"""Copilot tools: deterministic, org-scoped read functions the LLM may call.

Every function here takes ``org_id`` as its first argument, and ``org_id`` is
always bound by the engine from the authenticated request context — it is
never a parameter the LLM can set. This is the isolation boundary: no tool
argument, however the model is prompted, can make it read another
organisation's data.

Every tool except one only *reads*. ``propose_create_agent`` is the one
write-adjacent tool, and it does not create anything: it validates a
candidate agent config with the same validator real agent creation uses and
stores it as an unsaved draft (draft_store.py). The model can never turn a
draft into a real agent — only a human clicking "Create" in the UI does that
(see routers/copilot.py's confirm endpoint, which calls the same
agent_service.create_agent every other agent-creation path uses).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.database import get_database
from app.database_init import ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.models.schemas import AgentConfigPayload
from app.services import agent_service, audit_log, auth_service, knowledge_service
from app.services.agent_config_validation import validate_agent_config
from app.services.call_log_service import (
    CallLogNotFoundError,
    get_call_log,
    get_org_call_analytics,
)
from app.config import settings
from app.services.agent_service import AgentNotFoundError
from app.services.campaign import campaign_repository
from app.services.copilot import draft_store
from app.services.secure.masking import mask_call_log
from app.storage.minio_client import MinIOStorage
from apps.providers.availability import is_authenticated
from apps.providers.base import Kind
from apps.providers.schema import list_providers, provider_settings

logger = logging.getLogger(__name__)

# The Copilot never provisions real telephony infrastructure (a live Vobiz/
# Plivo application) from a chat turn — only the safe, no-external-side-effect
# "websocket" (browser test) agent category. Attaching a phone number stays a
# deliberate action in the Numbers UI, same as for any other websocket agent.
_DRAFT_AGENT_CATEGORY = "websocket"

# Fallback STT/TTS/LLM combination when the org has no existing agent to copy
# model choices from — the exact combination already used by every OpenAI-only
# fixture/example in this codebase (see tests/test_knowledge.py, schemas.py's
# own AgentCreateRequest example), so it's a known-valid shape, not a guess.
FALLBACK_STT_TTS_MODELS = {
    "stt_config": {"provider": "openai", "model": "gpt-4o-transcribe"},
    "tts_config": {"provider": "openai", "model": "gpt-4o-mini-tts", "voice": "alloy"},
    "llm_config": {"provider": "openai", "model": "gpt-4o-mini"},
}


class CopilotToolError(Exception):
    """Raised by a tool for a user-facing, non-fatal failure (bad args, not found)."""


def _trim(text: str | None, limit: int = 400) -> str | None:
    if not text:
        return text
    text = str(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


# Semantic provenance for a proposed field: did the user say this explicitly,
# did the model infer it from business intent, or is it a technical default
# the model picked because nobody cared to specify one? Shown honestly in the
# artifact UI (see AgentDraftCard) instead of presenting every filled-in
# field as if the user had chosen it — the whole point is never letting an
# inference masquerade as a confirmed user decision.
_PROVENANCE_VALUES = {"inferred", "recommended", "user_selected"}


def _sanitize_field_provenance(
    provenance: dict[str, Any] | None, known_fields: set[str]
) -> dict[str, str]:
    """Drop any entry for a field that isn't real or a value that isn't one
    of the three allowed labels — a malformed/hallucinated provenance entry
    must never break draft creation, it just doesn't get shown."""
    if not isinstance(provenance, dict):
        return {}
    return {
        field: value
        for field, value in provenance.items()
        if field in known_fields and value in _PROVENANCE_VALUES
    }


def list_agents(org_id: str, *, status: str | None = None, limit: int = 20) -> dict[str, Any]:
    """List the organisation's agents (name, category, status, language, models)."""
    agents = agent_service.list_agents(org_id)
    if status:
        agents = [a for a in agents if a.get("status") == status]
    agents = agents[: max(1, min(limit, 50))]
    rows = []
    for a in agents:
        config = a.get("config") or {}
        models = config.get("models") or {}
        rows.append(
            {
                "agent_id": a.get("agent_id"),
                "name": a.get("name"),
                "status": a.get("status"),
                "archived": a.get("archived", False),
                "agent_category": a.get("agent_category"),
                "primary_language": (config.get("language") or {}).get("primary"),
                "llm": (models.get("llm_config") or {}).get("model"),
                "knowledge_base_enabled": (config.get("knowledge_base") or {}).get("enabled", False),
                "linked_phone_number": a.get("linked_phone_number"),
                "created_at": a.get("created_at"),
            }
        )
    return {"count": len(rows), "agents": rows}


