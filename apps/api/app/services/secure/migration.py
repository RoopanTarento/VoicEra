"""Migrate plaintext numbers written before VoicEra Secure.

* ``QueuedRuns.context_variables.phone_number`` -> hashed + encrypted under
  the adopter's key; the run keeps only ``contact_id`` (the dispatcher dials
  it through the secure gateway).
* ``CallLogs`` contact numbers and custom variables -> masked; outbound calls
  are linked to the protected contact.
* Legacy campaign CSVs in object storage are listed, and deleted only when
  asked to.

Dry run by default: counts what would change and writes nothing.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from app.database import get_database
from app.services.secure import contact_ingest
from app.services.secure.masking import mask_call_log
from app.services.secure.phone import InvalidPhoneNumberError, normalize_phone
from apps.pii import looks_like_phone, scrub_mapping

logger = logging.getLogger(__name__)

ACTOR = "legacy-migration"


def _org_by_campaign() -> dict[str, str]:
    return {c["campaign_id"]: c["org_id"] for c in get_database()["Campaigns"].find({}, {"campaign_id": 1, "org_id": 1})}


def migrate_queued_runs(*, apply: bool) -> dict[str, int]:
    db = get_database()
    orgs = _org_by_campaign()
    pending: dict[str, list[dict[str, Any]]] = defaultdict(list)
    stats = {"queued_runs_with_numbers": 0, "protected": 0, "unparseable": 0, "orphaned": 0}
    for run in db["QueuedRuns"].find({"context_variables.phone_number": {"$exists": True}}):
        stats["queued_runs_with_numbers"] += 1
        org_id = orgs.get(run.get("campaign_id"))
        if not org_id:
            stats["orphaned"] += 1
            continue
        try:
            phone = normalize_phone(str(run["context_variables"]["phone_number"]))
        except InvalidPhoneNumberError:
            stats["unparseable"] += 1
            continue
        pending[org_id].append({"run": run, "e164": phone.e164})
    if not apply:
        stats["protected"] = sum(len(v) for v in pending.values())
        return stats
    for org_id, items in pending.items():
        ids = contact_ingest.protect_numbers(
            org_id, [{"e164": i["e164"]} for i in items], actor_email=ACTOR, source={"legacy_migration": "queued_runs"}
        )
        for item, contact_id in zip(items, ids):
            context = {k: v for k, v in item["run"]["context_variables"].items() if k != "phone_number"}
            context = scrub_mapping(context)
            context["contact_id"] = contact_id
            db["QueuedRuns"].update_one({"_id": item["run"]["_id"]}, {"$set": {"context_variables": context}})
            stats["protected"] += 1
    return stats


def migrate_call_logs(*, apply: bool) -> dict[str, int]:
    db = get_database()
    stats = {"call_logs_scanned": 0, "call_logs_masked": 0, "outbound_linked": 0}
    for doc in db["CallLogs"].find({}):
        stats["call_logs_scanned"] += 1
        masked, replaced = mask_call_log(doc)
        if not replaced:
            continue
        stats["call_logs_masked"] += 1
        if not apply:
            continue
        patch: dict[str, Any] = {
            "to_number": masked.get("to_number"),
            "from_number": masked.get("from_number"),
            "custom_variables": masked.get("custom_variables") or {},
            "error_message": masked.get("error_message"),
        }
        raw_to = doc.get("to_number")
        if doc.get("call_type") == "outbound" and not doc.get("contact_id") and looks_like_phone(raw_to):
            contact_id = contact_ingest.protect_number(
                doc["org_id"], str(raw_to), actor_email=ACTOR, source={"legacy_migration": "call_logs"}
            )
            if contact_id:
                patch["contact_id"] = contact_id
                stats["outbound_linked"] += 1
        db["CallLogs"].update_one({"_id": doc["_id"]}, {"$set": patch})
    return stats


def legacy_csv_objects() -> list[dict[str, str]]:
    cursor = get_database()["Campaigns"].find(
        {"$or": [{"source_type": "csv"}, {"source_type": {"$exists": False}}], "source_id": {"$regex": "^campaigns/"}},
        {"campaign_id": 1, "org_id": 1, "source_id": 1},
    )
    return [{"campaign_id": c["campaign_id"], "org_id": c["org_id"], "object": c["source_id"]} for c in cursor]


def run(*, apply: bool) -> dict[str, Any]:
    return {
        "applied": apply,
        "queued_runs": migrate_queued_runs(apply=apply),
        "call_logs": migrate_call_logs(apply=apply),
        "legacy_csv_objects": legacy_csv_objects(),
    }
