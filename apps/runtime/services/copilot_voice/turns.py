"""Persist completed spoken turns into the linked text Copilot conversation.

This is what makes voice and text the same conversation (not two separate
histories): every finished user/assistant turn in the voice session is
appended to CopilotConversations via the same append_messages path the text
/copilot/chat endpoint uses, so switching from voice to text mid-conversation
sees the same history.
"""

from __future__ import annotations

from loguru import logger
from pipecat.processors.aggregators.llm_response_universal import (
    AssistantTurnStoppedMessage,
    LLMContextAggregatorPair,
    UserTurnStoppedMessage,
)

from apps.runtime.services.backend import backend_client


def register_turn_persistence(session_id: str, aggregators: LLMContextAggregatorPair) -> None:
    """Attach turn-stopped handlers that push each turn to the API (fail-open)."""
    user_aggregator, assistant_aggregator = aggregators

    @user_aggregator.event_handler("on_user_turn_stopped")
    async def _persist_user_turn(_aggregator, _strategy, message: UserTurnStoppedMessage) -> None:
        if not message.content:
            return
        try:
            await backend_client.append_copilot_voice_turn(session_id, "user", message.content)
        except Exception:
            logger.debug("Copilot voice: failed to persist user turn", exc_info=True)

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def _persist_assistant_turn(_aggregator, message: AssistantTurnStoppedMessage) -> None:
        if message.interrupted or not message.content:
            return
        try:
            await backend_client.append_copilot_voice_turn(session_id, "assistant", message.content)
        except Exception:
            logger.debug("Copilot voice: failed to persist assistant turn", exc_info=True)
