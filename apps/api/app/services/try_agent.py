"""The no-login demo agent builder (/ and /try): build an agent in three
questions, test-call it in the browser, then sign in to keep it.

The agent itself is assembled by ``app.services.demo`` from the knowledge-base
snapshot (templates, sectors, cards, flows, guardrails). This module is the
public edge around it: the router and opening-line model calls, the hidden
preview workspace, the preview token, the fixed call stack and usage caps.

Everything here runs on platform keys, so it is bounded:

- Prompts are always assembled on the server from ids in the knowledge base;
  the browser can't send its own, so none of this is an open LLM or voice proxy.
- Preview agents expire after ``TRY_AGENT_TTL_MINUTES`` and need the random
  preview token returned when they were made.
- Usage caps per visitor IP per hour and across everyone per day, counted in
  ``TryTurns`` (shared by every API process; entries expire after a day):
  ``turn`` for text work (router, opening line, translation, call summary,
  added documents) and ``call`` for test calls.
- Preview calls store no audio and no transcript; their state expires with
  the preview agent.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from openai import AsyncOpenAI

from app.config import settings
from app.database import get_database
from app.services import auth_service, org_service, try_stack
from app.services.demo import builder, calls, kb, sources

logger = logging.getLogger(__name__)

COLLECTION = "TryTurns"
PREVIEW_ORG_ID = "voicera-preview"
PREVIEW_ORG_NAME = "Public preview (system)"
PREVIEW_CREATOR = "preview@voicera.internal"
MAX_TEXTS = 12
MAX_CHARS = 600
MAX_TRANSCRIPT_TURNS = 60
MAX_GREETING_CHARS = 400
MAX_REPLY_TOKENS = 600

LANGUAGES = builder.LANGUAGES
_LANGUAGE_NAMES = builder.LANGUAGE_NAMES

_BASE_URLS: dict[str, str | None] = {
    "openai": None,
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}
_DEFAULT_MODELS = try_stack.PREVIEW_LLM_MODELS

_TRANSLATE_TO_PROMPT = (
    "Translate each numbered line, from the start of a government helpline phone call, into natural "
    "spoken {language} in its own script. Keep names, numbers and scheme names. Reply with only the "
    "numbered translations, one per line.\n\n{lines}"
)
_TRANSLATE_FROM_PROMPT = (
    "Translate each numbered line from a phone call into plain English. Keep the "
    "numbers. Reply with only the numbered translations, one per line.\n\n{lines}"
)
_RECORDS_PROMPT = """A member of the public just had a test call with a government voice agent ({template}).
Fill in the call record from the transcript. Fields: {fields}.

Transcript:
{transcript}

Reply with only JSON: one key per field. Use "yes"/"no" for yes/no fields, a short
phrase or a list of short phrases otherwise, and null when the call didn't get to it."""


class TryError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class TryLimited(TryError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=429)


def _now() -> datetime:
    return datetime.now(timezone.utc)


_indexes_ready = False


def _collection():
    global _indexes_ready
    col = get_database()[COLLECTION]
    if not _indexes_ready:
        col.create_index([("key", 1), ("at", -1)], name="key_recent_index")
        col.create_index("at", name="at_ttl", expireAfterSeconds=int(timedelta(days=1).total_seconds()))
        _indexes_ready = True
    return col


# --- catalogue and agent text ----------------------------------------------------------


def snapshot() -> dict[str, Any]:
    return kb.current()


def catalogue() -> dict[str, Any]:
    """Templates, sectors and languages for the landing page and the questions."""
    data = builder.catalogue(snapshot())
    data["max_call_seconds"] = settings.TRY_CALL_MAX_SECONDS
    return data


def language_name(code: str) -> str:
    name = _LANGUAGE_NAMES.get(code)
    if not name:
        raise TryError("Pick one of the offered languages.")
    return name


def _build_error(exc: builder.BuildError) -> TryError:
    return TryError(str(exc), exc.status_code)


def sources_view(template_id: str, sector_id: str, topic: str = "") -> dict[str, Any]:
    """What Q1 and Q2 show for this template and sector."""
    try:
        return builder.sources(snapshot(), template_id, sector_id, topic)
    except builder.BuildError as exc:
        raise _build_error(exc) from exc


