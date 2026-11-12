"""Invitations: the Super admin or an Admin invites a person by email with a role.

The invite link carries a random token; only its SHA-256 is stored. The link
works once, for the invited email only, and expires after ``INVITE_TTL``.
Joining an organisation requires a valid invitation (the old open link that
used the organisation ID as the code let anyone who learnt the ID join).
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import settings
from app.database import get_database
from app.database_init import ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.rbac import ASSIGNABLE_ROLES, ROLES
from app.services import org_service

logger = logging.getLogger(__name__)

COLLECTION = "Invitations"
INVITE_TTL = timedelta(days=7)


class InvitationError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def invite_url(token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/signup?invite={token}"


def _public(doc: dict[str, Any]) -> dict[str, Any]:
    role = ROLES.get(str(doc.get("role")))
    return {
        "invite_id": doc["invite_id"],
        "email": doc["email"],
        "role": doc["role"],
        "role_label": role.label if role else doc["role"],
        "created_by": doc.get("created_by"),
        "created_at": doc.get("created_at"),
        "expires_at": doc.get("expires_at"),
        "email_sent": bool(doc.get("email_sent")),
    }


def create_invitation(org_id: str, *, email: str, role: str, caller_email: str, caller_role: str) -> tuple[dict[str, Any], str]:
    """Create (or replace) a pending invitation. Returns (invitation, raw token)."""
    if caller_role not in {ROLE_SUPER_ADMIN, ROLE_ADMIN}:
        raise InvitationError("Only the Super admin and Admins can invite people.", 403)
    if role not in ASSIGNABLE_ROLES:
        raise InvitationError(f"Unknown role: {role}")
    if role == ROLE_ADMIN and caller_role != ROLE_SUPER_ADMIN:
        raise InvitationError("Only the Super admin can invite Admins.", 403)
    org = org_service.get_organisation(org_id)
    if not org:
        raise InvitationError("Organisation not found", 404)
    db = get_database()
    from app.services.member_service import _find_user

    existing = _find_user(email)
    emails = {email, str(existing["email"])} if existing else {email}
    if db["Memberships"].find_one({"email": {"$in": sorted(emails)}, "org_id": org_id}):
        raise InvitationError("This person is already a member of your organisation.", 409)

    now = _now()
    db[COLLECTION].update_many(
        {"org_id": org_id, "email": email, "status": "pending"},
        {"$set": {"status": "replaced", "closed_at": now.isoformat()}},
    )
    token = secrets.token_urlsafe(32)
    doc = {
        "invite_id": f"INV-{secrets.token_hex(12)}",
        "org_id": org_id,
        "email": email,
        "role": role,
        "token_hash": _hash(token),
        "status": "pending",
        "created_by": caller_email,
        "created_at": now.isoformat(),
        "expires_at": (now + INVITE_TTL).isoformat(),
        "email_sent": False,
    }
    db[COLLECTION].insert_one(dict(doc))
    return _public(doc), token


def mark_email_sent(invite_id: str) -> None:
    get_database()[COLLECTION].update_one({"invite_id": invite_id}, {"$set": {"email_sent": True}})


def list_pending(org_id: str) -> list[dict[str, Any]]:
    now = _now().isoformat()
    cursor = (
        get_database()[COLLECTION]
        .find({"org_id": org_id, "status": "pending", "expires_at": {"$gt": now}}, {"_id": 0})
        .sort("created_at", -1)
    )
    return [_public(d) for d in cursor]


def revoke(org_id: str, invite_id: str) -> bool:
    result = get_database()[COLLECTION].update_one(
        {"org_id": org_id, "invite_id": invite_id, "status": "pending"},
        {"$set": {"status": "revoked", "closed_at": _now().isoformat()}},
    )
    return result.modified_count == 1


def find_valid(token: str) -> dict[str, Any] | None:
    """The pending, unexpired invitation for a raw token, or None."""
    if not token or len(token) > 200:
        return None
    doc = get_database()[COLLECTION].find_one({"token_hash": _hash(token), "status": "pending"}, {"_id": 0})
    if not doc or str(doc.get("expires_at") or "") <= _now().isoformat():
        return None
    return doc


def lookup(token: str) -> dict[str, Any] | None:
    """What the join page shows before the person sets a password."""
    doc = find_valid(token)
    if not doc:
        return None
    org = org_service.get_organisation(doc["org_id"]) or {}
    return {
        **_public(doc),
        "org_id": doc["org_id"],
        "org_name": org.get("name") or org.get("organisation_name") or doc["org_id"],
    }


def mark_accepted(invite_id: str, email: str) -> None:
    get_database()[COLLECTION].update_one(
        {"invite_id": invite_id},
        {"$set": {"status": "accepted", "accepted_at": _now().isoformat(), "accepted_by": email}},
    )
