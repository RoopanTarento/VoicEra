"""merge_models_with_auth skips stored auth for local (no-secret) providers."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from apps.runtime.services.ai_service_factory import (
    _has_all_auth_fields,
    _requires_stored_auth,
    merge_models_with_auth,
)


def test_local_providers_do_not_require_stored_auth():
    assert _requires_stored_auth("indic_nemotron") is False
    assert _requires_stored_auth("indic_orpheus") is False
    assert _requires_stored_auth("openai") is True
    assert _requires_stored_auth("deepgram") is True


def test_merge_skips_auth_fetch_for_local_stt_tts():
    client = MagicMock()
    client.get_provider_auth = AsyncMock(
        return_value={"api_key": "sk-test"},
    )
    agent = {
        "org_id": "org-1",
        "config": {
            "models": {
                "stt_config": {
                    "provider": "indic_nemotron",
                    "model": "indic-nemotron-600m",
                    "language": "hi",
                },
                "tts_config": {
                    "provider": "indic_orpheus",
                    "model": "orpheus-indic",
                    "language": "hi",
                    "voice": "Amit",
                    "style": "news",
                },
                "llm_config": {
                    "provider": "openai",
                    "model": "gpt-4.1",
                },
            }
        },
    }
    out = asyncio.run(merge_models_with_auth(agent, client=client))
    assert out["stt_config"]["provider"] == "indic_nemotron"
    assert "api_key" not in out["stt_config"]
    assert out["tts_config"]["provider"] == "indic_orpheus"
    assert out["llm_config"]["api_key"] == "sk-test"
    client.get_provider_auth.assert_awaited_once_with("openai", "org-1")


def test_has_all_auth_fields_false_for_secretless_blob():
    # A real stored Agents document never carries secrets (API-side validation
    # forbids it) — confirming this stays False preserves existing behavior.
    assert _has_all_auth_fields("openai", {"provider": "openai", "model": "gpt-4.1"}) is False


def test_has_all_auth_fields_true_when_pre_resolved():
    assert _has_all_auth_fields("openai", {"provider": "openai", "api_key": "sk-real"}) is True


def test_has_all_auth_fields_false_for_provider_with_no_secrets():
    assert _has_all_auth_fields("indic_nemotron", {"provider": "indic_nemotron"}) is False


def test_merge_skips_fetch_when_llm_config_already_has_a_pre_resolved_key():
    """The Copilot voice bundle embeds a resolved LLM key in-process (it can see
    the COPILOT_LLM_API_KEY fallback the runtime's HTTP-only get_provider_auth
    cannot) — merge_models_with_auth must not clobber or fail on it."""
    client = MagicMock()
    # STT/TTS still need a real fetch since they have no pre-embedded key;
    # llm_config must NOT trigger one, since it already carries api_key.
    client.get_provider_auth = AsyncMock(return_value={"api_key": "sk-openai-real"})
    agent = {
        "org_id": "org-demo",
        "config": {
            "models": {
                "stt_config": {"provider": "openai", "model": "gpt-4o-transcribe"},
                "tts_config": {"provider": "openai", "model": "gpt-4o-mini-tts", "voice": "alloy"},
                "llm_config": {"provider": "groq", "model": "llama-3.3-70b-versatile", "api_key": "gsk-real"},
            }
        },
    }
    out = asyncio.run(merge_models_with_auth(agent, client=client))
    assert out["llm_config"]["api_key"] == "gsk-real"
    assert out["stt_config"]["api_key"] == "sk-openai-real"
    client.get_provider_auth.assert_any_await("openai", "org-demo")
    assert client.get_provider_auth.await_count == 2  # stt + tts only, never llm
