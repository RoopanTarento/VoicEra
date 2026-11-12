"""Org+user-scoped storage for Copilot voice sessions.

A voice session is a short-lived handoff ticket: the browser creates one
(authenticated, normal JWT), then hands the bare ``session_id`` to
apps/runtime over a WebSocket URL. The runtime is the one thing that can
"redeem" it — via the internal-only bundle-fetch in routers/copilot.py — to
learn which org/user it's serving and get a ready-to-use pipeline config. The
session_id itself carries no privilege on its own beyond that one redemption:
it's exactly the same trust shape as ``call_id`` for browser test calls
(web_call_service.py), not a new pattern invented for this feature.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from app.database import get_database
from app.utils.mongo_utils import prepare_mongo_response

logger = logging.getLogger(__name__)

COLLECTION = "CopilotVoiceSessions"
SESSION_TTL_MINUTES = 30

VoiceSessionStatus = Literal["pending", "active", "ended"]


class CopilotVoiceSessionNotFoundError(Exception):
    """Raised when a session is missing, expired, or already ended."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_response(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    prepared = prepare_mongo_response(doc) or {}
    prepared.pop("_id", None)
    return prepared


def create_session(
    org_id: str,
    created_by: str,
    role: str,
    conversation_id: str | None,
) -> dict[str, Any]:
    """Create a pending voice session; the runtime redeems it once it connects."""
    now = _now()
    doc = {
        "session_id": str(uuid.uuid4()),
        "org_id": org_id,
        "created_by": created_by,
        "role": role,
        "conversation_id": conversation_id,
        "status": "pending",
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=SESSION_TTL_MINUTES)).isoformat(),
    }
    get_database()[COLLECTION].insert_one(doc)
    return _to_response(doc) or {}


def redeem_session(session_id: str) -> dict[str, Any]:
    """Fetch a still-valid session and mark it active (idempotent)."""
    db = get_database()
    doc = db[COLLECTION].find_one({"session_id": session_id})
    if not doc:
        raise CopilotVoiceSessionNotFoundError(session_id)
    if doc.get("status") == "ended":
        raise CopilotVoiceSessionNotFoundError(session_id)
    expires_at = doc.get("expires_at")
    if expires_at and datetime.fromisoformat(str(expires_at)) < _now():
        raise CopilotVoiceSessionNotFoundError(session_id)

    db[COLLECTION].update_one(
        {"session_id": session_id},
        {"$set": {"status": "active", "updated_at": _now().isoformat()}},
    )
    doc["status"] = "active"
    return _to_response(doc) or {}


def end_session(org_id: str, created_by: str, session_id: str) -> None:
    """Mark a session ended, scoped to the org/user that created it."""
    result = get_database()[COLLECTION].update_one(
        {"session_id": session_id, "org_id": org_id, "created_by": created_by},
        {"$set": {"status": "ended", "updated_at": _now().isoformat()}},
    )
    if result.matched_count == 0:
        raise CopilotVoiceSessionNotFoundError(session_id)
