"""VoicERA Copilot API: streaming chat + conversation history.

Scoping mirrors every other router in this API: the active organisation and
user come from the JWT (``get_current_user``), never from the request body,
and every service call below is org- and user-scoped.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response, StreamingResponse

from app.config import settings
from app.auth import get_current_user, verify_api_key
from app.models.schemas import (
    AgentCreateRequest,
    AgentUpdateRequest,
    CopilotAgentDraftConfirmResponse,
    CopilotAgentDraftDismissResponse,
    CopilotAttachmentUploadResponse,
    CopilotCampaignDraftConfirmResponse,
    CopilotChatRequest,
    CopilotConversationDeleteResponse,
    CopilotConversationDetail,
    CopilotConversationSummary,
    CopilotConversationTruncateRequest,
    CopilotConversationTruncateResponse,
    CopilotImprovePromptRequest,
    CopilotImprovePromptResponse,
    CopilotVoiceSessionBundle,
    CopilotVoiceSessionCreateResponse,
    CopilotVoiceToolExecuteRequest,
    CopilotVoiceToolExecuteResponse,
    CopilotVoiceTurnRequest,
    CreateCampaignRequest,
)
from app.services import agent_service, audit_log
from app.services.agent_config_validation import AgentConfigValidationError
from app.services.agent_service import AgentConflictError
from app.services.agent_telephony_service import AgentTelephonyError
from app.routers.campaign import _to_campaign_response, _validate_max_concurrency, _validate_telephony_agent
from app.services.campaign import campaign_repository
from app.services.copilot import attachment_store, conversation_store, documents, draft_store, voice_session_store
from app.services.copilot.engine import (
    CopilotConfigurationError,
    SYSTEM_PROMPT_TEMPLATE,
    _execute_tool,
    improve_prompt_text,
    run_copilot_turn,
)
from openai import APIError, RateLimitError
from app.services.copilot.voice import build_copilot_voice_agent, copilot_voice_tool_names
from app.storage.minio_client import MinIOStorage

_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
# Browsers report a CSV's type inconsistently (text/csv, application/vnd.ms-excel,
# or nothing at all) — the .csv extension is the more reliable signal in practice.
_CSV_FALLBACK_TYPES = {"text/csv", "application/vnd.ms-excel", "application/octet-stream", "text/plain", ""}

router = APIRouter(prefix="/copilot", tags=["copilot"])


def _require_active_org(current_user: dict[str, Any]) -> str:
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active organisation in token",
        )
    return str(org_id)


@router.post("/chat")
async def copilot_chat(
    body: CopilotChatRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    """Stream a Copilot response as Server-Sent Events.

    Event payloads (JSON per ``data:`` line): ``start``, ``token``,
    ``tool_call``, ``tool_result``, ``done``, ``error``.
    """
    org_id = _require_active_org(current_user)
    context = body.context.model_dump(exclude_none=True) if body.context else None

    generator = run_copilot_turn(
        org_id=org_id,
        user_email=str(current_user.get("email")),
        role=str(current_user.get("role") or "member"),
        message=body.message,
        conversation_id=body.conversation_id,
        context=context,
        ephemeral=body.ephemeral,
        history=[m.model_dump() for m in body.history],
        attachment_ids=body.attachment_ids,
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/improve-prompt", response_model=CopilotImprovePromptResponse)
async def copilot_improve_prompt(
    body: CopilotImprovePromptRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotImprovePromptResponse:
    """Fix spelling/grammar in a draft message before the user sends it —
    a real, tiny, non-streaming LLM call (its own dedicated micro-prompt,
    no tool schemas), never a fabricated/local text transform."""
    org_id = _require_active_org(current_user)
    try:
        improved = await improve_prompt_text(org_id, body.text)
    except CopilotConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except RateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The model provider is rate-limiting requests — try again shortly.",
        ) from exc
    except APIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The model provider had an unexpected error — try again.",
        ) from exc
    return CopilotImprovePromptResponse(improved=improved)


@router.post("/attachments", response_model=CopilotAttachmentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_copilot_attachment(
    file: UploadFile,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotAttachmentUploadResponse:
    """Upload one image, contacts CSV or document (PDF, Word, PowerPoint,
    Excel, text) to attach to a Copilot message. Stored in MinIO; Mongo keeps
    only metadata, plus a document's extracted text (never the raw bytes)."""
    org_id = _require_active_org(current_user)
    content_type = (file.content_type or "").lower()
    filename = file.filename or ""
    is_csv = filename.lower().endswith(".csv") and content_type in _CSV_FALLBACK_TYPES
    document_type = documents.document_type(filename)
    if is_csv:
        content_type = "text/csv"
    elif document_type:
        content_type = document_type
    elif content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported attachment type: {content_type or 'unknown'}. Attach an image, CSV, "
                "PDF, Word, PowerPoint, Excel or text file."
            ),
        )
    max_bytes = settings.COPILOT_DOCUMENT_MAX_BYTES if document_type else settings.COPILOT_ATTACHMENT_MAX_BYTES
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large (max {max_bytes // (1024 * 1024)} MB)",
        )

    safe_name = (filename or "image").rsplit("/", 1)[-1]
    extracted_text: str | None = None
    if document_type:
        try:
            # Parsing a large PDF is CPU work; keep it off the event loop.
            extracted_text = await asyncio.to_thread(documents.extract_text, safe_name, data)
        except documents.DocumentError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    storage_key = f"copilot/{org_id}/{uuid.uuid4()}_{safe_name}"

    storage = MinIOStorage()
    await storage.put_object_bytes(storage_key, data, content_type=content_type)

    attachment = attachment_store.create_attachment(
        org_id,
        str(current_user["email"]),
        storage_key=storage_key,
        content_type=content_type,
        original_filename=safe_name,
        size_bytes=len(data),
        extracted_text=extracted_text,
    )
    return CopilotAttachmentUploadResponse(
        attachment_id=attachment["attachment_id"],
        content_type=attachment["content_type"],
        original_filename=attachment["original_filename"],
    )


@router.get("/attachments/{attachment_id}")
async def get_copilot_attachment(
    attachment_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    """Stream back a previously-uploaded attachment — org-scoped, same as
    every other resource in this API; never a public MinIO URL."""
    org_id = _require_active_org(current_user)
    try:
        attachment = attachment_store.get_attachment(org_id, attachment_id)
    except attachment_store.CopilotAttachmentNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found") from None

    storage = MinIOStorage()
    data = await storage.get_object_bytes(attachment["storage_key"])
    return Response(content=data, media_type=attachment["content_type"])


@router.get("/conversations", response_model=list[CopilotConversationSummary])
async def list_conversations(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """List the caller's own Copilot conversations in their active organisation."""
    org_id = _require_active_org(current_user)
    return conversation_store.list_conversations(org_id, str(current_user.get("email")))


@router.get("/conversations/{conversation_id}", response_model=CopilotConversationDetail)
async def get_conversation(
    conversation_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch one conversation with its full message history."""
    org_id = _require_active_org(current_user)
    try:
        return conversation_store.get_conversation(
            org_id, str(current_user.get("email")), conversation_id
        )
    except conversation_store.CopilotConversationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        ) from exc


@router.post(
    "/conversations/{conversation_id}/truncate",
    response_model=CopilotConversationTruncateResponse,
)
async def truncate_conversation(
    conversation_id: str,
    body: CopilotConversationTruncateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotConversationTruncateResponse:
    """Drop stored messages from keep_count onward, before the client resends
    an edited past message as a fresh turn from that point."""
    org_id = _require_active_org(current_user)
    try:
        conversation_store.truncate_messages(
            org_id, str(current_user.get("email")), conversation_id, body.keep_count
        )
    except conversation_store.CopilotConversationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        ) from exc
    return CopilotConversationTruncateResponse(truncated=True)


@router.delete("/conversations/{conversation_id}", response_model=CopilotConversationDeleteResponse)
async def delete_conversation(
    conversation_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotConversationDeleteResponse:
    """Delete one of the caller's own Copilot conversations."""
    org_id = _require_active_org(current_user)
    try:
        conversation_store.delete_conversation(
            org_id, str(current_user.get("email")), conversation_id
        )
    except conversation_store.CopilotConversationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        ) from exc
    return CopilotConversationDeleteResponse(deleted=True)


@router.post("/agent-drafts/{draft_id}/confirm", response_model=CopilotAgentDraftConfirmResponse)
async def confirm_agent_draft(
    draft_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotAgentDraftConfirmResponse:
    """Turn a Copilot-proposed agent draft into a real create or update.

    This is the only place a Copilot conversation can produce a real write —
    and it only runs when the user clicks Confirm, never automatically as
    part of a chat turn. Branches on the draft's entity_type but calls the
    exact same ``agent_service.create_agent`` / ``update_agent`` every other
    agent path (the wizard, the API) uses either way; the Copilot just
    validated and staged the config ahead of time.
    """
    org_id = _require_active_org(current_user)
    email = str(current_user.get("email"))
    try:
        draft = draft_store.get_pending_draft(org_id, email, draft_id)
    except draft_store.CopilotDraftNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Draft not found, already resolved, or not yours",
        ) from exc

    if draft.get("entity_type") == "agent_update":
        agent_id = draft["create_payload"]["agent_id"]
        update_payload = AgentUpdateRequest.model_validate(draft["create_payload"]["update_payload"])
        try:
            updated = await agent_service.update_agent(org_id, agent_id, update_payload)
        except agent_service.AgentNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except AgentConfigValidationError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        except AgentConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        except AgentTelephonyError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

        draft_store.resolve_draft(org_id, email, draft_id, "confirmed")
        audit_log.record(
            org_id,
            entity_type="agent",
            action="updated",
            actor_email=email,
            actor_role=str(current_user.get("role") or ""),
            entity_id=updated["agent_id"],
            entity_name=updated["name"],
            detail="updated via Ask VoicEra",
        )
        return CopilotAgentDraftConfirmResponse(
            agent_id=updated["agent_id"],
            name=updated["name"],
            status=updated["status"],
        )

    payload = AgentCreateRequest.model_validate(draft["create_payload"])
    try:
        created = await agent_service.create_agent(org_id, email, payload)
    except AgentConfigValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except AgentConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except AgentTelephonyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    draft_store.resolve_draft(org_id, email, draft_id, "confirmed")
    audit_log.record(
        org_id,
        entity_type="agent",
        action="created",
        actor_email=email,
        actor_role=str(current_user.get("role") or ""),
        entity_id=created["agent_id"],
        entity_name=created["name"],
        detail="created via Ask VoicEra",
    )
    return CopilotAgentDraftConfirmResponse(
        agent_id=created["agent_id"],
        name=created["name"],
        status=created["status"],
    )


@router.post("/agent-drafts/{draft_id}/dismiss", response_model=CopilotAgentDraftDismissResponse)
async def dismiss_agent_draft(
    draft_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotAgentDraftDismissResponse:
    """Discard a Copilot-proposed agent draft without creating anything."""
    org_id = _require_active_org(current_user)
    try:
        draft_store.resolve_draft(org_id, str(current_user.get("email")), draft_id, "dismissed")
    except draft_store.CopilotDraftNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Draft not found, already resolved, or not yours",
        ) from exc
    return CopilotAgentDraftDismissResponse(dismissed=True)


@router.post("/campaign-drafts/{draft_id}/confirm", response_model=CopilotCampaignDraftConfirmResponse)
async def confirm_campaign_draft(
    draft_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotCampaignDraftConfirmResponse:
    """Turn a Copilot-proposed campaign draft into a real campaign.

    Re-runs the exact same telephony-agent and concurrency checks the real
    campaign wizard uses (state may have changed since the draft was
    proposed — e.g. the agent's phone number could have been detached).
    """
    org_id = _require_active_org(current_user)
    email = str(current_user.get("email"))
    try:
        draft = draft_store.get_pending_draft(org_id, email, draft_id)
    except draft_store.CopilotDraftNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Draft not found, already resolved, or not yours",
        ) from exc

    payload = CreateCampaignRequest.model_validate(draft["create_payload"])
    _validate_telephony_agent(org_id, payload.agent_id)
    _validate_max_concurrency(org_id, payload.agent_id, payload.max_concurrency)

    doc = campaign_repository.create_campaign(
        {
            "org_id": org_id,
            "name": payload.name,
            "agent_id": payload.agent_id,
            "source_type": payload.source_type,
            "source_id": payload.source_id,
            "rate_limit_per_second": payload.rate_limit_per_second,
            "created_by": email,
        }
    )
    draft_store.resolve_draft(org_id, email, draft_id, "confirmed")
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="created",
        actor_email=email,
        actor_role=str(current_user.get("role") or ""),
        entity_id=doc.get("campaign_id"),
        entity_name=doc.get("name"),
        detail="created via Ask VoicEra",
    )
    response = _to_campaign_response(doc)
    return CopilotCampaignDraftConfirmResponse(
        campaign_id=response.campaign_id, name=response.name, state=str(response.state)
    )


@router.post("/campaign-drafts/{draft_id}/dismiss", response_model=CopilotAgentDraftDismissResponse)
async def dismiss_campaign_draft(
    draft_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotAgentDraftDismissResponse:
    """Discard a Copilot-proposed campaign draft without creating anything."""
    org_id = _require_active_org(current_user)
    try:
        draft_store.resolve_draft(org_id, str(current_user.get("email")), draft_id, "dismissed")
    except draft_store.CopilotDraftNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Draft not found, already resolved, or not yours",
        ) from exc
    return CopilotAgentDraftDismissResponse(dismissed=True)


# ---------------------------------------------------------------------------
# Voice mode
#
# The browser only ever calls /voice/session (normal JWT auth) to get a bare
# session_id, then hands that to apps/runtime over a WebSocket URL — the
# browser itself never sees an LLM/provider credential. Everything below
# that is internal-only (verify_api_key), called by the runtime process the
# same way it already calls /rag/retrieve for regular agent calls.
# ---------------------------------------------------------------------------


@router.post("/voice/session", response_model=CopilotVoiceSessionCreateResponse)
async def create_voice_session(
    conversation_id: str | None = None,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopilotVoiceSessionCreateResponse:
    """Create a short-lived voice session; the browser uses it to open the
    runtime's WebSocket. Optionally links to an existing text conversation so
    voice and text share one history (see /voice/session/{id}/turn)."""
    org_id = _require_active_org(current_user)
    session = voice_session_store.create_session(
        org_id,
        str(current_user.get("email")),
        str(current_user.get("role") or "member"),
        conversation_id,
    )
    return CopilotVoiceSessionCreateResponse(
        session_id=session["session_id"],
        ws_path=f"/copilot-agent/{session['session_id']}",
        conversation_id=conversation_id,
    )


@router.post("/voice/session/{session_id}/end")
async def end_voice_session(
    session_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
    """User-initiated end (e.g. closing the voice panel before connecting)."""
    org_id = _require_active_org(current_user)
    try:
        voice_session_store.end_session(org_id, str(current_user.get("email")), session_id)
    except voice_session_store.CopilotVoiceSessionNotFoundError:
        pass  # already ended/expired — end is idempotent from the caller's view
    return {"ended": True}


@router.get(
    "/voice/session/{session_id}/bundle",
    response_model=CopilotVoiceSessionBundle,
    dependencies=[Depends(verify_api_key)],
)
async def get_voice_session_bundle(session_id: str) -> CopilotVoiceSessionBundle:
    """Internal: redeem a session and return everything apps/runtime needs to
    build the Pipecat pipeline. Never called by the browser."""
    try:
        session = voice_session_store.redeem_session(session_id)
    except voice_session_store.CopilotVoiceSessionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voice session not found, expired, or already ended",
        ) from exc

    org_id = session["org_id"]
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        org_id=org_id,
        role=session["role"],
        today=date.today().isoformat(),
        page_context="",
    )
    try:
        agent = build_copilot_voice_agent(org_id, base_system_prompt=system_prompt)
    except Exception as exc:  # CopilotConfigurationError or a provider/validation error
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail=f"Voice mode isn't ready for this organisation yet: {exc}",
        ) from exc

    return CopilotVoiceSessionBundle(
        org_id=org_id,
        created_by=session["created_by"],
        role=session["role"],
        conversation_id=session.get("conversation_id"),
        agent=agent,
        tool_names=copilot_voice_tool_names(),
    )


@router.post(
    "/voice/session/{session_id}/tool",
    response_model=CopilotVoiceToolExecuteResponse,
    dependencies=[Depends(verify_api_key)],
)
async def execute_voice_tool(
    session_id: str,
    body: CopilotVoiceToolExecuteRequest,
) -> CopilotVoiceToolExecuteResponse:
    """Internal: execute one Copilot tool call made mid-voice-conversation.

    Reuses engine._execute_tool unchanged — the identical dispatch, error
    handling, and org-scoping the text Copilot uses; a voice tool call cannot
    do anything a text tool call couldn't already do.
    """
    try:
        session = voice_session_store.redeem_session(session_id)
    except voice_session_store.CopilotVoiceSessionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voice session not found, expired, or already ended",
        ) from exc

    result, ok = _execute_tool(
        session["org_id"],
        body.tool,
        body.arguments,
        user_email=session["created_by"],
        user_role=session.get("role") or "",
        conversation_id=session.get("conversation_id"),
    )
    return CopilotVoiceToolExecuteResponse(ok=ok, data=result)


@router.post(
    "/voice/session/{session_id}/turn",
    dependencies=[Depends(verify_api_key)],
)
async def append_voice_turn(session_id: str, body: CopilotVoiceTurnRequest) -> dict[str, bool]:
    """Internal: append one completed spoken turn to the linked text
    conversation, if any, so voice and text share one history."""
    try:
        session = voice_session_store.redeem_session(session_id)
    except voice_session_store.CopilotVoiceSessionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voice session not found, expired, or already ended",
        ) from exc

    conversation_id = session.get("conversation_id")
    if not conversation_id:
        return {"appended": False}

    try:
        conversation_store.append_messages(
            session["org_id"],
            session["created_by"],
            conversation_id,
            [
                {
                    "role": body.role,
                    "content": body.content,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "tool_calls": [],
                }
            ],
        )
    except conversation_store.CopilotConversationNotFoundError:
        return {"appended": False}
    return {"appended": True}
