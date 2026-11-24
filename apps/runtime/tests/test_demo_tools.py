"""Demo-builder agents: the six tools, the live state block, and no recordings for preview calls."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from pipecat.frames.frames import EndWorkerFrame
from pipecat.processors.aggregators.llm_context import LLMContext, NOT_GIVEN

from apps.runtime.services.demo import tools as demo_tools
from apps.runtime.services.pipecat import events

DEMO_AGENT = {
    "agent_id": "a1",
    "config": {"demo": {"template_id": "T-ANSWER", "preview": True, "records_fields": [{"key": "topic_asked"}, {"key": "answered"}]}},
}


def _context() -> LLMContext:
    return LLMContext([{"role": "system", "content": "Rules.\n<state>\nActive flow: F-ANSWER, step 1\n</state>\nMore."}])


def test_plain_agents_get_no_demo_tools() -> None:
    context = LLMContext([])
    assert demo_tools.configure_demo_tools({"agent_id": "x", "config": {}}, context=context, org_id="o", call_id="c") is None
    assert context.tools is NOT_GIVEN


def test_demo_agents_get_the_six_tools() -> None:
    context = _context()
    client = demo_tools.configure_demo_tools(DEMO_AGENT, context=context, org_id="o", call_id="c1")
    names = {tool.name for tool in context.tools.standard_tools}
    assert names == {"search_cards", "get_card", "start_flow", "record_slot", "log_gap", "end_call"}
    assert client and client.call_id == "c1"
    end_call = next(t for t in context.tools.standard_tools if t.name == "end_call")
    assert "topic_asked, answered" in end_call.description


class _Transport(httpx.AsyncBaseTransport):
    def __init__(self, reply: dict | None = None, status: int = 200) -> None:
        self.reply = reply or {}
        self.status = status
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, json=self.reply)


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch):
    box = SimpleNamespace(t=_Transport())
    real = httpx.AsyncClient

    monkeypatch.setattr(demo_tools.httpx, "AsyncClient", lambda **kw: real(transport=box.t, **kw))
    monkeypatch.setenv("INTERNAL_API_KEY", "k")
    monkeypatch.setenv("API_BASE_URL", "http://api.test/api/v1")
    return box


def test_tool_results_refresh_the_state_block(transport) -> None:
    transport.t = _Transport({"next": {"asks_for": "aadhaar_bank"}, "state_block": "Active flow: F-AGRI-PMKISAN-STOP, step 2"})
    context = _context()
    client = demo_tools.DemoToolClient(org_id="o", agent_id="a1", call_id="c1", context=context)
    result = asyncio.run(client.call("record_slot", {"asks_for": "ekyc_done", "value": "yes", "branch_matched": False}))
    assert result == {"next": {"asks_for": "aadhaar_bank"}}
    assert context.messages[0]["content"] == "Rules.\n<state>\nActive flow: F-AGRI-PMKISAN-STOP, step 2\n</state>\nMore."
    request = transport.t.requests[0]
    assert request.url.path == "/api/v1/try/runtime/tool" and request.headers["X-API-Key"] == "k"


def test_an_unreachable_api_becomes_an_instruction_not_a_crash(transport) -> None:
    transport.t = _Transport(status=500)
    context = _context()
    client = demo_tools.DemoToolClient(org_id="o", agent_id="a1", call_id="c1", context=context)
    result = asyncio.run(client.call("get_card", {"card_id": "K-AGRI-01"}))
    assert "didn't answer" in result["error"] and "F-ANSWER" in context.messages[0]["content"]


def test_end_call_saves_the_record_then_ends_the_call(transport) -> None:
    transport.t = _Transport({"ok": True, "state_block": "The call has ended."})
    client = demo_tools.DemoToolClient(org_id="o", agent_id="a1", call_id="c1", context=_context())
    end_call = demo_tools.build_demo_tools(client, ["topic_asked"])[-1]
    params = SimpleNamespace(result_callback=AsyncMock(), llm=SimpleNamespace(push_frame=AsyncMock()))
    asyncio.run(end_call(params, records={"topic_asked": "PM-KISAN"}))
    params.result_callback.assert_awaited_once()
    frame = params.llm.push_frame.await_args.args[0]
    assert isinstance(frame, EndWorkerFrame)


def test_a_bad_record_is_returned_for_the_model_to_fix(transport) -> None:
    transport.t = _Transport({"error": "records must be an object with: topic_asked."})
    client = demo_tools.DemoToolClient(org_id="o", agent_id="a1", call_id="c1", context=_context())
    end_call = demo_tools.build_demo_tools(client, ["topic_asked"])[-1]
    params = SimpleNamespace(result_callback=AsyncMock(), llm=SimpleNamespace(push_frame=AsyncMock()))
    asyncio.run(end_call(params, records={}))
    assert "records must be" in params.result_callback.await_args.args[0]["error"]
    params.llm.push_frame.assert_not_awaited()


@pytest.mark.parametrize("agent, stored", [(DEMO_AGENT, False), ({"config": {"demo": {"template_id": "T-ANSWER", "preview": False}}}, True), ({"config": {}}, True)])
def test_preview_calls_store_no_audio_and_no_transcript(monkeypatch: pytest.MonkeyPatch, agent, stored) -> None:
    transcript = MagicMock(return_value="writer")
    recording = MagicMock()
    monkeypatch.setattr(events, "register_transcript_file_logging", transcript)
    monkeypatch.setattr(events, "register_recording_handlers", recording)
    for name in ("register_idle_handlers", "register_hold_handlers", "register_turn_logging_handlers", "register_transport_handlers"):
        monkeypatch.setattr(events, name, MagicMock())
    components = SimpleNamespace(
        user_aggregator=MagicMock(), assistant_aggregator=MagicMock(), llm=MagicMock(), audiobuffer=MagicMock(),
        transport=MagicMock(), worker=MagicMock(), transcript_writer=None,
    )
    config = SimpleNamespace(online_detection_enabled=False, online_detection_closing_message="")
    events.register_all_handlers(
        components, config=config, greeting="Hi", session_label="s", hold_handler=None, idle_handler=None,
        org_id="o", call_id="c1", agent=agent,
    )
    assert transcript.called is stored and recording.called is stored
