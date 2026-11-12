"""Mock provider config, client and simulated call lifecycle.

Outcomes are deterministic so demos and tests can show every path:

* number ending in 7 -> ``busy`` on the first attempt, answered on retry
* number ending in 8 -> ``no_answer`` on every attempt
* number ending in 9 -> ``failed``
* anything else      -> answered, 20-120 s simulated duration
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional
from urllib.parse import parse_qs, urlparse

import httpx
from pydantic import Field

from apps.pii import mask_phone
from apps.telephony.base import (
    BaseTelephonyAuth,
    BaseTelephonyConfig,
    BaseTelephonySettings,
    fail,
    success,
)
from apps.telephony.registry import register_answer_xml, register_client, register_telephony

logger = logging.getLogger(__name__)

MOCK_PROVIDER_ID = "mock"
MOCK_NUMBERS = ("+918000000101", "+918000000102", "+918000000103")

CallbackSink = Callable[[Dict[str, Any]], Awaitable[None]]


class MockAuth(BaseTelephonyAuth):
    auth_id: str = Field(
        default="mock-account",
        description="Any value; the mock provider does not authenticate.",
        json_schema_extra={"secret": True},
    )
    auth_token: str = Field(
        default="mock-token",
        description="Any value; the mock provider does not authenticate.",
        json_schema_extra={"secret": True},
    )


class MockSettings(BaseTelephonySettings):
    base_url: str = Field(default="mock://local", description="Unused by the mock provider.")


class MockConfig(MockAuth, MockSettings, BaseTelephonyConfig):
    """Simulated telephony for local demos. Never places real calls."""

    name: str = "Mock (local demo)"
    provider: Literal["mock"] = "mock"


@dataclass(frozen=True)
class MockOutcome:
    call_status: str
    hangup_cause: str
    duration: int

    @property
    def answered(self) -> bool:
        return self.call_status == "completed"


_attempts: dict[str, int] = {}
_callback_sink: CallbackSink | None = None
_tasks: set[asyncio.Task] = set()
_enabled = False


def _number_key(number: str) -> str:
    # The mock tracks attempts per destination without keeping the number itself.
    return hashlib.sha256(number.encode("utf-8")).hexdigest()


def outcome_for(to_number: str, attempt: int) -> MockOutcome:
    digits = "".join(ch for ch in to_number if ch.isdigit())
    last = digits[-1:] or "0"
    seed = int(hashlib.sha256(f"{digits}:{attempt}".encode()).hexdigest()[:6], 16)
    if last == "7" and attempt == 1:
        return MockOutcome("busy", "USER_BUSY", 0)
    if last == "8":
        return MockOutcome("no-answer", "NO_ANSWER", 0)
    if last == "9":
        return MockOutcome("failed", "UNALLOCATED_NUMBER", 0)
    return MockOutcome("completed", "NORMAL_CLEARING", 20 + seed % 101)


def set_callback_sink(sink: CallbackSink | None) -> None:
    """Deliver simulated callbacks to ``sink`` instead of HTTP POSTing them."""
    global _callback_sink
    _callback_sink = sink


def reset_mock_state() -> None:
    _attempts.clear()
    for task in list(_tasks):
        task.cancel()
    _tasks.clear()


def _callback_delay() -> float:
    try:
        return max(0.0, float(os.getenv("TELEPHONY_MOCK_CALLBACK_DELAY_SECONDS", "2")))
    except ValueError:
        return 2.0


async def _deliver(callback_url: str | None, payload: Dict[str, Any], delay: float) -> None:
    await asyncio.sleep(delay)
    try:
        if _callback_sink is not None:
            await _callback_sink(payload)
        elif callback_url:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(callback_url, data=payload)
    except Exception:
        logger.exception("Mock provider callback delivery failed call_uuid=%s", payload.get("CallUUID"))


class MockClient:
    """Implements the client surface the API uses for Plivo / Vobiz."""

    PROVIDER_LABEL = "Mock"

    def __init__(self, auth_id: str = "mock-account", auth_token: str = "mock-token", base_url: str = "mock://local") -> None:
        self.base_url = base_url

    async def create_application(self, app_name: str, answer_url: str) -> Dict[str, Any]:
        return success("Mock application created", app_id=f"mock-app-{app_name}")

    async def delete_application(self, application_id: str) -> Dict[str, Any]:
        return success("Mock application deleted")

    async def update_application_name(self, application_id: str, app_name: str) -> Dict[str, Any]:
        return success("Mock application renamed")

    async def link_number(self, phone_number: str, application_id: str) -> Dict[str, Any]:
        return success("Mock number linked")

    async def unlink_number(self, phone_number: str) -> Dict[str, Any]:
        return success("Mock number unlinked")

    async def list_numbers(self) -> Dict[str, Any]:
        return success(numbers=list(MOCK_NUMBERS))

    async def initiate_call(
        self,
        *,
        from_number: str,
        to_number: str,
        answer_url: str,
        answer_method: str = "POST",
        hangup_url: Optional[str] = None,
        hangup_method: str = "POST",
    ) -> Dict[str, Any]:
        if not to_number:
            return fail("Mock provider: destination number is required")
        key = _number_key(to_number)
        _attempts[key] = _attempts.get(key, 0) + 1
        outcome = outcome_for(to_number, _attempts[key])
        call_uuid = str(uuid.uuid4())
        query = {k: v[0] for k, v in parse_qs(urlparse(hangup_url or answer_url).query).items()}
        payload = {
            "Event": "Hangup",
            "CallUUID": call_uuid,
            "From": from_number,
            "To": to_number,
            "Direction": "outbound",
            "CallStatus": outcome.call_status,
            "HangupCause": outcome.hangup_cause,
            "Duration": str(outcome.duration),
            "AnswerTime": "1" if outcome.answered else "",
            **query,
        }
        task = asyncio.get_running_loop().create_task(
            _deliver(hangup_url or answer_url, payload, _callback_delay())
        )
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
        logger.info(
            "Mock outbound call accepted to=%s request_uuid=%s outcome=%s",
            mask_phone(to_number),
            call_uuid,
            outcome.call_status,
        )
        return success("Call initiated successfully", call_uuid=call_uuid, request_uuid=call_uuid, raw={"request_uuid": call_uuid})

    async def start_call_recording(self, call_uuid: str, time_limit_secs: int) -> Optional[str]:
        return None

    async def wait_and_download_recording(self, *args: Any, **kwargs: Any) -> Optional[bytes]:
        return None


def create_client(cfg: MockConfig) -> MockClient:
    return MockClient(cfg.auth_id, cfg.auth_token, cfg.base_url)


def build_answer_stream_xml(websocket_url: str, *, sample_rate: int = 8000, **_: Any) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n'
        f'    <Stream bidirectional="true" contentType="audio/x-mulaw;rate={sample_rate}">{websocket_url}</Stream>\n'
        "</Response>"
    )


def enable_mock_provider() -> None:
    """Register the mock provider (idempotent)."""
    global _enabled
    register_telephony(MockConfig)
    register_client(create_client)
    register_answer_xml(MOCK_PROVIDER_ID)(build_answer_stream_xml)
    _enabled = True


def disable_mock_provider() -> None:
    """Unregister the mock provider (tests)."""
    global _enabled
    from apps.telephony import registry

    registry.TELEPHONY_CONFIGS.pop(MOCK_PROVIDER_ID, None)
    registry.CLIENT_CREATORS.pop(MOCK_PROVIDER_ID, None)
    registry.ANSWER_XML_BUILDERS.pop(MOCK_PROVIDER_ID, None)
    set_callback_sink(None)
    reset_mock_state()
    _enabled = False


def is_mock_enabled() -> bool:
    return _enabled
