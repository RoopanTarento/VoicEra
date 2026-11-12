"""Copilot voice WebSocket endpoint — a live spoken conversation with the Copilot.

Deliberately separate from routes/agent.py: this never looks up a real
Agents document. Everything the pipeline needs (org, resolved LLM/STT/TTS
config, tool set) comes from the Copilot voice session bundle apps/api
builds — redeemed once via ``session_id`` alone, the same trust shape as
``call_id`` for browser test calls.
"""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger
from pipecat.serializers.protobuf import ProtobufFrameSerializer

from apps.runtime.constants import websocket_sample_rate
from apps.runtime.services.backend import BackendError, backend_client
from apps.runtime.services.copilot_voice.tool import build_copilot_voice_tools
from apps.runtime.services.copilot_voice.turns import register_turn_persistence
from apps.runtime.services.pipecat.pipeline import run_pipeline

router = APIRouter()


@router.websocket("/copilot-agent/{session_id}")
async def copilot_voice_websocket(websocket: WebSocket, session_id: str) -> None:
    """Accept a browser voice session and run a Pipecat pipeline for the Copilot."""
    await websocket.accept()
    logger.info("Copilot voice WebSocket accepted session_id={}", session_id)

    try:
        bundle = await backend_client.get_copilot_voice_session(session_id)
    except BackendError as exc:
        logger.warning("Copilot voice session invalid session_id={}: {}", session_id, exc)
        try:
            await websocket.close(code=1008, reason=str(exc)[:120])
        except Exception:
            pass
        return

    org_id = bundle["org_id"]
    agent = bundle["agent"]
    tools = build_copilot_voice_tools(session_id, bundle.get("tool_names"))

    try:
        await run_pipeline(
            websocket,
            org_id=org_id,
            agent=agent,
            serializer=ProtobufFrameSerializer(),
            sample_rate=websocket_sample_rate(),
            call_id=None,
            session_label=f"copilot-voice:{session_id}",
            finalize_call=False,
            extra_tools=tools,
            aggregator_hooks=lambda aggs: register_turn_persistence(session_id, aggs),
        )
    except WebSocketDisconnect:
        logger.info("Copilot voice WebSocket disconnected session_id={}", session_id)
    except Exception:
        logger.exception("Copilot voice pipeline failed session_id={}", session_id)
        try:
            await websocket.close(code=1011, reason="Pipeline error")
        except Exception:
            pass
    finally:
        logger.info("Copilot voice WebSocket closed session_id={}", session_id)
