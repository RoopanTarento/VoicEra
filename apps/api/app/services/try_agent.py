"""Build and test-call a scheme discovery agent before signing up (/try).

A visitor picks built-in schemes and a language and gets the same agent a
signed-in user would get (``use_cases.build_preset``). For the test call the
server creates a short-lived copy of that agent in a hidden preview
workspace, on a fixed stack (``try_stack``), and the browser calls it through
the normal voice runtime. After sign-in, ``save_to_workspace`` creates the
real agent in the visitor's own workspace.

Everything here runs on platform keys, so it is bounded:

- Prompts are always rebuilt on the server from scheme ids; the browser can't
  send its own, so none of this is an open LLM or voice proxy.
- Preview agents expire after ``TRY_AGENT_TTL_MINUTES`` and need the random
  preview token returned when they were made.
- Usage caps per visitor IP per hour and across everyone per day, counted in
  ``TryTurns`` (shared by every API process; entries expire after a day):
  ``turn`` for text work (greeting, transcript translation, call summary) and
  ``call`` for test calls.
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
from app.services import auth_service, org_service, try_stack, use_cases

logger = logging.getLogger(__name__)

COLLECTION = "TryTurns"
PREVIEW_ORG_ID = "voicera-preview"
PREVIEW_ORG_NAME = "Public preview (system)"
PREVIEW_CREATOR = "preview@voicera.internal"
MAX_TEXTS = 12
MAX_CHARS = 600
MAX_TRANSCRIPT_TURNS = 60
MAX_GREETING_CHARS = 300
MAX_REPLY_TOKENS = 600

# Offered on the try page, in the order shown (codes match apps/providers/languages.py).
LANGUAGES: list[tuple[str, str, str]] = [
    ("kn", "Kannada", "ಕನ್ನಡ"),
    ("hi", "Hindi", "हिन्दी"),
    ("en", "English", "English"),
    ("mr", "Marathi", "मराठी"),
    ("ta", "Tamil", "தமிழ்"),
    ("te", "Telugu", "తెలుగు"),
    ("bn", "Bengali", "বাংলা"),
    ("gu", "Gujarati", "ગુજરાતી"),
    ("ml", "Malayalam", "മലയാളം"),
    ("pa", "Punjabi", "ਪੰਜਾਬੀ"),
    ("od", "Odia", "ଓଡ଼ିଆ"),
]
_LANGUAGE_NAMES = {code: name for code, name, _ in LANGUAGES}

# The preset's greeting names the caller's organisation; a preview has none.
PREVIEW_WELCOME = "Namaste! I'm an assistant who shares information about government schemes. Is this a good time to talk?"

OUTCOMES = ("Shared how to apply", "Checked eligibility", "Not eligible for these schemes", "Call ended early")

_BASE_URLS: dict[str, str | None] = {
    "openai": None,
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}
_DEFAULT_MODELS = try_stack.PREVIEW_LLM_MODELS

_TRANSLATE_TO_PROMPT = (
    "Translate this opening line of a phone call into natural spoken {language}, in its "
    "own script. Reply with only the translation.\n\n{text}"
)
_TRANSLATE_FROM_PROMPT = (
    "Translate each numbered line from a phone call into plain English. Keep the "
    "numbers. Reply with only the numbered translations, one per line.\n\n{lines}"
)
_SUMMARY_PROMPT = """A citizen just had a test call with a government scheme discovery agent.
Schemes the agent knows (id: name): {schemes}

Transcript:
{transcript}

