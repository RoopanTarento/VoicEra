"""Sign-in protection: lockout after repeated failures, and auditing.

Failures are stored in ``LoginAttempts`` (shared by every API process) and
expire after the window. Five failures for one email, or 20 from one IP,
within 15 minutes lock that email or IP out for the rest of the window. A
successful sign-in clears the email's failures. Every failure and lockout is
written to the security audit trail (visible in the platform audit).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.database import get_database

logger = logging.getLogger(__name__)

COLLECTION = "LoginAttempts"
WINDOW = timedelta(minutes=15)
MAX_PER_EMAIL = 5
MAX_PER_IP = 20


class LoginLocked(Exception):
    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        minutes = max(1, round(retry_after_seconds / 60))
        super().__init__(
            f"Too many failed sign-in attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}."
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_indexes() -> None:
    col = get_database()[COLLECTION]
    col.create_index([("key", 1), ("at", -1)], name="key_recent_index")
    col.create_index("at", name="at_index")


def _recent(key: str) -> list[str]:
    since = (_now() - WINDOW).isoformat()
    cursor = get_database()[COLLECTION].find({"key": key, "at": {"$gte": since}}, {"at": 1}).sort("at", 1)
    return [d["at"] for d in cursor]


def check(email: str, ip: str | None) -> None:
    """Raise LoginLocked when the email or IP is over its failure budget."""
    budgets = [(f"email:{email}", MAX_PER_EMAIL)]
    if ip:
        budgets.append((f"ip:{ip}", MAX_PER_IP))
    for key, limit in budgets:
        attempts = _recent(key)
        if len(attempts) >= limit:
            oldest = datetime.fromisoformat(attempts[-limit])
            retry = int((oldest + WINDOW - _now()).total_seconds())
            raise LoginLocked(max(retry, 30))


def record_failure(email: str, ip: str | None, *, reason: str) -> None:
    now = _now().isoformat()
    docs = [{"key": f"email:{email}", "at": now}]
    if ip:
        docs.append({"key": f"ip:{ip}", "at": now})
    try:
        get_database()[COLLECTION].insert_many(docs)
        # Old rows are never read again; trim opportunistically.
        get_database()[COLLECTION].delete_many({"at": {"$lt": (_now() - WINDOW).isoformat()}})
    except Exception:
        logger.exception("Failed to record sign-in failure")
    _audit(email, reason=reason, action="login_failed")


def record_lockout(email: str, ip: str | None) -> None:
    _audit(email, reason="Sign-in locked after repeated failures", action="login_locked")


def clear(email: str) -> None:
    try:
        get_database()[COLLECTION].delete_many({"key": f"email:{email}"})
    except Exception:
        logger.exception("Failed to clear sign-in failures")


def _audit(email: str, *, reason: str, action: str) -> None:
    from app.services.secure import security_audit

    from app.services.user_service import find_user  # local import: user_service imports this module

    org_id = None
    try:
        org_id = (find_user(email) or {}).get("default_org_id")
    except Exception:
        logger.exception("Couldn't resolve the adopter for a failed sign-in")
    security_audit.record(
        "auth.failed",
        org_id=org_id,
        actor_type="anonymous",
        actor_id=email,
        outcome="denied",
        action=action,
        reason=reason,
    )
