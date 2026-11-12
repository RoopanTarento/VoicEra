"""SecurityAuditEvents: who touched which contact, how, and with what outcome.

Separate from the org activity log (``AuditLog``), whose contract and Copilot
tool stay unchanged. Records never contain phone numbers, ciphertext, keys or
secrets: ``metadata`` is passed through :func:`apps.pii.scrub_mapping` and
known-sensitive keys are dropped before insert.

Writes never raise into the caller — an audit failure is logged and the
protected operation continues, matching ``services/audit_log.py``. Denials
are written *before* the caller raises its error so they are never lost.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pymongo.database import Database

from app.config import get_settings
from app.database import get_database
from app.services.secure import request_context
from apps.pii import scrub_mapping

logger = logging.getLogger(__name__)

COLLECTION = "SecurityAuditEvents"

Outcome = Literal["success", "denied", "error"]
ActorType = Literal["user", "service", "system", "anonymous"]

# event_type -> category shown in the Audit Centre and the overview chart.
EVENT_CATEGORIES: dict[str, str] = {
    "contact.upload": "ingest",
    "contact.tokenize": "ingest",
    "contact.view": "data_access",
    "contact.export": "data_access",
    "contact.resolve": "resolution",
    "contact.bulk_resolve": "resolution",
    "contact.status_change": "lifecycle",
    "contact.delete": "lifecycle",
    "contact.purge": "lifecycle",
    "contact_set.create": "ingest",
    "contact_set.update": "lifecycle",
    "contact_set.delete": "lifecycle",
    "gateway.call": "telephony",
    "callback.sanitized": "telephony",
    "key.rotation": "key_management",
    "config.change": "configuration",
    "auth.failed": "authentication",
    "access.suspicious": "threat",
}

_FORBIDDEN_METADATA_KEYS = frozenset(
    {"ciphertext", "nonce", "phone", "phone_e164", "e164", "key", "secret", "token", "password"}
)
SUSPICIOUS_WINDOW = timedelta(minutes=5)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_indexes(db: Database | None = None) -> None:
    db = db if db is not None else get_database()
    events = db[COLLECTION]
    events.create_index("event_id", unique=True, name="event_id_unique")
    events.create_index([("org_id", 1), ("created_at", -1)], name="org_recent_index")
    events.create_index([("org_id", 1), ("event_type", 1), ("created_at", -1)], name="org_type_index")
    events.create_index([("org_id", 1), ("outcome", 1), ("created_at", -1)], name="org_outcome_index")
    events.create_index([("org_id", 1), ("contact_id", 1)], name="org_contact_index", sparse=True)


def _clean_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    kept = {k: v for k, v in metadata.items() if str(k).lower() not in _FORBIDDEN_METADATA_KEYS}
    return scrub_mapping(kept)


def record(
    event_type: str,
    *,
    org_id: str | None,
    actor_type: ActorType,
    actor_id: str | None,
    outcome: Outcome,
    action: str | None = None,
    contact_id: str | None = None,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
    actor_role: str | None = None,
) -> dict[str, Any]:
    """Append one security event and return it (without Mongo's ``_id``)."""
    now = _now()
    doc: dict[str, Any] = {
        "event_id": f"EVT-{uuid.uuid4().hex}",
        "org_id": org_id,
        "event_type": event_type,
        "category": EVENT_CATEGORIES.get(event_type, "other"),
        "action": action or event_type.split(".", 1)[-1],
        "actor": {"type": actor_type, "id": actor_id, "role": actor_role},
        "contact_id": contact_id,
        "outcome": outcome,
        "reason": reason,
        "correlation_id": request_context.correlation_id(),
        "source_ip": request_context.source_ip(),
        "metadata": _clean_metadata(metadata),
        "created_at": now.isoformat(),
    }
    try:
        get_database()[COLLECTION].insert_one(dict(doc))
    except Exception:
        logger.exception("Failed to write security audit event type=%s org=%s", event_type, org_id)
    if outcome == "denied" and event_type != "access.suspicious":
        _check_suspicious(org_id, actor_type, actor_id)
    return doc


def _check_suspicious(org_id: str | None, actor_type: str, actor_id: str | None) -> None:
    """Raise one ``access.suspicious`` event when an actor's denials cross the threshold."""
    threshold = max(1, int(get_settings().SECURE_DENIAL_ALERT_THRESHOLD))
    since = (_now() - SUSPICIOUS_WINDOW).isoformat()
    try:
        col = get_database()[COLLECTION]
        query = {
            "org_id": org_id,
            "actor.id": actor_id,
            "outcome": "denied",
            "created_at": {"$gte": since},
        }
        if col.count_documents(query) < threshold:
            return
        already = col.count_documents(
            {
                "org_id": org_id,
                "event_type": "access.suspicious",
                "actor.id": actor_id,
                "created_at": {"$gte": since},
            }
        )
        if already:
            return
    except Exception:
        logger.exception("Suspicious-access check failed org=%s", org_id)
        return
    record(
        "access.suspicious",
        org_id=org_id,
        actor_type=actor_type,  # type: ignore[arg-type]
        actor_id=actor_id,
        outcome="denied",
        action="repeated_denials",
        reason=f"{threshold}+ denied requests within {int(SUSPICIOUS_WINDOW.total_seconds() // 60)} minutes",
    )


def _to_response(doc: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    return out


def list_events(
    org_id: str,
    *,
    event_type: str | None = None,
    category: str | None = None,
    outcome: str | None = None,
    actor: str | None = None,
    contact_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Filtered, most-recent-first events for one org plus the total match count."""
    query: dict[str, Any] = {"org_id": org_id}
    if event_type:
        query["event_type"] = event_type
    if category:
        query["category"] = category
    if outcome:
        query["outcome"] = outcome
    if actor:
        query["actor.id"] = actor
    if contact_id:
        query["contact_id"] = contact_id
    if date_from or date_to:
        bounds: dict[str, str] = {}
        if date_from:
            bounds["$gte"] = date_from
        if date_to:
            bounds["$lte"] = date_to
        query["created_at"] = bounds
    col = get_database()[COLLECTION]
    total = col.count_documents(query)
    cursor = (
        col.find(query)
        .sort("created_at", -1)
        .skip(max(0, offset))
        .limit(max(1, min(limit, 500)))
    )
    return [_to_response(d) for d in cursor], total


def distinct_actors(org_id: str) -> list[str]:
    return sorted(
        a for a in get_database()[COLLECTION].distinct("actor.id", {"org_id": org_id}) if a
    )
