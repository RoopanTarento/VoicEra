"""Agent create / list / get / update / delete routes."""

from __future__ import annotations

from typing import Any, Literal

from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import get_current_user, verify_api_key
from app.database_init import ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.models.schemas import (
    AgentCreateRequest,
    AgentResponse,
    AgentUpdateRequest,
    SuccessResponse,
)
from app.services import agent_service, audit_log, phone_number_service
from app.services.agent_config_validation import AgentConfigValidationError
from app.services.agent_service import AgentConflictError, AgentNotFoundError
from app.services.agent_telephony_service import AgentTelephonyError
from app.services.copilot.engine import _PROVIDER_BASE_URLS, _resolve_api_key
from app.services.phone_number_service import PhoneNumberError
from openai import AsyncOpenAI

router = APIRouter(prefix="/agents", tags=["agents"])

_DELETE_ROLES = frozenset({ROLE_SUPER_ADMIN, ROLE_ADMIN})


def _require_active_org(current_user: dict[str, Any]) -> str:
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active organisation in token",
        )
    return str(org_id)


def _require_delete_role(current_user: dict[str, Any]) -> None:
    if current_user.get("role") not in _DELETE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can delete agents",
        )


def _raise_agent_validation(exc: AgentConfigValidationError) -> None:
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=str(exc),
    ) from exc


def _raise_agent_conflict(exc: AgentConflictError) -> None:
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=str(exc),
    ) from exc


def _raise_agent_not_found(exc: AgentNotFoundError) -> None:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=str(exc),
    ) from exc