Reply with only JSON: {{"fit": [ids of schemes the agent said may fit the caller],
"explained": [ids of other schemes it explained], "outcome": one of {outcomes}}}.
Use only ids from the list. If nothing was explained, use empty lists and "Call ended early"."""


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


def catalogue() -> dict[str, Any]:
    """Built-in schemes (no organisation's own) and the offered languages."""
    data = use_cases.catalogue("")
    keep = ("id", "name", "category", "summary", "benefit")
    schemes = [{k: s.get(k) for k in keep} for s in data["schemes"] if not s.get("custom")]
    discovery = next((i for i in data["intents"] if i["id"] == "discovery"), None)
    return {
        "schemes": schemes,
        "languages": [{"code": c, "name": n, "native": native} for c, n, native in LANGUAGES],
        "max_schemes": discovery.get("max_schemes") if discovery else None,
        "facts_checked": data.get("facts_checked"),
        "max_call_seconds": settings.TRY_CALL_MAX_SECONDS,
    }


def language_name(code: str) -> str:
    name = _LANGUAGE_NAMES.get(code)
    if not name:
        raise TryError("Pick one of the offered languages.")
    return name


def _scheme_ids(scheme_ids: list[str]) -> list[str]:
    ids = [s for s in dict.fromkeys(scheme_ids) if isinstance(s, str)]
    builtin = {s["id"] for s in catalogue()["schemes"]}
    if not ids or any(i not in builtin for i in ids):
        raise TryError("Pick at least one of the listed schemes.")
    return ids


def build_agent(scheme_ids: list[str], language: str) -> dict[str, Any]:
    """The discovery agent for these schemes, as a signed-in user would get it."""
    language_name(language)
    ids = _scheme_ids(scheme_ids)
    try:
        preset = use_cases.build_preset("", use_case="scheme", intent="discovery", scheme_ids=ids)
    except use_cases.UseCaseError as exc:
        raise TryError(str(exc), exc.status_code) from exc
    return {**preset, "welcome": PREVIEW_WELCOME, "scheme_ids": ids}


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


async def opening_line(scheme_ids: list[str], language: str, ip: str | None) -> dict[str, Any]:
    """Agent name, its opening line in ``language`` (with the English) and the scheme count."""
    agent = build_agent(scheme_ids, language)
    greeting = agent["welcome"]
    if language != "en":
        check_and_count(ip, "turn")
        greeting = await _complete(_TRANSLATE_TO_PROMPT.format(language=language_name(language), text=agent["welcome"]))
        greeting = greeting.strip().strip('"“”')
    return {
        "name": agent["name"],
        "greeting": greeting,
        "english": agent["welcome"] if language != "en" else None,
        "scheme_ids": agent["scheme_ids"],
    }


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


async def summarise(scheme_ids: list[str], transcript: list[dict[str, Any]], ip: str | None) -> dict[str, Any]:
    """Which schemes may fit, which were also explained, and how the call ended."""
    ids = _scheme_ids(scheme_ids)
    turns = [
        (str(t.get("role")), re.sub(r"\s+", " ", str(t.get("text") or "")).strip()[:MAX_CHARS])
        for t in transcript[:MAX_TRANSCRIPT_TURNS]
        if t.get("role") in ("agent", "user")
    ]
    turns = [(r, t) for r, t in turns if t]
    if not any(r == "user" for r, _ in turns):
        return {"fit": [], "explained": [], "outcome": "Call ended early"}
    names = {s["id"]: s["name"] for s in catalogue()["schemes"] if s["id"] in ids}
    check_and_count(ip, "turn")
    text = await _complete(
        _SUMMARY_PROMPT.format(
            schemes="; ".join(f"{i}: {n}" for i, n in names.items()),
            transcript="\n".join(f"{'Agent' if r == 'agent' else 'Caller'}: {t}" for r, t in turns),
            outcomes=", ".join(f'"{o}"' for o in OUTCOMES),
        )
    )
    match = re.search(r"\{.*\}", text, re.S)
    try:
        data = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        data = {}
    fit = [i for i in dict.fromkeys(data.get("fit") or []) if i in names]
    explained = [i for i in dict.fromkeys(data.get("explained") or []) if i in names and i not in fit]
    outcome = data.get("outcome") if data.get("outcome") in OUTCOMES else "Call ended early"
    return {"fit": fit, "explained": explained, "outcome": outcome}


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
    """Remove preview agents past their expiry (they're never shown to anyone)."""
    get_database()["Agents"].delete_many(
        {"org_id": PREVIEW_ORG_ID, "try_preview.expires_at": {"$lt": _now().isoformat()}}
    )


def stack_for(language: str, org_id: str = PREVIEW_ORG_ID) -> dict[str, dict[str, Any]]:
    try:
        return try_stack.build_models(language, set(auth_service.available_providers(org_id)), fixed=True)
    except try_stack.StackError as exc:
        raise TryError(f"Test calls in {language_name(language)} aren't available yet. {exc}", status_code=503) from exc


def _agent_config(agent: dict[str, Any], language: str, greeting: str, models: dict[str, Any], *, preview: bool) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "prompts": {"system_prompt": agent["prompt"], "greeting_message": greeting},
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
            "automatic_call_ending": {"enabled": True, "graceful_llm_call_ending": True},
        },
        "language": {"primary": language, "secondary": []},
        "models": models,
        "knowledge_base": {"enabled": False, "mode": "context", "document_ids": [], "top_k": 5},
        "custom_variables": {},
        "use_case": agent.get("use_case"),
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


async def prepare_call(scheme_ids: list[str], language: str, greeting: str | None, ip: str | None) -> dict[str, Any]:
    """A short-lived agent the browser can call, on the fixed preview stack."""
    agent = build_agent(scheme_ids, language)
    opening = _clean_greeting(greeting) or agent["welcome"]
    _ensure_preview_org()
    models = stack_for(language)
    check_and_count(ip, "call")
    _sweep_expired()
    created = await _create(
        PREVIEW_ORG_ID, PREVIEW_CREATOR, agent["name"][:80], _agent_config(agent, language, opening, models, preview=True)
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
    }


def stack_names(language: str) -> dict[str, str]:
    """What the preview call runs on for ``language`` (shown while it's being set up)."""
    language_name(language)
    _ensure_preview_org()
    return try_stack.describe(stack_for(language))


def register_call(agent_id: str, preview_token: str) -> dict[str, Any]:
    """A call id for a preview agent this visitor made (checked by its token)."""
    from app.services import web_call_service

    doc = get_database()["Agents"].find_one({"org_id": PREVIEW_ORG_ID, "agent_id": agent_id}, {"try_preview": 1})
    meta = (doc or {}).get("try_preview") or {}
    if not doc or not preview_token or not secrets.compare_digest(meta.get("token_hash", ""), _token_hash(preview_token)):
        raise TryError("This test agent has expired. Create it again.", status_code=404)
    if str(meta.get("expires_at") or "") < _now().isoformat():
        raise TryError("This test agent has expired. Create it again.", status_code=404)
    try:
        call = web_call_service.register_web_call(PREVIEW_ORG_ID, agent_id)
    except web_call_service.WebCallError as exc:
        raise TryError(exc.message, exc.status_code) from exc
    return {"org_id": PREVIEW_ORG_ID, "agent_id": agent_id, "call_id": call["call_id"]}


# --- after sign-in ---------------------------------------------------------------------


async def save_to_workspace(
    org_id: str, email: str, scheme_ids: list[str], language: str, greeting: str | None
) -> dict[str, Any]:
    """Create the tried agent in the signed-in user's workspace, on the providers it can use."""
    agent = build_agent(scheme_ids, language)
    try:
        models = try_stack.build_models(language, set(auth_service.available_providers(org_id)))
    except try_stack.StackError as exc:
        raise TryError(str(exc), status_code=409) from exc
    opening = _clean_greeting(greeting) or agent["welcome"]
    return await _create(org_id, email, agent["name"][:80], _agent_config(agent, language, opening, models, preview=False))