def get_agent(org_id: str, *, agent_id: str) -> dict[str, Any]:
    """Fetch one agent's configuration summary (prompt, models, behaviour, KB)."""
    try:
        agent = agent_service.get_agent(org_id, agent_id)
    except agent_service.AgentNotFoundError as exc:
        raise CopilotToolError(f"No agent with id '{agent_id}' in this organisation.") from exc

    config = agent.get("config") or {}
    prompts = config.get("prompts") or {}
    return {
        "agent_id": agent.get("agent_id"),
        "name": agent.get("name"),
        "status": agent.get("status"),
        "archived": agent.get("archived", False),
        "agent_category": agent.get("agent_category"),
        "system_prompt": _trim(prompts.get("system_prompt"), 1200),
        "greeting_message": prompts.get("greeting_message"),
        "language": config.get("language"),
        "models": config.get("models"),
        "knowledge_base": config.get("knowledge_base"),
        "behaviour": config.get("behaviour"),
        "linked_phone_number": agent.get("linked_phone_number"),
        "created_at": agent.get("created_at"),
        "updated_at": agent.get("updated_at"),
    }


def list_calls(
    org_id: str,
    *,
    agent_id: str | None = None,
    status: str | None = None,
    call_response: str | None = None,
    days: int | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """List recent calls, optionally filtered by agent, status, outcome, or recency."""
    query: dict[str, Any] = {"org_id": org_id}
    if agent_id:
        query["agent_id"] = agent_id
    if status:
        query["status"] = status
    if call_response:
        query["call_response"] = call_response
    if days:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, days))).isoformat()
        query["created_at"] = {"$gte": cutoff}

    limit = max(1, min(limit, 100))
    cursor = (
        get_database()["CallLogs"]
        .find(query)
        .sort("created_at", -1)
        .limit(limit)
    )
    rows = []
    for raw in cursor:
        # Call data is sent to an external LLM: contact numbers go out masked.
        doc, _ = mask_call_log(raw)
        rows.append(
            {
                "call_id": doc.get("call_id"),
                "agent_id": doc.get("agent_id"),
                "agent_name": doc.get("agent_name"),
                "call_type": doc.get("call_type"),
                "status": doc.get("status"),
                "call_response": doc.get("call_response"),
                "from_number": doc.get("from_number"),
                "to_number": doc.get("to_number"),
                "duration": doc.get("duration"),
                "campaign_id": doc.get("campaign_id"),
                "error_message": _trim(doc.get("error_message"), 200),
                "created_at": doc.get("created_at"),
            }
        )
    applied_filters = {k: v for k, v in query.items() if k != "org_id"}
    return {"count": len(rows), "filters": applied_filters, "calls": rows}


def get_call(org_id: str, *, call_id: str) -> dict[str, Any]:
    """Fetch one call's full detail (does not include audio/transcript bytes)."""
    try:
        call, _ = mask_call_log(get_call_log(org_id, call_id))
    except CallLogNotFoundError as exc:
        raise CopilotToolError(f"No call with id '{call_id}' in this organisation.") from exc

    return {
        "call_id": call.get("call_id"),
        "agent_id": call.get("agent_id"),
        "agent_name": call.get("agent_name"),
        "call_type": call.get("call_type"),
        "status": call.get("status"),
        "call_response": call.get("call_response"),
        "from_number": call.get("from_number"),
        "to_number": call.get("to_number"),
        "duration": call.get("duration"),
        "start_time_utc": call.get("start_time_utc"),
        "end_time_utc": call.get("end_time_utc"),
        "campaign_id": call.get("campaign_id"),
        "error_message": call.get("error_message"),
        "has_recording": bool(call.get("recording_url")),
        "has_transcript": bool(call.get("transcript_url")),
    }


