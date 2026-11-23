"""Is the public preview (/try) ready on this server? Prints what works and what to set.

Run inside the API container:

    docker compose exec api python -m app.services.try_check

Never prints a key. Makes one tiny AI request to prove the key works.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import urllib.request

from app.config import settings
from app.database import connect_to_mongo, get_database
from app.services import auth_service, try_agent, try_stack

OK, NO, WARN = "  [ok]  ", "  [!!]  ", "  [..]  "
CALL_LANGUAGES = [code for code, _name, _native in try_agent.LANGUAGES]


def _line(mark: str, text: str) -> None:
    print(f"{mark}{text}")


def _workspaces_with_ai_keys() -> list[str]:
    rows = []
    for provider in ("openai", "groq", "openrouter"):
        for doc in get_database()["ProviderAuth"].find({"provider": provider}, {"org_id": 1}):
            org = get_database()["Organizations"].find_one({"org_id": doc["org_id"]}, {"name": 1}) or {}
            rows.append(f"{doc['org_id']}  ({org.get('name') or 'unnamed'})  has {provider}")
    return rows


async def _text_model() -> bool:
    print("\n1. AI model for the preview's own text (greeting, transcript, summary)")
    found = try_agent.resolve_text_model()
    if not found:
        _line(NO, "No key found. Non-English languages stop at 'Writing the greeting and script'.")
        return False
    provider, model, _key, source = found
    _line(OK, f"{provider} · {model}  (key from {source})")
    try:
        await try_agent._complete("Reply with the single word: ready")
        _line(OK, "Test request worked.")
        return True
    except try_agent.TryError:
        _line(NO, f"Test request failed: the {provider} key is wrong, expired, or lacks {model}.")
        return False


def _lending() -> set[str]:
    print("\n2. Keys lent to the preview's test calls (DEFAULT_PROVIDERS_ORG_ID / DEFAULT_PROVIDERS)")
    if not settings.DEFAULT_PROVIDERS_ORG_ID.strip():
        _line(NO, "DEFAULT_PROVIDERS_ORG_ID is blank, so test calls have no AI key.")
        return set()
    lent = auth_service.lent_providers()
    wanted = auth_service.default_providers()
    _line(OK if lent else NO, f"Workspace {settings.DEFAULT_PROVIDERS_ORG_ID} lends: {', '.join(sorted(lent)) or 'nothing'}")
    for missing in sorted(wanted - lent):
        _line(NO, f"'{missing}' is in DEFAULT_PROVIDERS but that workspace has no {missing} key under Integrations.")
    return lent


def _model_server() -> None:
    print("\n3. Self-hosted speech models (MODEL_SERVER_URL)")
    base = (os.getenv("MODEL_SERVER_URL") or "").strip().rstrip("/")
    if not base:
        _line(WARN, "MODEL_SERVER_URL isn't set in the API container, so Indic Nemotron / Maya 2 can't be confirmed.")
        return
    try:
        with urllib.request.urlopen(f"{base}/models", timeout=3) as resp:
            _line(OK, f"Reachable at {base} (HTTP {resp.status}).")
    except Exception as exc:  # noqa: BLE001
        _line(NO, f"Can't reach {base}/models: {type(exc).__name__}.")


def _call_stacks(lent: set[str]) -> None:
    print("\n4. What each language's test call runs on")
    usable = set(auth_service.available_providers(try_agent.PREVIEW_ORG_ID)) | lent
    for lang in CALL_LANGUAGES:
        try:
            models = try_stack.build_models(lang, usable)
        except try_stack.StackError as exc:
            _line(NO, f"{lang}: {exc} Visitors can't pick {lang}. Lend a key that covers it (Sarvam or Google cover every"
                      " Indian language; OpenAI only English and Hindi voices) or run the speech model server.")
            continue
        parts = [models[key]["provider"] for key in ("stt_config", "llm_config", "tts_config")]
        _line(OK, f"{lang}: " + " → ".join(parts))


def _runtime() -> None:
    print("\n5. Voice runtime")
    url = (os.getenv("RUNTIME_HEALTH_URL") or "http://runtime:7860/health").strip()
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            _line(OK, f"{url} answered (HTTP {resp.status}).")
    except Exception as exc:  # noqa: BLE001
        _line(WARN, f"{url} didn't answer ({type(exc).__name__}). Set RUNTIME_HEALTH_URL if it lives elsewhere.")


def _email() -> None:
    print("\n6. Email sign-in codes")
    _line(OK if settings.MAILTRAP_API_TOKEN else NO, "MAILTRAP_API_TOKEN is " + ("set." if settings.MAILTRAP_API_TOKEN else "blank, so 'Send me a sign-in code' fails."))


async def main() -> int:
    logging.disable(logging.WARNING)  # the report below says the same, plainly
    connect_to_mongo()
    print("VoicEra public preview (/try) readiness")
    text_ok = await _text_model()
    lent = _lending()
    _model_server()
    _call_stacks(lent)
    _runtime()
    _email()
    if not text_ok or not lent:
        print("\nTo fix: pick the workspace whose Integrations key the preview should use:")
        for row in _workspaces_with_ai_keys() or ["(no workspace has an OpenAI, Groq or OpenRouter key yet)"]:
            print(f"    {row}")
        print("  then in the server's .env set, for example:")
        print("    DEFAULT_PROVIDERS_ORG_ID=<that workspace id>")
        print("    DEFAULT_PROVIDERS=groq          # or openai, matching its key")
        print("  and restart the API:  docker compose up -d api")
    return 0 if text_ok and lent else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