def _raise_agent_telephony(exc: AgentTelephonyError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail=exc.message,
    ) from exc


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(
    body: AgentCreateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Create an agent in the caller's active organisation (any member)."""
    org_id = _require_active_org(current_user)
    try:
        created = await agent_service.create_agent(
            org_id,
            str(current_user["email"]),
            body,
        )
        audit_log.record(
            org_id,
            entity_type="agent",
            action="created",
            actor_email=str(current_user["email"]),
            actor_role=str(current_user.get("role") or ""),
            entity_id=created.get("agent_id"),
            entity_name=created.get("name"),
        )
        return created
    except AgentConfigValidationError as exc:
        _raise_agent_validation(exc)
    except AgentTelephonyError as exc:
        _raise_agent_telephony(exc)
    except AgentConflictError as exc:
        _raise_agent_conflict(exc)


@router.get("", response_model=list[AgentResponse])
async def list_agents(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """List agents for the caller's active organisation."""
    org_id = _require_active_org(current_user)
    return agent_service.list_agents(org_id)


@router.get("/by-phone/{phone_number}", response_model=AgentResponse)
async def get_agent_by_phone_number(
    phone_number: str,
    _: bool = Depends(verify_api_key),
) -> dict[str, Any]:
    """Resolve agent by linked phone number (voice server; X-API-Key)."""
    decoded = unquote(phone_number)
    try:
        return phone_number_service.get_agent_by_phone(decoded)
    except PhoneNumberError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.message,
        ) from exc


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    agent_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Get one agent by id (same organisation only)."""
    org_id = _require_active_org(current_user)
    try:
        return agent_service.get_agent(org_id, agent_id)
    except AgentNotFoundError as exc:
        _raise_agent_not_found(exc)


class AgentTextChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentTextChatRequest(BaseModel):
    org_id: str
    # Empty on purpose for an outbound call's opening turn: the caller wants
    # just the agent's real configured greeting, not a generated reply.
    messages: list[AgentTextChatMessage] = Field(default_factory=list, max_length=40)


class AgentTextChatResponse(BaseModel):
    reply: str
    agent_name: str
    model: str


@router.post(
    "/{agent_id}/text-chat",
    response_model=AgentTextChatResponse,
    dependencies=[Depends(verify_api_key)],
)
async def agent_text_chat(agent_id: str, body: AgentTextChatRequest) -> AgentTextChatResponse:
    """Internal-only: run one text turn against a real stored agent's system
    prompt and LLM config, for an external orchestrated client (e.g. a
    standalone citizen-facing app) that wants VoicERA to be the actual
    orchestration brain without ever handling a provider credential itself.
    Reuses the exact credential-resolution path the Copilot already uses —
    no new secret handling is introduced by this endpoint.
    """
    try:
        agent = agent_service.get_agent(body.org_id, agent_id)
    except AgentNotFoundError as exc:
        _raise_agent_not_found(exc)

    config = agent["config"]

    if not body.messages:
        # Opening turn of a call (inbound or outbound): the real configured
        # greeting is a fixed string, not something to generate — mirrors
        # how the actual voice pipeline plays greeting_message verbatim
        # before any LLM turn happens.
        return AgentTextChatResponse(
            reply=config["prompts"]["greeting_message"],
            agent_name=agent["name"],
            model=config["models"]["llm_config"].get("model", ""),
        )

    system_prompt = config["prompts"]["system_prompt"]
    for key, value in (config.get("custom_variables") or {}).items():
        system_prompt = system_prompt.replace("{{" + key + "}}", str(value))

    llm_config = config["models"]["llm_config"]
    provider = llm_config.get("provider") or "openai"
    model = llm_config.get("model") or "gpt-4o-mini"

    api_key = _resolve_api_key(body.org_id, provider)
    client_kwargs: dict[str, Any] = {"api_key": api_key, "max_retries": 0}
    base_url = _PROVIDER_BASE_URLS.get(provider)
    if base_url:
        client_kwargs["base_url"] = base_url
    client = AsyncOpenAI(**client_kwargs)

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend({"role": m.role, "content": m.content} for m in body.messages)

    # Reasoning models (e.g. Groq's openai/gpt-oss-20b) spend part of max_tokens
    # on hidden chain-of-thought before any visible content. A low ceiling here
    # was causing real, reproducible empty replies once a conversation had
    # enough context to need more reasoning (finish_reason "length" with the
    # whole budget spent on reasoning_tokens). 2000 covers that for real
    # conversations seen so far; the retry below is a second real safety net,
    # not a substitute — a genuinely empty completion on a fresh attempt is
    # rare but real, so one retry with a larger budget before giving up.
    reply = ""
    for attempt_max_tokens in (2000, 3000):
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=attempt_max_tokens,
        )
        reply = (response.choices[0].message.content or "").strip()
        if reply:
            break
    return AgentTextChatResponse(reply=reply or "Could you say that again?", agent_name=agent["name"], model=model)


@router.patch("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: str,
    body: AgentUpdateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Update an agent in the caller's active organisation (any member)."""
    org_id = _require_active_org(current_user)
    try:
        updated = await agent_service.update_agent(org_id, agent_id, body)
        audit_log.record(
            org_id,
            entity_type="agent",
            action="updated",
            actor_email=str(current_user["email"]),
            actor_role=str(current_user.get("role") or ""),
            entity_id=agent_id,
            entity_name=updated.get("name"),
        )
        return updated
    except AgentConfigValidationError as exc:
        _raise_agent_validation(exc)
    except AgentTelephonyError as exc:
        _raise_agent_telephony(exc)
    except AgentConflictError as exc:
        _raise_agent_conflict(exc)
    except AgentNotFoundError as exc:
        _raise_agent_not_found(exc)


@router.delete("/{agent_id}", response_model=SuccessResponse)
async def delete_agent(
    agent_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> SuccessResponse:
    """Delete an agent (admin / super_admin only)."""
    _require_delete_role(current_user)
    org_id = _require_active_org(current_user)
    try:
        deleted_name = await agent_service.delete_agent(org_id, agent_id)
    except AgentNotFoundError as exc:
        _raise_agent_not_found(exc)
    audit_log.record(
        org_id,
        entity_type="agent",
        action="deleted",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=agent_id,
        entity_name=deleted_name,
    )
    return SuccessResponse(message=f"Agent deleted: {agent_id}")