def assemble(answers: dict[str, Any], snap: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """(snapshot, agent config) for the visitor's answers, with any added documents."""
    snap = snap or snapshot()
    try:
        session_cards = sources.cards_for(list(answers.get("source_ids") or []))
    except sources.SourceError as exc:
        raise TryError(str(exc), exc.status_code) from exc
    try:
        return snap, builder.assemble(snap, answers, session_cards)
    except builder.BuildError as exc:
        raise _build_error(exc) from exc


def _clean_greeting(greeting: str | None) -> str | None:
    text = re.sub(r"\s+", " ", (greeting or "")).strip()
    if not text:
        return None
    if len(text) > MAX_GREETING_CHARS:
        raise TryError(f"Keep the greeting under {MAX_GREETING_CHARS} characters.")
    return text


# --- usage caps ------------------------------------------------------------------------


_BUCKETS = {
    "turn": ("TRY_TURNS_PER_IP_HOUR", "TRY_TURNS_PER_DAY"),
    "call": ("TRY_CALLS_PER_IP_HOUR", "TRY_CALLS_PER_DAY"),
}


def check_and_count(ip: str | None, bucket: str = "turn") -> None:
    """Refuse when this visitor or everyone together is over the bucket's budget; else count one."""
    per_ip, per_day = (getattr(settings, name) for name in _BUCKETS[bucket])
    col = _collection()
    now = _now()
    if col.count_documents({"key": f"all:{bucket}", "at": {"$gte": now - timedelta(days=1)}}) >= per_day:
        raise TryLimited("The free preview is busy today. Sign in to keep building your agent.")
    if ip:
        mine = col.count_documents({"key": f"ip:{bucket}:{ip}", "at": {"$gte": now - timedelta(hours=1)}})
        if mine >= per_ip:
            raise TryLimited("That's the end of the free preview for now. Sign in to keep testing your agent.")
        col.insert_one({"key": f"ip:{bucket}:{ip}", "at": now})
    col.insert_one({"key": f"all:{bucket}", "at": now})


# --- text model ------------------------------------------------------------------------


def _auth_key(stored: dict[str, Any] | None) -> str:
    raw = ((stored or {}).get("auth") or {}).get("api_key")
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    return str(raw or "").strip()


def _org_key(org_id: str, provider: str) -> str:
    """The key an organisation connected for ``provider`` under Integrations."""
    try:
        return _auth_key(auth_service.get_provider_auth(org_id, provider, mask_secrets=False))
    except Exception:
        logger.warning("Try-agent couldn't read TRY_KEY_ORG_ID's %s key", provider)
        return ""


def text_model_candidates() -> list[str]:
    """Providers the preview may use for its own text, in order: TRY_LLM_PROVIDER,
    then any the platform lends (DEFAULT_PROVIDERS), then the Agent Builder's."""
    order = [(settings.TRY_LLM_PROVIDER or "openai").strip().lower()]
    order += sorted(auth_service.lent_providers())
    order.append((settings.COPILOT_LLM_PROVIDER or "").strip().lower())
    return [p for p in dict.fromkeys(order) if p in _BASE_URLS]


def resolve_text_model() -> tuple[str, str, str, str] | None:
    """(provider, model, key, where the key came from) for the first candidate
    with a key, or None. Never logs or returns the key outside this module."""
    try_provider = (settings.TRY_LLM_PROVIDER or "openai").strip().lower()
    for provider in text_model_candidates():
        sources: list[tuple[str, str]] = []
        if provider == try_provider:
            sources.append(("TRY_LLM_API_KEY", settings.TRY_LLM_API_KEY.strip()))
            if settings.TRY_KEY_ORG_ID.strip():
                sources.append(("TRY_KEY_ORG_ID workspace", _org_key(settings.TRY_KEY_ORG_ID.strip(), provider)))
        sources.append(("DEFAULT_PROVIDERS_ORG_ID workspace", _auth_key(auth_service.default_provider_auth(provider))))
        if provider == "openai":
            sources.append(("KB_EMBEDDING_API_KEY", settings.KB_EMBEDDING_API_KEY.strip()))
        if provider == (settings.COPILOT_LLM_PROVIDER or "").strip().lower():
            sources.append(("COPILOT_LLM_API_KEY", settings.COPILOT_LLM_API_KEY.strip()))
        for source, key in sources:
            if key:
                custom = (settings.TRY_LLM_MODEL or "").strip() if provider == try_provider else ""
                return provider, custom or _DEFAULT_MODELS[provider], key, source
    return None


def _client() -> tuple[AsyncOpenAI, str, str]:
    found = resolve_text_model()
    if not found:
        logger.warning(
            "Try-agent has no AI model key: set DEFAULT_PROVIDERS_ORG_ID and DEFAULT_PROVIDERS, "
            "or TRY_LLM_API_KEY (run `python -m app.services.try_check` on the API server)"
        )
        raise TryError("The preview's AI model isn't set up on this server yet.", status_code=503)
    provider, model, key, _source = found
    kwargs: dict[str, Any] = {"api_key": key, "max_retries": 1, "timeout": 30}
    if _BASE_URLS[provider]:
        kwargs["base_url"] = _BASE_URLS[provider]
    return AsyncOpenAI(**kwargs), provider, model


async def _complete(prompt: str) -> str:
    client, provider, model = _client()
    extra: dict[str, Any] = {}
    if "gpt-oss" in model:
        extra = {"extra_body": {"reasoning": {"effort": "low"}}} if provider == "openrouter" else {"reasoning_effort": "low"}
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=MAX_REPLY_TOKENS,
            temperature=0.2,
            **extra,
        )
    except Exception as exc:
        logger.warning("Try-agent text call failed provider=%s model=%s: %s", provider, model, type(exc).__name__)
        raise TryError("That didn't work just now. Try again in a moment.", status_code=502) from exc
    text = (response.choices[0].message.content or "").strip()
    if not text:
        raise TryError("That didn't work just now. Try again in a moment.", status_code=502)
    return text


