"""Secure resolution: the only path from a contact ID back to a phone number.

Checks run in this order, and each outcome is audited:

1. The caller is an authenticated service identity whose scope covers the
   purpose (users can never resolve).
2. The contact exists *in the caller's organisation*. A contact in another
   org is reported exactly like a missing one, so IDs cannot be probed.
3. The contact is active (inactive and deleted contacts cannot be dialled).
4. The service is within its per-organisation rate limit.
5. The ciphertext authenticates and decrypts.

The number is returned wrapped in :class:`ResolvedNumber`, whose ``str`` and
``repr`` are masked, so it cannot leak through logging or string formatting.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Any

from app.config import get_settings
from app.services.secure import crypto, security_audit
from app.services.secure import vault_repository as vault
from app.services.secure.keys import VaultKeyError
from app.services.secure.service_identity import ServiceIdentity
from app.services.secure.tokenization import is_contact_id
from apps.pii import mask_phone

logger = logging.getLogger(__name__)

PURPOSES = frozenset({"dial"})

# Denial reason codes. NOT_FOUND covers both "missing" and "other organisation".
DENY_UNAUTHENTICATED = "unauthenticated"
DENY_SCOPE = "scope_not_granted"
DENY_NOT_FOUND = "contact_not_found"
DENY_INACTIVE = "contact_inactive"
DENY_DELETED = "contact_deleted"
DENY_RATE_LIMIT = "rate_limited"
DENY_BAD_REQUEST = "invalid_request"
DENY_INTEGRITY = "integrity_failure"
DENY_KEYS = "vault_unavailable"


class ResolutionDenied(Exception):
    def __init__(self, reason: str, message: str) -> None:
        self.reason = reason
        self.message = message
        super().__init__(message)


class ResolvedNumber:
    """A decrypted number that refuses to print itself."""

    __slots__ = ("_value", "contact_id")

    def __init__(self, value: str, contact_id: str) -> None:
        self._value = value
        self.contact_id = contact_id

    def reveal(self) -> str:
        """The raw E.164 number. Pass it straight to the dial call; never store it."""
        return self._value

    @property
    def masked(self) -> str:
        return mask_phone(self._value)

    def __repr__(self) -> str:
        return f"ResolvedNumber(contact_id={self.contact_id!r}, masked={self.masked!r})"

    __str__ = __repr__

    def __reduce__(self):  # pragma: no cover - defensive
        raise TypeError("ResolvedNumber cannot be pickled")


class SlidingWindowRateLimiter:
    """Thread-safe per-key sliding window (per process).

    One API process runs the dispatcher in the PoC; a multi-replica deployment
    would move this to the existing Redis rate limiter.
    """

    def __init__(self, window_seconds: float = 60.0) -> None:
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


rate_limiter = SlidingWindowRateLimiter()


def _deny(
    reason: str,
    message: str,
    *,
    org_id: str | None,
    contact_id: str | None,
    actor_type: str,
    actor_id: str | None,
    purpose: str,
) -> ResolutionDenied:
    security_audit.record(
        "contact.resolve",
        org_id=org_id,
        actor_type=actor_type,  # type: ignore[arg-type]
        actor_id=actor_id,
        outcome="denied",
        contact_id=contact_id if contact_id and is_contact_id(contact_id) else None,
        reason=reason,
        metadata={"purpose": purpose},
    )
    vault.increment_metric(org_id or "", "resolutions_denied")
    return ResolutionDenied(reason, message)


def deny_user(org_id: str, contact_id: str, *, user_email: str, role: str | None) -> ResolutionDenied:
    """Record and return the denial for a human user's resolve attempt."""
    security_audit.record(
        "contact.resolve",
        org_id=org_id,
        actor_type="user",
        actor_id=user_email,
        actor_role=role,
        outcome="denied",
        contact_id=contact_id if is_contact_id(contact_id) else None,
        reason=DENY_UNAUTHENTICATED,
        metadata={"detail": "User sessions cannot resolve contact numbers"},
    )
    vault.increment_metric(org_id, "resolutions_denied")
    return ResolutionDenied(DENY_UNAUTHENTICATED, "Contact resolution requires an authorised service identity")


def resolve_contact(
    *,
    org_id: str,
    contact_id: str,
    identity: ServiceIdentity | None,
    purpose: str = "dial",
    metadata: dict[str, Any] | None = None,
) -> ResolvedNumber:
    """Return the decrypted number for an authorised purpose, or raise ResolutionDenied."""
    actor_id = identity.service_id if identity else None
    common = {"org_id": org_id, "contact_id": contact_id, "actor_type": "service", "actor_id": actor_id, "purpose": purpose}

    if identity is None:
        raise _deny(DENY_UNAUTHENTICATED, "Service identity required", **common)
    if purpose not in PURPOSES or not identity.allows(purpose):
        raise _deny(DENY_SCOPE, f"Service '{identity.service_id}' may not resolve for '{purpose}'", **common)
    if not org_id or not is_contact_id(contact_id):
        raise _deny(DENY_BAD_REQUEST, "A valid org_id and contact ID are required", **common)

    record = vault.get_encrypted_phone(org_id, contact_id)
    if not record:
        raise _deny(DENY_NOT_FOUND, "Contact not found", **common)
    status = record.get("status")
    if status == vault.STATUS_DELETED or not record.get("phone"):
        raise _deny(DENY_DELETED, "Contact has been deleted", **common)
    if status != vault.STATUS_ACTIVE:
        raise _deny(DENY_INACTIVE, "Contact is not active", **common)

    limit = max(1, int(get_settings().SECURE_RESOLVE_RATE_LIMIT_PER_MINUTE))
    if not rate_limiter.allow(f"{identity.service_id}:{org_id}", limit):
        raise _deny(DENY_RATE_LIMIT, "Resolution rate limit exceeded", **common)

    try:
        value = crypto.decrypt_value(record["phone"], org_id=org_id, contact_id=contact_id)
    except crypto.VaultDecryptionError:
        raise _deny(DENY_INTEGRITY, "Contact record failed integrity check", **common) from None
    except VaultKeyError:
        raise _deny(DENY_KEYS, "Vault key for this record is not available", **common) from None

    vault.mark_resolved(org_id, contact_id)
    vault.increment_metric(org_id, "resolutions_granted")
    security_audit.record(
        "contact.resolve",
        org_id=org_id,
        actor_type="service",
        actor_id=identity.service_id,
        outcome="success",
        contact_id=contact_id,
        metadata={"purpose": purpose, **(metadata or {})},
    )
    return ResolvedNumber(value, contact_id)
