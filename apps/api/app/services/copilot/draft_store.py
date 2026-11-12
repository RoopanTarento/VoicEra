"""Org+user-scoped storage for Copilot-proposed drafts (agents, campaigns).

A draft is never a live entity — it's a validated-but-unsaved config the
model proposed. Nothing here calls agent_service.create_agent or
repo.create_campaign; that only happens when the user explicitly confirms
(see routers/copilot.py), which is the whole point: propose -> preview ->
human confirmation -> real creation.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from app.database import get_database
from app.utils.mongo_utils import prepare_mongo_response

logger = logging.getLogger(__name__)

COLLECTION = "CopilotAgentDrafts"

DraftStatus = Literal["pending", "confirmed", "dismissed"]
DraftEntityType = Literal["agent", "agent_update", "campaign"]


class CopilotDraftNotFoundError(Exception):
    """Raised when a draft is missing for this org/user, or already resolved."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_response(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    prepared = prepare_mongo_response(doc) or {}
    prepared.pop("_id", None)
    return prepared


def create_draft(
    org_id: str,
    created_by: str,
    conversation_id: str | None,
    preview: dict[str, Any],
    create_payload: dict[str, Any],
    *,
    entity_type: DraftEntityType = "agent",
) -> dict[str, Any]:
    """Store a proposed-but-unsaved config; returns the draft document.

    ``preview`` is the compact shape shown to the user/model; ``create_payload``
    is the exact dict later passed to the real create call on confirmation.
    """
    now = _now_iso()
    doc = {
        "draft_id": str(uuid.uuid4()),
        "org_id": org_id,
        "created_by": created_by,
        "conversation_id": conversation_id,
        "entity_type": entity_type,
        "status": "pending",
        "preview": preview,
        "create_payload": create_payload,
        "created_at": now,
        "updated_at": now,
    }
    get_database()[COLLECTION].insert_one(doc)
    return _to_response(doc) or {}


def get_pending_draft(org_id: str, created_by: str, draft_id: str) -> dict[str, Any]:
    """Fetch a still-pending draft scoped to org + owning user."""
    doc = get_database()[COLLECTION].find_one(
        {
            "draft_id": draft_id,
            "org_id": org_id,
            "created_by": created_by,
            "status": "pending",
        }
    )
    if not doc:
        raise CopilotDraftNotFoundError(draft_id)
    return _to_response(doc) or {}


def resolve_draft(org_id: str, created_by: str, draft_id: str, status: DraftStatus) -> None:
    """Mark a pending draft confirmed/dismissed; no-op-safe against double-resolution."""
    result = get_database()[COLLECTION].update_one(
        {
            "draft_id": draft_id,
            "org_id": org_id,
            "created_by": created_by,
            "status": "pending",
        },
        {"$set": {"status": status, "updated_at": _now_iso()}},
    )
    if result.matched_count == 0:
        raise CopilotDraftNotFoundError(draft_id)