async def _translate_lines(language: str, lines: list[str]) -> list[str]:
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(lines))
    text = await _complete(_TRANSLATE_TO_PROMPT.format(language=language_name(language), lines=numbered))
    found: dict[int, str] = {}
    for row in text.splitlines():
        m = re.match(r"\s*(\d+)[.)]\s*(.+)", row)
        if m:
            found[int(m.group(1))] = m.group(2).strip().strip('"“”')
    if any(i + 1 not in found for i in range(len(lines))):
        raise TryError("That didn't work just now. Try again in a moment.", status_code=502)
    return [found[i + 1] for i in range(len(lines))]


# The AI and demo notice (G-01, G-02) in each language, translated once per
# process. It is always added on the server, so a visitor can edit the
# greeting but can't drop the notice.
_NOTICES: dict[str, str] = {"en": builder.NOTICE}


async def notice_in(language: str) -> str:
    if language not in _NOTICES:
        _NOTICES[language] = (await _translate_lines(language, [builder.NOTICE]))[0]
    return _NOTICES[language]


async def build(answers: dict[str, Any], ip: str | None) -> dict[str, Any]:
    """What the "Creating your agent" and "Agent ready" screens show: the
    greeting (in the call language, with the English), the notice it always
    carries, what the agent loaded, who the tester plays and the call stack."""
    snap, config = assemble(answers)
    t = builder.template(snap, config["template_id"])
    s = builder.sector(snap, config["sector_id"])
    english = builder.opening_line(snap, config)
    language = config["language"]
    greeting, notice = english["greeting"], builder.NOTICE
    if language != "en":
        check_and_count(ip, "turn")
        if language in _NOTICES:
            greeting = (await _translate_lines(language, [english["greeting"]]))[0]
        else:
            greeting, notice = await _translate_lines(language, [english["greeting"], builder.NOTICE])
            _NOTICES[language] = notice
    result: dict[str, Any] = {
        "name": f"{t['name']} · {s['name']}",
        "template": {"template_id": t["template_id"], "name": t["name"], "job": t["job"]},
        "sector": {"sector_id": s["sector_id"], "name": s["name"]},
        "language": language,
        "greeting": greeting,
        "greeting_english": english["greeting"] if language != "en" else None,
        "notice": notice,
        "opening": builder.compose_opening(greeting, notice),
        "opening_english": english["opening"] if language != "en" else None,
        # What the visitor kept, plus their own; cards the flows need ride along uncounted.
        "cards": config.get("chosen_cards", len(config["card_ids"])) + len(config["session_cards"]),
        "session_cards": len(config["session_cards"]),
        "flows": len(config["flows"]),
        "role": config["role"],
        "kb_version": config["kb_version"],
    }
    try:
        result["stack"] = try_stack.describe(stack_for(language))
    except TryError as exc:
        result["stack"] = None
        result["stack_error"] = str(exc)
    return result