def get_analytics_summary(org_id: str) -> dict[str, Any]:
    """Org-wide call analytics: volume, connection rate, duration, trend, top agents/models."""
    return get_org_call_analytics(org_id)


def list_campaigns(org_id: str, *, state: str | None = None, limit: int = 20) -> dict[str, Any]:
    """List campaigns, optionally filtered by state (created/syncing/running/paused/completed/failed)."""
    campaigns = campaign_repository.list_campaigns(org_id)
    if state:
        campaigns = [c for c in campaigns if c.get("state") == state]
    campaigns = campaigns[: max(1, min(limit, 50))]
    rows = [
        {
            "campaign_id": c.get("campaign_id"),
            "name": c.get("name"),
            "agent_id": c.get("agent_id"),
            "state": c.get("state"),
            "total_rows": c.get("total_rows", 0),
            "processed_rows": c.get("processed_rows", 0),
            "failed_rows": c.get("failed_rows", 0),
            "created_at": c.get("created_at"),
            "started_at": c.get("started_at"),
            "completed_at": c.get("completed_at"),
        }
        for c in campaigns
    ]
    return {"count": len(rows), "campaigns": rows}


def list_knowledge_documents(org_id: str) -> dict[str, Any]:
    """List knowledge-base documents (name, status, chunk count) for this organisation."""
    docs = knowledge_service.list_documents(org_id)
    rows = [
        {
            "document_id": d.get("document_id"),
            "original_filename": d.get("original_filename"),
            "status": d.get("status"),
            "chunk_count": d.get("chunk_count"),
            "created_at": d.get("created_at"),
        }
        for d in docs
    ]
    return {"count": len(rows), "documents": rows}


def _model_examples(kind: Kind, provider: str) -> list[str]:
    examples = provider_settings(kind, provider).get("fields", {}).get("model", {}).get("examples")
    return [str(m) for m in examples] if examples else []


def _voices_by_model(provider: str) -> dict[str, dict[str, list[str]]]:
    """Real per-language voice names for one TTS provider, straight from the
    same capabilities catalog the agent-config UI reads — never a guessed or
    remembered voice name."""
    capabilities = provider_settings(Kind.TTS, provider).get("capabilities", {})
    out: dict[str, dict[str, list[str]]] = {}
    for model, cap in capabilities.items():
        per_language: dict[str, list[str]] = {}
        for lang, entry in (cap.get("settings") or {}).items():
            options = ((entry or {}).get("voice") or {}).get("options")
            if options:
                per_language[lang] = [str(o) for o in options]
        if per_language:
            out[model] = per_language
    return out


def list_available_providers(org_id: str) -> dict[str, Any]:
    """STT/TTS/LLM providers this organisation has actually connected
    (stored, working credentials only — see auth_service.list_configured_providers),
    with their real model names and, for TTS, real voice names per language.

    Call this before proposing a specific provider, model, or voice in
    propose_create_agent — it's the only way to know what's genuinely
    available for this org rather than guessing a plausible-sounding name.
    """
    configured = set(auth_service.available_providers(org_id))
    stt = [
        {"provider": p, "models": _model_examples(Kind.STT, p)}
        for p in list_providers(Kind.STT)
        if is_authenticated(p, configured)
    ]
    tts = [
        {"provider": p, "voices_by_model": _voices_by_model(p)}
        for p in list_providers(Kind.TTS)
        if is_authenticated(p, configured)
    ]
    llm = [
        {"provider": p, "models": _model_examples(Kind.LLM, p)}
        for p in list_providers(Kind.LLM)
        if is_authenticated(p, configured)
    ]
    return {"stt": stt, "tts": tts, "llm": llm}


