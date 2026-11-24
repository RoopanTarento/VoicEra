"""Public demo builder: build a voice agent in three questions and test-call it
without signing up (the landing page and /try). See app/services/try_agent.py
and app/services/demo/."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from app.auth import get_current_user, verify_api_key
from app.config import settings
from app.services import try_agent
from app.services.demo import calls, sources

router = APIRouter(prefix="/try", tags=["try"])


class Answers(BaseModel):
    """The visitor's answers to the builder's questions (ids from the catalogue)."""

    template_id: str = Field(min_length=1, max_length=40)
    sector_id: str = Field(min_length=1, max_length=40)
    language: str = Field(min_length=1, max_length=8)
    topic: Optional[str] = Field(default=None, max_length=400)
    sample_knowledge: bool = True
    excluded_cards: list[str] = Field(default_factory=list, max_length=200)
    source_ids: list[str] = Field(default_factory=list, max_length=3)
    announcement: Optional[str] = Field(default=None, max_length=1400)
    audience: Optional[str] = Field(default=None, max_length=400)
    reminder: Optional[str] = Field(default=None, max_length=600)
    if_cant_make_it: Optional[Literal["reschedule", "helpline"]] = None
    survey_questions: Optional[list[str]] = Field(default=None, max_length=8)
    complaint_flows: Optional[list[str]] = Field(default=None, max_length=16)
    service_card_id: Optional[str] = Field(default=None, max_length=40)

    def as_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class AgentRequest(BaseModel):
    answers: Answers


class PrepareRequest(AgentRequest):
    greeting: Optional[str] = Field(default=None, max_length=try_agent.MAX_GREETING_CHARS * 2)


class RouteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)


class LinkRequest(BaseModel):
    url: str = Field(min_length=8, max_length=1000)


class CallRequest(BaseModel):
    agent_id: str = Field(min_length=1, max_length=64)
    preview_token: str = Field(min_length=1, max_length=128)


class CallRef(CallRequest):
    call_id: str = Field(min_length=1, max_length=64)


class TranslateRequest(BaseModel):
    language: str = Field(min_length=1, max_length=8)
    texts: list[str] = Field(max_length=try_agent.MAX_TEXTS)


class TranscriptTurn(BaseModel):
    role: Literal["agent", "user"]
    text: str = Field(max_length=try_agent.MAX_CHARS * 4)


class SummaryRequest(CallRef):
    transcript: list[TranscriptTurn] = Field(default_factory=list, max_length=try_agent.MAX_TRANSCRIPT_TURNS * 2)


class ToolRequest(BaseModel):
    org_id: str = Field(min_length=1, max_length=64)
    agent_id: str = Field(min_length=1, max_length=64)
    call_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=40)
    args: dict[str, Any] = Field(default_factory=dict)


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
    """Templates, sectors and languages (with whether a test call works in each)."""
    _enabled()
    data = try_agent.catalogue()
    ready = set(try_agent.call_languages())
    data["languages"] = [{**lang, "call_ready": lang["code"] in ready} for lang in data["languages"]]
    return data


@router.get("/sources")
async def sources_view(
    template_id: str = Query(min_length=1, max_length=40),
    sector_id: str = Query(min_length=1, max_length=40),
    topic: str = Query(default="", max_length=400),
) -> dict[str, Any]:
    """What the first two questions show for this template and sector."""
    _enabled()
    try:
        return try_agent.sources_view(template_id, sector_id, topic)
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/route")
async def route(body: RouteRequest, request: Request) -> dict[str, Any]:
    """The "Describe your agent" box: template, sector, topic and language."""
    _enabled()
    try:
        return await try_agent.route(body.text, _client_ip(request))
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/sources/upload")
async def add_upload(file: UploadFile, request: Request) -> dict[str, Any]:
    """A document whose text becomes session-only cards."""
    _enabled()
    data = await file.read(sources.MAX_UPLOAD_BYTES + 1)
    try:
        return try_agent.add_upload(file.filename or "document", data, _client_ip(request))
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/sources/link")
async def add_link(body: LinkRequest, request: Request) -> dict[str, Any]:
    """A public page whose text becomes session-only cards."""
    _enabled()
    try:
        return await try_agent.add_link(body.url, _client_ip(request))
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/agent")
async def agent(body: AgentRequest, request: Request) -> dict[str, Any]:
    """The agent for these answers: its greeting (in the call language, with
    the English), what it loaded, the tester's role card and the call stack.
    The prompt stays on the server."""
    _enabled()
    try:
        return await try_agent.build(body.answers.as_dict(), _client_ip(request))
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/prepare")
async def prepare(body: PrepareRequest, request: Request) -> dict[str, Any]:
    """A short-lived agent to test-call, and the token that lets this visitor call it."""
    _enabled()
    try:
        return await try_agent.prepare_call(body.answers.as_dict(), body.greeting, _client_ip(request))
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


@router.post("/progress")
async def progress(body: CallRef) -> dict[str, Any]:
    """The flow and step the call is on (shown as tags in the team's review build)."""
    _enabled()
    try:
        return try_agent.call_progress(body.agent_id, body.preview_token, body.call_id)
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/summary")
async def summary(body: SummaryRequest, request: Request) -> dict[str, Any]:
    """The call record for "How your test call went"."""
    _enabled()
    try:
        return await try_agent.summarise(
            body.agent_id, body.preview_token, body.call_id, [t.model_dump() for t in body.transcript], _client_ip(request)
        )
    except try_agent.TryError as exc:
        _raise(exc)
        raise


@router.post("/save")
async def save(body: PrepareRequest, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """After sign-in: create the tried agent in the caller's workspace."""
    try:
        agent_doc = await try_agent.save_to_workspace(
            str(current_user.get("org_id") or ""),
            str(current_user.get("email") or ""),
            body.answers.as_dict(),
            body.greeting,
        )
    except try_agent.TryError as exc:
        _raise(exc)
        raise
    return {"agent_id": agent_doc["agent_id"], "name": agent_doc.get("name")}


@router.post("/runtime/tool")
async def runtime_tool(body: ToolRequest, _: bool = Depends(verify_api_key)) -> dict[str, Any]:
    """The voice runtime's demo tools (internal API key). Refusals come back as
    ``{"error": ...}`` so the model can read them and recover."""
    return calls.run_tool_safely(body.org_id, body.agent_id, body.call_id, body.name, body.args)
