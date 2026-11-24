"""The six tools of a demo-builder agent (build spec, "Call runtime").

An agent built by the no-login demo builder carries ``config.demo``. Its calls
get these tools; each one is answered by the API (``POST /try/runtime/tool``,
internal API key), which holds the call's flow state and knowledge cards:

    search_cards, get_card, start_flow, record_slot, log_gap, end_call

Every API result carries the new ``state_block``; it replaces the
``<state>…</state>`` section of the system prompt, so the model's next turn
reads the current flow step. Tool calls of one call run one at a time, so
parallel calls from the model can't race on the state.
"""

from __future__ import annotations

import asyncio
import os
import re
import uuid
from typing import Any, Union

import httpx
from loguru import logger
from pipecat.frames.frames import EndWorkerFrame, FunctionCallResultProperties
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.llm_service import FunctionCallParams

from apps.runtime.services.pipecat.call_ending import _append_tools

_STATE = re.compile(r"<state>.*?</state>", re.S)
_TIMEOUT = 8.0
_UNAVAILABLE = (
    "The knowledge service didn't answer. Say \"One moment\", try once more, and if it fails again "
    "give the most relevant contact from the prompt."
)


def demo_config(agent: dict[str, Any]) -> dict[str, Any] | None:
    demo = (agent.get("config") or {}).get("demo")
    return demo if isinstance(demo, dict) and demo.get("template_id") else None


def keeps_no_recordings(agent: dict[str, Any] | None) -> bool:
    """No-login demo calls store no audio and no transcript (spec, "After the call")."""
    demo = demo_config(agent or {})
    return bool(demo and demo.get("preview"))


class DemoToolClient:
    """Posts tool calls for one call to the API and keeps the prompt's state block current."""

    def __init__(self, *, org_id: str, agent_id: str, call_id: str, context: LLMContext) -> None:
        self.org_id = org_id
        self.agent_id = agent_id
        self.call_id = call_id
        self.context = context
        self._lock = asyncio.Lock()

    def _update_state_block(self, block: str) -> None:
        for message in self.context.messages:
            if message.get("role") == "system" and isinstance(message.get("content"), str) and "<state>" in message["content"]:
                message["content"] = _STATE.sub(lambda _m: f"<state>\n{block}\n</state>", message["content"], count=1)
                return

    async def call(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        base = (os.getenv("API_BASE_URL") or "http://localhost:8000/api/v1").rstrip("/")
        payload = {"org_id": self.org_id, "agent_id": self.agent_id, "call_id": self.call_id, "name": name, "args": args}
        headers = {"X-API-Key": os.getenv("INTERNAL_API_KEY", ""), "Accept": "application/json"}
        async with self._lock:
            try:
                async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                    response = await client.post(f"{base}/try/runtime/tool", json=payload, headers=headers)
                response.raise_for_status()
                result = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("Demo tool {} failed call_id={}: {}", name, self.call_id, type(exc).__name__)
                return {"error": _UNAVAILABLE}
            block = result.pop("state_block", None)
            if isinstance(block, str):
                self._update_state_block(block)
            return result


def build_demo_tools(client: DemoToolClient, records_fields: list[str]) -> list[Any]:
    """The six tools as Pipecat direct functions bound to ``client``."""

    async def search_cards(params: FunctionCallParams, query: str, sector_id: str = "") -> None:
        """Find knowledge cards when no active flow covers the caller's question.

        Args:
            query: The caller's question in a few English keywords (cards are in English).
            sector_id: Optional sector id; leave empty for this agent's own sector.
        """
        await params.result_callback(await client.call("search_cards", {"query": query, "sector_id": sector_id}))

    async def get_card(params: FunctionCallParams, card_id: str) -> None:
        """Get a full card: steps, documents, fee and time, and where to go.

        Args:
            card_id: The card id, e.g. K-AGRI-03.
        """
        await params.result_callback(await client.call("get_card", {"card_id": card_id}))

    async def start_flow(params: FunctionCallParams, flow_id: str) -> None:
        """Begin a question flow when the caller's need matches its starts_when. Returns step 1.

        Args:
            flow_id: One of the flow ids listed under "Question flows you can start".
        """
        await params.result_callback(await client.call("start_flow", {"flow_id": flow_id}))

    async def record_slot(params: FunctionCallParams, asks_for: str, value: str, branch_matched: bool) -> None:
        """Save the caller's answer to a step of the active flow. Returns what to say, any cards, and the next step or "end".

        Call it after every flow answer, and after a step you only speak (answer_type none) with value "done".

        Args:
            asks_for: The step's asks_for (the current step, or a later one the caller already answered).
            value: The caller's answer in a few words, in English.
            branch_matched: True when the answer matches the step's if_answer, else false.
        """
        await params.result_callback(
            await client.call("record_slot", {"asks_for": asks_for, "value": value, "branch_matched": branch_matched})
        )

    async def log_gap(params: FunctionCallParams, caller_text: str) -> None:
        """Record a question you could not answer from any card or flow.

        Args:
            caller_text: The caller's question, in English, without any personal details.
        """
        await params.result_callback(await client.call("log_gap", {"caller_text": caller_text}))

    async def end_call(params: FunctionCallParams, records: dict[str, Union[str, list[str]]]) -> None:
        """Save the call record and end the call, after your one-sentence closing.

        Args:
            records: The call record (see the tool description for its fields).
        """
        result = await client.call("end_call", {"records": records})
        if result.get("error") and "records" in str(result["error"]):
            await params.result_callback(result)
            return
        await params.result_callback({"status": "ended"}, properties=FunctionCallResultProperties(run_llm=False))
        await params.llm.push_frame(EndWorkerFrame(), FrameDirection.DOWNSTREAM)

    fields = ", ".join(records_fields) if records_fields else "the template's fields"
    end_call.__doc__ = (
        "Save the call record and end the call, after your one-sentence closing recap. "
        f"records must have exactly these keys: {fields}. Use \"yes\"/\"no\" for yes/no fields, a short "
        "phrase or a list of short phrases otherwise, in English.\n\n"
        "Args:\n    records: The call record."
    )
    return [search_cards, get_card, start_flow, record_slot, log_gap, end_call]


def configure_demo_tools(
    agent: dict[str, Any],
    *,
    context: LLMContext,
    org_id: str,
    call_id: str | None,
) -> DemoToolClient | None:
    """Add the six tools when ``agent`` was built by the demo builder."""
    demo = demo_config(agent)
    if not demo:
        return None
    agent_id = str(agent.get("agent_id") or "")
    client = DemoToolClient(
        org_id=org_id,
        agent_id=agent_id,
        call_id=call_id or f"session-{uuid.uuid4()}",
        context=context,
    )
    fields = [str(f.get("key")) for f in demo.get("records_fields") or [] if isinstance(f, dict) and f.get("key")]
    _append_tools(context, build_demo_tools(client, fields))
    logger.info("Demo tools enabled agent_id={} template={} call_id={}", agent_id, demo.get("template_id"), client.call_id)
    return client
