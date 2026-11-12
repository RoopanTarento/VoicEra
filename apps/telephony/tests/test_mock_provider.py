"""Mock telephony provider (VoicEra Secure) and webhook sanitisation."""

from __future__ import annotations

import asyncio

import pytest

from apps.telephony import create_client, build_config, registered_providers, sanitize_webhook_payload
from apps.telephony.providers.mock import (
    MockClient,
    disable_mock_provider,
    enable_mock_provider,
    set_callback_sink,
)


@pytest.fixture
def mock_enabled(monkeypatch):
    monkeypatch.setenv("TELEPHONY_MOCK_CALLBACK_DELAY_SECONDS", "0")
    enable_mock_provider()
    yield
    disable_mock_provider()


def test_mock_is_not_registered_unless_enabled():
    disable_mock_provider()
    assert "mock" not in registered_providers()


def test_enable_registers_config_client_and_xml(mock_enabled):
    assert "mock" in registered_providers()
    client = create_client(build_config("mock", auth_id="a", auth_token="b"))
    assert isinstance(client, MockClient)


@pytest.mark.asyncio
async def test_mock_call_delivers_provider_style_callback(mock_enabled):
    received: list[dict] = []

    async def sink(payload: dict) -> None:
        received.append(payload)

    set_callback_sink(sink)
    client = MockClient()
    result = await client.initiate_call(
        from_number="+918000000101",
        to_number="+919876543217",
        answer_url="https://voice.test/answer?org_id=o1&agent_id=a1&call_id=c1",
        hangup_url="https://voice.test/answer?org_id=o1&agent_id=a1&call_id=c1",
    )
    assert result["status"] == "success" and result["call_uuid"]
    await asyncio.sleep(0.05)
    assert received[0]["To"] == "+919876543217"  # the provider itself sees the number
    assert received[0]["CallStatus"] == "busy"
    assert received[0]["call_id"] == "c1"
    clean = sanitize_webhook_payload(received[0])
    assert clean["To"] == "+91 ******3217"


def test_sanitize_keeps_non_number_fields():
    clean = sanitize_webhook_payload({"CallUUID": "u-1", "Event": "Hangup", "Duration": "42", "caller_id": "9876543210"})
    assert clean == {"CallUUID": "u-1", "Event": "Hangup", "Duration": "42", "caller_id": "******3210"}