async def to_english(language: str, texts: list[str], ip: str | None) -> list[str | None]:
    """English lines for transcript lines spoken in ``language`` (None where empty)."""
    language_name(language)
    if not texts:
        return []
    if len(texts) > MAX_TEXTS:
        raise TryError(f"Send at most {MAX_TEXTS} lines at a time.")
    lines = [re.sub(r"\s+", " ", t or "").strip()[:MAX_CHARS] for t in texts]
    if language == "en":
        return [None for _ in lines]
    check_and_count(ip, "turn")
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(lines))
    text = await _complete(_TRANSLATE_FROM_PROMPT.format(lines=numbered))
    found: dict[int, str] = {}
    for row in text.splitlines():
        m = re.match(r"\s*(\d+)[.)]\s*(.+)", row)
        if m:
            found[int(m.group(1))] = m.group(2).strip()
    return [found.get(i + 1) if lines[i] else None for i in range(len(lines))]


async def route(text: str, ip: str | None) -> dict[str, Any]:
    """The router prompt: template, sector, topic and language for a typed description."""
    check_and_count(ip, "turn")
    try:
        return await builder.route(snapshot(), text, _complete)
    except builder.BuildError as exc:
        raise _build_error(exc) from exc


async def add_link(url: str, ip: str | None) -> dict[str, Any]:
    check_and_count(ip, "turn")
    try:
        return await sources.from_link(url)
    except sources.SourceError as exc:
        raise TryError(str(exc), exc.status_code) from exc


def add_upload(filename: str, data: bytes, ip: str | None) -> dict[str, Any]:
    check_and_count(ip, "turn")
    try:
        return sources.from_upload(filename, data)
    except sources.SourceError as exc:
        raise TryError(str(exc), exc.status_code) from exc


# --- test call -------------------------------------------------------------------------


def _ensure_preview_org() -> None:
    if not org_service.get_organisation(PREVIEW_ORG_ID):
        org_service.create_organisation(name=PREVIEW_ORG_NAME, created_by_email=PREVIEW_CREATOR, org_id=PREVIEW_ORG_ID)
        get_database()["Organizations"].update_one(
            {"org_id": PREVIEW_ORG_ID}, {"$set": {"status": "active", "system": "try_preview"}}
        )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _sweep_expired() -> None:
    """Remove preview agents past their expiry with their call logs and call
    state (they're never shown to anyone, and the demo keeps nothing)."""
    db = get_database()
    expired = [
        d["agent_id"]
        for d in db["Agents"].find(
            {"org_id": PREVIEW_ORG_ID, "try_preview.expires_at": {"$lt": _now().isoformat()}}, {"agent_id": 1, "_id": 0}
        )
    ]
    if not expired:
        return
    db["CallLogs"].delete_many({"org_id": PREVIEW_ORG_ID, "agent_id": {"$in": expired}})
    calls.delete_for_agents(PREVIEW_ORG_ID, expired)
    db["Agents"].delete_many({"org_id": PREVIEW_ORG_ID, "agent_id": {"$in": expired}})


def stack_for(language: str, org_id: str = PREVIEW_ORG_ID) -> dict[str, dict[str, Any]]:
    try:
        return try_stack.build_models(language, set(auth_service.available_providers(org_id)))
    except try_stack.StackError as exc:
        # The fix is the operator's (see `python -m app.services.try_check`), not the visitor's.
        logger.warning("Try-agent has no call stack for %s: %s", language, exc)
        raise TryError(
            f"Test calls in {language_name(language)} aren't available yet. Pick another language.", status_code=503
        ) from exc


def call_languages() -> list[str]:
    """Languages a preview test call works in right now."""
    _ensure_preview_org()
    usable = set(auth_service.available_providers(PREVIEW_ORG_ID))
    ready = []
    for code, _name, _native in LANGUAGES:
        try:
            try_stack.build_models(code, usable)
        except try_stack.StackError:
            continue
        ready.append(code)
    return ready


