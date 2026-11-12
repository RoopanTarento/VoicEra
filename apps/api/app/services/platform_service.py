"""Platform (VoicEra operator) management of adopters.

Platform admins create adopters, suspend and reactivate them, rotate or
revoke their keys, and see platform-wide security events. Every view here is
aggregate or metadata: no phone numbers, masked or otherwise, and no access
to an adopter's contacts, calls or campaigns.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.auth import get_password_hash
from app.database import get_database
from app.database_init import ROLE_SUPER_ADMIN
from app.rbac import invalidate_cache
from app.services import org_service
from app.services.secure import insights, security_audit, tenant_keys
from app.services.secure import vault_repository as vault

logger = logging.getLogger(__name__)

STATUS_ACTIVE = "active"
STATUS_SUSPENDED = "suspended"
STATUS_OFFBOARDED = "offboarded"


class PlatformError(Exception):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(event_type: str, org_id: str, actor: str, *, action: str, outcome: str = "success", reason: str | None = None, metadata: dict[str, Any] | None = None) -> None:
    security_audit.record(
        event_type,
        org_id=org_id,
        actor_type="user",
        actor_id=actor,
        actor_role="platform_admin",
        outcome=outcome,  # type: ignore[arg-type]
        action=action,
        reason=reason,
        metadata={"via": "platform", **(metadata or {})},
    )


def _adopter_row(org: dict[str, Any]) -> dict[str, Any]:
    db = get_database()
    org_id = org["org_id"]
    counts = vault.counts(org_id)
    roles: dict[str, int] = {}
    for m in db["Memberships"].find({"org_id": org_id}, {"role": 1}):
        roles[str(m.get("role"))] = roles.get(str(m.get("role")), 0) + 1
    owners = [m["email"] for m in db["Memberships"].find({"org_id": org_id, "role": ROLE_SUPER_ADMIN}, {"email": 1})]
    return {
        "org_id": org_id,
        "name": org.get("name"),
        "status": org.get("status") or STATUS_ACTIVE,
        "status_reason": org.get("status_reason"),
        "created_at": org.get("created_at"),
        "created_by_email": org.get("created_by_email"),
        "owners": owners,
        "members": sum(roles.values()),
        "members_by_role": roles,
        "agents": db["Agents"].count_documents({"org_id": org_id}),
        "campaigns": db["Campaigns"].count_documents({"org_id": org_id}),
        "calls": db["CallLogs"].count_documents({"org_id": org_id}),
        "contacts_protected": counts["by_status"]["active"] + counts["by_status"]["inactive"],
        "encrypted_records": counts["encrypted"],
        "keys": tenant_keys.summary(org_id),
    }


def list_adopters() -> list[dict[str, Any]]:
    orgs = list(get_database()["Organizations"].find({}, {"_id": 0}).sort("created_at", -1))
    return [_adopter_row(o) for o in orgs]


def get_adopter(org_id: str) -> dict[str, Any]:
    org = org_service.get_organisation(org_id)
    if not org:
        raise PlatformError("Adopter not found", status_code=404)
    row = _adopter_row(org)
    events, _ = security_audit.list_events(org_id, limit=20)
    row["recent_security_events"] = events
    return row


def create_adopter(*, name: str, owner_email: str, owner_password: str | None, actor: str) -> dict[str, Any]:
    """Create an adopter organisation with its own keys and an owner account."""
    db = get_database()
    email = owner_email.strip().lower()
    user = db["Users"].find_one({"email": email})
    if not user and not owner_password:
        raise PlatformError("A first password is required for a new owner account")
    if db["Organizations"].find_one({"name": name}):
        raise PlatformError("An adopter with this name already exists", status_code=409)
    org = org_service.create_organisation(name=name, created_by_email=actor)
    org_id = org["org_id"]
    now = _now()
    db["Organizations"].update_one({"org_id": org_id}, {"$set": {"status": STATUS_ACTIVE}})
    if not user:
        db["Users"].insert_one(
            {"email": email, "password": get_password_hash(owner_password or ""), "created_at": now, "default_org_id": org_id}
        )
    db["Memberships"].insert_one({"email": email, "org_id": org_id, "role": ROLE_SUPER_ADMIN, "created_at": now})
    tenant_keys.provision(org_id)
    _audit("config.change", org_id, actor, action="adopter_created", metadata={"name": name, "owner": email})
    return get_adopter(org_id)


def set_status(org_id: str, *, status: str, reason: str | None, actor: str) -> dict[str, Any]:
    """Suspend or reactivate an adopter. Suspension blocks its users, keys and campaigns."""
    org = org_service.get_organisation(org_id)
    if not org:
        raise PlatformError("Adopter not found", status_code=404)
    if (org.get("status") or STATUS_ACTIVE) == STATUS_OFFBOARDED:
        raise PlatformError("This adopter was offboarded and its keys destroyed", status_code=409)
    if status not in (STATUS_ACTIVE, STATUS_SUSPENDED):
        raise PlatformError("status must be 'active' or 'suspended'")
    db = get_database()
    db["Organizations"].update_one(
        {"org_id": org_id}, {"$set": {"status": status, "status_reason": reason, "status_changed_at": _now()}}
    )
    tenant_keys.set_status(org_id, status)
    paused = 0
    if status == STATUS_SUSPENDED:
        result = db["Campaigns"].update_many(
            {"org_id": org_id, "state": {"$in": ["running", "syncing"]}},
            {"$set": {"state": "paused", "updated_at": _now()}},
        )
        paused = int(result.modified_count)
    invalidate_cache()
    _audit(
        "config.change", org_id, actor,
        action="adopter_suspended" if status == STATUS_SUSPENDED else "adopter_reactivated",
        reason=reason, metadata={"campaigns_paused": paused},
    )
    return get_adopter(org_id)


def rotate_key(org_id: str, *, actor: str) -> dict[str, Any]:
    if not org_service.get_organisation(org_id):
        raise PlatformError("Adopter not found", status_code=404)
    return insights.rotate_keys(org_id, actor_email=actor, actor_role="platform_admin")


def revoke_key(org_id: str, *, confirm_name: str, actor: str) -> dict[str, Any]:
    """Offboard an adopter: destroy its keys so every stored number becomes unreadable."""
    org = org_service.get_organisation(org_id)
    if not org:
        raise PlatformError("Adopter not found", status_code=404)
    if (org.get("status") or STATUS_ACTIVE) != STATUS_SUSPENDED:
        raise PlatformError("Suspend the adopter before revoking its keys", status_code=409)
    if confirm_name.strip() != str(org.get("name") or ""):
        raise PlatformError("Type the adopter's exact name to confirm")
    tenant_keys.revoke(org_id)
    db = get_database()
    erased = db[vault.CONTACTS].update_many(
        {"org_id": org_id, "status": {"$ne": vault.STATUS_DELETED}},
        {"$set": {"status": vault.STATUS_DELETED, "deleted_at": _now(), "attributes": {}}, "$unset": {"phone": "", "email": ""}},
    )
    db[vault.STAGING].delete_many({"org_id": org_id})
    db["Organizations"].update_one({"org_id": org_id}, {"$set": {"status": STATUS_OFFBOARDED, "status_changed_at": _now()}})
    invalidate_cache()
    _audit("key.rotation", org_id, actor, action="adopter_keys_revoked", metadata={"contacts_erased": int(erased.modified_count)})
    return get_adopter(org_id)


def rewrap_master(*, actor: str) -> dict[str, Any]:
    result = tenant_keys.rewrap_all()
    _audit("key.rotation", "platform", actor, action="master_key_rewrap", metadata=result)
    return result


def platform_events(*, event_type: str | None = None, outcome: str | None = None, org_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if event_type:
        query["event_type"] = event_type
    if outcome:
        query["outcome"] = outcome
    if org_id:
        query["org_id"] = org_id
    cursor = get_database()[security_audit.COLLECTION].find(query, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 500)))
    return list(cursor)
