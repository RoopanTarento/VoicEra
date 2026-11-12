"""Copilot voice WebSocket route: session redemption, pipeline wiring, failure handling."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from apps.runtime.services.backend import BackendError


def _bundle(**overrides: Any) -> dict[str, Any]:
    base = {
        "org_id": "org-a",
        "created_by": "alice@example.com",
        "role": "admin",
        "conversation_id": None,
        "agent": {
            "agent_id": "copilot-voice",
            "org_id": "org-a",
            "name": "VoicERA Copilot",
            "agent_category": "websocket",
            "config": {
                "prompts": {"system_prompt": "You are the Copilot.", "greeting_message": "Hi!"},
                "behaviour": {},
                "models": {
                    "stt_config": {"provider": "openai", "model": "gpt-4o-transcribe"},
                    "tts_config": {"provider": "openai", "model": "gpt-4o-mini-tts"},
                    "llm_config": {"provider": "groq", "model": "llama-3.3-70b-versatile", "api_key": "gsk-x"},
                },
                "knowledge_base": {"enabled": False},
            },
        },
        "tool_names": ["list_agents", "get_analytics_summary"],
    }
    base.update(overrides)
    return base


@patch("apps.runtime.routes.copilot_voice.run_pipeline", new_callable=AsyncMock)
@patch("apps.runtime.routes.copilot_voice.backend_client.get_copilot_voice_session", new_callable=AsyncMock)
def test_copilot_voice_websocket_builds_pipeline_from_bundle(
    get_session_mock: AsyncMock,
    run_pipeline_mock: AsyncMock,
    client: TestClient,
) -> None:
    get_session_mock.return_value = _bundle()

    with client.websocket_connect("/copilot-agent/session-123"):
        pass

    get_session_mock.assert_awaited_once_with("session-123")
    run_pipeline_mock.assert_awaited_once()
    _, kwargs = run_pipeline_mock.await_args
    assert kwargs["org_id"] == "org-a"
    assert kwargs["agent"]["agent_id"] == "copilot-voice"
    assert kwargs["call_id"] is None
    assert kwargs["finalize_call"] is False
    # Every Copilot tool the bundle named is registered as a live Pipecat function.
    assert len(kwargs["extra_tools"]) == 2
    assert kwargs["aggregator_hooks"] is not None


@patch("apps.runtime.routes.copilot_voice.run_pipeline", new_callable=AsyncMock)
@patch("apps.runtime.routes.copilot_voice.backend_client.get_copilot_voice_session", new_callable=AsyncMock)
def test_copilot_voice_websocket_closes_on_invalid_session(
    get_session_mock: AsyncMock,
    run_pipeline_mock: AsyncMock,
    client: TestClient,
) -> None:
    get_session_mock.side_effect = BackendError("Voice session not found or expired: bad-id")

    with client.websocket_connect("/copilot-agent/bad-id"):
        pass

    run_pipeline_mock.assert_not_awaited()
