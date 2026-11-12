"""ContactVault persistence (``SecureContacts`` and companion collections).

Every query is scoped by ``org_id``. Public read helpers return a *safe view*
built by :func:`to_safe_view`, which has no ciphertext, nonce or blind index.
The encrypted payload is read only by :func:`get_encrypted_phone`, which is
used exclusively by the resolution service and key rotation.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import ReturnDocument
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.database import get_database
from app.services.secure.tokenization import generate_contact_id

logger = logging.getLogger(__name__)

CONTACTS = "SecureContacts"
STAGING = "SecureContactStaging"
BATCHES = "SecureContactBatches"
CONTACT_SETS = "SecureContactSets"
METRICS = "SecureMetrics"

STATUS_ACTIVE = "active"
STATUS_INACTIVE = "inactive"
STATUS_DELETED = "deleted"
CONTACT_STATUSES = (STATUS_ACTIVE, STATUS_INACTIVE, STATUS_DELETED)

STAGING_TTL = timedelta(hours=24)

_SAFE_FIELDS = (
    "contact_id",
    "org_id",
    "display_name",
    "masked_phone",
    "masked_email",
    "country_code",
    "region",
    "attributes",
    "key_version",
    "status",
    "synthetic",
    "source",
    "created_by",
    "created_at",
    "updated_at",
    "deleted_at",
    "last_resolved_at",
    "resolution_count",
)


class ContactNotFoundError(Exception):
    def __init__(self, contact_id: str) -> None:
        self.contact_id = contact_id
        super().__init__(f"Contact not found: {contact_id}")


class DuplicateContactError(Exception):
    """A contact with the same normalised number already exists in the org."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def ensure_indexes(db: Database | None = None) -> None:
    db = db if db is not None else get_database()
    contacts = db[CONTACTS]
    contacts.create_index("contact_id", unique=True, name="contact_id_unique")
    # Deleted records get a tombstone index value so the number can be re-added.
    contacts.create_index([("org_id", 1), ("phone_index", 1)], unique=True, name="org_phone_index_unique")
    contacts.create_index([("org_id", 1), ("status", 1), ("created_at", -1)], name="org_status_index")
    contacts.create_index([("org_id", 1), ("key_version", 1)], name="org_key_version_index")
    db[STAGING].create_index([("batch_id", 1), ("row", 1)], unique=True, name="batch_row_unique")
    db[STAGING].create_index("expires_at", name="expires_index")
    db[BATCHES].create_index("batch_id", unique=True, name="batch_id_unique")
    db[BATCHES].create_index([("org_id", 1), ("created_at", -1)], name="org_recent_index")
    db[CONTACT_SETS].create_index("set_id", unique=True, name="set_id_unique")
    db[METRICS].create_index([("org_id", 1), ("day", 1)], unique=True, name="org_day_unique")


