"""Sign in with a one-time code sent by email; the account is created on first sign-in.

- A 6-digit code, stored only as a keyed hash, valid for ``CODE_TTL`` and for
  ``MAX_ATTEMPTS`` guesses. Asking again replaces the previous code.
- At most ``MAX_SENDS_PER_EMAIL`` codes per email and ``MAX_SENDS_PER_IP`` per
  IP in ``SEND_WINDOW``, so the endpoint can't be used to flood inboxes.
- Requesting a code never says whether an account exists.
- First sign-in for a new email creates the user and a workspace named after
  the email's domain, with them as its Super admin (the same as signing up).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import settings
from app.database import get_database
from app.database_init import ROLE_SUPER_ADMIN
from app.rbac import effective_role
from app.services import email_service, login_guard, org_service, user_service

logger = logging.getLogger(__name__)

COLLECTION = "LoginCodes"
CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
SEND_WINDOW = timedelta(minutes=15)
MAX_SENDS_PER_EMAIL = 5
MAX_SENDS_PER_IP = 20
SENT_MESSAGE = "If that address can receive email, a sign-in code is on its way. It expires in 10 minutes."


class CodeError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(email: str, code: str) -> str:
    key = (settings.SECRET_KEY or "").encode()
    return hmac.new(key, f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def _normalise(email: str) -> str:
    email = (email or "").strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@") or len(email) > 254:
        raise CodeError("Enter a valid work email.")
    return email


_indexes_ready = False


def _collection():
    global _indexes_ready
    col = get_database()[COLLECTION]
    if not _indexes_ready:
        col.create_index([("kind", 1), ("email", 1)], name="kind_email_index")
        col.create_index("expires_at", name="expires_ttl", expireAfterSeconds=0)
        col.create_index("at", name="at_ttl", expireAfterSeconds=int(SEND_WINDOW.total_seconds()))
        _indexes_ready = True
    return col


def request_code(email: str, ip: str | None) -> dict[str, str]:
    email = _normalise(email)
    col = _collection()
    since = _now() - SEND_WINDOW
    if col.count_documents({"kind": "send", "email": email, "at": {"$gte": since}}) >= MAX_SENDS_PER_EMAIL or (
        ip and col.count_documents({"kind": "send", "ip": ip, "at": {"$gte": since}}) >= MAX_SENDS_PER_IP
    ):
        raise CodeError("Too many codes requested. Wait 15 minutes and try again.", status_code=429)
    if not email_service.email_configured():
        raise CodeError("Email sign-in isn't set up on this server. Sign in with your password instead.", status_code=503)

    code = f"{secrets.randbelow(1_000_000):06d}"
    col.delete_many({"kind": "code", "email": email})
    col.insert_one(
        {"kind": "code", "email": email, "code_hash": _hash(email, code), "attempts": 0, "expires_at": _now() + CODE_TTL}
    )
    col.insert_one({"kind": "send", "email": email, "ip": ip, "at": _now()})
    if not email_service.send_login_code_email(email, code):
        raise CodeError("Couldn't send the code just now. Try again in a minute.", status_code=502)
    return {"status": "success", "message": SENT_MESSAGE}


def _workspace_name(email: str) -> str:
    return email.split("@", 1)[1][:80] or "My workspace"


def _create_account(email: str) -> dict[str, Any]:
    now = _now().isoformat()
    org = org_service.create_organisation(name=_workspace_name(email), created_by_email=email)
    db = get_database()
    db["Users"].insert_one({"email": email, "created_at": now, "default_org_id": org["org_id"], "last_logged_in_at": now})
    db["Memberships"].insert_one({"email": email, "org_id": org["org_id"], "role": ROLE_SUPER_ADMIN, "created_at": now})
    logger.info("Account created by email code sign-in org=%s", org["org_id"])
    return user_service.auth_response_for_membership(
        email, org["org_id"], ROLE_SUPER_ADMIN, message="Account created", is_first_login=True
    )


def verify_code(email: str, code: str, ip: str | None) -> dict[str, Any]:
    email = _normalise(email)
    code = (code or "").strip().replace(" ", "")
    try:
        login_guard.check(email, ip)
    except login_guard.LoginLocked as exc:
        raise CodeError(str(exc), status_code=429) from exc

    col = _collection()
    doc = col.find_one({"kind": "code", "email": email})
    expires = (doc or {}).get("expires_at")
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if not doc or expires is None or expires < _now() or doc.get("attempts", 0) >= MAX_ATTEMPTS:
        raise CodeError("That code has expired. Ask for a new one.")
    if not (code.isdigit() and len(code) == 6 and hmac.compare_digest(doc["code_hash"], _hash(email, code))):
        col.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
        login_guard.record_failure(email, ip, reason="Wrong sign-in code")
        raise CodeError("That code isn't right. Check the email and try again.")
    col.delete_one({"_id": doc["_id"]})
    login_guard.clear(email)

    user = user_service.find_user(email)
    if not user:
        return _create_account(email)
    email = str(user["email"])
    active, reason = user_service._resolve_active_membership(email, user)
    if not active:
        raise CodeError(reason or "Your account has no active workspace.", status_code=403)
    role = effective_role(active.get("role", "member"))
    is_first = user.get("last_logged_in_at") is None
    return user_service.auth_response_for_membership(
        email, active["org_id"], role, message="Signed in", is_first_login=is_first
    )
