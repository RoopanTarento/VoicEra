"""Public preview: build and chat with a scheme discovery agent without signing up."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import settings
from app.services import try_agent

router = APIRouter(prefix="/try", tags=["try"])


class AgentRequest(BaseModel):
    scheme_ids: list[str] = Field(min_length=1, max_length=10)
    language: str = Field(min_length=1, max_length=8)


class ChatMessage(BaseModel):
    role: str = Field(max_length=16)
    content: str = Field(max_length=try_agent.MAX_CHARS * 2)


class ChatRequest(AgentRequest):
    # Empty: the agent's opening line in the chosen language.
    messages: list[ChatMessage] = Field(default_factory=list, max_length=try_agent.MAX_MESSAGES + 1)


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
async def agent(body: AgentRequest) -> dict[str, Any]:
    """Name, greeting and purpose of the agent for these schemes (the prompt stays on the server)."""
    _enabled()
    try:
        preset = try_agent.build_agent(body.scheme_ids, body.language)
    except try_agent.TryError as exc:
        _raise(exc)
        raise
    return {"name": preset["name"], "purpose": preset["purpose"], "welcome": preset["welcome"]}


@router.post("/chat")
async def chat(body: ChatRequest, request: Request) -> dict[str, str | None]:
    """The agent's next reply, plus an English line when it speaks another language."""
    _enabled()
    ip = _client_ip(request)
    try:
        if not body.messages:
            return await try_agent.greeting(body.scheme_ids, body.language, ip)
        return await try_agent.chat(body.scheme_ids, body.language, [m.model_dump() for m in body.messages], ip)
    except try_agent.TryError as exc:
        _raise(exc)
        raise