def _agent_config(
    snap: dict[str, Any], config: dict[str, Any], opening: str, models: dict[str, Any], *, preview: bool
) -> dict[str, Any]:
    _, state_text = builder.initial_state_text(snap, config, opening)
    demo = {k: v for k, v in config.items() if k != "values"} | {"preview": preview, "values": config["values"]}
    return {
        "schema_version": 1,
        "prompts": {"system_prompt": builder.system_prompt(snap, config, opening, state_text), "greeting_message": opening},
        "behaviour": {
            "interruption_min_words": 0,
            "user_silence_hangup_seconds": 20 if preview else 30,
            "call_timeout_seconds": settings.TRY_CALL_MAX_SECONDS if preview else None,
            "ignore_user_speech_before_greeting": False,
            "hold_messages": [],
            "hold_message_timeout_seconds": None,
            "user_online_detection_enabled": False,
            "user_online_detection_message": "",
            "user_online_detection_seconds": None,
            "user_online_detection_repeats": None,
            "user_online_detection_closing_message": "",
            # The demo's own end_call tool ends the call (and saves the call record).
            "automatic_call_ending": {"enabled": False, "graceful_llm_call_ending": False},
        },
        "language": {"primary": config["language"], "secondary": []},
        "models": models,
        "knowledge_base": {"enabled": False, "mode": "context", "document_ids": [], "top_k": 5},
        "custom_variables": {},
        "use_case": None,
        "demo": demo,
    }


async def _create(org_id: str, email: str, name: str, config: dict[str, Any]) -> dict[str, Any]:
    from app.models.schemas import AgentCreateRequest
    from app.services import agent_service

    payload = AgentCreateRequest(name=name, agent_category="websocket", config=config)
    try:
        return await agent_service.create_agent(org_id, email, payload)
    except agent_service.AgentConfigValidationError as exc:
        logger.warning("Try-agent config rejected: %s", exc)
        raise TryError("Couldn't set up the agent's voice. Try another language.", status_code=503) from exc


async def _opening(config: dict[str, Any], greeting: str | None, snap: dict[str, Any]) -> str:
    """The spoken opening: the visitor's greeting (or the template's), always with the notice."""
    language = config["language"]
    text = _clean_greeting(greeting)
    if not text:
        english = builder.opening_line(snap, config)
        if language == "en":
            return english["opening"]
        text = (await _translate_lines(language, [english["greeting"]]))[0]
    return builder.compose_opening(text, await notice_in(language))


async def prepare_call(answers: dict[str, Any], greeting: str | None, ip: str | None) -> dict[str, Any]:
    """A short-lived agent the browser can call, on the fixed preview stack."""
    snap, config = assemble(answers)
    _ensure_preview_org()
    models = stack_for(config["language"])
    check_and_count(ip, "call")
    _sweep_expired()
    opening = await _opening(config, greeting, snap)
    t = builder.template(snap, config["template_id"])
    s = builder.sector(snap, config["sector_id"])
    created = await _create(
        # Every visitor's agent lives in the one preview workspace, where names
        # must be unique, so each gets a short random suffix.
        PREVIEW_ORG_ID,
        PREVIEW_CREATOR,
        f"{t['name']} · {s['name']} · {secrets.token_hex(3)}",
        _agent_config(snap, config, opening, models, preview=True),
    )
    token = secrets.token_urlsafe(24)
    expires = _now() + timedelta(minutes=settings.TRY_AGENT_TTL_MINUTES)
    get_database()["Agents"].update_one(
        {"org_id": PREVIEW_ORG_ID, "agent_id": created["agent_id"]},
        {"$set": {"try_preview": {"token_hash": _token_hash(token), "expires_at": expires.isoformat()}}},
    )
    return {
        "org_id": PREVIEW_ORG_ID,
        "agent_id": created["agent_id"],
        "preview_token": token,
        "expires_at": expires.isoformat(),
        "max_call_seconds": settings.TRY_CALL_MAX_SECONDS,
        "stack": try_stack.describe(models),
        "opening": opening,
    }


def stack_names(language: str) -> dict[str, str]:
    """What the preview call runs on for ``language`` (shown while it's being set up)."""
    language_name(language)
    _ensure_preview_org()
    return try_stack.describe(stack_for(language))


def _preview_agent(agent_id: str, preview_token: str) -> dict[str, Any]:
    doc = get_database()["Agents"].find_one(
        {"org_id": PREVIEW_ORG_ID, "agent_id": agent_id}, {"try_preview": 1, "config.demo": 1, "_id": 0}
    )
    meta = (doc or {}).get("try_preview") or {}
    if not doc or not preview_token or not secrets.compare_digest(meta.get("token_hash", ""), _token_hash(preview_token)):
        raise TryError("This test agent has expired. Create it again.", status_code=404)
    if str(meta.get("expires_at") or "") < _now().isoformat():
        raise TryError("This test agent has expired. Create it again.", status_code=404)
    return doc


