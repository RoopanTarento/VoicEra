"""Try a scheme discovery agent before signing up.

A visitor picks built-in schemes and a language, gets the same agent text a
signed-in user would get (``use_cases.build_preset``), and can chat with it.
Nothing is stored except per-IP usage counts. The chat runs on a platform
key, so it is bounded three ways:

- The system prompt is always rebuilt on the server from scheme ids; the
  browser can't send its own prompt, so this is not an open LLM proxy.
- Short conversations: at most ``MAX_MESSAGES`` messages of ``MAX_CHARS``.
- Usage caps: ``TRY_TURNS_PER_IP_HOUR`` replies per visitor IP per hour and
  ``TRY_TURNS_PER_DAY`` replies across everyone per day. Both are counted in
  ``TryTurns`` (shared by every API process; entries expire after a day).
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from openai import AsyncOpenAI

from app.config import settings
from app.database import get_database
from app.services import use_cases

logger = logging.getLogger(__name__)

COLLECTION = "TryTurns"
MAX_MESSAGES = 24
MAX_CHARS = 600
MAX_REPLY_TOKENS = 400

# Languages offered on the try page (codes match apps/providers/languages.py).
LANGUAGES: dict[str, str] = {
    "hi": "Hindi",
    "en": "English",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "kn": "Kannada",
    "ml": "Malayalam",
    "mr": "Marathi",
    "gu": "Gujarati",
    "pa": "Punjabi",
    "od": "Odia",
}

_BASE_URLS: dict[str, str | None] = {
    "openai": None,
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}
_DEFAULT_MODELS = {"openai": "gpt-4.1-mini", "groq": "openai/gpt-oss-120b", "openrouter": "openai/gpt-4.1-mini"}

# Played as if the agent had phoned the visitor; the preset is written for a call.
_CHAT_FRAME = (
    "This is a text preview of the voice agent above, shown on a website to someone "
    "trying it out. Behave exactly as you would on the call and keep every reply short "
    "(two or three sentences, as if spoken). If they ask about something outside these "
    "schemes, say what you can help with."
)
# The visitor picked a language to hear; most will type in English, so the
# preview answers in that language regardless and adds an English line.
_LANGUAGE_RULE = (
    "Always reply in {language}, in its own script, even when they write in English "
    "or another language. After your reply, write a line containing only --- and then "
    "an English translation of your reply."
)
_GREETING_PROMPT = (
    "Translate this opening line of a phone call into natural spoken {language}, in its "
    "own script. Reply with only the translation.\n\n{welcome}"
)


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


def catalogue() -> dict[str, Any]:
    """Built-in schemes (no organisation's own) and the offered languages."""
    data = use_cases.catalogue("")
    keep = ("id", "name", "category", "summary", "benefit", "questions", "kind", "pack_name", "last_checked")
    schemes = [{k: s.get(k) for k in keep} for s in data["schemes"] if not s.get("custom")]
    discovery = next((i for i in data["intents"] if i["id"] == "discovery"), None)
    return {
        "schemes": schemes,
        "languages": [{"code": c, "name": n} for c, n in LANGUAGES.items()],
        "max_schemes": discovery.get("max_schemes") if discovery else None,
        "facts_checked": data.get("facts_checked"),
    }


def _language(code: str) -> str:
    name = LANGUAGES.get(code)
    if not name:
        raise TryError("Pick one of the offered languages.")
    return name


def build_agent(scheme_ids: list[str], language: str) -> dict[str, Any]:
    """The discovery agent for these schemes, as a signed-in user would get it."""
    _language(language)
    ids = [s for s in dict.fromkeys(scheme_ids) if isinstance(s, str)]
    builtin = {s["id"] for s in catalogue()["schemes"]}
    if not ids or any(i not in builtin for i in ids):
        raise TryError("Pick at least one of the listed schemes.")
    try:
        preset = use_cases.build_preset("", use_case="scheme", intent="discovery", scheme_ids=ids)
    except use_cases.UseCaseError as exc:
        raise TryError(str(exc), exc.status_code) from exc
    return preset


def check_and_count(ip: str | None) -> None:
    """Refuse when this visitor or everyone together is over budget; else record one reply."""
    col = _collection()
    now = _now()
    total = col.count_documents({"key": "all", "at": {"$gte": now - timedelta(days=1)}})
    if total >= settings.TRY_TURNS_PER_DAY:
        raise TryLimited("The free preview is busy today. Sign up to keep building your agent.")
    if ip:
        mine = col.count_documents({"key": f"ip:{ip}", "at": {"$gte": now - timedelta(hours=1)}})
        if mine >= settings.TRY_TURNS_PER_IP_HOUR:
            raise TryLimited("That's the end of the free preview for now. Sign up to keep talking to your agent.")
        col.insert_one({"key": f"ip:{ip}", "at": now})
    col.insert_one({"key": "all", "at": now})


def _clean_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    if not messages:
        raise TryError("Say something to the agent first.")
    if len(messages) > MAX_MESSAGES:
        raise TryLimited("That's the end of the preview chat. Sign up to keep talking to your agent.")
    cleaned: list[dict[str, str]] = []
    for m in messages:
        role = m.get("role")
        content = str(m.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            raise TryError("Couldn't read the conversation.")
        if len(content) > MAX_CHARS:
            raise TryError(f"Keep each message under {MAX_CHARS} characters.")
        cleaned.append({"role": role, "content": content})
    if cleaned[-1]["role"] != "user":
        raise TryError("Say something to the agent first.")
    return cleaned


def _org_key(org_id: str, provider: str) -> str:
    """The key an organisation connected for ``provider`` under Integrations."""
    from app.services import auth_service

    try:
        stored = auth_service.get_provider_auth(org_id, provider, mask_secrets=False)
    except Exception:
        logger.warning("Try-agent couldn't read TRY_KEY_ORG_ID's %s key", provider)
        return ""
    raw = ((stored or {}).get("auth") or {}).get("api_key")
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    return str(raw or "").strip()


def _client() -> tuple[AsyncOpenAI, str, str]:
    provider = (settings.TRY_LLM_PROVIDER or "openai").strip().lower()
    if provider not in _BASE_URLS:
        raise TryError("The preview isn't set up on this server.", status_code=503)
    key = settings.TRY_LLM_API_KEY.strip()
    if not key and settings.TRY_KEY_ORG_ID.strip():
        key = _org_key(settings.TRY_KEY_ORG_ID.strip(), provider)
    if not key and provider == "openai":
        key = settings.KB_EMBEDDING_API_KEY.strip()
    if not key and provider == (settings.COPILOT_LLM_PROVIDER or "").strip().lower():
        key = settings.COPILOT_LLM_API_KEY.strip()
    if not key:
        raise TryError("The preview isn't set up on this server.", status_code=503)
    kwargs: dict[str, Any] = {"api_key": key, "max_retries": 1, "timeout": 30}
    if _BASE_URLS[provider]:
        kwargs["base_url"] = _BASE_URLS[provider]
    model = (settings.TRY_LLM_MODEL or "").strip() or _DEFAULT_MODELS[provider]
    return AsyncOpenAI(**kwargs), provider, model


def _split(text: str) -> tuple[str, str | None]:
    """A reply and its English line (after ---, which the model doesn't always put on its own line)."""
    parts = re.split(r"\s*-{3,}\s*", text.strip(), maxsplit=1)
    reply = parts[0].strip()
    english = parts[1].strip() if len(parts) > 1 else ""
    if not reply:  # separator first: nothing in the chosen language
        return english, None
    return reply, english or None


async def _complete(client: AsyncOpenAI, provider: str, model: str, messages: list[dict[str, str]]) -> str:
    extra: dict[str, Any] = {}
    if "gpt-oss" in model:
        extra = {"extra_body": {"reasoning": {"effort": "low"}}} if provider == "openrouter" else {"reasoning_effort": "low"}
    try:
        response = await client.chat.completions.create(
            model=model, messages=messages, max_tokens=MAX_REPLY_TOKENS, temperature=0.4, **extra
        )
    except Exception as exc:
        logger.warning("Try-agent chat failed provider=%s model=%s: %s", provider, model, type(exc).__name__)
        raise TryError("The agent couldn't answer just now. Try again in a moment.", status_code=502) from exc
    text = (response.choices[0].message.content or "").strip()
    if not text:
        raise TryError("The agent couldn't answer just now. Try again in a moment.", status_code=502)
    return text


async def greeting(scheme_ids: list[str], language: str, ip: str | None) -> dict[str, str | None]:
    """The agent's opening line in the chosen language, with the English original."""
    agent = build_agent(scheme_ids, language)
    name = _language(language)
    if language == "en":
        return {"reply": agent["welcome"], "english": None}
    client, provider, model = _client()
    check_and_count(ip)
    text = await _complete(
        client, provider, model,
        [{"role": "user", "content": _GREETING_PROMPT.format(language=name, welcome=agent["welcome"])}],
    )
    return {"reply": _split(text)[0], "english": agent["welcome"]}


async def chat(
    scheme_ids: list[str], language: str, messages: list[dict[str, Any]], ip: str | None
) -> dict[str, str | None]:
    """The agent's next reply (and its English line). ``messages`` starts after its greeting."""
    agent = build_agent(scheme_ids, language)
    name = _language(language)
    history = _clean_messages(messages)
    client, provider, model = _client()
    check_and_count(ip)
    system = agent["prompt"] + "\n\n" + _CHAT_FRAME
    if language != "en":
        system += " " + _LANGUAGE_RULE.format(language=name)
    text = await _complete(
        client, provider, model,
        [{"role": "system", "content": system}, {"role": "assistant", "content": agent["welcome"]}, *history],
    )
    reply, english = _split(text)
    return {"reply": reply, "english": english if language != "en" else None}
