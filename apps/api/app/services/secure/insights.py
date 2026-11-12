"""Read models for the Secure dashboard: overview metrics, health checks,
campaign protection status, settings, key rotation and retention.

Every number here is a query over the vault, the security audit trail, the
measured counters in ``SecureMetrics`` or existing campaign collections.
Nothing is estimated. The health indicator is the worst status among named
checks; there is no composite score.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.database import get_database
from app.services.secure import crypto, security_audit, tenant_keys
from app.services.secure import vault_repository as vault
from app.services.secure.keys import VaultKeyError, get_key_provider
from app.services.secure.service_identity import ServiceCredentialError, configured_services
from apps.pii.log_redaction import is_logging_redaction_installed

logger = logging.getLogger(__name__)

ORG_SETTINGS = "SecureOrgSettings"


def _find_env_example() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env.example"
        if candidate.is_file():
            return candidate
    return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _days(days: int) -> list[str]:
    today = _now().date()
    return [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]


# --- org policy -----------------------------------------------------------------


def get_org_policy(org_id: str) -> dict[str, Any]:
    s = get_settings()
    doc = get_database()[ORG_SETTINGS].find_one({"org_id": org_id}, {"_id": 0}) or {}
    return {
        "require_vault_campaigns": bool(doc.get("require_vault_campaigns", False)) or s.SECURE_ENFORCE_VAULT_CAMPAIGNS,
        "require_vault_campaigns_env": s.SECURE_ENFORCE_VAULT_CAMPAIGNS,
        "retention_days": int(doc.get("retention_days") or s.SECURE_CONTACT_RETENTION_DAYS),
        "updated_by": doc.get("updated_by"),
        "updated_at": doc.get("updated_at"),
    }


def update_org_policy(org_id: str, *, actor_email: str, actor_role: str | None, **changes: Any) -> dict[str, Any]:
    before = get_org_policy(org_id)
    patch = {k: v for k, v in changes.items() if v is not None}
    if not patch:
        return before
    patch.update({"updated_by": actor_email, "updated_at": _now().isoformat()})
    get_database()[ORG_SETTINGS].update_one({"org_id": org_id}, {"$set": patch}, upsert=True)
    after = get_org_policy(org_id)
    security_audit.record(
        "config.change",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success",
        metadata={
            "changed": {k: {"from": before.get(k), "to": after.get(k)} for k in changes if changes[k] is not None}
        },
    )
    return after


# --- overview ---------------------------------------------------------------------


def overview(org_id: str, *, days: int = 14) -> dict[str, Any]:
    days = max(7, min(days, 90))
    since = _now() - timedelta(days=days - 1)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0)
    day_keys = _days(days)
    counts = vault.counts(org_id)

    events_col = get_database()[security_audit.COLLECTION]
    window_events = list(
        events_col.find(
            {"org_id": org_id, "created_at": {"$gte": since.isoformat()}},
            {"_id": 0, "event_type": 1, "category": 1, "outcome": 1, "created_at": 1},
        )
    )
    resolve = [e for e in window_events if e["event_type"] == "contact.resolve"]
    access = [e for e in window_events if e["category"] in ("data_access", "resolution", "authentication")]

    by_day_res = {d: {"day": d, "granted": 0, "denied": 0} for d in day_keys}
    for e in resolve:
        day = e["created_at"][:10]
        if day in by_day_res:
            by_day_res[day]["granted" if e["outcome"] == "success" else "denied"] += 1

    by_category: dict[str, int] = {}
    for e in window_events:
        by_category[e["category"]] = by_category.get(e["category"], 0) + 1

    created = vault.created_per_day(org_id, since=since)
    running = vault.count_before(org_id, before=since)
    protection = []
    for d in day_keys:
        running += created.get(d, 0)
        protection.append({"day": d, "added": created.get(d, 0), "cumulative": running})

    measured: dict[str, int] = {}
    for row in vault.metrics_since(org_id, since=since):
        for k, v in row.items():
            if k not in ("org_id", "day") and isinstance(v, (int, float)):
                measured[k] = measured.get(k, 0) + int(v)
    all_time = {}
    for row in get_database()[vault.METRICS].find({"org_id": org_id}, {"_id": 0}):
        for k, v in row.items():
            if k not in ("org_id", "day") and isinstance(v, (int, float)):
                all_time[k] = all_time.get(k, 0) + int(v)

    recent, _ = security_audit.list_events(org_id, limit=8)
    return {
        "window_days": days,
        "totals": {
            "contacts_protected": counts["by_status"]["active"] + counts["by_status"]["inactive"],
            "contacts_tokenized": counts["total"],
            "contacts_deleted": counts["by_status"]["deleted"],
            "encrypted_records": counts["encrypted"],
            "resolution_requests": len(resolve),
            "resolutions_granted": sum(1 for e in resolve if e["outcome"] == "success"),
            "resolutions_denied": sum(1 for e in resolve if e["outcome"] != "success"),
            "access_granted": sum(1 for e in access if e["outcome"] == "success"),
            "access_denied": sum(1 for e in access if e["outcome"] == "denied"),
            "security_events": len(window_events),
            "suspicious_events": sum(1 for e in window_events if e["event_type"] == "access.suspicious"),
            "exposures_prevented": all_time.get("exposures_prevented", 0),
            "callbacks_sanitized": all_time.get("callbacks_sanitized", 0),
            "secure_calls": all_time.get("secure_calls", 0),
        },
        "window_measured": measured,
        "series": {
            "protection": protection,
            "resolutions": list(by_day_res.values()),
            "events_by_category": [
                {"category": k, "count": v} for k, v in sorted(by_category.items(), key=lambda kv: -kv[1])
            ],
        },
        "campaign_protection": campaign_protection_summary(org_id),
        "recent_events": recent,
        "health": health(org_id),
    }


# --- campaigns ----------------------------------------------------------------------


def campaign_protection(org_id: str) -> list[dict[str, Any]]:
    db = get_database()
    rows: list[dict[str, Any]] = []
    for c in db["Campaigns"].find({"org_id": org_id}, {"_id": 0, "logs": 0}).sort("created_at", -1):
        cid = c["campaign_id"]
        protected = c.get("source_type") == "secure_contacts"
        queued_total = db["QueuedRuns"].count_documents({"campaign_id": cid})
        plaintext_queue = db["QueuedRuns"].count_documents(
            {"campaign_id": cid, "context_variables.phone_number": {"$exists": True}}
        )
        calls_total = db["CallLogs"].count_documents({"org_id": org_id, "campaign_id": cid})
        calls_tokenised = db["CallLogs"].count_documents(
            {"org_id": org_id, "campaign_id": cid, "contact_id": {"$nin": [None, ""]}}
        )
        source = None
        if protected:
            source = vault.get_contact_set(org_id, str(c.get("source_id") or ""))
        rows.append(
            {
                "campaign_id": cid,
                "name": c.get("name"),
                "state": c.get("state"),
                "agent_id": c.get("agent_id"),
                "source_type": c.get("source_type") or "csv",
                "protected": protected,
                "contact_set": {"set_id": source.get("set_id"), "name": source.get("name"), "size": len(source.get("contact_ids") or [])} if source else None,
                "total_rows": int(c.get("total_rows") or 0),
                "processed_rows": int(c.get("processed_rows") or 0),
                "failed_rows": int(c.get("failed_rows") or 0),
                "queued_runs": queued_total,
                "plaintext_queue_entries": plaintext_queue,
                "calls": calls_total,
                "calls_tokenised": calls_tokenised,
                "created_at": c.get("created_at"),
            }
        )
    return rows


def campaign_protection_summary(org_id: str) -> dict[str, int]:
    rows = campaign_protection(org_id)
    return {
        "protected": sum(1 for r in rows if r["protected"]),
        "legacy": sum(1 for r in rows if not r["protected"]),
        "legacy_plaintext_queue_entries": sum(r["plaintext_queue_entries"] for r in rows),
    }


# --- health ---------------------------------------------------------------------------


def _check(check_id: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"id": check_id, "label": label, "status": status, "detail": detail}


def _example_values() -> set[str]:
    values: set[str] = set()
    path = _find_env_example()
    if path is None:
        return values
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                values.add(line.split("=", 1)[1].strip())
    except OSError:
        pass
    return {v for v in values if len(v) >= 16}


def health(org_id: str) -> dict[str, Any]:
    s = get_settings()
    checks: list[dict[str, str]] = []
    ring = None
    try:
        master = get_key_provider()
        checks.append(
            _check(
                "vault_keys",
                "Master key",
                "pass",
                f"{len(master.versions())} AES-256 master key version(s) loaded, active {master.active_version}",
            )
        )
        try:
            ring = tenant_keys.keyring(org_id)
            checks.append(
                _check(
                    "adopter_keys",
                    "This adopter's keys",
                    "pass",
                    f"Own data key and hash key, version {ring.active_version}, wrapped by the master key",
                )
            )
        except VaultKeyError as exc:
            checks.append(_check("adopter_keys", "This adopter's keys", "fail", str(exc)))
    except VaultKeyError as exc:
        checks.append(_check("vault_keys", "Master key", "fail", str(exc)))

    if ring is not None:
        counts = vault.counts(org_id)
        stale = sum(n for v, n in counts["by_key_version"].items() if v != ring.active_version)
        checks.append(
            _check(
                "key_coverage",
                "Records on the active key",
                "pass" if stale == 0 else "warn",
                "All encrypted records use the adopter's active key version"
                if stale == 0
                else f"{stale} record(s) still on an older key version; run rotation",
            )
        )

    checks.append(
        _check(
            "log_redaction",
            "Log redaction",
            "pass" if is_logging_redaction_installed() else "fail",
            "Phone numbers and emails are masked in API logs"
            if is_logging_redaction_installed()
            else "Redaction filter is not attached to the root log handlers",
        )
    )

    try:
        services = configured_services()
        checks.append(
            _check(
                "service_identities",
                "Service identities",
                "pass",
                f"{len(services)} external service identit{'y' if len(services) == 1 else 'ies'} configured; gateway uses an in-process identity",
            )
        )
    except ServiceCredentialError as exc:
        checks.append(_check("service_identities", "Service identities", "fail", str(exc)))

    examples = _example_values()
    reused = [
        name
        for name, value in (
            ("INTERNAL_API_KEY", s.INTERNAL_API_KEY),
            ("SECRET_KEY", s.SECRET_KEY),
            ("PROVIDER_AUTH_ENCRYPTION_KEY", s.PROVIDER_AUTH_ENCRYPTION_KEY),
            ("SECURE_VAULT_KEYS", s.SECURE_VAULT_KEYS),
        )
        if value and value in examples
    ]
    checks.append(
        _check(
            "example_secrets",
            "Secrets differ from .env.example",
            "fail" if reused else "pass",
            f"Still using published example values: {', '.join(reused)}" if reused else "No secret matches a value published in .env.example",
        )
    )

    db = get_database()
    legacy_queue = campaign_protection_summary(org_id)["legacy_plaintext_queue_entries"]
    raw_calls = db["CallLogs"].count_documents(
        {
            "org_id": org_id,
            "call_type": "outbound",
            "to_number": {"$regex": r"^\+?\d{7,15}$"},
        }
    )
    checks.append(
        _check(
            "legacy_plaintext",
            "Legacy plaintext numbers at rest",
            "pass" if not (legacy_queue or raw_calls) else "warn",
            "No plaintext contact numbers found in queues or call logs"
            if not (legacy_queue or raw_calls)
            else f"{legacy_queue} queued run(s) and {raw_calls} call log(s) from before VoicEra Secure hold plaintext numbers (masked in every API response)",
        )
    )

    policy = get_org_policy(org_id)
    checks.append(
        _check(
            "vault_campaign_policy",
            "Vault-only campaigns",
            "pass" if policy["require_vault_campaigns"] else "warn",
            "New campaigns must use vault contact sets"
            if policy["require_vault_campaigns"]
            else "Plain CSV campaigns are still allowed",
        )
    )

    from apps.telephony.providers.mock import is_mock_enabled

    checks.append(
        _check(
            "mock_provider",
            "Mock telephony provider",
            "warn" if is_mock_enabled() else "pass",
            "Enabled for local demos; disable TELEPHONY_MOCK_ENABLED in production"
            if is_mock_enabled()
            else "Disabled",
        )
    )

    worst = "pass"
    if any(c["status"] == "fail" for c in checks):
        worst = "fail"
    elif any(c["status"] == "warn" for c in checks):
        worst = "warn"
    label = {"pass": "Healthy", "warn": "Needs attention", "fail": "At risk"}[worst]
    return {"status": worst, "label": label, "checks": checks, "checked_at": _now().isoformat()}


# --- settings, rotation, retention --------------------------------------------------------


def settings_view(org_id: str) -> dict[str, Any]:
    s = get_settings()
    keyring: dict[str, Any] = {"configured": False}
    try:
        master = get_key_provider()
        ring = tenant_keys.keyring(org_id)
        counts = vault.counts(org_id)
        record = tenant_keys.summary(org_id)
        keyring = {
            "configured": True,
            "provider": master.name,
            "algorithm": crypto.ALGORITHM,
            "scope": "adopter",
            "status": record["status"],
            "active_version": ring.active_version,
            "master_active_version": master.active_version,
            "versions": [
                {
                    "version": v["version"],
                    "status": v["status"],
                    "fingerprint": ring.fingerprint(v["version"]) if v["status"] != "destroyed" else None,
                    "active": v["version"] == ring.active_version,
                    "records": counts["by_key_version"].get(v["version"], 0),
                    "master_version": v["master_version"],
                    "created_at": v["created_at"],
                }
                for v in record["versions"]
            ],
            "blind_index": "HMAC-SHA256 under this adopter's own hash key",
        }
    except VaultKeyError as exc:
        keyring = {"configured": False, "error": str(exc)}
    try:
        services = [{"service_id": i.service_id, "scopes": sorted(i.scopes)} for i in configured_services()]
    except ServiceCredentialError as exc:
        services = []
        keyring.setdefault("service_error", str(exc))
    from apps.telephony.providers.mock import is_mock_enabled

    return {
        "keyring": keyring,
        "policy": get_org_policy(org_id),
        "resolution": {
            "rate_limit_per_minute": s.SECURE_RESOLVE_RATE_LIMIT_PER_MINUTE,
            "denial_alert_threshold": s.SECURE_DENIAL_ALERT_THRESHOLD,
            "in_process_identity": "secure-telephony-gateway (contacts:resolve:dial)",
            "external_services": services,
        },
        "default_region": s.SECURE_DEFAULT_REGION,
        "mock_provider_enabled": is_mock_enabled(),
    }


def rotate_keys(org_id: str, *, actor_email: str, actor_role: str | None) -> dict[str, Any]:
    """Rotate this adopter's own keys: new version, re-encrypt and re-hash every record.

    Old versions stay decrypt-only until no record uses them, then their
    wrapped key material is destroyed.
    """
    previous = tenant_keys.keyring(org_id).active_version
    active = tenant_keys.add_version(org_id)
    rotated = 0
    failed = 0
    from_versions: dict[str, int] = {}
    while True:
        batch = [r for r in vault.records_needing_rotation(org_id, active) if r.get("contact_id")]
        if not batch:
            break
        progressed = 0
        for record in batch:
            cid = record["contact_id"]
            old_version = str(record.get("key_version"))
            try:
                phone = crypto.decrypt_value(record["phone"], org_id=org_id, contact_id=cid)
                fields: dict[str, Any] = {
                    "phone": crypto.encrypt_value(phone, org_id=org_id, contact_id=cid).to_doc(),
                    "phone_index": crypto.blind_index(org_id, phone),
                }
                if record.get("email"):
                    fields["email"] = crypto.reencrypt_value(
                        record["email"], org_id=org_id, contact_id=cid, field="email"
                    ).to_doc()
                del phone
            except (crypto.VaultDecryptionError, VaultKeyError):
                failed += 1
                vault.replace_encrypted_fields(org_id, cid, {}, f"unreadable:{old_version}")
                continue
            from_versions[old_version] = from_versions.get(old_version, 0) + 1
            vault.replace_encrypted_fields(org_id, cid, fields, active)
            rotated += 1
            progressed += 1
        if not progressed:
            break
    in_use = set(vault.counts(org_id)["by_key_version"])
    destroyed = tenant_keys.destroy_unused_versions(org_id, in_use)
    result = {
        "previous_version": previous,
        "active_version": active,
        "rotated": rotated,
        "failed": failed,
        "from_versions": from_versions,
        "destroyed_versions": destroyed,
    }
    security_audit.record(
        "key.rotation",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success" if not failed else "error",
        metadata=result,
    )
    return result


def purge_retention(org_id: str, *, actor_email: str, actor_role: str | None) -> dict[str, Any]:
    policy = get_org_policy(org_id)
    cutoff = _now() - timedelta(days=policy["retention_days"])
    purged = vault.purge_inactive(org_id, older_than=cutoff)
    staging = vault.purge_expired_staging()
    result = {"purged_contacts": len(purged), "expired_staging_rows": staging, "retention_days": policy["retention_days"]}
    security_audit.record(
        "contact.purge",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success",
        metadata=result,
    )
    return result