def to_safe_view(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    view = {k: doc.get(k) for k in _SAFE_FIELDS if k in doc}
    view["encrypted"] = bool(doc.get("phone"))
    view["encryption_algorithm"] = (doc.get("phone") or {}).get("alg")
    return view


# --- contacts -----------------------------------------------------------------


def insert_contact_with_builder(builder, *, max_id_attempts: int = 3) -> dict[str, Any]:
    """Insert ``builder(contact_id)``, retrying only on contact-ID collisions."""
    collection = get_database()[CONTACTS]
    for _ in range(max_id_attempts):
        contact_id = generate_contact_id()
        record = builder(contact_id)
        try:
            collection.insert_one(dict(record))
            return record
        except DuplicateKeyError as exc:
            details = str(getattr(exc, "details", None) or exc)
            if "phone_index" in details:
                raise DuplicateContactError() from exc
            continue
    raise RuntimeError("Could not allocate a unique contact ID")


def find_active_by_index(org_id: str, phone_index: str) -> dict[str, Any] | None:
    doc = get_database()[CONTACTS].find_one(
        {"org_id": org_id, "phone_index": phone_index},
        {"contact_id": 1, "status": 1},
    )
    return doc


def existing_indexes(org_id: str, indexes: list[str]) -> dict[str, str]:
    """Map blind-index value -> contact_id for indexes already in the org's vault."""
    if not indexes:
        return {}
    cursor = get_database()[CONTACTS].find(
        {"org_id": org_id, "phone_index": {"$in": indexes}},
        {"phone_index": 1, "contact_id": 1},
    )
    return {d["phone_index"]: d["contact_id"] for d in cursor}


def count_contacts(org_id: str) -> int:
    return get_database()[CONTACTS].count_documents({"org_id": org_id})


def get_contact(org_id: str, contact_id: str) -> dict[str, Any]:
    doc = get_database()[CONTACTS].find_one({"org_id": org_id, "contact_id": contact_id})
    if not doc:
        raise ContactNotFoundError(contact_id)
    return to_safe_view(doc) or {}


def get_encrypted_phone(org_id: str, contact_id: str) -> dict[str, Any] | None:
    """Raw vault record including ciphertext. Resolution and rotation only."""
    return get_database()[CONTACTS].find_one({"org_id": org_id, "contact_id": contact_id})


def list_contacts(
    org_id: str,
    *,
    status: str | None = None,
    search: str | None = None,
    batch_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    query: dict[str, Any] = {"org_id": org_id}
    if status:
        query["status"] = status
    else:
        query["status"] = {"$ne": STATUS_DELETED}
    if batch_id:
        query["source.batch_id"] = batch_id
    if search:
        term = search.strip()
        if term.upper().startswith("CNT-"):
            query["contact_id"] = {"$regex": f"^{_escape(term.lower().replace('cnt-', 'CNT-', 1))}"}
        elif term.isdigit() and len(term) <= 4:
            query["masked_phone"] = {"$regex": f"{term}$"}
        else:
            query["display_name"] = {"$regex": _escape(term), "$options": "i"}
    col = get_database()[CONTACTS]
    total = col.count_documents(query)
    cursor = col.find(query).sort("created_at", -1).skip(max(0, offset)).limit(max(1, min(limit, 500)))
    return [to_safe_view(d) or {} for d in cursor], total


def _escape(value: str) -> str:
    return re.escape(value)


def active_contact_ids(org_id: str, contact_ids: list[str]) -> list[str]:
    cursor = get_database()[CONTACTS].find(
        {"org_id": org_id, "contact_id": {"$in": contact_ids}, "status": STATUS_ACTIVE},
        {"contact_id": 1},
    )
    found = {d["contact_id"] for d in cursor}
    return [c for c in contact_ids if c in found]


def all_active_contact_ids(org_id: str, *, batch_id: str | None = None) -> list[str]:
    query: dict[str, Any] = {"org_id": org_id, "status": STATUS_ACTIVE}
    if batch_id:
        query["source.batch_id"] = batch_id
    return [d["contact_id"] for d in get_database()[CONTACTS].find(query, {"contact_id": 1}).sort("created_at", 1)]


def safe_views_for(org_id: str, contact_ids: list[str]) -> dict[str, dict[str, Any]]:
    cursor = get_database()[CONTACTS].find({"org_id": org_id, "contact_id": {"$in": contact_ids}})
    return {d["contact_id"]: to_safe_view(d) or {} for d in cursor}


def set_status(org_id: str, contact_id: str, status: str) -> dict[str, Any]:
    if status not in (STATUS_ACTIVE, STATUS_INACTIVE):
        raise ValueError("status must be 'active' or 'inactive'")
    doc = get_database()[CONTACTS].find_one_and_update(
        {"org_id": org_id, "contact_id": contact_id, "status": {"$ne": STATUS_DELETED}},
        {"$set": {"status": status, "updated_at": _now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise ContactNotFoundError(contact_id)
    return to_safe_view(doc) or {}


def erase_contact(org_id: str, contact_id: str) -> dict[str, Any]:
    """Crypto-shred: drop ciphertext and blind index, keep a masked tombstone."""
    now = _now_iso()
    doc = get_database()[CONTACTS].find_one_and_update(
        {"org_id": org_id, "contact_id": contact_id, "status": {"$ne": STATUS_DELETED}},
        {
            "$set": {
                "status": STATUS_DELETED,
                "phone_index": f"deleted:{contact_id}",
                "deleted_at": now,
                "updated_at": now,
                "attributes": {},
            },
            "$unset": {"phone": "", "email": ""},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise ContactNotFoundError(contact_id)
    return to_safe_view(doc) or {}


def purge_inactive(org_id: str, *, older_than: datetime) -> list[str]:
    """Erase inactive contacts whose last update is older than ``older_than``."""
    cursor = get_database()[CONTACTS].find(
        {"org_id": org_id, "status": STATUS_INACTIVE, "updated_at": {"$lt": older_than.isoformat()}},
        {"contact_id": 1},
    )
    ids = [d["contact_id"] for d in cursor]
    for cid in ids:
        try:
            erase_contact(org_id, cid)
        except ContactNotFoundError:
            pass
    return ids


def mark_resolved(org_id: str, contact_id: str) -> None:
    get_database()[CONTACTS].update_one(
        {"org_id": org_id, "contact_id": contact_id},
        {"$set": {"last_resolved_at": _now_iso()}, "$inc": {"resolution_count": 1}},
    )


def records_needing_rotation(org_id: str, active_version: str, *, limit: int = 500) -> list[dict[str, Any]]:
    cursor = get_database()[CONTACTS].find(
        {"org_id": org_id, "phone": {"$exists": True}, "key_version": {"$ne": active_version}}
    ).limit(limit)
    return list(cursor)


def replace_encrypted_fields(org_id: str, contact_id: str, fields: dict[str, Any], key_version: str) -> None:
    get_database()[CONTACTS].update_one(
        {"org_id": org_id, "contact_id": contact_id},
        {"$set": {**fields, "key_version": key_version, "updated_at": _now_iso()}},
    )


def counts(org_id: str) -> dict[str, Any]:
    col = get_database()[CONTACTS]
    by_status = {s: col.count_documents({"org_id": org_id, "status": s}) for s in CONTACT_STATUSES}
    encrypted = col.count_documents({"org_id": org_id, "phone": {"$exists": True}})
    by_version: dict[str, int] = {}
    for row in col.aggregate(
        [
            {"$match": {"org_id": org_id, "phone": {"$exists": True}}},
            {"$group": {"_id": "$key_version", "count": {"$sum": 1}}},
        ]
    ):
        by_version[str(row["_id"])] = int(row["count"])
    return {
        "total": sum(by_status.values()),
        "by_status": by_status,
        "encrypted": encrypted,
        "by_key_version": by_version,
    }


def created_per_day(org_id: str, *, since: datetime) -> dict[str, int]:
    out: dict[str, int] = {}
    cursor = get_database()[CONTACTS].find(
        {"org_id": org_id, "created_at": {"$gte": since.isoformat()}}, {"created_at": 1}
    )
    for d in cursor:
        day = str(d.get("created_at") or "")[:10]
        out[day] = out.get(day, 0) + 1
    return out


def count_before(org_id: str, *, before: datetime) -> int:
    return get_database()[CONTACTS].count_documents(
        {"org_id": org_id, "created_at": {"$lt": before.isoformat()}}
    )


# --- staging and batches --------------------------------------------------------


def save_batch(batch: dict[str, Any]) -> None:
    get_database()[BATCHES].insert_one(dict(batch))


def get_batch(org_id: str, batch_id: str) -> dict[str, Any] | None:
    doc = get_database()[BATCHES].find_one({"org_id": org_id, "batch_id": batch_id})
    if doc:
        doc.pop("_id", None)
    return doc


def update_batch(batch_id: str, **fields: Any) -> None:
    get_database()[BATCHES].update_one({"batch_id": batch_id}, {"$set": fields})


def list_batches(org_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    cursor = get_database()[BATCHES].find({"org_id": org_id}, {"_id": 0, "rows": 0}).sort("created_at", -1).limit(limit)
    return list(cursor)


def stage_rows(rows: list[dict[str, Any]]) -> None:
    if rows:
        get_database()[STAGING].insert_many([dict(r) for r in rows])


def staged_rows(batch_id: str) -> list[dict[str, Any]]:
    return list(get_database()[STAGING].find({"batch_id": batch_id}).sort("row", 1))


def delete_staging(batch_id: str) -> int:
    return int(get_database()[STAGING].delete_many({"batch_id": batch_id}).deleted_count)


def purge_expired_staging() -> int:
    return int(
        get_database()[STAGING].delete_many({"expires_at": {"$lt": _now_iso()}}).deleted_count
    )


# --- contact sets (campaign sources) -------------------------------------------


def create_contact_set(doc: dict[str, Any]) -> dict[str, Any]:
    get_database()[CONTACT_SETS].insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "_id"}


def list_contact_sets(org_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
    """Recent contact sets with their size (member IDs omitted)."""
    cursor = (
        get_database()[CONTACT_SETS]
        .find({"org_id": org_id, "deleted_at": {"$exists": False}}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    return [
        {**{k: v for k, v in d.items() if k not in ("contact_ids", "members")}, "size": len(d.get("contact_ids") or [])}
        for d in cursor
    ]


def get_contact_set(org_id: str, set_id: str) -> dict[str, Any] | None:
    """Full contact set, including per-row variables (internal use only)."""
    doc = get_database()[CONTACT_SETS].find_one(
        {"org_id": org_id, "set_id": set_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    )
    return doc


# --- measured counters -----------------------------------------------------------


def increment_metric(org_id: str, field: str, amount: int = 1) -> None:
    if amount <= 0 or not org_id:
        return
    day = _now().date().isoformat()
    try:
        get_database()[METRICS].update_one(
            {"org_id": org_id, "day": day},
            {"$inc": {field: amount}},
            upsert=True,
        )
    except Exception:
        logger.exception("Failed to increment secure metric %s", field)


def metrics_since(org_id: str, *, since: datetime) -> list[dict[str, Any]]:
    cursor = get_database()[METRICS].find(
        {"org_id": org_id, "day": {"$gte": since.date().isoformat()}}, {"_id": 0}
    ).sort("day", 1)
    return list(cursor)
