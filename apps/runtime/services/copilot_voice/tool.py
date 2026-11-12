"""Pipecat direct-function wrappers for the Copilot's tools, live-voice-only.

Each wrapper's signature IS its function-calling schema — Pipecat derives it
from these type hints and docstrings (the same "direct function" mechanism
apps/runtime/services/knowledge/tool.py already uses for search_knowledge_base),
so they're hand-written to mirror
apps/api/app/services/copilot/tool_specs.py's JSON schemas exactly, rather
than generated dynamically.

Every wrapper does the same thing underneath: forward to
backend_client.call_copilot_voice_tool, which executes the identical
apps.api...copilot.tools function the text Copilot uses (via the internal
/voice/session/{id}/tool endpoint). A voice tool call can never do anything a
text tool call couldn't — same dispatch, same org scoping, same safety
contract (propose_create_agent only ever stages a draft; nothing here can
create a real agent by itself).
"""

from __future__ import annotations

from typing import Any

from pipecat.services.llm_service import FunctionCallParams

from apps.runtime.services.backend import backend_client


def build_copilot_voice_tools(session_id: str, tool_names: list[str] | None = None) -> list[Any]:
    """Return the Pipecat direct functions this session's bundle authorized.

    ``tool_names`` (from the session bundle apps/api built) is the actual
    filter — not every voice session need offer every tool the text Copilot
    has, e.g. a future role-restricted session. ``None`` means "all of them"
    for callers/tests that don't care about restricting the set.
    """

    async def _call(tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return await backend_client.call_copilot_voice_tool(session_id, tool, arguments)

    async def list_agents(
        params: FunctionCallParams, status: str | None = None, limit: int = 20
    ) -> None:
        """List the organisation's voice agents.

        Args:
            status: Optional filter, e.g. 'active' or 'inactive'.
            limit: Max agents to return.
        """
        await params.result_callback(await _call("list_agents", {"status": status, "limit": limit}))

    async def get_agent(params: FunctionCallParams, agent_id: str) -> None:
        """Fetch one agent's full configuration.

        Args:
            agent_id: The agent's id, from list_agents.
        """
        await params.result_callback(await _call("get_agent", {"agent_id": agent_id}))

    async def list_calls(
        params: FunctionCallParams,
        agent_id: str | None = None,
        status: str | None = None,
        call_response: str | None = None,
        days: int | None = None,
        limit: int = 20,
    ) -> None:
        """List recent calls, optionally filtered.

        Args:
            agent_id: Optional agent id filter.
            status: Optional call status filter, e.g. 'completed', 'failed'.
            call_response: Optional outcome filter, e.g. 'answered', 'no_answer'.
            days: Only calls from the last N days.
            limit: Max calls to return.
        """
        await params.result_callback(
            await _call(
                "list_calls",
                {
                    "agent_id": agent_id,
                    "status": status,
                    "call_response": call_response,
                    "days": days,
                    "limit": limit,
                },
            )
        )

    async def get_call(params: FunctionCallParams, call_id: str) -> None:
        """Fetch full detail for one call.

        Args:
            call_id: The call's id.
        """
        await params.result_callback(await _call("get_call", {"call_id": call_id}))

    async def get_analytics_summary(params: FunctionCallParams) -> None:
        """Org-wide call analytics: volume, connection rate, duration, trend."""
        await params.result_callback(await _call("get_analytics_summary", {}))

    async def list_campaigns(
        params: FunctionCallParams, state: str | None = None, limit: int = 20
    ) -> None:
        """List outbound calling campaigns, optionally filtered by state.

        Args:
            state: Optional state filter, e.g. 'running', 'completed'.
            limit: Max campaigns to return.
        """
        await params.result_callback(await _call("list_campaigns", {"state": state, "limit": limit}))

    async def list_knowledge_documents(params: FunctionCallParams) -> None:
        """List the organisation's knowledge-base documents and ingest status."""
        await params.result_callback(await _call("list_knowledge_documents", {}))

    async def search_knowledge_base(params: FunctionCallParams, query: str) -> None:
        """Search the organisation's knowledge-base documents.

        Args:
            query: Natural-language search query.
        """
        await params.result_callback(await _call("search_knowledge_base", {"query": query}))

    async def propose_create_agent(
        params: FunctionCallParams,
        name: str,
        purpose: str,
        primary_language: str = "en",
    ) -> None:
        """Propose a new agent as an unsaved draft for the user to confirm in the app.

        This never creates a real agent by itself — always say so out loud
        and tell the user to look at the confirmation card.

        Args:
            name: Short, human-readable agent name.
            purpose: What the agent should help callers accomplish, one sentence.
            primary_language: Canonical language id, e.g. 'en', 'hi', 'kn'.
        """
        await params.result_callback(
            await _call(
                "propose_create_agent",
                {"name": name, "purpose": purpose, "primary_language": primary_language},
            )
        )

    all_tools = {
        "list_agents": list_agents,
        "get_agent": get_agent,
        "list_calls": list_calls,
        "get_call": get_call,
        "get_analytics_summary": get_analytics_summary,
        "list_campaigns": list_campaigns,
        "list_knowledge_documents": list_knowledge_documents,
        "search_knowledge_base": search_knowledge_base,
        "propose_create_agent": propose_create_agent,
    }
    if tool_names is None:
        return list(all_tools.values())
    return [all_tools[name] for name in tool_names if name in all_tools]