def list_recent_activity(
    org_id: str,
    *,
    actor_role: str = "",
    entity_type: str | None = None,
    actor_email: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Who created, updated, or deleted what in this org, most recent first.

    entity_type, if given, is one of: agent, campaign, knowledge_document,
    phone_number, member, provider_auth. Admin/super_admin only — same
    restriction as the GET /audit-log endpoint this mirrors.
    """
    if actor_role not in (ROLE_ADMIN, ROLE_SUPER_ADMIN):
        raise CopilotToolError("Only admins can view the organisation's activity log.")
    events = audit_log.list_events(
        org_id,
        entity_type=entity_type,
        actor_email=actor_email,
        limit=limit,
    )
    rows = [
        {
            "entity_type": e.get("entity_type"),
            "entity_id": e.get("entity_id"),
            "entity_name": e.get("entity_name"),
            "action": e.get("action"),
            "actor_email": e.get("actor_email"),
            "detail": e.get("detail"),
            "created_at": e.get("created_at"),
        }
        for e in events
    ]
    return {"count": len(rows), "events": rows}


def search_knowledge_base(
    org_id: str,
    *,
    query: str,
    document_ids: list[str] | None = None,
    top_k: int = 5,
) -> dict[str, Any]:
    """Semantic search over the organisation's ready knowledge-base documents."""
    if not query or not query.strip():
        raise CopilotToolError("query must not be empty")
    try:
        chunks = knowledge_service.retrieve_chunks_for_query(
            org_id=org_id,
            question=query,
            document_ids=document_ids,
            top_k=top_k,
        )
    except knowledge_service.KnowledgeRetrievalError as exc:
        raise CopilotToolError(f"Knowledge base search failed: {exc}") from exc

    return {
        "count": len(chunks),
        "results": [
            {
                "document_id": c.get("document_id"),
                "source_filename": c.get("source_filename"),
                "text": c.get("text"),
            }
            for c in chunks
        ],
    }


def _models_from_existing_agent_or_fallback(org_id: str) -> dict[str, Any]:
    existing = agent_service.list_agents(org_id)
    if existing:
        models = (existing[0].get("config") or {}).get("models")
        if models and models.get("stt_config") and models.get("tts_config") and models.get("llm_config"):
            return models
    return dict(FALLBACK_STT_TTS_MODELS)


def _require_connected(configured: set[str], kind_label: str, provider: str) -> None:
    if not is_authenticated(provider, configured):
        raise CopilotToolError(
            f"'{provider}' isn't a connected {kind_label} provider for this organisation "
            "— call list_available_providers first to see what's actually authenticated "
            "before proposing it, or tell the user it needs to be connected in "
            "Integrations before this agent can use it."
        )


def _models_from_explicit_choice(
    org_id: str,
    *,
    stt_provider: str | None,
    stt_model: str | None,
    tts_provider: str | None,
    tts_model: str | None,
    tts_voice: str | None,
    llm_provider: str | None,
    llm_model: str | None,
) -> dict[str, Any]:
    """Layer explicit provider/model/voice choices onto the org's existing
    defaults, one kind at a time — any kind left unspecified keeps whatever
    ``_models_from_existing_agent_or_fallback`` already picked. Every
    explicitly named provider must have real, stored credentials for this
    org (checked here, not just trusted from the model's argument)."""
    base = _models_from_existing_agent_or_fallback(org_id)
    configured = set(auth_service.available_providers(org_id))

    stt = dict(base["stt_config"])
    if stt_provider:
        _require_connected(configured, "STT", stt_provider)
        stt = {"provider": stt_provider, "model": stt_model or stt.get("model")}

    tts = dict(base["tts_config"])
    if tts_provider:
        _require_connected(configured, "TTS", tts_provider)
        tts = {"provider": tts_provider, "model": tts_model or tts.get("model")}
    if tts_voice:
        tts["voice"] = tts_voice

    llm = dict(base["llm_config"])
    if llm_provider:
        _require_connected(configured, "LLM", llm_provider)
        llm = {"provider": llm_provider, "model": llm_model or llm.get("model")}

    return {"stt_config": stt, "tts_config": tts, "llm_config": llm}


def _default_system_prompt(name: str, purpose: str) -> str:
    """A genuinely complete fallback for when the model omits system_prompt
    despite being asked to always supply one — smaller/weaker models via
    some providers don't reliably fill every tool argument. Deterministic,
    not model-authored, but several real sentences instead of a bare clause."""
    return (
        f"You are {name}, a phone agent whose job is to: {purpose}. "
        "Speak in a warm, clear, and concise tone, as a helpful person would "
        "on a real call — short sentences, no jargon. Stay focused on this "
        "purpose; if the caller asks for something outside it, say so plainly "
        "and offer to connect them with a human instead of guessing. If you're "
        "ever unsure what the caller means, ask a short clarifying question "
        "rather than assuming. Confirm the key details back to the caller "
        "before ending the call."
    )


def propose_create_agent(
    org_id: str,
    *,
    created_by: str,
    conversation_id: str | None,
    name: str,
    purpose: str,
    primary_language: str = "en",
    system_prompt: str | None = None,
    greeting_message: str | None = None,
    stt_provider: str | None = None,
    stt_model: str | None = None,
    tts_provider: str | None = None,
    tts_model: str | None = None,
    tts_voice: str | None = None,
    llm_provider: str | None = None,
    llm_model: str | None = None,
    knowledge_base_document_ids: list[str] | None = None,
    field_provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate and stage a new agent config as an unsaved draft for the user to confirm.

    Never creates a real agent. ``created_by``/``conversation_id`` are bound by
    the engine, not the model, same as ``org_id``. Provider/model/voice
    arguments are optional — leave any of them out to keep copying from the
    org's existing agent (or the hardcoded fallback), same as before. Any one
    supplied must be a provider this org has actually connected (see
    list_available_providers) or this raises rather than staging a draft that
    can never actually run.

    ``field_provenance`` labels each meaningful field as "inferred" (deduced
    from business intent), "recommended" (a technical default picked because
    nobody specified one), or "user_selected" (the user said this exactly) —
    shown honestly in the confirmation card. Never required, and a bad entry
    is silently dropped rather than failing the draft.
    """
    name = (name or "").strip()
    purpose = (purpose or "").strip()
    if not name:
        raise CopilotToolError("name is required")
    if not purpose:
        raise CopilotToolError("purpose is required (what should this agent help callers do?)")

    resolved_prompt = (system_prompt or "").strip() or _default_system_prompt(name, purpose)
    resolved_greeting = (greeting_message or "").strip() or f"Hi, this is {name}. How can I help you today?"

    if stt_provider or tts_provider or tts_voice or llm_provider:
        models = _models_from_explicit_choice(
            org_id,
            stt_provider=stt_provider,
            stt_model=stt_model,
            tts_provider=tts_provider,
            tts_model=tts_model,
            tts_voice=tts_voice,
            llm_provider=llm_provider,
            llm_model=llm_model,
        )
    else:
        models = _models_from_existing_agent_or_fallback(org_id)

    document_ids = [d.strip() for d in (knowledge_base_document_ids or []) if d and d.strip()]

    config = {
        "schema_version": 1,
        "prompts": {"system_prompt": resolved_prompt, "greeting_message": resolved_greeting},
        "behaviour": {},
        "language": {"primary": primary_language, "secondary": []},
        "models": models,
        "knowledge_base": {
            "enabled": bool(document_ids),
            "mode": "context",
            "document_ids": document_ids,
            "top_k": 5,
        },
        "custom_variables": {},
    }

    try:
        validated = validate_agent_config(
            AgentConfigPayload.model_validate(config),
            org_id=org_id,
        )
    except Exception as exc:  # AgentConfigValidationError, pydantic ValidationError, provider errors
        raise CopilotToolError(f"This draft doesn't pass agent validation: {exc}") from exc

    create_payload = {
        "name": name,
        "agent_category": _DRAFT_AGENT_CATEGORY,
        "config": validated.model_dump(mode="python"),
    }
    preview = {
        "name": name,
        "purpose": purpose,
        "agent_category": _DRAFT_AGENT_CATEGORY,
        "primary_language": primary_language,
        "system_prompt": resolved_prompt,
        "greeting_message": resolved_greeting,
        "llm": models["llm_config"].get("model"),
        "stt": models["stt_config"].get("model"),
        "tts": models["tts_config"].get("model"),
        "tts_voice": models["tts_config"].get("voice"),
        "knowledge_base_enabled": bool(document_ids),
        "knowledge_base_document_count": len(document_ids),
        "field_provenance": _sanitize_field_provenance(
            field_provenance,
            {
                "name",
                "purpose",
                "primary_language",
                "system_prompt",
                "greeting_message",
                "llm",
                "stt",
                "tts",
                "tts_voice",
                "knowledge_base",
            },
        ),
    }

    draft = draft_store.create_draft(org_id, created_by, conversation_id, preview, create_payload)
    return {
        "draft_id": draft["draft_id"],
        **preview,
        "note": (
            "This is a draft only — nothing was created. Ask the user to review "
            "the confirmation card and click Create to actually save it."
        ),
    }


# Human-readable labels for the preview card / model-facing summary — one
# entry per AgentBehaviour leaf this tool can touch (see propose_update_agent).
_BEHAVIOUR_FIELD_LABELS: dict[str, str] = {
    "interruption_min_words": "interruption threshold",
    "user_silence_hangup_seconds": "silence hangup timeout",
    "call_timeout_seconds": "call time limit",
    "hold_messages": "hold messages",
    "hold_message_timeout_seconds": "hold message timeout",
    "user_online_detection_enabled": '"still there?" check',
    "user_online_detection_message": '"still there?" message',
    "user_online_detection_seconds": '"still there?" timeout',
    "user_online_detection_repeats": '"still there?" repeat count',
    "user_online_detection_closing_message": '"still there?" closing message',
    "ignore_user_speech_before_greeting": "ignore-speech-before-greeting",
}


def propose_update_agent(
    org_id: str,
    *,
    created_by: str,
    conversation_id: str | None,
    agent_id: str,
    name: str | None = None,
    system_prompt: str | None = None,
    greeting_message: str | None = None,
    primary_language: str | None = None,
    stt_provider: str | None = None,
    stt_model: str | None = None,
    tts_provider: str | None = None,
    tts_model: str | None = None,
    tts_voice: str | None = None,
    llm_provider: str | None = None,
    llm_model: str | None = None,
    knowledge_base_document_ids: list[str] | None = None,
    knowledge_base_enabled: bool | None = None,
    interruption_min_words: int | None = None,
    user_silence_hangup_seconds: float | None = None,
    call_timeout_seconds: float | None = None,
    hold_messages: list[str] | None = None,
    hold_message_timeout_seconds: float | None = None,
    user_online_detection_enabled: bool | None = None,
    user_online_detection_message: str | None = None,
    user_online_detection_seconds: float | None = None,
    user_online_detection_repeats: int | None = None,
    user_online_detection_closing_message: str | None = None,
    automatic_call_ending_enabled: bool | None = None,
    automatic_call_ending_graceful: bool | None = None,
    ignore_user_speech_before_greeting: bool | None = None,
) -> dict[str, Any]:
    """Validate and stage an update to a REAL, existing agent as an unsaved
    draft — never edits anything until the user confirms.

    Every leaf field is optional; only the ones actually supplied are
    changed. Starts from the agent's real current config (not blank
    defaults) and overlays only the given fields at the leaf level — this
    matters especially for ``behaviour``, where naively re-validating a
    partially-filled object would silently reset every untouched field
    (interruption threshold, silence timeout, etc.) back to its schema
    default. ``created_by``/``conversation_id`` are bound by the engine,
    not the model, same as ``org_id``.
    """
    agent_id = (agent_id or "").strip()
    if not agent_id:
        raise CopilotToolError("agent_id is required — look one up with list_agents or get_agent first")

    try:
        existing = agent_service.get_agent(org_id, agent_id)
    except AgentNotFoundError as exc:
        raise CopilotToolError(f"No agent with id '{agent_id}' in this organisation.") from exc

    existing_config = dict(existing.get("config") or {})
    changes: list[str] = []

    prompts = dict(existing_config.get("prompts") or {})
    if system_prompt is not None and system_prompt.strip():
        prompts["system_prompt"] = system_prompt.strip()
        changes.append("system prompt")
    if greeting_message is not None and greeting_message.strip():
        prompts["greeting_message"] = greeting_message.strip()
        changes.append("greeting")

    language = dict(existing_config.get("language") or {})
    if primary_language is not None and primary_language.strip():
        language["primary"] = primary_language.strip()
        changes.append("language")

    configured = set(auth_service.available_providers(org_id))
    models = dict(existing_config.get("models") or {})

    stt = dict(models.get("stt_config") or {})
    if stt_provider:
        _require_connected(configured, "STT", stt_provider)
        stt = {"provider": stt_provider, "model": stt_model or stt.get("model")}
        changes.append("STT provider")
    elif stt_model:
        stt["model"] = stt_model
        changes.append("STT model")

    tts = dict(models.get("tts_config") or {})
    if tts_provider:
        _require_connected(configured, "TTS", tts_provider)
        tts = {"provider": tts_provider, "model": tts_model or tts.get("model")}
        changes.append("TTS provider")
    elif tts_model:
        tts["model"] = tts_model
        changes.append("TTS model")
    if tts_voice:
        tts["voice"] = tts_voice
        changes.append("voice")

    llm = dict(models.get("llm_config") or {})
    if llm_provider:
        _require_connected(configured, "LLM", llm_provider)
        llm = {"provider": llm_provider, "model": llm_model or llm.get("model")}
        changes.append("LLM provider")
    elif llm_model:
        llm["model"] = llm_model
        changes.append("LLM model")

    models = {"stt_config": stt, "tts_config": tts, "llm_config": llm}

    knowledge_base = dict(existing_config.get("knowledge_base") or {})
    if knowledge_base_document_ids is not None:
        document_ids = [d.strip() for d in knowledge_base_document_ids if d and d.strip()]
        knowledge_base["document_ids"] = document_ids
        knowledge_base["enabled"] = bool(document_ids)
        knowledge_base.setdefault("mode", "context")
        knowledge_base.setdefault("top_k", 5)
        changes.append("knowledge base")
    elif knowledge_base_enabled is not None:
        knowledge_base["enabled"] = knowledge_base_enabled
        changes.append("knowledge base")

    behaviour = dict(existing_config.get("behaviour") or {})
    behaviour_overrides = {
        "interruption_min_words": interruption_min_words,
        "user_silence_hangup_seconds": user_silence_hangup_seconds,
        "call_timeout_seconds": call_timeout_seconds,
        "hold_messages": hold_messages,
        "hold_message_timeout_seconds": hold_message_timeout_seconds,
        "user_online_detection_enabled": user_online_detection_enabled,
        "user_online_detection_message": user_online_detection_message,
        "user_online_detection_seconds": user_online_detection_seconds,
        "user_online_detection_repeats": user_online_detection_repeats,
        "user_online_detection_closing_message": user_online_detection_closing_message,
        "ignore_user_speech_before_greeting": ignore_user_speech_before_greeting,
    }
    for field, value in behaviour_overrides.items():
        if value is not None:
            behaviour[field] = value
            changes.append(_BEHAVIOUR_FIELD_LABELS[field])

    if automatic_call_ending_enabled is not None or automatic_call_ending_graceful is not None:
        auto_ending = dict(behaviour.get("automatic_call_ending") or {})
        if automatic_call_ending_enabled is not None:
            auto_ending["enabled"] = automatic_call_ending_enabled
        if automatic_call_ending_graceful is not None:
            auto_ending["graceful_llm_call_ending"] = automatic_call_ending_graceful
        behaviour["automatic_call_ending"] = auto_ending
        changes.append("automatic call ending")

    new_name = (name or "").strip() or None
    if new_name and new_name != existing.get("name"):
        changes.append("name")
    else:
        new_name = None

    if not changes:
        raise CopilotToolError(
            "No changes were specified — say what you'd like to change about this agent "
            "(e.g. the prompt, a threshold, the voice)."
        )

    merged_config = {
        **existing_config,
        "prompts": prompts,
        "language": language,
        "models": models,
        "knowledge_base": knowledge_base,
        "behaviour": behaviour,
    }

    try:
        validated = validate_agent_config(
            AgentConfigPayload.model_validate(merged_config),
            org_id=org_id,
        )
    except Exception as exc:  # AgentConfigValidationError, pydantic ValidationError, provider errors
        raise CopilotToolError(f"This update doesn't pass agent validation: {exc}") from exc

    update_payload: dict[str, Any] = {"config": validated.model_dump(mode="python")}
    if new_name:
        update_payload["name"] = new_name

    preview = {
        "agent_id": agent_id,
        "agent_name": existing.get("name"),
        "new_name": new_name,
        "changes": changes,
    }

    draft = draft_store.create_draft(
        org_id,
        created_by,
        conversation_id,
        preview,
        {"agent_id": agent_id, "update_payload": update_payload},
        entity_type="agent_update",
    )
    return {
        "draft_id": draft["draft_id"],
        **preview,
        "note": (
            "This is a draft only — nothing on the real agent was changed. Ask the "
            "user to review the confirmation card and click Update to actually save it."
        ),
    }


def propose_create_campaign(
    org_id: str,
    *,
    created_by: str,
    conversation_id: str | None,
    name: str,
    agent_id: str,
    source_id: str,
    rate_limit_per_second: int = 1,
    max_concurrency: int = 5,
) -> dict[str, Any]:
    """Validate and stage a new outbound campaign as an unsaved draft.

    Never creates a real campaign. ``source_id`` must be a real, already
    -uploaded contact CSV — the model cannot invent one; get it from a CSV the
    user attached in this chat (see the attachment note this turn), or ask the
    user to attach one first. ``created_by``/``conversation_id`` are bound by
    the engine, not the model, same as ``org_id``.
    """
    name = (name or "").strip()
    if not name:
        raise CopilotToolError("name is required")
    if not agent_id:
        raise CopilotToolError("agent_id is required — look one up with list_agents first")
    if not source_id:
        raise CopilotToolError(
            "source_id is required — it comes from a CSV the user attaches in this chat, "
            "never a value you invent"
        )

    try:
        agent = agent_service.get_agent(org_id, agent_id)
    except AgentNotFoundError as exc:
        raise CopilotToolError(f"No agent with id '{agent_id}' in this organisation.") from exc

    storage = MinIOStorage()
    if not storage.object_exists(settings.MINIO_BUCKET, source_id):
        raise CopilotToolError(
            "That source_id doesn't point to a real uploaded CSV in this organisation — "
            "ask the user to attach a contacts CSV to this chat first."
        )

    create_payload = {
        "org_id": org_id,
        "name": name,
        "agent_id": agent_id,
        "source_type": "csv",
        "source_id": source_id,
        "rate_limit_per_second": max(1, min(rate_limit_per_second, 20)),
        "max_concurrency": max(1, min(max_concurrency, 20)),
        "created_by": created_by,
    }
    preview = {
        "name": name,
        "agent_id": agent_id,
        "agent_name": agent.get("name"),
        "source_id": source_id,
        "rate_limit_per_second": create_payload["rate_limit_per_second"],
        "max_concurrency": create_payload["max_concurrency"],
    }

    draft = draft_store.create_draft(
        org_id, created_by, conversation_id, preview, create_payload, entity_type="campaign"
    )
    return {
        "draft_id": draft["draft_id"],
        **preview,
        "note": (
            "This is a draft only — nothing was created. Ask the user to review "
            "the confirmation card and click Create to actually save it."
        ),
    }


TOOL_FUNCTIONS: dict[str, Any] = {
    "list_agents": list_agents,
    "get_agent": get_agent,
    "list_calls": list_calls,
    "get_call": get_call,
    "get_analytics_summary": get_analytics_summary,
    "list_campaigns": list_campaigns,
    "list_knowledge_documents": list_knowledge_documents,
    "list_available_providers": list_available_providers,
    "list_recent_activity": list_recent_activity,
    "search_knowledge_base": search_knowledge_base,
    "propose_create_agent": propose_create_agent,
    "propose_update_agent": propose_update_agent,
    "propose_create_campaign": propose_create_campaign,
}

# Tools whose execution needs more than org_id — the engine merges these extra
# bound values (never model-controlled) into the call for the named tools only.
TOOLS_NEEDING_REQUEST_CONTEXT = frozenset(
    {"propose_create_agent", "propose_update_agent", "propose_create_campaign", "list_recent_activity"}
)