def register_call(agent_id: str, preview_token: str) -> dict[str, Any]:
    """A call id for a preview agent this visitor made (checked by its token)."""
    from app.services import web_call_service

    _preview_agent(agent_id, preview_token)
    try:
        call = web_call_service.register_web_call(PREVIEW_ORG_ID, agent_id)
    except web_call_service.WebCallError as exc:
        raise TryError(exc.message, exc.status_code) from exc
    calls.open_call(PREVIEW_ORG_ID, agent_id, call["call_id"])
    return {"org_id": PREVIEW_ORG_ID, "agent_id": agent_id, "call_id": call["call_id"]}


def _owned_call(agent_id: str, preview_token: str, call_id: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
    doc = _preview_agent(agent_id, preview_token)
    call = calls.call_state(call_id)
    if call and call.get("agent_id") != agent_id:
        raise TryError("That call isn't this agent's.", status_code=404)
    return doc["config"]["demo"], call


def call_progress(agent_id: str, preview_token: str, call_id: str) -> dict[str, Any]:
    """Flow and step per tool call (the team's review build shows them as tags)."""
    _demo, call = _owned_call(agent_id, preview_token, call_id)
    state = (call or {}).get("state") or {}
    return {
        "active_flow": state.get("active_flow"),
        "step": state.get("step"),
        "turns": [{"at": t["at"], "tool": t["tool"], "flow_id": t.get("flow_id"), "step": t.get("step")} for t in (call or {}).get("turns", [])],
    }


async def summarise(
    agent_id: str, preview_token: str, call_id: str, transcript: list[dict[str, Any]], ip: str | None
) -> dict[str, Any]:
    """Screen 8: the template's call record. The agent fills it with end_call;
    if the visitor hung up first, it is read from the transcript instead."""
    demo, call = _owned_call(agent_id, preview_token, call_id)
    snap = kb.get(demo.get("kb_version"))
    out = calls.summary(snap, demo, call)
    if out["recorded_by_agent"]:
        return out
    turns = [
        (str(t.get("role")), re.sub(r"\s+", " ", str(t.get("text") or "")).strip()[:MAX_CHARS])
        for t in transcript[:MAX_TRANSCRIPT_TURNS]
        if t.get("role") in ("agent", "user")
    ]
    turns = [(r, t) for r, t in turns if t]
    if not any(r == "user" for r, _ in turns):
        return out
    check_and_count(ip, "turn")
    t = builder.template(snap, demo["template_id"])
    fields = [f"{f['key']} ({f['kind']})" for f in t["records_fields"]]
    try:
        text = await _complete(
            _RECORDS_PROMPT.format(
                template=t["name"],
                fields=", ".join(fields),
                transcript="\n".join(
                    f"Agent: {x}" if r == "agent" else f"Caller: {calls.mask_personal(x, calls.published(snap))}" for r, x in turns
                ),
            )
        )
        match = re.search(r"\{.*\}", text, re.S)
        data = json.loads(match.group(0)) if match else {}
    except (TryError, json.JSONDecodeError):
        return out
    for f in out["fields"]:
        value = data.get(f["key"]) if isinstance(data, dict) else None
        f["value"] = calls.clean_record_value(snap, value)
    return out


# --- after sign-in ---------------------------------------------------------------------


async def save_to_workspace(org_id: str, email: str, answers: dict[str, Any], greeting: str | None) -> dict[str, Any]:
    """Create the tried agent in the signed-in user's workspace, on the providers
    it can use there. It keeps its knowledge-base version, flows and tools."""
    snap, config = assemble(answers)
    try:
        models = try_stack.build_models(config["language"], set(auth_service.available_providers(org_id)))
    except try_stack.StackError as exc:
        raise TryError(str(exc), status_code=409) from exc
    opening = await _opening(config, greeting, snap)
    t = builder.template(snap, config["template_id"])
    s = builder.sector(snap, config["sector_id"])
    name = f"{t['name']} · {s['name']} · {language_name(config['language'])}"
    try:
        return await _create(org_id, email, name[:80], _agent_config(snap, config, opening, models, preview=False))
    except Exception as exc:
        from app.services import agent_service

        if isinstance(exc, agent_service.AgentConflictError):
            return await _create(
                org_id, email, f"{name[:70]} · {secrets.token_hex(2)}", _agent_config(snap, config, opening, models, preview=False)
            )
        raise
