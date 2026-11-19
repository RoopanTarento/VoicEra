"""Copilot tests: tool org-scoping, conversation persistence/isolation,
the streaming tool-calling engine loop, and router auth/permission wiring.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import mongomock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openai import APIError, APIStatusError, RateLimitError

from app import database as database_module
from app.auth import get_current_user
from app.routers import copilot as copilot_router
from app.services.copilot import conversation_store, engine, tools


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def fake_mongo(monkeypatch: pytest.MonkeyPatch):
    """Back app.database.get_database() with an in-memory mongomock DB for
    every test in this file, so tools/conversation_store exercise real
    Mongo-shaped queries (find/sort/limit/update_one/$push) instead of mocks."""
    client = mongomock.MongoClient()
    db = client["voicera_copilot_test"]
    monkeypatch.setattr(database_module.mongodb, "database", db)
    monkeypatch.setattr(database_module.mongodb, "client", client)
    yield db


def _connect_provider(monkeypatch: pytest.MonkeyPatch, org_id: str, provider: str) -> None:
    """Store real, encrypted provider credentials for ``org_id`` — the same
    path list_available_providers and propose_create_agent's explicit-choice
    validation check via auth_service.list_configured_providers."""
    from cryptography.fernet import Fernet

    from app.services import auth_service, secret_crypto

    monkeypatch.setattr(secret_crypto.settings, "PROVIDER_AUTH_ENCRYPTION_KEY", Fernet.generate_key().decode())
    auth_service.upsert_provider_auth(org_id, provider, {"api_key": f"{provider}-test-key"})


def _seed_agent(db, *, org_id: str, agent_id: str, name: str) -> None:
    db["Agents"].insert_one(
        {
            "agent_id": agent_id,
            "org_id": org_id,
            "name": name,
            "status": "active",
            "archived": False,
            "agent_category": "telephony",
            "created_by": "owner@example.com",
            "linked_phone_number": None,
            "telephony": None,
            "config": {
                "prompts": {"system_prompt": "Be helpful.", "greeting_message": "Hi!"},
                "language": {"primary": "en", "secondary": []},
                "models": {
                    "stt_config": {"provider": "openai", "model": "gpt-4o-transcribe"},
                    "tts_config": {"provider": "openai", "model": "gpt-4o-mini-tts"},
                    "llm_config": {"provider": "openai", "model": "gpt-4o-mini"},
                },
                "knowledge_base": {"enabled": False, "mode": "context", "document_ids": [], "top_k": 5},
            },
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    )


# ---------------------------------------------------------------------------
# Tool org-scoping (the core isolation guarantee)
# ---------------------------------------------------------------------------


def test_list_agents_is_scoped_to_org(fake_mongo):
    _seed_agent(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")
    _seed_agent(fake_mongo, org_id="org-b", agent_id="agent-2", name="Other Org Agent")

    result = tools.list_agents("org-a")

    assert result["count"] == 1
    assert result["agents"][0]["name"] == "Farmer Support"
    assert result["agents"][0]["agent_id"] == "agent-1"


def test_get_agent_not_found_raises_tool_error(fake_mongo):
    _seed_agent(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")

    with pytest.raises(tools.CopilotToolError):
        tools.get_agent("org-a", agent_id="does-not-exist")

    # Cross-org lookup of a real agent id must also fail — org-b can't read org-a's agent.
    with pytest.raises(tools.CopilotToolError):
        tools.get_agent("org-b", agent_id="agent-1")


def test_list_calls_filters_by_org_and_status(fake_mongo):
    fake_mongo["CallLogs"].insert_many(
        [
            {
                "call_id": "call-1",
                "org_id": "org-a",
                "agent_id": "agent-1",
                "status": "completed",
                "call_response": "answered",
                "created_at": "2026-01-02T00:00:00+00:00",
            },
            {
                "call_id": "call-2",
                "org_id": "org-a",
                "agent_id": "agent-1",
                "status": "failed",
                "call_response": "no_answer",
                "created_at": "2026-01-02T01:00:00+00:00",
            },
            {
                "call_id": "call-3",
                "org_id": "org-b",
                "agent_id": "agent-9",
                "status": "completed",
                "call_response": "answered",
                "created_at": "2026-01-02T02:00:00+00:00",
            },
        ]
    )

    result = tools.list_calls("org-a", status="completed")

    assert result["count"] == 1
    assert result["calls"][0]["call_id"] == "call-1"


def test_search_knowledge_base_rejects_empty_query():
    with pytest.raises(tools.CopilotToolError):
        tools.search_knowledge_base("org-a", query="   ")


# ---------------------------------------------------------------------------
# Provider selection (engine._resolve_provider/_resolve_model/_resolve_api_key)
# ---------------------------------------------------------------------------


def test_resolve_provider_defaults_to_openai(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "")
    assert engine._resolve_provider() == "openai"


def test_resolve_provider_rejects_unsupported(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "azure_openai")
    with pytest.raises(engine.CopilotConfigurationError, match="not supported"):
        engine._resolve_provider()


def test_resolve_model_uses_provider_catalog_default_when_unset(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_MODEL", "")
    assert engine._resolve_model("groq") == engine._PROVIDER_DEFAULT_MODELS["groq"]
    assert engine._resolve_model("openai") == "gpt-4o-mini"


def test_resolve_model_respects_explicit_override(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_MODEL", "llama-3.1-8b-instant")
    assert engine._resolve_model("groq") == "llama-3.1-8b-instant"


def test_groq_uses_its_own_base_url_and_falls_back_to_platform_key(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "groq-platform-key")
    api_key = engine._resolve_api_key("org-a", "groq")
    assert api_key == "groq-platform-key"
    assert engine._PROVIDER_BASE_URLS["groq"] == "https://api.groq.com/openai/v1"


def test_resolve_api_key_prefers_org_credential_over_platform_key(fake_mongo, monkeypatch):
    from cryptography.fernet import Fernet

    from app.services import auth_service, secret_crypto

    monkeypatch.setattr(secret_crypto.settings, "PROVIDER_AUTH_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "platform-fallback-key")
    auth_service.upsert_provider_auth("org-a", "groq", {"api_key": "org-owned-groq-key"})
    assert engine._resolve_api_key("org-a", "groq") == "org-owned-groq-key"


@pytest.mark.asyncio
async def test_engine_uses_configured_provider_base_url_and_model(fake_mongo, monkeypatch):
    """The client the engine builds must target the configured provider's real
    endpoint and model — not silently stay pinned to OpenAI defaults."""
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "groq")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-groq-key")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_MODEL", "")

    captured: dict[str, Any] = {}

    class _CapturingAsyncOpenAI:
        def __init__(self, api_key: str | None = None, base_url: str | None = None, **_: Any) -> None:
            captured["api_key"] = api_key
            captured["base_url"] = base_url

            async def create(**kwargs: Any):
                captured["model"] = kwargs.get("model")

                async def _gen():
                    yield _content_chunk("hi", finish_reason="stop")

                return _gen()

            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    monkeypatch.setattr(engine, "AsyncOpenAI", _CapturingAsyncOpenAI)

    async for _ in engine.run_copilot_turn(
        org_id="org-a",
        user_email="alice@example.com",
        role="admin",
        message="hello",
        conversation_id=None,
        context=None,
    ):
        pass

    assert captured["api_key"] == "test-groq-key"
    assert captured["base_url"] == "https://api.groq.com/openai/v1"
    assert captured["model"] == engine._PROVIDER_DEFAULT_MODELS["groq"]


@pytest.mark.asyncio
async def test_engine_disables_sdk_retries_so_a_rate_limit_fails_fast(fake_mongo, monkeypatch):
    """The OpenAI SDK's default (max_retries=2) honors a provider's
    Retry-After header by sleeping *inside* the call — for a rate-limited
    request that can mean tens of seconds with zero bytes sent on the SSE
    stream, long enough that the browser treats the connection as dead. The
    engine must ask for max_retries=0 so a 429 raises immediately instead."""
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "groq")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-groq-key")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_MODEL", "")

    captured: dict[str, Any] = {}

    class _RateLimitedAsyncOpenAI:
        def __init__(self, **kwargs: Any) -> None:
            captured["max_retries"] = kwargs.get("max_retries")

            async def create(**_: Any):
                raise Exception("Error code: 429 - rate limit exceeded")

            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    monkeypatch.setattr(engine, "AsyncOpenAI", _RateLimitedAsyncOpenAI)

    events = [
        json.loads(line[len("data: ") :])
        for line in [
            line
            async for line in engine.run_copilot_turn(
                org_id="org-a",
                user_email="alice@example.com",
                role="admin",
                message="hello",
                conversation_id=None,
                context=None,
            )
        ]
        if line.startswith("data: ")
    ]

    assert captured["max_retries"] == 0
    error_events = [e for e in events if e["type"] == "error"]
    assert len(error_events) == 1
    assert "rate-limiting" in error_events[0]["message"]


def test_execute_tool_drops_spurious_arguments_a_weaker_model_might_send(fake_mongo):
    """openai/gpt-oss-20b (and other small/local models) sometimes emit a
    junk key like {"": ""} for a tool that takes no arguments instead of a
    clean {} — this must not fail the call, since the model can't reliably
    self-correct from a generic "invalid arguments" error and would just
    waste another round trip (and its tokens) retrying the same mistake."""
    result, ok = engine._execute_tool(
        "org-a",
        "list_available_providers",
        {"": ""},
        user_email="alice@example.com",
        user_role="admin",
        conversation_id=None,
    )
    assert ok is True
    assert result == {"stt": [], "tts": [], "llm": []}


@pytest.mark.asyncio
async def test_stream_with_heartbeats_keeps_the_connection_alive(monkeypatch):
    """While a completions call is still pending, the wrapper yields SSE
    comment lines (harmless — see streamCopilotChat's frontend parser, which
    only reacts to lines starting with "data:") instead of producing total
    silence on the stream."""
    monkeypatch.setattr(engine, "_HEARTBEAT_INTERVAL_S", 0.01)

    async def slow_call():
        await asyncio.sleep(0.05)
        return "final-result"

    items = [item async for item in engine._stream_with_heartbeats(slow_call())]

    assert items[-1] == "final-result"
    assert all(item == ": keep-alive\n\n" for item in items[:-1])
    assert len(items) > 1


@pytest.mark.asyncio
async def test_sleep_with_heartbeats_keeps_the_connection_alive_during_a_long_wait(monkeypatch):
    """Real bug found live: a retry_wait sleep of up to ~65s with zero bytes
    sent the whole time reproduces the exact original "network error" bug
    (browser treats a quiet connection as dead), just at a longer
    timescale. This must emit keep-alives throughout the wait, not just
    once at the start."""
    monkeypatch.setattr(engine, "_HEARTBEAT_INTERVAL_S", 5.0)
    real_sleep = asyncio.sleep

    async def fast_forward(_seconds: float) -> None:
        await real_sleep(0)  # yield control without actually waiting in the test

    monkeypatch.setattr(engine.asyncio, "sleep", fast_forward)

    items = [item async for item in engine._sleep_with_heartbeats(23.0)]

    # ceil(23/5) - 1 = 4 keep-alives between the 5 chunks (5,5,5,5,3)
    assert items == [": keep-alive\n\n"] * 4


@pytest.mark.asyncio
async def test_completion_recovery_emits_heartbeats_during_a_long_retry_wait(monkeypatch):
    """End-to-end version of the bug above, through the actual recovery
    path a real turn takes: a rate-limit retry_wait long enough to span
    multiple heartbeat intervals must keep the stream visibly alive."""
    monkeypatch.setattr(engine, "_HEARTBEAT_INTERVAL_S", 5.0)
    real_sleep = asyncio.sleep

    async def fast_forward(_seconds: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr(engine.asyncio, "sleep", fast_forward)

    attempts = {"n": 0}

    def make_coro():
        attempts["n"] += 1
        if attempts["n"] == 1:

            async def _fail():
                raise _make_rate_limit_error("23")

            return _fail()

        async def _succeed():
            return "the-real-stream"

        return _succeed()

    items = [item async for item in engine._create_completion_with_recovery(make_coro)]

    keep_alives = [item for item in items if item == ": keep-alive\n\n"]
    assert len(keep_alives) >= 3
    assert items[-1] == "the-real-stream"


def _make_rate_limit_error(retry_after_seconds: str) -> RateLimitError:
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    response = httpx.Response(
        429,
        headers={"retry-after": retry_after_seconds},
        request=request,
    )
    return RateLimitError("rate limit exceeded", response=response, body=None)


def test_rate_limit_wait_seconds_reads_the_real_retry_after_header():
    assert engine._rate_limit_wait_seconds(_make_rate_limit_error("18")) == 18.0


@pytest.mark.asyncio
async def test_completion_recovery_retries_once_on_a_short_rate_limit(monkeypatch):
    """The whole point of this feature: a short, provider-stated rate-limit
    wait (this account hits these constantly — an 8000 TPM cap against a
    prompt that alone costs ~6000 tokens) should be recovered from
    automatically, with a visible status in between, instead of failing the
    turn outright the way max_retries=0 alone would."""
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    attempts = {"n": 0}

    def make_coro():
        attempts["n"] += 1
        if attempts["n"] == 1:

            async def _fail():
                raise _make_rate_limit_error("2")

            return _fail()

        async def _succeed():
            return "the-real-stream"

        return _succeed()

    items = [item async for item in engine._create_completion_with_recovery(make_coro)]

    assert attempts["n"] == 2
    assert sleeps == [2.0]
    assert items[-1] == "the-real-stream"

    retry_events = [json.loads(item[len("data: ") :]) for item in items[:-1]]
    assert retry_events == [{"type": "retry_wait", "seconds": 2.0, "message": retry_events[0]["message"]}]
    assert "2s" in retry_events[0]["message"]


@pytest.mark.asyncio
async def test_completion_recovery_retries_twice_when_the_first_retry_also_gets_limited(monkeypatch):
    """Real observed behaviour on this account: a retry can land moments
    before the TPM window rolls over and get hit again, this time with a
    much shorter wait. One retry alone would give up here; this must keep
    going up to _MAX_AUTO_RETRY_ATTEMPTS before it does."""
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    attempts = {"n": 0}

    def make_coro():
        attempts["n"] += 1
        if attempts["n"] in (1, 2):
            wait = "19" if attempts["n"] == 1 else "0.6"

            async def _fail():
                raise _make_rate_limit_error(wait)

            return _fail()

        async def _succeed():
            return "the-real-stream"

        return _succeed()

    items = [item async for item in engine._create_completion_with_recovery(make_coro)]

    assert attempts["n"] == 3
    # The 19s wait is chunked into heartbeat-interval pieces (see
    # test_sleep_with_heartbeats_...), so the total slept time — not the
    # exact call list — is what matters here.
    assert sum(sleeps) == pytest.approx(19.6)
    assert items[-1] == "the-real-stream"


@pytest.mark.asyncio
async def test_completion_recovery_gives_up_on_a_long_rate_limit(monkeypatch):
    """A wait longer than _MAX_AUTO_RETRY_WAIT_S isn't worth blocking the
    turn on — this should raise immediately (existing fast-fail behaviour),
    not silently sleep for a long time."""
    monkeypatch.setattr(engine, "_MAX_AUTO_RETRY_WAIT_S", 30.0)

    async def fake_sleep(_seconds: float) -> None:
        raise AssertionError("should not sleep for a wait this long")

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    def make_coro():
        async def _fail():
            raise _make_rate_limit_error("120")

        return _fail()

    with pytest.raises(RateLimitError):
        async for _ in engine._create_completion_with_recovery(make_coro):
            pass


def _make_tool_call_json_error(message: str = "Failed to parse tool call arguments as JSON") -> APIError:
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    return APIError(message, request, body=None)


@pytest.mark.asyncio
async def test_completion_recovery_retries_on_a_transient_tool_call_json_error(monkeypatch):
    """Real Groq/openai-gpt-oss-20b flakiness observed in practice: the
    provider aborts the stream mid-generation with this exact message when
    the model emits malformed JSON for a tool call's arguments (more likely
    for a long field like propose_create_agent's system_prompt).
    Regenerating the same request should be tried automatically."""
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    attempts = {"n": 0}

    def make_coro():
        attempts["n"] += 1
        if attempts["n"] == 1:

            async def _fail():
                raise _make_tool_call_json_error()

            return _fail()

        async def _succeed():
            return "the-real-stream"

        return _succeed()

    items = [item async for item in engine._create_completion_with_recovery(make_coro)]

    assert attempts["n"] == 2
    assert sleeps == [engine._TOOL_CALL_ERROR_RETRY_DELAY_S]
    assert items[-1] == "the-real-stream"

    retry_events = [json.loads(item[len("data: ") :]) for item in items[:-1]]
    assert retry_events[0]["type"] == "retry_wait"


@pytest.mark.asyncio
async def test_completion_recovery_does_not_retry_an_unrelated_api_error(monkeypatch):
    """Only the specific known-transient tool-call-JSON failure should be
    retried automatically — any other APIError is a real, possibly
    non-transient failure and must surface immediately, not be masked by a
    blind retry."""

    async def fake_sleep(_seconds: float) -> None:
        raise AssertionError("should not retry an unrelated error")

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    def make_coro():
        async def _fail():
            raise _make_tool_call_json_error("The model's engine is currently overloaded")

        return _fail()

    with pytest.raises(APIError):
        async for _ in engine._create_completion_with_recovery(make_coro):
            pass


def _make_request_too_large_error(
    message: str = (
        "Request too large for model `openai/gpt-oss-20b` in organization `org_x` "
        "service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested "
        "8404, please reduce your message size and try again."
    ),
) -> APIStatusError:
    """Real, verbatim Groq failure mode found via live testing: after a tool
    call's result is appended to the conversation, the *next* completion
    call's prompt + max_tokens can exceed the account's whole per-minute
    budget. Unlike a 429 RateLimitError, this is HTTP 413 — a distinct
    exception class the SDK doesn't special-case, so it surfaces as a plain
    APIStatusError (a subclass of APIError, not RateLimitError)."""
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    response = httpx.Response(413, request=request)
    return APIStatusError(message, response=response, body=None)


def test_is_request_too_large_error_detects_a_413_status():
    assert engine._is_request_too_large_error(_make_request_too_large_error()) is True


def test_is_request_too_large_error_ignores_unrelated_errors():
    assert engine._is_request_too_large_error(_make_tool_call_json_error()) is False


@pytest.mark.asyncio
async def test_completion_recovery_retries_with_a_smaller_budget_on_a_too_large_error(monkeypatch):
    """Real bug found via live testing: creating an agent (list_agents +
    get_analytics_summary or propose_create_agent) can produce a tool result
    large enough that the *follow-up* completion call — the one that writes
    the narrative reply — exceeds the account's 8000 TPM cap on its own.
    Retrying the identical request would fail identically forever (the size
    doesn't change with time, unlike a 429), so recovery must actually
    shrink the request via a separate ``shrink_coro`` using a smaller
    max_tokens, not just wait and repeat ``make_coro``."""

    async def fake_sleep(_seconds: float) -> None:
        raise AssertionError("a too-large retry should not need to sleep")

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    make_calls = {"n": 0}
    shrink_calls = {"n": 0}

    def make_coro():
        make_calls["n"] += 1

        async def _fail():
            raise _make_request_too_large_error()

        return _fail()

    def shrink_coro():
        shrink_calls["n"] += 1

        async def _succeed():
            return "the-shorter-stream"

        return _succeed()

    items = [
        item
        async for item in engine._create_completion_with_recovery(make_coro, shrink_coro=shrink_coro)
    ]

    assert make_calls["n"] == 1
    assert shrink_calls["n"] == 1
    assert items[-1] == "the-shorter-stream"

    retry_events = [json.loads(item[len("data: ") :]) for item in items[:-1]]
    assert retry_events == [{"type": "retry_wait", "seconds": 0, "message": retry_events[0]["message"]}]


@pytest.mark.asyncio
async def test_completion_recovery_reraises_a_too_large_error_without_a_shrink_coro(monkeypatch):
    """Backward-compat: a caller that doesn't opt into the shrink retry (no
    ``shrink_coro`` passed) must see the original 413 surface immediately,
    exactly like any other unrelated APIError — no silent behaviour change
    for existing call sites."""

    async def fake_sleep(_seconds: float) -> None:
        raise AssertionError("should not sleep without a shrink_coro")

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    def make_coro():
        async def _fail():
            raise _make_request_too_large_error()

        return _fail()

    with pytest.raises(APIStatusError):
        async for _ in engine._create_completion_with_recovery(make_coro):
            pass


@pytest.mark.asyncio
async def test_completion_recovery_reraises_if_the_shrunk_retry_also_fails(monkeypatch):
    """The shrink retry is a single, one-shot attempt — if the smaller
    request still doesn't fit, this must surface as a real error rather than
    looping or masking the failure."""

    async def fake_sleep(_seconds: float) -> None:
        raise AssertionError("should not sleep on the one-shot shrink retry")

    monkeypatch.setattr(engine.asyncio, "sleep", fake_sleep)

    def make_coro():
        async def _fail():
            raise _make_request_too_large_error()

        return _fail()

    def shrink_coro():
        async def _fail_again():
            raise _make_request_too_large_error()

        return _fail_again()

    with pytest.raises(APIStatusError):
        async for _ in engine._create_completion_with_recovery(make_coro, shrink_coro=shrink_coro):
            pass


# ---------------------------------------------------------------------------
# Conversation persistence + org/user isolation
# ---------------------------------------------------------------------------


def test_conversation_scoped_to_org_and_creator(fake_mongo):
    conv = conversation_store.create_conversation("org-a", "alice@example.com", "How are my calls doing?")
    conversation_store.append_messages(
        "org-a",
        "alice@example.com",
        conv["conversation_id"],
        [{"role": "user", "content": "How are my calls doing?", "created_at": "now", "tool_calls": []}],
    )

    fetched = conversation_store.get_conversation("org-a", "alice@example.com", conv["conversation_id"])
    assert fetched["title"].startswith("How are my calls")
    assert len(fetched["messages"]) == 1

    # Different user in the same org cannot read alice's conversation.
    with pytest.raises(conversation_store.CopilotConversationNotFoundError):
        conversation_store.get_conversation("org-a", "bob@example.com", conv["conversation_id"])

    # Same user, different org (e.g. switched active org) cannot read it either.
    with pytest.raises(conversation_store.CopilotConversationNotFoundError):
        conversation_store.get_conversation("org-b", "alice@example.com", conv["conversation_id"])


def test_list_conversations_only_returns_callers_own(fake_mongo):
    conversation_store.create_conversation("org-a", "alice@example.com", "Q1")
    conversation_store.create_conversation("org-a", "bob@example.com", "Q2")

    alice_convos = conversation_store.list_conversations("org-a", "alice@example.com")
    assert len(alice_convos) == 1
    assert alice_convos[0]["title"] == "Q1"


def test_editing_the_first_message_regenerates_the_title(fake_mongo):
    """The title is set once from the first message — if that message gets
    truncated away (the user edited it), the next append must regenerate it,
    or the conversation list would keep describing content that no longer
    exists in the conversation at all."""
    conv = conversation_store.create_conversation("org-a", "alice@example.com", "Original question")
    conversation_store.append_messages(
        "org-a",
        "alice@example.com",
        conv["conversation_id"],
        [
            {"role": "user", "content": "Original question", "created_at": "t1", "tool_calls": []},
            {"role": "assistant", "content": "Original answer", "created_at": "t1", "tool_calls": []},
        ],
    )
    conversation_store.truncate_messages("org-a", "alice@example.com", conv["conversation_id"], 0)
    conversation_store.append_messages(
        "org-a",
        "alice@example.com",
        conv["conversation_id"],
        [
            {"role": "user", "content": "Edited question", "created_at": "t2", "tool_calls": []},
            {"role": "assistant", "content": "New answer", "created_at": "t2", "tool_calls": []},
        ],
    )

    convos = conversation_store.list_conversations("org-a", "alice@example.com")
    assert convos[0]["title"] == "Edited question"


# ---------------------------------------------------------------------------
# Engine: streaming tool-calling loop against a scripted fake OpenAI client
# ---------------------------------------------------------------------------


def _content_chunk(text: str | None, finish_reason: str | None = None):
    delta = SimpleNamespace(content=text, tool_calls=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)])


def _tool_call_chunk(
    index: int,
    *,
    call_id: str | None = None,
    name: str | None = None,
    arguments: str | None = None,
    finish_reason: str | None = None,
):
    func = SimpleNamespace(name=name, arguments=arguments)
    tc = SimpleNamespace(index=index, id=call_id, function=func)
    delta = SimpleNamespace(content=None, tool_calls=[tc])
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)])


class _FakeCompletions:
    def __init__(self, scripted_rounds: list[list[Any]]):
        self._rounds = list(scripted_rounds)
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any):
        self.calls.append(kwargs)
        chunks = self._rounds.pop(0)

        async def _gen():
            for chunk in chunks:
                if isinstance(chunk, BaseException):  # the provider aborting mid-stream
                    raise chunk
                yield chunk

        return _gen()


def _fake_openai_factory(scripted_rounds: list[list[Any]]):
    completions = _FakeCompletions(scripted_rounds)

    class _FakeAsyncOpenAI:
        def __init__(self, api_key: str | None = None, **_: Any) -> None:
            self.chat = SimpleNamespace(completions=completions)

    _FakeAsyncOpenAI.completions = completions  # test introspection hook
    return _FakeAsyncOpenAI


def _parse_sse_events(lines: list[str]) -> list[dict[str, Any]]:
    events = []
    for line in lines:
        assert line.startswith("data: ")
        events.append(json.loads(line[len("data: "):].strip()))
    return events


@pytest.mark.asyncio
async def test_engine_executes_tool_call_and_persists_conversation(fake_mongo, monkeypatch):
    _seed_agent(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")

    fake_cls = _fake_openai_factory(
        [
            [
                _tool_call_chunk(0, call_id="call_1", name="list_agents", arguments="{}"),
                _tool_call_chunk(0, finish_reason="tool_calls"),
            ],
            [
                _content_chunk("You have 1 agent: Farmer Support."),
                _content_chunk(None, finish_reason="stop"),
            ],
        ]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    lines = [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="How many agents do I have?",
            conversation_id=None,
            context=None,
        )
    ]
    events = _parse_sse_events(lines)
    types = [e["type"] for e in events]
    assert types == ["start", "tool_call", "tool_result", "token", "done"]

    tool_call_event = events[types.index("tool_call")]
    assert tool_call_event["tool"] == "list_agents"

    tool_result_event = events[types.index("tool_result")]
    assert tool_result_event["ok"] is True
    assert tool_result_event["data"]["count"] == 1
    assert tool_result_event["data"]["agents"][0]["name"] == "Farmer Support"

    done_event = events[-1]
    assert done_event["text"] == "You have 1 agent: Farmer Support."
    conversation_id = done_event["conversation_id"]

    # The full data still goes to the frontend (needed for e.g. AgentDraftCard),
    # but what the model itself sees for a subsequent round is capped — a real,
    # observed cause of a 413 "request too large" on this account's tight
    # 8000 TPM ceiling was a multi-tool turn's accumulated *uncapped* tool
    # results, not just the completion's own max_tokens.
    second_call_messages = fake_cls.completions.calls[1]["messages"]
    tool_message = next(m for m in second_call_messages if m["role"] == "tool")
    assert len(tool_message["content"]) <= 3000

    # The org_id used by the tool call came from the authenticated request,
    # never from the model — confirmed by only org-a's agent coming back above.
    stored = conversation_store.get_conversation("org-a", "alice@example.com", conversation_id)
    assert len(stored["messages"]) == 2
    assert stored["messages"][0]["role"] == "user"
    assert stored["messages"][1]["role"] == "assistant"
    assert stored["messages"][1]["tool_calls"][0]["tool"] == "list_agents"


@pytest.mark.asyncio
async def test_engine_truncates_a_genuinely_large_tool_result_for_the_model(fake_mongo, monkeypatch):
    """Real regression test for the 413 above: a tool result that's actually
    bigger than the cap must be cut down to what the model sees, not passed
    through whole — while the frontend's own tool_result event (asserted
    separately) keeps everything. Uses a stand-in tool function so this
    doesn't depend on exactly how much any specific real tool trims its own
    output (get_agent, for instance, already trims system_prompt itself)."""
    big_payload = {"blob": "x" * 10000}
    monkeypatch.setitem(engine.TOOL_FUNCTIONS, "get_agent", lambda org_id, **kwargs: big_payload)
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")

    fake_cls = _fake_openai_factory(
        [
            [
                _tool_call_chunk(0, call_id="call_1", name="get_agent", arguments='{"agent_id": "agent-big"}'),
                _tool_call_chunk(0, finish_reason="tool_calls"),
            ],
            [
                _content_chunk("Here it is."),
                _content_chunk(None, finish_reason="stop"),
            ],
        ]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    lines = [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="What's the prompt on Crop Advisory?",
            conversation_id=None,
            context=None,
        )
    ]
    events = _parse_sse_events(lines)

    # Frontend still gets the whole real thing, untruncated.
    tool_result_event = next(e for e in events if e["type"] == "tool_result")
    assert len(tool_result_event["data"]["blob"]) == 10000

    # The model's own next-round context does not.
    second_call_messages = fake_cls.completions.calls[1]["messages"]
    tool_message = next(m for m in second_call_messages if m["role"] == "tool")
    assert len(tool_message["content"]) <= 3000


@pytest.mark.asyncio
async def test_ephemeral_turn_persists_nothing_and_uses_client_supplied_history(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_openai_factory(
        [[_content_chunk("Your name is Bob, as you told me."), _content_chunk(None, finish_reason="stop")]]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    before = conversation_store.list_conversations("org-a", "alice@example.com")

    lines = [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="What's my name again?",
            conversation_id=None,
            context=None,
            ephemeral=True,
            history=[{"role": "user", "content": "My name is Bob."}],
        )
    ]
    events = _parse_sse_events(lines)
    types = [e["type"] for e in events]
    assert types == ["start", "token", "done"]
    assert events[0]["conversation_id"] is None
    assert events[-1]["conversation_id"] is None

    # The client-supplied history actually reached the model...
    sent_messages = fake_cls.completions.calls[0]["messages"]
    assert {"role": "user", "content": "My name is Bob."} in sent_messages

    # ...and nothing about this turn was ever written to CopilotConversations.
    after = conversation_store.list_conversations("org-a", "alice@example.com")
    assert after == before


@pytest.mark.asyncio
async def test_engine_answers_without_tools_when_none_needed(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_openai_factory(
        [[_content_chunk("VoicERA lets you build voice agents."), _content_chunk(None, finish_reason="stop")]]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    lines = [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="member",
            message="What is VoicERA?",
            conversation_id=None,
            context={"route": "/dashboard"},
        )
    ]
    events = _parse_sse_events(lines)
    assert [e["type"] for e in events] == ["start", "token", "done"]
    assert events[-1]["text"] == "VoicERA lets you build voice agents."


@pytest.mark.asyncio
async def test_engine_yields_error_event_when_no_api_key_configured(fake_mongo, monkeypatch):
    # Pin the provider explicitly rather than relying on whatever the ambient
    # .env happens to default to (e.g. a local dev .env configuring
    # openrouter) — this test is specifically about the openai no-key path.
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "")
    monkeypatch.setattr(engine.settings, "KB_EMBEDDING_API_KEY", "")

    lines = [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="member",
            message="Hello",
            conversation_id=None,
            context=None,
        )
    ]
    events = _parse_sse_events(lines)
    assert events[0]["type"] == "start"
    assert events[-1]["type"] == "error"
    assert "OpenAI" in events[-1]["message"]


@pytest.mark.asyncio
async def test_engine_returns_error_for_unknown_conversation(fake_mongo):
    lines = [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="member",
            message="Hello",
            conversation_id="does-not-exist",
            context=None,
        )
    ]
    events = _parse_sse_events(lines)
    assert events == [{"type": "error", "message": "Conversation not found."}]


# ---------------------------------------------------------------------------
# Router: auth + per-user/org scoping
# ---------------------------------------------------------------------------


def _user(email: str = "alice@example.com", org_id: str = "org-a", role: str = "admin") -> dict[str, Any]:
    return {"email": email, "org_id": org_id, "role": role}


@pytest.fixture
def copilot_app() -> FastAPI:
    app = FastAPI()
    app.include_router(copilot_router.router, prefix="/api/v1")
    return app


def test_chat_requires_authentication(copilot_app: FastAPI):
    client = TestClient(copilot_app)
    response = client.post("/api/v1/copilot/chat", json={"message": "hello"})
    assert response.status_code in (401, 403)


def test_conversations_list_scoped_to_caller(fake_mongo, copilot_app: FastAPI):
    conversation_store.create_conversation("org-a", "alice@example.com", "Alice's question")
    conversation_store.create_conversation("org-a", "bob@example.com", "Bob's question")

    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)

    response = client.get("/api/v1/copilot/conversations")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["title"] == "Alice's question"


def test_get_conversation_404_for_other_user(fake_mongo, copilot_app: FastAPI):
    conv = conversation_store.create_conversation("org-a", "bob@example.com", "Bob's question")

    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)

    response = client.get(f"/api/v1/copilot/conversations/{conv['conversation_id']}")
    assert response.status_code == 404


def test_delete_conversation(fake_mongo, copilot_app: FastAPI):
    conv = conversation_store.create_conversation("org-a", "alice@example.com", "To delete")

    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)

    response = client.delete(f"/api/v1/copilot/conversations/{conv['conversation_id']}")
    assert response.status_code == 200
    assert response.json() == {"deleted": True}

    with pytest.raises(conversation_store.CopilotConversationNotFoundError):
        conversation_store.get_conversation("org-a", "alice@example.com", conv["conversation_id"])


def test_truncate_conversation_drops_messages_from_keep_count(fake_mongo, copilot_app: FastAPI):
    conv = conversation_store.create_conversation("org-a", "alice@example.com", "Q1")
    conversation_store.append_messages(
        "org-a",
        "alice@example.com",
        conv["conversation_id"],
        [
            {"role": "user", "content": "first", "created_at": "t1", "tool_calls": []},
            {"role": "assistant", "content": "reply1", "created_at": "t1", "tool_calls": []},
            {"role": "user", "content": "second", "created_at": "t2", "tool_calls": []},
            {"role": "assistant", "content": "reply2", "created_at": "t2", "tool_calls": []},
        ],
    )

    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)

    response = client.post(
        f"/api/v1/copilot/conversations/{conv['conversation_id']}/truncate",
        json={"keep_count": 2},
    )
    assert response.status_code == 200
    assert response.json() == {"truncated": True}

    stored = conversation_store.get_conversation("org-a", "alice@example.com", conv["conversation_id"])
    assert [m["content"] for m in stored["messages"]] == ["first", "reply1"]


def test_truncate_conversation_404_for_other_user(fake_mongo, copilot_app: FastAPI):
    conv = conversation_store.create_conversation("org-a", "bob@example.com", "Q1")

    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)

    response = client.post(
        f"/api/v1/copilot/conversations/{conv['conversation_id']}/truncate",
        json={"keep_count": 0},
    )
    assert response.status_code == 404


def test_chat_streams_sse_from_engine(fake_mongo, copilot_app: FastAPI, monkeypatch):
    async def fake_turn(**kwargs):
        assert kwargs["org_id"] == "org-a"
        yield 'data: {"type": "start", "conversation_id": "c1"}\n\n'
        yield 'data: {"type": "token", "text": "hi"}\n\n'
        yield 'data: {"type": "done", "conversation_id": "c1", "text": "hi"}\n\n'

    monkeypatch.setattr(copilot_router, "run_copilot_turn", fake_turn)
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)

    with client.stream("POST", "/api/v1/copilot/chat", json={"message": "hello"}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join(response.iter_text())

    assert '"type": "done"' in body


# ---------------------------------------------------------------------------
# propose_create_agent: real validation, real staging, NEVER a real agent
# ---------------------------------------------------------------------------


def test_propose_create_agent_stages_draft_without_creating_a_real_agent(fake_mongo):
    result = tools.propose_create_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id="conv-1",
        name="Scheme Eligibility Bot",
        purpose="help farmers check government scheme eligibility",
    )

    assert result["name"] == "Scheme Eligibility Bot"
    assert result["agent_category"] == "websocket"
    assert "draft_id" in result
    assert "not yet saved" in result["note"].lower() or "draft" in result["note"].lower()

    # The whole point: nothing was actually created.
    assert fake_mongo["Agents"].count_documents({"org_id": "org-a"}) == 0
    stored = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": result["draft_id"]})
    assert stored["status"] == "pending"
    assert stored["org_id"] == "org-a"
    assert stored["created_by"] == "alice@example.com"


def test_sanitize_field_provenance_keeps_only_known_fields_and_values():
    known = {"name", "purpose", "llm"}
    result = tools._sanitize_field_provenance(
        {
            "name": "user_selected",
            "purpose": "inferred",
            "llm": "recommended",
            "not_a_real_field": "user_selected",  # unknown field name
            "primary_language": "bogus_value",  # unknown value, also not in `known`
        },
        known,
    )
    assert result == {"name": "user_selected", "purpose": "inferred", "llm": "recommended"}


def test_sanitize_field_provenance_handles_missing_or_malformed_input():
    assert tools._sanitize_field_provenance(None, {"name"}) == {}
    assert tools._sanitize_field_provenance("not a dict", {"name"}) == {}
    assert tools._sanitize_field_provenance({}, {"name"}) == {}


def test_propose_create_agent_includes_honest_field_provenance(fake_mongo):
    result = tools.propose_create_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id="conv-1",
        name="Crop Advisory Assistant",
        purpose="help farmers understand crop advisory schemes",
        primary_language="kn",
        field_provenance={
            "name": "user_selected",
            "purpose": "user_selected",
            "primary_language": "inferred",
            "llm": "recommended",
        },
    )

    assert result["field_provenance"] == {
        "name": "user_selected",
        "purpose": "user_selected",
        "primary_language": "inferred",
        "llm": "recommended",
    }


def test_propose_create_agent_drops_a_hallucinated_provenance_entry_without_failing(fake_mongo):
    """A malformed field_provenance value must never break draft creation —
    agent creation staying reliable matters more than a cosmetic label."""
    result = tools.propose_create_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id="conv-1",
        name="Crop Advisory Assistant",
        purpose="help farmers",
        field_provenance={"name": "definitely_confirmed_for_sure"},  # not a real value
    )

    assert result["field_provenance"] == {}
    assert "draft_id" in result


def test_propose_create_agent_defaults_field_provenance_to_empty_when_absent(fake_mongo):
    result = tools.propose_create_agent(
        "org-a", created_by="alice@example.com", conversation_id="conv-1", name="Bot", purpose="help people"
    )
    assert result["field_provenance"] == {}


def test_propose_create_agent_requires_name_and_purpose():
    with pytest.raises(tools.CopilotToolError, match="name"):
        tools.propose_create_agent(
            "org-a", created_by="alice@example.com", conversation_id=None, name="", purpose="help people"
        )
    with pytest.raises(tools.CopilotToolError, match="purpose"):
        tools.propose_create_agent(
            "org-a", created_by="alice@example.com", conversation_id=None, name="Bot", purpose=""
        )


def test_propose_create_agent_copies_models_from_an_existing_agent(fake_mongo):
    fake_mongo["Agents"].insert_one(
        {
            "agent_id": "existing-1",
            "org_id": "org-a",
            "name": "Existing",
            "status": "active",
            "archived": False,
            "agent_category": "websocket",
            "created_by": "owner@example.com",
            "linked_phone_number": None,
            "telephony": None,
            "config": {
                "prompts": {"system_prompt": "x", "greeting_message": "y"},
                "language": {"primary": "en", "secondary": []},
                "models": {
                    "stt_config": {"provider": "deepgram", "model": "nova-3-general"},
                    "tts_config": {"provider": "cartesia", "model": "sonic-3.5", "voice": "abc"},
                    "llm_config": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
                },
                "knowledge_base": {"enabled": False, "mode": "context", "document_ids": [], "top_k": 5},
            },
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    )

    result = tools.propose_create_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id=None,
        name="New Bot",
        purpose="answer FAQs",
    )
    assert result["llm"] == "llama-3.3-70b-versatile"
    assert result["stt"] == "nova-3-general"


def test_list_available_providers_only_returns_connected_providers(monkeypatch):
    assert tools.list_available_providers("org-a") == {"stt": [], "tts": [], "llm": []}

    _connect_provider(monkeypatch, "org-a", "openai")
    result = tools.list_available_providers("org-a")

    assert [p["provider"] for p in result["llm"]] == ["openai"]
    assert [p["provider"] for p in result["stt"]] == ["openai"]
    tts_entry = next(p for p in result["tts"] if p["provider"] == "openai")
    assert "alloy" in tts_entry["voices_by_model"]["gpt-4o-mini-tts"]["en"]

    # Another org's credentials never leak into this one's list.
    assert tools.list_available_providers("org-b") == {"stt": [], "tts": [], "llm": []}


def test_propose_create_agent_rejects_an_unconnected_explicit_provider():
    with pytest.raises(tools.CopilotToolError, match="isn't a connected"):
        tools.propose_create_agent(
            "org-a",
            created_by="alice@example.com",
            conversation_id=None,
            name="Bot",
            purpose="answer FAQs",
            llm_provider="groq",
        )


def test_propose_create_agent_accepts_an_explicit_connected_voice(monkeypatch):
    _connect_provider(monkeypatch, "org-a", "openai")

    result = tools.propose_create_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id=None,
        name="Bot",
        purpose="answer FAQs",
        tts_provider="openai",
        tts_voice="ash",
    )

    assert result["tts"] == "gpt-4o-mini-tts"
    assert result["tts_voice"] == "ash"


def test_propose_create_agent_attaches_a_ready_knowledge_document(fake_mongo):
    fake_mongo["KnowledgeDocuments"].insert_one(
        {"document_id": "doc-1", "org_id": "org-a", "status": "ready", "original_filename": "pricing.pdf"}
    )

    result = tools.propose_create_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id=None,
        name="Pricing Bot",
        purpose="answer pricing questions",
        knowledge_base_document_ids=["doc-1"],
    )

    assert result["knowledge_base_enabled"] is True
    assert result["knowledge_base_document_count"] == 1


def test_propose_create_agent_rejects_a_document_that_is_not_ready(fake_mongo):
    fake_mongo["KnowledgeDocuments"].insert_one(
        {"document_id": "doc-1", "org_id": "org-a", "status": "processing", "original_filename": "pricing.pdf"}
    )

    with pytest.raises(tools.CopilotToolError, match="not ready"):
        tools.propose_create_agent(
            "org-a",
            created_by="alice@example.com",
            conversation_id=None,
            name="Pricing Bot",
            purpose="answer pricing questions",
            knowledge_base_document_ids=["doc-1"],
        )


# ---------------------------------------------------------------------------
# propose_update_agent: editing a REAL existing agent via chat
# ---------------------------------------------------------------------------


def _seed_agent_with_behaviour(db, *, org_id: str, agent_id: str, name: str) -> None:
    """Like _seed_agent, but with a real, non-default behaviour block, so a
    test can assert that fields it doesn't touch survive an update untouched
    — the exact trap agent_service._merge_config has for a naive partial
    AgentConfigPayload (see propose_update_agent's docstring)."""
    db["Agents"].insert_one(
        {
            "agent_id": agent_id,
            "org_id": org_id,
            "name": name,
            "status": "active",
            "archived": False,
            "agent_category": "websocket",
            "created_by": "owner@example.com",
            "linked_phone_number": None,
            "telephony": None,
            "config": {
                "prompts": {"system_prompt": "Be helpful.", "greeting_message": "Hi!"},
                "language": {"primary": "en", "secondary": []},
                "models": {
                    "stt_config": {"provider": "openai", "model": "gpt-4o-transcribe"},
                    "tts_config": {"provider": "openai", "model": "gpt-4o-mini-tts"},
                    "llm_config": {"provider": "openai", "model": "gpt-4o-mini"},
                },
                "knowledge_base": {"enabled": False, "mode": "context", "document_ids": [], "top_k": 5},
                "behaviour": {
                    "interruption_min_words": 3,
                    "user_silence_hangup_seconds": 20.0,
                    "call_timeout_seconds": 600.0,
                    "ignore_user_speech_before_greeting": True,
                    "hold_messages": ["One moment please."],
                    "hold_message_timeout_seconds": 8.0,
                    "user_online_detection_enabled": True,
                    "user_online_detection_message": "Are you still there?",
                    "user_online_detection_seconds": 15.0,
                    "user_online_detection_repeats": 2,
                    "user_online_detection_closing_message": "I'll end the call now.",
                    "automatic_call_ending": {"enabled": True, "graceful_llm_call_ending": True},
                },
            },
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    )


def test_propose_update_agent_requires_a_real_agent_id(fake_mongo):
    with pytest.raises(tools.CopilotToolError, match="agent_id is required"):
        tools.propose_update_agent(
            "org-a", created_by="alice@example.com", conversation_id=None, agent_id="", system_prompt="x"
        )


def test_propose_update_agent_404s_for_unknown_or_other_org_agent(fake_mongo):
    _seed_agent_with_behaviour(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")

    with pytest.raises(tools.CopilotToolError):
        tools.propose_update_agent(
            "org-a", created_by="alice@example.com", conversation_id=None, agent_id="does-not-exist", system_prompt="x"
        )
    # Cross-org: org-b can't stage an update against org-a's real agent.
    with pytest.raises(tools.CopilotToolError):
        tools.propose_update_agent(
            "org-b", created_by="alice@example.com", conversation_id=None, agent_id="agent-1", system_prompt="x"
        )


def test_propose_update_agent_requires_at_least_one_change(fake_mongo):
    _seed_agent_with_behaviour(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")

    with pytest.raises(tools.CopilotToolError, match="No changes"):
        tools.propose_update_agent(
            "org-a", created_by="alice@example.com", conversation_id=None, agent_id="agent-1"
        )


def test_propose_update_agent_only_changes_the_requested_threshold(fake_mongo):
    """The core guarantee: changing one behaviour field must leave every
    other real behaviour field exactly as it was — not reset to schema
    defaults the way naively re-validating a partial AgentBehaviour would."""
    _seed_agent_with_behaviour(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")

    result = tools.propose_update_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id=None,
        agent_id="agent-1",
        interruption_min_words=7,
    )

    assert result["changes"] == ["interruption threshold"]
    stored = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": result["draft_id"]})
    updated_behaviour = stored["create_payload"]["update_payload"]["config"]["behaviour"]

    assert updated_behaviour["interruption_min_words"] == 7
    # Everything else survives untouched from the real seeded agent.
    assert updated_behaviour["user_silence_hangup_seconds"] == 20.0
    assert updated_behaviour["call_timeout_seconds"] == 600.0
    assert updated_behaviour["ignore_user_speech_before_greeting"] is True
    assert updated_behaviour["hold_messages"] == ["One moment please."]
    assert updated_behaviour["user_online_detection_enabled"] is True
    assert updated_behaviour["user_online_detection_message"] == "Are you still there?"
    assert updated_behaviour["automatic_call_ending"] == {"enabled": True, "graceful_llm_call_ending": True}
    # Nothing outside behaviour was touched either.
    assert stored["create_payload"]["update_payload"]["config"]["prompts"]["system_prompt"] == "Be helpful."
    assert "name" not in stored["create_payload"]["update_payload"]


def test_propose_update_agent_rejects_an_unconnected_explicit_voice_provider(fake_mongo):
    _seed_agent_with_behaviour(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")

    with pytest.raises(tools.CopilotToolError, match="isn't a connected"):
        tools.propose_update_agent(
            "org-a",
            created_by="alice@example.com",
            conversation_id=None,
            agent_id="agent-1",
            tts_provider="groq",
        )


def test_propose_update_agent_stages_a_rename(fake_mongo):
    _seed_agent_with_behaviour(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")

    result = tools.propose_update_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id=None,
        agent_id="agent-1",
        name="Farmer Helpline",
    )

    assert result["new_name"] == "Farmer Helpline"
    assert "name" in result["changes"]
    stored = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": result["draft_id"]})
    assert stored["create_payload"]["update_payload"]["name"] == "Farmer Helpline"
    assert stored["entity_type"] == "agent_update"


# ---------------------------------------------------------------------------
# Confirm / dismiss: the only path that can produce a real write
# ---------------------------------------------------------------------------


def _stage_draft(org_id: str, created_by: str) -> dict[str, Any]:
    return tools.propose_create_agent(
        org_id,
        created_by=created_by,
        conversation_id=None,
        name="Kannada Support",
        purpose="help Kannada-speaking customers",
        primary_language="kn",
    )


def test_confirm_agent_draft_creates_a_real_agent(fake_mongo, copilot_app: FastAPI):
    draft = _stage_draft("org-a", "alice@example.com")
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(copilot_app)

    response = client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/confirm")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Kannada Support"
    assert "agent_id" in body

    agents = list(fake_mongo["Agents"].find({"org_id": "org-a"}))
    assert len(agents) == 1
    assert agents[0]["name"] == "Kannada Support"
    assert agents[0]["config"]["language"]["primary"] == "kn"

    stored_draft = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": draft["draft_id"]})
    assert stored_draft["status"] == "confirmed"


def test_confirm_agent_draft_cannot_be_used_twice(fake_mongo, copilot_app: FastAPI):
    draft = _stage_draft("org-a", "alice@example.com")
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(copilot_app)

    first = client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/confirm")
    assert first.status_code == 200
    second = client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/confirm")
    assert second.status_code == 404

    # Only one agent exists, not two.
    assert fake_mongo["Agents"].count_documents({"org_id": "org-a"}) == 1


def test_confirm_agent_draft_scoped_to_owning_user_and_org(fake_mongo, copilot_app: FastAPI):
    draft = _stage_draft("org-a", "alice@example.com")
    client = TestClient(copilot_app)

    # A different user in the same org cannot confirm alice's draft.
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("bob@example.com", org_id="org-a")
    assert client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/confirm").status_code == 404

    # Same user, different org (e.g. switched active org) cannot confirm it either.
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-b")
    assert client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/confirm").status_code == 404

    assert fake_mongo["Agents"].count_documents({}) == 0


def test_confirm_agent_update_draft_updates_the_real_agent(fake_mongo, copilot_app: FastAPI):
    """The confirm endpoint must branch correctly on entity_type=agent_update
    and call agent_service.update_agent (not create_agent) — same real write
    path the wizard's Edit page uses, just staged ahead of time by the model."""
    _seed_agent_with_behaviour(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")
    draft = tools.propose_update_agent(
        "org-a",
        created_by="alice@example.com",
        conversation_id=None,
        agent_id="agent-1",
        interruption_min_words=9,
        name="Farmer Helpline",
    )
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(copilot_app)

    response = client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/confirm")

    assert response.status_code == 200
    body = response.json()
    assert body["agent_id"] == "agent-1"
    assert body["name"] == "Farmer Helpline"

    # No new agent was created — the real, existing one was updated in place.
    assert fake_mongo["Agents"].count_documents({"org_id": "org-a"}) == 1
    updated = fake_mongo["Agents"].find_one({"org_id": "org-a", "agent_id": "agent-1"})
    assert updated["name"] == "Farmer Helpline"
    assert updated["config"]["behaviour"]["interruption_min_words"] == 9
    # Untouched behaviour fields survived the real write too, not just the draft.
    assert updated["config"]["behaviour"]["user_silence_hangup_seconds"] == 20.0

    stored_draft = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": draft["draft_id"]})
    assert stored_draft["status"] == "confirmed"


def test_dismiss_agent_draft_prevents_later_confirmation(fake_mongo, copilot_app: FastAPI):
    draft = _stage_draft("org-a", "alice@example.com")
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(copilot_app)

    dismiss = client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/dismiss")
    assert dismiss.status_code == 200
    assert dismiss.json() == {"dismissed": True}

    confirm = client.post(f"/api/v1/copilot/agent-drafts/{draft['draft_id']}/confirm")
    assert confirm.status_code == 404
    assert fake_mongo["Agents"].count_documents({}) == 0


def test_confirm_unknown_draft_id_404s(fake_mongo, copilot_app: FastAPI):
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(copilot_app)
    response = client.post("/api/v1/copilot/agent-drafts/does-not-exist/confirm")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Engine integration: the model can propose a draft mid-conversation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_engine_propose_create_agent_stages_real_draft(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    args = json.dumps(
        {"name": "Grievance Bot", "purpose": "log citizen complaints", "primary_language": "hi"}
    )
    fake_cls = _fake_openai_factory(
        [
            [
                _tool_call_chunk(0, call_id="call_1", name="propose_create_agent", arguments=args),
                _tool_call_chunk(0, finish_reason="tool_calls"),
            ],
            [
                _content_chunk("I've drafted Grievance Bot for your review."),
                _content_chunk(None, finish_reason="stop"),
            ],
        ]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    lines = [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="Create a Hindi grievance-logging agent",
            conversation_id=None,
            context=None,
        )
    ]
    events = _parse_sse_events(lines)
    tool_result = next(e for e in events if e["type"] == "tool_result")
    assert tool_result["tool"] == "propose_create_agent"
    assert tool_result["ok"] is True
    draft_id = tool_result["data"]["draft_id"]

    # Staged for the real requesting user, not a model-supplied identity.
    stored = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": draft_id})
    assert stored["created_by"] == "alice@example.com"
    assert stored["org_id"] == "org-a"
    assert fake_mongo["Agents"].count_documents({}) == 0

    # The turn ends on the draft: one model call, not a second one to describe
    # what the draft card already shows.
    assert len(fake_cls.completions.calls) == 1
    assert "**Grievance Bot**" in events[-1]["text"]
    assert "Create agent" in events[-1]["text"]


@pytest.mark.asyncio
async def test_engine_retries_a_round_the_provider_aborts_mid_stream(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    monkeypatch.setattr(engine, "_TOOL_CALL_ERROR_RETRY_DELAY_S", 0)
    args = json.dumps({"name": "Grievance Bot", "purpose": "log citizen complaints", "primary_language": "hi"})
    fake_cls = _fake_openai_factory(
        [
            [_tool_call_chunk(0, call_id="call_1", name="propose_create_agent", arguments='{"name": "Grie'),
             _make_tool_call_json_error()],
            [
                _tool_call_chunk(0, call_id="call_2", name="propose_create_agent", arguments=args),
                _tool_call_chunk(0, finish_reason="tool_calls"),
            ],
        ]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    events = _parse_sse_events([
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="Create a Hindi grievance-logging agent",
            conversation_id=None,
            context=None,
        )
    ])
    assert [e["type"] for e in events if e["type"] in ("retry_wait", "error")] == ["retry_wait"]
    assert len(fake_cls.completions.calls) == 2
    assert fake_mongo["CopilotAgentDrafts"].count_documents({}) == 1
    assert "**Grievance Bot**" in events[-1]["text"]


def test_written_out_draft_is_recognised_but_ordinary_answers_are_not():
    written = (
        "Here's a draft for you to review.\n\n**Agent name:** Kisan Advisor\n**Purpose:** Answer PM-KISAN "
        "questions\n**Primary language:** Kannada\n**Greeting:** Namaskara!"
    )
    assert engine._looks_like_written_draft(written) is True
    assert engine._looks_like_written_draft("You have 2 agents: Farmer Support and Grievance Bot.") is False
    assert engine._looks_like_written_draft("Which language should the agent speak?") is False


@pytest.mark.asyncio
async def test_draft_written_as_text_is_sent_back_once_to_make_a_real_card(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    written = (
        "Here's a draft.\n\n**Agent name:** Grievance Bot\n**Purpose:** log citizen complaints\n"
        "**Primary language:** Hindi"
    )
    args = json.dumps({"name": "Grievance Bot", "purpose": "log citizen complaints", "primary_language": "hi"})
    fake_cls = _fake_openai_factory(
        [
            [_content_chunk(written), _content_chunk(None, finish_reason="stop")],
            [
                _tool_call_chunk(0, call_id="call_1", name="propose_create_agent", arguments=args),
                _tool_call_chunk(0, finish_reason="tool_calls"),
            ],
        ]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    events = _parse_sse_events([
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="Create a Hindi grievance-logging agent",
            conversation_id=None,
            context=None,
        )
    ])
    assert len(fake_cls.completions.calls) == 2
    second_round = fake_cls.completions.calls[1]["messages"]
    assert any(m.get("role") == "user" and m.get("content") == engine._DRAFT_NUDGE for m in second_round)
    assert fake_mongo["CopilotAgentDrafts"].count_documents({}) == 1
    final = events[-1]["text"]
    assert final.startswith("Here's a draft.")  # what the user already saw is kept
    assert "Create agent" in final


@pytest.mark.asyncio
async def test_draft_nudge_happens_only_once(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    written = "Draft below.\n**Agent name:** X\n**Purpose:** Y\n**Greeting:** Hi"
    fake_cls = _fake_openai_factory(
        [
            [_content_chunk(written), _content_chunk(None, finish_reason="stop")],
            [_content_chunk(written), _content_chunk(None, finish_reason="stop")],
        ]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="Make me an agent",
            conversation_id=None,
            context=None,
        )
    ]
    assert len(fake_cls.completions.calls) == 2


# ---------------------------------------------------------------------------
# Voice mode: session lifecycle, internal bundle/tool/turn endpoints
# ---------------------------------------------------------------------------


@pytest.fixture
def voice_app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    from app import auth as auth_mod

    monkeypatch.setattr(auth_mod.settings, "INTERNAL_API_KEY", "test-internal-key")
    app = FastAPI()
    app.include_router(copilot_router.router, prefix="/api/v1")
    return app


def _internal_headers() -> dict[str, str]:
    return {"X-API-Key": "test-internal-key"}


def test_create_voice_session_returns_ws_path(fake_mongo, voice_app: FastAPI):
    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(voice_app)

    response = client.post("/api/v1/copilot/voice/session")
    assert response.status_code == 200
    body = response.json()
    assert body["ws_path"] == f"/copilot-agent/{body['session_id']}"
    assert body["conversation_id"] is None

    stored = fake_mongo["CopilotVoiceSessions"].find_one({"session_id": body["session_id"]})
    assert stored["org_id"] == "org-a"
    assert stored["created_by"] == "alice@example.com"
    assert stored["status"] == "pending"


def test_voice_session_bundle_requires_internal_key(fake_mongo, voice_app: FastAPI):
    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(voice_app)
    session_id = client.post("/api/v1/copilot/voice/session").json()["session_id"]

    missing_key = client.get(f"/api/v1/copilot/voice/session/{session_id}/bundle")
    assert missing_key.status_code == 401


def test_voice_session_bundle_builds_real_agent_config(fake_mongo, voice_app: FastAPI, monkeypatch):
    from app.services.copilot import engine as engine_mod

    monkeypatch.setattr(engine_mod.settings, "COPILOT_LLM_PROVIDER", "groq")
    monkeypatch.setattr(engine_mod.settings, "COPILOT_LLM_API_KEY", "test-groq-key")
    monkeypatch.setattr(engine_mod.settings, "COPILOT_LLM_MODEL", "")

    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(voice_app)
    session_id = client.post("/api/v1/copilot/voice/session").json()["session_id"]

    response = client.get(
        f"/api/v1/copilot/voice/session/{session_id}/bundle", headers=_internal_headers()
    )
    assert response.status_code == 200
    body = response.json()
    assert body["org_id"] == "org-a"
    assert body["created_by"] == "alice@example.com"
    assert set(body["tool_names"]) == set(tools.TOOL_FUNCTIONS.keys())

    llm_config = body["agent"]["config"]["models"]["llm_config"]
    assert llm_config["provider"] == "groq"
    assert llm_config["model"] == engine_mod._PROVIDER_DEFAULT_MODELS["groq"]
    assert llm_config["api_key"] == "test-groq-key"
    # STT/TTS fall back to the same known-good combo propose_create_agent uses
    # since this org has no existing agent to copy from.
    assert body["agent"]["config"]["models"]["stt_config"]["provider"] == "openai"

    # Redeeming activates the session (visible via the raw store, not the API).
    stored = fake_mongo["CopilotVoiceSessions"].find_one({"session_id": session_id})
    assert stored["status"] == "active"


def test_voice_session_bundle_copies_existing_agent_models(fake_mongo, voice_app: FastAPI, monkeypatch):
    from app.services.copilot import engine as engine_mod

    monkeypatch.setattr(engine_mod.settings, "COPILOT_LLM_API_KEY", "test-openai-key")
    _seed_agent(fake_mongo, org_id="org-a", agent_id="existing-1", name="Existing")
    fake_mongo["Agents"].update_one(
        {"agent_id": "existing-1"},
        {"$set": {"config.models.stt_config": {"provider": "deepgram", "model": "nova-3-general"}}},
    )

    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(voice_app)
    session_id = client.post("/api/v1/copilot/voice/session").json()["session_id"]

    response = client.get(
        f"/api/v1/copilot/voice/session/{session_id}/bundle", headers=_internal_headers()
    )
    assert response.status_code == 200
    assert response.json()["agent"]["config"]["models"]["stt_config"]["provider"] == "deepgram"


def test_voice_session_bundle_unknown_session_404s(fake_mongo, voice_app: FastAPI):
    response = TestClient(voice_app).get(
        "/api/v1/copilot/voice/session/does-not-exist/bundle", headers=_internal_headers()
    )
    assert response.status_code == 404


def test_voice_tool_execution_is_org_scoped(fake_mongo, voice_app: FastAPI, monkeypatch):
    from app.services.copilot import engine as engine_mod

    monkeypatch.setattr(engine_mod.settings, "COPILOT_LLM_API_KEY", "test-key")
    _seed_agent(fake_mongo, org_id="org-a", agent_id="agent-1", name="Org A Agent")
    _seed_agent(fake_mongo, org_id="org-b", agent_id="agent-2", name="Org B Agent")

    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(voice_app)
    session_id = client.post("/api/v1/copilot/voice/session").json()["session_id"]
    client.get(f"/api/v1/copilot/voice/session/{session_id}/bundle", headers=_internal_headers())

    response = client.post(
        f"/api/v1/copilot/voice/session/{session_id}/tool",
        json={"tool": "list_agents", "arguments": {}},
        headers=_internal_headers(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["count"] == 1
    assert body["data"]["agents"][0]["name"] == "Org A Agent"


def test_voice_turn_appends_to_linked_conversation(fake_mongo, voice_app: FastAPI, monkeypatch):
    from app.services.copilot import conversation_store, engine as engine_mod

    monkeypatch.setattr(engine_mod.settings, "COPILOT_LLM_API_KEY", "test-key")
    conv = conversation_store.create_conversation("org-a", "alice@example.com", "Voice chat")

    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(voice_app)
    session_id = client.post(
        "/api/v1/copilot/voice/session", params={"conversation_id": conv["conversation_id"]}
    ).json()["session_id"]
    client.get(f"/api/v1/copilot/voice/session/{session_id}/bundle", headers=_internal_headers())

    response = client.post(
        f"/api/v1/copilot/voice/session/{session_id}/turn",
        json={"role": "user", "content": "What agents do I have?"},
        headers=_internal_headers(),
    )
    assert response.status_code == 200
    assert response.json() == {"appended": True}

    stored = conversation_store.get_conversation("org-a", "alice@example.com", conv["conversation_id"])
    assert stored["messages"][-1]["content"] == "What agents do I have?"


def test_voice_turn_without_linked_conversation_is_noop(fake_mongo, voice_app: FastAPI, monkeypatch):
    from app.services.copilot import engine as engine_mod

    monkeypatch.setattr(engine_mod.settings, "COPILOT_LLM_API_KEY", "test-key")
    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(voice_app)
    session_id = client.post("/api/v1/copilot/voice/session").json()["session_id"]
    client.get(f"/api/v1/copilot/voice/session/{session_id}/bundle", headers=_internal_headers())

    response = client.post(
        f"/api/v1/copilot/voice/session/{session_id}/turn",
        json={"role": "assistant", "content": "You have one agent."},
        headers=_internal_headers(),
    )
    assert response.status_code == 200
    assert response.json() == {"appended": False}


def test_end_voice_session_is_idempotent(fake_mongo, voice_app: FastAPI):
    voice_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(voice_app)
    session_id = client.post("/api/v1/copilot/voice/session").json()["session_id"]

    first = client.post(f"/api/v1/copilot/voice/session/{session_id}/end")
    second = client.post(f"/api/v1/copilot/voice/session/{session_id}/end")
    assert first.status_code == 200
    assert second.status_code == 200

    # An ended session can no longer be redeemed by the runtime.
    bundle = client.get(
        f"/api/v1/copilot/voice/session/{session_id}/bundle", headers=_internal_headers()
    )
    assert bundle.status_code == 404


# ---------------------------------------------------------------------------
# Image attachments
# ---------------------------------------------------------------------------


def _fake_minio_storage(objects: dict[str, bytes]):
    """A stand-in for MinIOStorage whose put/get operate on an in-memory dict
    instead of a real MinIO server, keyed by storage_key."""

    class _Fake:
        async def put_object_bytes(self, object_key, data, *, bucket_name=None, content_type="application/octet-stream"):
            objects[object_key] = data

        async def get_object_bytes(self, object_key, bucket_name=None):
            return objects[object_key]

    return _Fake


def test_upload_attachment_and_fetch_roundtrip(fake_mongo, copilot_app: FastAPI):
    objects: dict[str, bytes] = {}
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)

    with patch("app.routers.copilot.MinIOStorage", _fake_minio_storage(objects)):
        upload = client.post(
            "/api/v1/copilot/attachments",
            files={"file": ("photo.png", b"fake-png-bytes", "image/png")},
        )
        assert upload.status_code == 201
        body = upload.json()
        assert body["content_type"] == "image/png"
        assert body["original_filename"] == "photo.png"

        fetched = client.get(f"/api/v1/copilot/attachments/{body['attachment_id']}")
        assert fetched.status_code == 200
        assert fetched.content == b"fake-png-bytes"
        assert fetched.headers["content-type"] == "image/png"


def test_attachment_rejects_unsupported_type(fake_mongo, copilot_app: FastAPI):
    # Images, CSVs and documents are accepted (see the document tests); anything else isn't.
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)
    response = client.post(
        "/api/v1/copilot/attachments",
        files={"file": ("installer.dmg", b"koly", "application/x-apple-diskimage")},
    )
    assert response.status_code == 415


def test_attachment_rejects_oversized_file(fake_mongo, copilot_app: FastAPI, monkeypatch):
    monkeypatch.setattr(copilot_router.settings, "COPILOT_ATTACHMENT_MAX_BYTES", 10)
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)
    response = client.post(
        "/api/v1/copilot/attachments",
        files={"file": ("photo.png", b"x" * 100, "image/png")},
    )
    assert response.status_code == 413


def test_attachment_not_fetchable_from_another_org(fake_mongo, copilot_app: FastAPI):
    objects: dict[str, bytes] = {}
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(copilot_app)
    with patch("app.routers.copilot.MinIOStorage", _fake_minio_storage(objects)):
        upload = client.post(
            "/api/v1/copilot/attachments",
            files={"file": ("photo.png", b"secret-bytes", "image/png")},
        )
        attachment_id = upload.json()["attachment_id"]

        copilot_app.dependency_overrides[get_current_user] = lambda: _user("mallory@example.com", org_id="org-b")
        other_org_client = TestClient(copilot_app)
        response = other_org_client.get(f"/api/v1/copilot/attachments/{attachment_id}")
        assert response.status_code == 404


def test_model_supports_vision_only_for_known_openai_models():
    assert engine._model_supports_vision("openai", "gpt-4.1-mini") is True
    assert engine._model_supports_vision("openai", "gpt-5") is True
    assert engine._model_supports_vision("openai", "gpt-3.5-turbo") is False
    assert engine._model_supports_vision("groq", "openai/gpt-oss-120b") is False


@pytest.mark.asyncio
async def test_engine_sends_image_content_when_model_supports_vision(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_MODEL", "gpt-4.1-mini")
    fake_cls = _fake_openai_factory(
        [[_content_chunk("I see a screenshot."), _content_chunk(None, finish_reason="stop")]]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    from app.services.copilot import attachment_store

    attachment_store.create_attachment(
        "org-a",
        "alice@example.com",
        storage_key="copilot/org-a/img1.png",
        content_type="image/png",
        original_filename="screenshot.png",
        size_bytes=3,
    )
    stored = fake_mongo["CopilotAttachments"].find_one({"org_id": "org-a"})
    attachment_id = stored["attachment_id"]

    with patch(
        "app.services.copilot.engine.MinIOStorage",
        _fake_minio_storage({"copilot/org-a/img1.png": b"\x89PNG\r\n"}),
    ):
        lines = [
            line
            async for line in engine.run_copilot_turn(
                org_id="org-a",
                user_email="alice@example.com",
                role="admin",
                message="What's in this image?",
                conversation_id=None,
                context=None,
                attachment_ids=[attachment_id],
            )
        ]

    events = _parse_sse_events(lines)
    assert events[-1]["text"] == "I see a screenshot."

    sent_messages = fake_cls.completions.calls[0]["messages"]
    user_message = next(m for m in sent_messages if m["role"] == "user")
    assert isinstance(user_message["content"], list)
    types = [part["type"] for part in user_message["content"]]
    assert types == ["text", "image_url"]
    assert user_message["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")

    # The stored message keeps the attachment reference for history reload.
    conv_id = events[0]["conversation_id"]
    stored_conv = conversation_store.get_conversation("org-a", "alice@example.com", conv_id)
    assert stored_conv["messages"][0]["attachments"][0]["attachment_id"] == attachment_id


@pytest.mark.asyncio
async def test_engine_tells_user_plainly_when_model_cannot_see_images(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_MODEL", "gpt-3.5-turbo")
    fake_cls = _fake_openai_factory(
        [[_content_chunk("I can't see images right now."), _content_chunk(None, finish_reason="stop")]]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)
    # No vision model could read them either (unavailable, or its call failed).
    monkeypatch.setattr(engine, "_describe_images", AsyncMock(return_value=None))

    from app.services.copilot import attachment_store

    attachment_store.create_attachment(
        "org-a",
        "alice@example.com",
        storage_key="copilot/org-a/img1.png",
        content_type="image/png",
        original_filename="screenshot.png",
        size_bytes=3,
    )
    stored = fake_mongo["CopilotAttachments"].find_one({"org_id": "org-a"})
    attachment_id = stored["attachment_id"]

    with patch(
        "app.services.copilot.engine.MinIOStorage",
        _fake_minio_storage({"copilot/org-a/img1.png": b"\x89PNG\r\n"}),
    ):
        lines = [
            line
            async for line in engine.run_copilot_turn(
                org_id="org-a",
                user_email="alice@example.com",
                role="admin",
                message="What's in this image?",
                conversation_id=None,
                context=None,
                attachment_ids=[attachment_id],
            )
        ]

    sent_messages = fake_cls.completions.calls[0]["messages"]
    system_message = next(m for m in sent_messages if m["role"] == "system")
    assert "cannot see or analyse images" in system_message["content"]
    user_message = next(m for m in sent_messages if m["role"] == "user")
    assert isinstance(user_message["content"], str)


@pytest.mark.asyncio
async def test_text_only_model_answers_from_a_vision_models_description(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_PROVIDER", "groq")
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_MODEL", "openai/gpt-oss-20b")
    fake_cls = _fake_openai_factory(
        [[_content_chunk("The form asks for an Aadhaar number."), _content_chunk(None, finish_reason="stop")]]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)
    describe = AsyncMock(return_value="Image 1: a scheme enrolment form with fields Name and Aadhaar number.")
    monkeypatch.setattr(engine, "_describe_images", describe)

    from app.services.copilot import attachment_store

    attachment = attachment_store.create_attachment(
        "org-a",
        "alice@example.com",
        storage_key="copilot/org-a/form.png",
        content_type="image/png",
        original_filename="form.png",
        size_bytes=3,
    )

    with patch(
        "app.services.copilot.engine.MinIOStorage",
        _fake_minio_storage({"copilot/org-a/form.png": b"\x89PNG\r\n"}),
    ):
        lines = [
            line
            async for line in engine.run_copilot_turn(
                org_id="org-a",
                user_email="alice@example.com",
                role="admin",
                message="What does this form ask for?",
                conversation_id=None,
                context=None,
                attachment_ids=[attachment["attachment_id"]],
            )
        ]

    events = _parse_sse_events(lines)
    assert [e["tool"] for e in events if e["type"] in ("tool_call", "tool_result")] == ["read_images", "read_images"]
    describe.assert_awaited_once()
    assert describe.await_args.args[1] == "groq"

    sent = fake_cls.completions.calls[0]["messages"]
    system_message = next(m for m in sent if m["role"] == "system")
    assert "Aadhaar number" in system_message["content"]
    assert "cannot see or analyse" not in system_message["content"]
    user_message = next(m for m in sent if m["role"] == "user")
    assert isinstance(user_message["content"], str)  # the image itself never reaches the text-only model

    # The description is kept with the message, so a follow-up can still use it.
    conv = conversation_store.get_conversation("org-a", "alice@example.com", events[0]["conversation_id"])
    assert "Aadhaar number" in conv["messages"][0]["image_description"]
    replayed = engine._history_to_messages(conv, 16)
    assert "Aadhaar number" in replayed[0]["content"]


def test_reasoning_effort_is_lowered_only_for_gpt_oss(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_REASONING_EFFORT", "low")
    assert engine._reasoning_kwargs("groq", "openai/gpt-oss-20b") == {"reasoning_effort": "low"}
    assert engine._reasoning_kwargs("openrouter", "openai/gpt-oss-120b") == {
        "extra_body": {"reasoning": {"effort": "low"}}
    }
    assert engine._reasoning_kwargs("openai", "gpt-4.1-mini") == {}
    monkeypatch.setattr(engine.settings, "COPILOT_REASONING_EFFORT", "")
    assert engine._reasoning_kwargs("groq", "openai/gpt-oss-20b") == {}


@pytest.mark.asyncio
async def test_reply_cut_off_before_any_text_says_so(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_openai_factory([[_content_chunk(None, finish_reason="length")]])
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    events = _parse_sse_events([
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="Build me an agent",
            conversation_id=None,
            context=None,
        )
    ])
    assert "ran out of room" in events[-1]["text"]


def _docx_bytes(*paragraphs: str) -> bytes:
    import io
    import zipfile

    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as book:
        book.writestr("word/document.xml", xml)
    return buffer.getvalue()


def _pptx_bytes(*slides: str) -> bytes:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as book:
        for number, text in enumerate(slides, start=1):
            book.writestr(
                f"ppt/slides/slide{number}.xml",
                '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                f"<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p>"
                "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>",
            )
    return buffer.getvalue()


def _pdf_bytes(text: str) -> bytes:
    """A one-page PDF with real text on it, built by hand (no PDF writer needed)."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def test_documents_extract_text_from_each_supported_format():
    from app.services.copilot import documents

    assert "PM-KISAN pays 6000 rupees" in documents.extract_text("scheme.pdf", _pdf_bytes("PM-KISAN pays 6000 rupees"))
    assert documents.extract_text("scheme.pdf", _pdf_bytes("hello")).startswith("[Page 1]")
    assert documents.extract_text("faq.docx", _docx_bytes("Who is eligible?", "Small farmers.")) == (
        "Who is eligible?\n\nSmall farmers."
    )
    assert documents.extract_text("deck.pptx", _pptx_bytes("Intro", "Benefits")) == (
        "[Slide 1]\nIntro\n\n[Slide 2]\nBenefits"
    )
    assert documents.extract_text("notes.md", "# Title\r\n\r\n\r\n\r\nBody".encode()) == "# Title\n\nBody"


def test_documents_reject_unreadable_and_empty_files():
    from app.services.copilot import documents

    with pytest.raises(documents.DocumentError, match="couldn't be read"):
        documents.extract_text("broken.docx", b"not a zip file")
    with pytest.raises(documents.DocumentError, match="No text found"):
        documents.extract_text("empty.txt", b"   \n  ")


def test_document_context_is_whole_when_it_fits_and_relevant_excerpts_when_not():
    from app.services.copilot import documents

    small = documents.build_context([("faq.txt", "Short FAQ.")], "anything", 1000)
    assert '"faq.txt" (full text)' in small and "Short FAQ." in small

    filler = "\n\n".join(f"Paragraph {i} about general programme history and background." * 8 for i in range(40))
    text = filler + "\n\nEligibility: farmers owning under two hectares can enrol." + "\n\n" + filler
    context = documents.build_context([("guide.pdf", text)], "Who is eligible to enrol?", 3000)
    assert "farmers owning under two hectares" in context
    assert "excerpts; the full document is" in context
    assert "[…]" in context
    assert len(context) < 3000 + 800  # budget plus the fixed instructions


def test_upload_document_stores_its_text_and_rejects_unsupported_files(fake_mongo, copilot_app: FastAPI):
    objects: dict[str, bytes] = {}
    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com", org_id="org-a")
    client = TestClient(copilot_app)
    with patch("app.routers.copilot.MinIOStorage", _fake_minio_storage(objects)):
        upload = client.post(
            "/api/v1/copilot/attachments",
            files={"file": ("faq.docx", _docx_bytes("Helpline is 1800-180-1551."), "application/octet-stream")},
        )
        assert upload.status_code == 201
        body = upload.json()
        assert body["content_type"].endswith("wordprocessingml.document")
        assert "extracted_text" not in body
        stored = fake_mongo["CopilotAttachments"].find_one({"attachment_id": body["attachment_id"]})
        assert stored["extracted_text"] == "Helpline is 1800-180-1551."

        unsupported = client.post(
            "/api/v1/copilot/attachments",
            files={"file": ("tool.exe", b"MZ", "application/octet-stream")},
        )
        assert unsupported.status_code == 415

        unreadable = client.post(
            "/api/v1/copilot/attachments",
            files={"file": ("broken.pdf", b"%PDF-1.4 garbage", "application/pdf")},
        )
        assert unreadable.status_code == 422
        assert "broken.pdf" in unreadable.json()["detail"]


@pytest.mark.asyncio
async def test_document_text_reaches_the_model_on_its_turn_and_later_turns(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_openai_factory(
        [
            [_content_chunk("The helpline is 1800-180-1551."), _content_chunk(None, finish_reason="stop")],
            [_content_chunk("Small farmers."), _content_chunk(None, finish_reason="stop")],
        ]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    from app.services.copilot import attachment_store, documents

    attachment = attachment_store.create_attachment(
        "org-a",
        "alice@example.com",
        storage_key="copilot/org-a/faq.docx",
        content_type=documents.DOCUMENT_TYPES[".docx"],
        original_filename="faq.docx",
        size_bytes=10,
        extracted_text="Helpline is 1800-180-1551.\n\nEligibility: small farmers.",
    )
    # Another org's document with the same id must never be read.
    other = attachment_store.create_attachment(
        "org-b",
        "mallory@example.com",
        storage_key="copilot/org-b/secret.docx",
        content_type=documents.DOCUMENT_TYPES[".docx"],
        original_filename="secret.docx",
        size_bytes=10,
        extracted_text="Org B secret.",
    )

    # No MinIO patch: a document's text comes from Mongo, its bytes are never fetched.
    first = _parse_sse_events([
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="What's the helpline number?",
            conversation_id=None,
            context=None,
            attachment_ids=[attachment["attachment_id"], other["attachment_id"]],
        )
    ])
    system_first = next(m for m in fake_cls.completions.calls[0]["messages"] if m["role"] == "system")["content"]
    assert "1800-180-1551" in system_first
    assert "Org B secret" not in system_first

    conversation_id = first[0]["conversation_id"]
    [
        line
        async for line in engine.run_copilot_turn(
            org_id="org-a",
            user_email="alice@example.com",
            role="admin",
            message="Who is eligible?",
            conversation_id=conversation_id,
            context=None,
        )
    ]
    system_second = next(m for m in fake_cls.completions.calls[1]["messages"] if m["role"] == "system")["content"]
    assert "Eligibility: small farmers." in system_second


# ---------------------------------------------------------------------------
# Campaign creation via chat (propose_create_campaign)
# ---------------------------------------------------------------------------


def _fake_minio_object_exists(exists: bool):
    class _Fake:
        def object_exists(self, bucket_name, object_name):
            return exists

    return _Fake


def test_propose_create_campaign_requires_real_agent(fake_mongo):
    with pytest.raises(tools.CopilotToolError, match="No agent"):
        tools.propose_create_campaign(
            "org-a",
            created_by="alice@example.com",
            conversation_id=None,
            name="Reminder Blast",
            agent_id="does-not-exist",
            source_id="campaigns/org-a/contacts.csv",
        )


def test_propose_create_campaign_requires_real_source(fake_mongo):
    _seed_agent(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")
    with patch("app.services.copilot.tools.MinIOStorage", _fake_minio_object_exists(False)):
        with pytest.raises(tools.CopilotToolError, match="doesn't point to a real"):
            tools.propose_create_campaign(
                "org-a",
                created_by="alice@example.com",
                conversation_id=None,
                name="Reminder Blast",
                agent_id="agent-1",
                source_id="campaigns/org-a/nonexistent.csv",
            )


def test_propose_create_campaign_stages_draft_without_creating_a_real_campaign(fake_mongo):
    _seed_agent(fake_mongo, org_id="org-a", agent_id="agent-1", name="Farmer Support")
    with patch("app.services.copilot.tools.MinIOStorage", _fake_minio_object_exists(True)):
        result = tools.propose_create_campaign(
            "org-a",
            created_by="alice@example.com",
            conversation_id=None,
            name="Reminder Blast",
            agent_id="agent-1",
            source_id="copilot/org-a/contacts.csv",
            rate_limit_per_second=2,
        )
    assert result["name"] == "Reminder Blast"
    assert result["agent_name"] == "Farmer Support"
    assert fake_mongo["Campaigns"].count_documents({}) == 0

    draft = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": result["draft_id"]})
    assert draft["entity_type"] == "campaign"
    assert draft["status"] == "pending"


def test_confirm_campaign_draft_creates_a_real_campaign(fake_mongo, copilot_app: FastAPI):
    fake_mongo["Agents"].insert_one(
        {
            "agent_id": "agent-1",
            "org_id": "org-a",
            "name": "Farmer Support",
            "status": "active",
            "archived": False,
            "agent_category": "telephony",
            "linked_phone_number": "+15551234567",
            "telephony": None,
            "config": {
                "prompts": {"system_prompt": "Be helpful.", "greeting_message": "Hi!"},
                "language": {"primary": "en", "secondary": []},
                "models": {
                    "stt_config": {"provider": "openai", "model": "gpt-4o-transcribe"},
                    "tts_config": {"provider": "openai", "model": "gpt-4o-mini-tts"},
                    "llm_config": {"provider": "openai", "model": "gpt-4o-mini"},
                },
                "knowledge_base": {"enabled": False, "mode": "context", "document_ids": [], "top_k": 5},
            },
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    )
    with patch("app.services.copilot.tools.MinIOStorage", _fake_minio_object_exists(True)):
        draft = tools.propose_create_campaign(
            "org-a",
            created_by="alice@example.com",
            conversation_id=None,
            name="Reminder Blast",
            agent_id="agent-1",
            source_id="copilot/org-a/contacts.csv",
        )

    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)
    response = client.post(f"/api/v1/copilot/campaign-drafts/{draft['draft_id']}/confirm")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Reminder Blast"

    assert fake_mongo["Campaigns"].count_documents({"org_id": "org-a"}) == 1
    resolved = fake_mongo["CopilotAgentDrafts"].find_one({"draft_id": draft["draft_id"]})
    assert resolved["status"] == "confirmed"

    logged = fake_mongo["AuditLog"].find_one({"entity_type": "campaign", "action": "created"})
    assert logged is not None
    assert logged["detail"] == "created via Ask VoicEra"


def test_confirm_campaign_draft_rejects_non_telephony_agent(fake_mongo, copilot_app: FastAPI):
    _seed_agent(fake_mongo, org_id="org-a", agent_id="agent-1", name="Websocket Agent")
    fake_mongo["Agents"].update_one({"agent_id": "agent-1"}, {"$set": {"agent_category": "websocket"}})

    with patch("app.services.copilot.tools.MinIOStorage", _fake_minio_object_exists(True)):
        draft = tools.propose_create_campaign(
            "org-a",
            created_by="alice@example.com",
            conversation_id=None,
            name="Reminder Blast",
            agent_id="agent-1",
            source_id="copilot/org-a/contacts.csv",
        )

    copilot_app.dependency_overrides[get_current_user] = lambda: _user("alice@example.com")
    client = TestClient(copilot_app)
    response = client.post(f"/api/v1/copilot/campaign-drafts/{draft['draft_id']}/confirm")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_csv_attachment_note_gives_model_the_real_source_id(fake_mongo, monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_openai_factory(
        [[_content_chunk("Got it, 2 contacts."), _content_chunk(None, finish_reason="stop")]]
    )
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    from app.services.copilot import attachment_store

    attachment_store.create_attachment(
        "org-a",
        "alice@example.com",
        storage_key="copilot/org-a/contacts.csv",
        content_type="text/csv",
        original_filename="contacts.csv",
        size_bytes=3,
    )
    stored = fake_mongo["CopilotAttachments"].find_one({"org_id": "org-a"})
    attachment_id = stored["attachment_id"]
    csv_bytes = b"phone_number,name\r\n+15551230000,Asha\r\n+15551230001,Ravi\r\n"

    with patch(
        "app.services.copilot.engine.MinIOStorage",
        _fake_minio_storage({"copilot/org-a/contacts.csv": csv_bytes}),
    ):
        lines = [
            line
            async for line in engine.run_copilot_turn(
                org_id="org-a",
                user_email="alice@example.com",
                role="admin",
                message="Set up a campaign with this list.",
                conversation_id=None,
                context=None,
                attachment_ids=[attachment_id],
            )
        ]

    events = _parse_sse_events(lines)
    assert events[-1]["text"] == "Got it, 2 contacts."

    sent_messages = fake_cls.completions.calls[0]["messages"]
    system_message = next(m for m in sent_messages if m["role"] == "system")
    assert "copilot/org-a/contacts.csv" in system_message["content"]
    assert "2 contact row(s)" in system_message["content"]
    # A CSV never becomes vision content — the user turn stays plain text.
    user_message = next(m for m in sent_messages if m["role"] == "user")
    assert isinstance(user_message["content"], str)


# ---------------------------------------------------------------------------
# improve_prompt_text — the "improve my prompt" text-correction feature
# ---------------------------------------------------------------------------


class _FakeNonStreamingCompletions:
    """Real SDK response shape for stream=False: response.choices[0].message.content
    — distinct from _FakeCompletions above, which returns an async generator
    for the streaming calls run_copilot_turn makes."""

    def __init__(self, content: str):
        self.content = content
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any):
        self.calls.append(kwargs)
        message = SimpleNamespace(content=self.content)
        choice = SimpleNamespace(message=message)
        return SimpleNamespace(choices=[choice])


def _fake_non_streaming_openai_factory(content: str):
    completions = _FakeNonStreamingCompletions(content)

    class _FakeAsyncOpenAI:
        def __init__(self, api_key: str | None = None, **_: Any) -> None:
            self.chat = SimpleNamespace(completions=completions)

    _FakeAsyncOpenAI.completions = completions
    return _FakeAsyncOpenAI


@pytest.mark.asyncio
async def test_improve_prompt_text_returns_the_corrected_text(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_non_streaming_openai_factory("Create an outbound Kannada EMI reminder agent.")
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    result = await engine.improve_prompt_text("org-a", "creat an outbnd knnada emi remindr agnt")

    assert result == "Create an outbound Kannada EMI reminder agent."
    # A tiny, dedicated call — not the full Agent Builder system prompt or tools.
    call_kwargs = fake_cls.completions.calls[0]
    assert "tools" not in call_kwargs
    assert call_kwargs["messages"][0]["role"] == "system"
    assert call_kwargs["messages"][0]["content"] != engine.SYSTEM_PROMPT_TEMPLATE
    assert call_kwargs["messages"][1] == {"role": "user", "content": "creat an outbnd knnada emi remindr agnt"}


@pytest.mark.asyncio
async def test_improve_prompt_text_rejects_empty_input(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    with pytest.raises(ValueError):
        await engine.improve_prompt_text("org-a", "   ")


@pytest.mark.asyncio
async def test_improve_prompt_text_falls_back_to_original_on_empty_model_reply(monkeypatch):
    """A blank/whitespace-only reply from the model must never erase the
    user's own text — fall back to what they typed rather than losing it."""
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_non_streaming_openai_factory("   ")
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    result = await engine.improve_prompt_text("org-a", "my origianl text")

    assert result == "my origianl text"


def test_copilot_improve_prompt_endpoint_returns_corrected_text(monkeypatch):
    monkeypatch.setattr(engine.settings, "COPILOT_LLM_API_KEY", "test-key")
    fake_cls = _fake_non_streaming_openai_factory("Fixed text.")
    monkeypatch.setattr(engine, "AsyncOpenAI", fake_cls)

    app = FastAPI()
    app.include_router(copilot_router.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {
        "email": "alice@example.com",
        "org_id": "org-a",
        "role": "member",
    }
    client = TestClient(app)

    response = client.post("/api/v1/copilot/improve-prompt", json={"text": "brokn txt"})

    assert response.status_code == 200
    assert response.json() == {"improved": "Fixed text."}
