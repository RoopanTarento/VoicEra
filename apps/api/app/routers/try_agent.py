"""Public preview: build and test-call a scheme discovery agent without signing up."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.config import settings
from app.services import try_agent

router = APIRouter(prefix="/try", tags=["try"])


class AgentRequest(BaseModel):
    scheme_ids: list[str] = Field(min_length=1, max_length=16)
    language: str = Field(min_length=1, max_length=8)


class PrepareRequest(AgentRequest):
    greeting: Optional[str] = Field(default=None, max_length=try_agent.MAX_GREETING_CHARS * 2)


class CallRequest(BaseModel):
    agent_id: str = Field(min_length=1, max_length=64)
    preview_token: str = Field(min_length=1, max_length=128)


class TranslateRequest(BaseModel):
    language: str = Field(min_length=1, max_length=8)
    texts: list[str] = Field(max_length=try_agent.MAX_TEXTS)


class TranscriptTurn(BaseModel):
    role: Literal["agent", "user"]
    text: str = Field(max_length=try_agent.MAX_CHARS * 4)


class SummaryRequest(BaseModel):
    scheme_ids: list[str] = Field(min_length=1, max_length=16)
    transcript: list[TranscriptTurn] = Field(max_length=try_agent.MAX_TRANSCRIPT_TURNS * 2)


def _enabled() -> None:
    if not settings.TRY_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")


def _client_ip(request: Request) -> str | None:
    """The visitor's IP. Behind TRY_TRUSTED_PROXY_HOPS proxies (the Next.js
    server is one), it is that many entries from the right of
    X-Forwarded-For; entries further left are client-supplied and ignored."""
    hops = settings.TRY_TRUSTED_PROXY_HOPS
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if hops > 0 and len(forwarded) >= hops:
        return forwarded[-hops]
    return request.client.host if request.client else None


def _raise(exc: try_agent.TryError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/catalogue")
async def catalogue() -> dict[str, Any]:
    _enabled()
    return try_agent.catalogue()


@router.post("/agent")
async def agent(body: AgentRequest, request: Request) -> dict[str, Any]:
    """Name and opening line (in the chosen language, with the English) of the
    agent for these schemes, and what its test call runs on. The prompt stays
    on the server."""
    _enabled()
    try:
        result = await try_agent.opening_line(body.scheme_ids, body.language, _client_ip(request))
        try:
            result["stack"] = try_agent.stack_names(body.language)
        except try_agent.TryError as exc:
            result["stack"] = None
            result["stack_error"] = str(exc)
    except try_agent.TryError as exc:
        _raise(exc)
        raise
    return result


@router.post("/prepare")
async def prepare(body: PrepareRequest, request: Request) -> dict[str, Any]:
    """A short-lived agent to test-call, and the token that lets this visitor call it."""
    _enabled()
    try:
        return await try_agent.prepare_call(body.scheme_ids, body.language, body.greeting, _client_ip(request))
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/call")
async def call(body: CallRequest) -> dict[str, Any]:
    _enabled()
    try:
        return try_agent.register_call(body.agent_id, body.preview_token)
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/translate")
async def translate(body: TranslateRequest, request: Request) -> dict[str, Any]:
    """English lines for what was said on the test call."""
    _enabled()
    try:
        return {"english": await try_agent.to_english(body.language, body.texts, _client_ip(request))}
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/summary")
async def summary(body: SummaryRequest, request: Request) -> dict[str, Any]:
    """Schemes that may fit, others explained, and the outcome of the test call."""
    _enabled()
    try:
        return await try_agent.summarise(body.scheme_ids, [t.model_dump() for t in body.transcript], _client_ip(request))
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/save")
async def save(body: PrepareRequest, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """After sign-in: create the tried agent in the caller's workspace."""
    try:
        agent_doc = await try_agent.save_to_workspace(
            str(current_user.get("org_id") or ""), str(current_user.get("email") or ""),
            body.scheme_ids, body.language, body.greeting,
        )
    except try_agent.TryError as exc:
        _raise(exc)
        raise
    return {"agent_id": agent_doc["agent_id"], "name": agent_doc.get("name")}
