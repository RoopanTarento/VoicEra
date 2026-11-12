"""Org-wide activity log: who created, updated, or deleted what, and when.

Written from routers right after a mutation actually succeeds (never
speculatively), so an entry existing always means the action really happened.
Read by GET /audit-log and by the Copilot's list_recent_activity tool.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from app.database import get_database
from app.utils.mongo_utils import prepare_mongo_response

logger = logging.getLogger(__name__)

COLLECTION = "AuditLog"

EntityType = Literal[
    "agent",
    "campaign",
    "knowledge_document",
    "phone_number",
    "member",
    "provider_auth",
]

Action = Literal[
    "created",
    "updated",
    "deleted",
    "started",
    "paused",
    "resumed",
    "linked",
    "unlinked",
    "invited",
    "invitation_revoked",
    "joined",
    "removed",
    "role_changed",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_response(doc: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_mongo_response(doc) or {}
    prepared.pop("_id", None)
    return prepared


def record(
    org_id: str,
    *,
    entity_type: EntityType,
    action: Action,
    actor_email: str,
    entity_id: str | None = None,
    entity_name: str | None = None,
    actor_role: str | None = None,
    detail: str | None = None,
) -> dict[str, Any]:
    """Append one activity entry. Never raises — a logging failure must not
    fail the mutation it's describing, so errors are swallowed and logged."""
    doc = {
        "log_id": str(uuid.uuid4()),
        "org_id": org_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "action": action,
        "actor_email": actor_email,
        "actor_role": actor_role,
        "detail": detail,
        "created_at": _now_iso(),
    }
    try:
        get_database()[COLLECTION].insert_one(dict(doc))
    except Exception:
        logger.exception("Failed to write audit log entry org=%s entity=%s", org_id, entity_type)
    return _to_response(doc)


def list_events(
    org_id: str,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    actor_email: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Most-recent-first activity for this org, optionally narrowed."""
    query: dict[str, Any] = {"org_id": org_id}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    if actor_email:
        query["actor_email"] = actor_email

    limit = max(1, min(limit, 200))
    cursor = get_database()[COLLECTION].find(query).sort("created_at", -1).limit(limit)
    return [_to_response(doc) for doc in cursor]
