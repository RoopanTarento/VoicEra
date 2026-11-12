"""Service identities allowed to resolve contact IDs.

Two kinds:

* In-process identities (the secure telephony gateway) are constructed in code
  and passed to the resolution service directly; they never travel over HTTP.
* HTTP callers present ``X-Service-Id`` and ``X-Service-Key`` matching an entry
  in ``SECURE_SERVICE_CREDENTIALS`` (``service_id|scope+scope|secret``). These
  are separate from ``INTERNAL_API_KEY`` and from user JWTs, which can never
  resolve a contact.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass, field

from app.config import get_settings

SCOPE_RESOLVE_DIAL = "contacts:resolve:dial"
SCOPE_RESOLVE = "contacts:resolve"
KNOWN_SCOPES = frozenset({SCOPE_RESOLVE_DIAL, SCOPE_RESOLVE})
MIN_SECRET_LENGTH = 32


@dataclass(frozen=True)
class ServiceIdentity:
    service_id: str
    scopes: frozenset[str] = field(default_factory=frozenset)
    in_process: bool = False

    def allows(self, purpose: str) -> bool:
        """``dial`` needs the dial scope or the general resolve scope."""
        if SCOPE_RESOLVE in self.scopes:
            return True
        return purpose == "dial" and SCOPE_RESOLVE_DIAL in self.scopes


SECURE_GATEWAY_IDENTITY = ServiceIdentity(
    service_id="secure-telephony-gateway",
    scopes=frozenset({SCOPE_RESOLVE_DIAL}),
    in_process=True,
)


class ServiceCredentialError(ValueError):
    """SECURE_SERVICE_CREDENTIALS is malformed."""


@dataclass(frozen=True)
class _Credential:
    identity: ServiceIdentity
    secret: str


def _parse_credentials(raw: str) -> dict[str, _Credential]:
    out: dict[str, _Credential] = {}
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        pieces = part.split("|", 2)
        if len(pieces) != 3:
            raise ServiceCredentialError("Entries must look like 'service_id|scope+scope|secret'")
        service_id, scopes_raw, secret = (p.strip() for p in pieces)
        scopes = frozenset(s for s in scopes_raw.split("+") if s)
        unknown = scopes - KNOWN_SCOPES
        if not service_id or not scopes or unknown:
            raise ServiceCredentialError(f"Invalid scopes for service '{service_id}'")
        if len(secret) < MIN_SECRET_LENGTH:
            raise ServiceCredentialError(
                f"Secret for service '{service_id}' must be at least {MIN_SECRET_LENGTH} characters"
            )
        out[service_id] = _Credential(ServiceIdentity(service_id, scopes), secret)
    return out


def configured_services() -> list[ServiceIdentity]:
    return [c.identity for c in _parse_credentials(get_settings().SECURE_SERVICE_CREDENTIALS).values()]


def authenticate_service(service_id: str | None, secret: str | None) -> ServiceIdentity | None:
    """Return the identity when id and secret match, else None (constant-time compare)."""
    if not service_id or not secret:
        return None
    try:
        creds = _parse_credentials(get_settings().SECURE_SERVICE_CREDENTIALS)
    except ServiceCredentialError:
        return None
    cred = creds.get(service_id.strip())
    # Compare against a dummy when the id is unknown so timing does not reveal it.
    expected = cred.secret if cred else "x" * MIN_SECRET_LENGTH
    ok = hmac.compare_digest(expected.encode("utf-8"), secret.encode("utf-8"))
    return cred.identity if (cred and ok) else None
