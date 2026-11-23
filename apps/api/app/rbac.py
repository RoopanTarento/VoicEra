"""Role-based access control and tenant (adopter) enforcement.

Every adopter is a VoicEra organisation. People belong to adopters through
``Memberships`` with one role; VoicEra operators can additionally be
*platform admins*, who manage adopters but get no access to an adopter's data
unless they are also a member of it.

Enforcement is central: :func:`authorize` is attached to every router in
``main.py`` and looks the matched route up in :data:`ROUTE_POLICY`. A route
that is not in the table is refused (fail closed), and a test asserts every
registered route has an entry. For tenant permissions the caller's role is
re-read from ``Memberships`` (cached briefly) rather than trusted from the
JWT, so removing someone or changing their role takes effect within
``_CACHE_TTL`` seconds, and requests for a suspended adopter are refused.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.security import HTTPBearer

from app.auth import verify_token
from app.config import get_settings

logger = logging.getLogger(__name__)

BOT_SERVICE_EMAIL = "bot@voicera.internal"

# --- permission catalogue ------------------------------------------------------------

PERMISSIONS: dict[str, str] = {
    "copilot:use": "Use the Agent Builder copilot",
    "agents:read": "View agents",
    "agents:write": "Create and edit agents",
    "agents:delete": "Delete agents",
    "knowledge:read": "View knowledge base",
    "knowledge:write": "Upload and delete knowledge documents",
    "numbers:read": "View the organisation's caller IDs",
    "numbers:write": "Attach and detach caller IDs",
    "integrations:read": "View provider integrations",
    "integrations:write": "Change provider credentials",
    "lists:read": "See contact lists (names and counts, numbers masked)",
    "contacts:write": "Upload, rename and delete contact lists",
    "contacts:read": "Browse the contact vault (numbers masked)",
    "contacts:delete": "Erase a contact (right to erasure)",
    "contacts:export": "Export contacts and campaign source files (masked)",
    "campaigns:read": "View campaigns and their progress",
    "campaigns:write": "Create, edit and delete campaigns",
    "campaigns:run": "Start, pause, resume and redial campaigns",
    "campaigns:export": "Download campaign reports (masked)",
    "calls:read": "View call history (numbers masked)",
    "calls:test": "Make browser test calls to an agent",
    "calls:dial": "Call a typed phone number or a single contact",
    "calls:update": "Update call records (used by the voice runtime)",
    "recordings:read": "Play recordings, read transcripts and full call analysis",
    "analytics:read": "View analytics and campaign results",
    "telemetry:read": "View telemetry (latency and AI usage)",
    "gateway:read": "View the secure gateway dial log",
    "members:read": "See who is in the organisation",
    "members:write": "Invite members, change roles and remove members",
    "audit:read": "View activity and security audit logs",
    "security:read": "View data-protection overview and security settings",
    "security:write": "Change security policy, rotate adopter keys, run retention",
    "org:delete": "Delete the organisation",
    "platform:manage": "Manage adopters across the platform",
}

_ALL_TENANT = frozenset(p for p in PERMISSIONS if not p.startswith("platform:"))

# Only the Owner handles phone numbers: uploading lists, creating campaigns
# from them, dialling a typed number and erasing contacts. Nobody sees a full
# number in VoicEra; the Owner is simply the one person who brings them in.
_OWNER_ONLY = frozenset(
    {"contacts:write", "contacts:delete", "contacts:export", "campaigns:write", "calls:dial", "security:write", "org:delete"}
)

_MEMBER = frozenset(
    {"agents:read", "knowledge:read", "numbers:read", "campaigns:read", "calls:read", "analytics:read", "members:read"}
)


@dataclass(frozen=True)
class Role:
    id: str
    label: str
    description: str
    permissions: frozenset[str]
    assignable: bool = True


ROLES: dict[str, Role] = {
    "super_admin": Role(
        "super_admin", "Super admin",
        "Controls the organisation and is the only person who handles phone numbers: uploads contact lists and creates campaigns.",
        _ALL_TENANT, assignable=False,
    ),
    "admin": Role(
        "admin", "Admin",
        "Runs the platform (people, agents, numbers, integrations) and campaigns, but never handles phone numbers.",
        _ALL_TENANT - _OWNER_ONLY,
    ),
    "campaign_manager": Role(
        "campaign_manager", "Campaign manager",
        "Runs campaigns day to day (start, pause, redial) and reviews calls and results.",
        _MEMBER | {
            "lists:read", "campaigns:run", "campaigns:export", "calls:test", "recordings:read",
            "telemetry:read", "gateway:read",
        },
    ),
    "member": Role(
        "member", "Viewer",
        "View only: sees agents, campaigns, call history and dashboards, and can't change anything.",
        _MEMBER,
    ),
}

# Roles removed in the four-role model; memberships holding them are moved to
# "member" at startup (see migrate_legacy_roles).
LEGACY_ROLES = frozenset({"agent_builder", "analyst", "auditor"})

# How the role table is shown in the dashboard (Roles & permissions page and
# the role picker): area -> rows of (what the person can do, permission).
PERMISSION_MATRIX: list[dict[str, Any]] = [
    {"area": "Build", "rows": [
        ("Use the Agent Builder copilot", "copilot:use"),
        ("View agents", "agents:read"),
        ("Create and edit agents", "agents:write"),
        ("Delete agents", "agents:delete"),
        ("Test an agent in the browser", "calls:test"),
        ("Call a typed phone number", "calls:dial"),
        ("View caller IDs", "numbers:read"),
        ("Attach and detach caller IDs", "numbers:write"),
        ("View knowledge base", "knowledge:read"),
        ("Upload and delete knowledge documents", "knowledge:write"),
    ]},
    {"area": "Campaigns and contacts", "rows": [
        ("Upload, rename and delete contact lists", "contacts:write"),
        ("See contact lists (masked)", "lists:read"),
        ("Create, edit and delete campaigns", "campaigns:write"),
        ("Start, pause, resume and redial campaigns", "campaigns:run"),
        ("View campaigns and progress", "campaigns:read"),
        ("Download campaign reports (masked)", "campaigns:export"),
    ]},
    {"area": "Results", "rows": [
        ("Call history (masked numbers)", "calls:read"),
        ("Recordings, transcripts and full call analysis", "recordings:read"),
        ("Analytics and campaign results", "analytics:read"),
        ("Telemetry (latency and AI usage)", "telemetry:read"),
    ]},
    {"area": "Security and data protection", "rows": [
        ("Data-protection overview and settings", "security:read"),
        ("Browse the contact vault (masked)", "contacts:read"),
        ("Erase a contact", "contacts:delete"),
        ("Export contacts (masked)", "contacts:export"),
        ("Secure gateway dial log", "gateway:read"),
        ("Audit logs", "audit:read"),
        ("Change security settings and rotate keys", "security:write"),
    ]},
    {"area": "Workspace", "rows": [
        ("See who is in the organisation", "members:read"),
        ("Invite members, change roles, remove members", "members:write"),
        ("View integrations", "integrations:read"),
        ("Change provider keys", "integrations:write"),
        ("Delete the organisation", "org:delete"),
    ]},
]

ASSIGNABLE_ROLES = frozenset(r.id for r in ROLES.values() if r.assignable)


def effective_role(role: str | None) -> str | None:
    """A stored role as it applies now: retired roles count as ``member``."""
    if role is None:
        return None
    return "member" if str(role) in LEGACY_ROLES else str(role)


def migrate_legacy_roles() -> int:
    """Move memberships on roles that no longer exist to ``member`` (view only)."""
    result = _db()["Memberships"].update_many(
        {"role": {"$in": sorted(LEGACY_ROLES)}},
        {"$set": {"role": "member", "role_migrated_from_legacy": True}},
    )
    if result.modified_count:
        logger.info("RBAC: moved %d membership(s) from retired roles to member", result.modified_count)
        invalidate_cache()
    return int(result.modified_count)


def permissions_for(role: str | None) -> frozenset[str]:
    found = ROLES.get(str(role or ""))
    return found.permissions if found else frozenset()


def has_permission(role: str | None, permission: str) -> bool:
    return permission in permissions_for(role)


# --- route policy ----------------------------------------------------------------------

PUBLIC = "public"            # no authentication (login, signup, password reset)
SERVICE = "service"          # authenticated inside the handler (API key or service key)
AUTHENTICATED = "authenticated"  # any signed-in user, no tenant permission
PLATFORM = "platform:manage"

_P = "/api/v1"

ROUTE_POLICY: dict[tuple[str, str], str] = {
    # users and session
    ("POST", f"{_P}/users/signup"): PUBLIC,
    ("POST", f"{_P}/users/login"): PUBLIC,
    ("POST", f"{_P}/users/forgot-password"): PUBLIC,
    ("POST", f"{_P}/users/reset-password"): PUBLIC,
    ("GET", f"{_P}/users/check/{{email}}"): PUBLIC,
    ("POST", f"{_P}/users/bot/token"): SERVICE,
    ("POST", f"{_P}/users/switch-organisation"): AUTHENTICATED,
    ("GET", f"{_P}/users/organisations"): AUTHENTICATED,
    ("GET", f"{_P}/users/me"): AUTHENTICATED,
    ("GET", f"{_P}/users/{{email}}"): "members:read",
    ("GET", f"{_P}/rbac/me"): AUTHENTICATED,
    ("GET", f"{_P}/rbac/roles"): AUTHENTICATED,
    # members and organisation
    ("POST", f"{_P}/members/invite"): "members:write",
    ("POST", f"{_P}/members/join"): PUBLIC,
    ("POST", f"{_P}/members/invitations"): "members:write",
    ("GET", f"{_P}/members/invitations"): "members:write",
    ("DELETE", f"{_P}/members/invitations/{{invite_id}}"): "members:write",
    ("GET", f"{_P}/members/invitations/lookup/{{token}}"): PUBLIC,
    # public agent preview (rate-limited in app/services/try_agent.py)
    ("GET", f"{_P}/try/catalogue"): PUBLIC,
    ("POST", f"{_P}/try/agent"): PUBLIC,
    ("POST", f"{_P}/try/chat"): PUBLIC,
    ("GET", f"{_P}/members/{{org_id}}"): "members:read",
    ("POST", f"{_P}/members/assign-admin"): "members:write",
    ("POST", f"{_P}/members/remove"): "members:write",
    ("PATCH", f"{_P}/members/role"): "members:write",
    ("DELETE", f"{_P}/organisations/{{org_id}}"): "org:delete",
    # catalogues
    ("GET", f"{_P}/languages"): AUTHENTICATED,
    **{("GET", f"{_P}/configuration/{k}"): AUTHENTICATED for k in ("stt", "tts", "llm", "telephony")},
    **{("GET", f"{_P}/configuration/{k}/setting/{{provider}}"): AUTHENTICATED for k in ("stt", "tts", "llm", "telephony")},
    # integrations (provider credentials)
    ("GET", f"{_P}/auth/catalog"): "integrations:read",
    ("GET", f"{_P}/auth/catalog/{{provider}}"): "integrations:read",
    ("GET", f"{_P}/auth/configured"): "integrations:read",
    ("GET", f"{_P}/auth/{{provider}}"): "integrations:read",
    ("POST", f"{_P}/auth"): "integrations:write",
    ("DELETE", f"{_P}/auth/{{provider}}"): "integrations:write",
    # agents
    ("GET", f"{_P}/agents"): "agents:read",
    ("POST", f"{_P}/agents"): "agents:write",
    ("GET", f"{_P}/agents/by-phone/{{phone_number}}"): "agents:read",
    ("GET", f"{_P}/agents/{{agent_id}}"): "agents:read",
    ("PATCH", f"{_P}/agents/{{agent_id}}"): "agents:write",
    ("DELETE", f"{_P}/agents/{{agent_id}}"): "agents:delete",
    ("POST", f"{_P}/agents/{{agent_id}}/text-chat"): "agents:write",
    # agent use cases (scheme and survey catalogue)
    ("GET", f"{_P}/use-cases"): "agents:read",
    ("POST", f"{_P}/use-cases/preset"): "agents:write",
    ("GET", f"{_P}/use-cases/knowledge/{{scheme_id}}"): "knowledge:read",
    ("POST", f"{_P}/use-cases/schemes"): "agents:write",
    ("DELETE", f"{_P}/use-cases/schemes/{{scheme_id}}"): "agents:write",
    # knowledge
    ("GET", f"{_P}/knowledge"): "knowledge:read",
    ("POST", f"{_P}/knowledge/upload"): "knowledge:write",
    ("DELETE", f"{_P}/knowledge/{{document_id}}"): "knowledge:write",
    ("GET", f"{_P}/knowledge/{{document_id}}/preview"): "knowledge:read",
    ("POST", f"{_P}/rag/retrieve"): SERVICE,
    # phone numbers (the organisation's own caller IDs)
    ("GET", f"{_P}/phone-numbers"): "numbers:read",
    ("GET", f"{_P}/phone-numbers/agent/{{agent_id}}"): "numbers:read",
    ("POST", f"{_P}/phone-numbers/attach"): "numbers:write",
    ("DELETE", f"{_P}/phone-numbers/detach"): "numbers:write",
    ("GET", f"{_P}/phone-numbers/providers/{{provider}}/inventory"): "numbers:read",
    ("GET", f"{_P}/phone-numbers/activity"): "numbers:read",
    ("DELETE", f"{_P}/phone-numbers/remove"): "numbers:write",
    # calls
    ("POST", f"{_P}/calls/outbound"): "calls:dial",
    ("POST", f"{_P}/calls/inbound"): "calls:update",
    ("POST", f"{_P}/calls/outbound/register"): "calls:update",
    ("GET", f"{_P}/calls/by-provider-sid/{{provider_call_sid}}"): SERVICE,
    ("POST", f"{_P}/calls/web"): "calls:test",
    ("PATCH", f"{_P}/calls/by-provider-sid/{{provider_call_sid}}"): "calls:update",
    ("PATCH", f"{_P}/calls/{{call_id}}"): "calls:update",
    ("GET", f"{_P}/calls/{{call_id}}"): "calls:read",
    ("GET", f"{_P}/calls/{{call_id}}/metrics"): "telemetry:read",
    ("PUT", f"{_P}/calls/{{call_id}}/metrics"): "calls:update",
    ("GET", f"{_P}/calls/{{call_id}}/recording"): "recordings:read",
    ("GET", f"{_P}/calls/{{call_id}}/provider-recording"): "recordings:read",
    ("GET", f"{_P}/calls/{{call_id}}/transcript"): "recordings:read",
    ("POST", f"{_P}/calls/{{call_id}}/analyze"): "recordings:read",
    ("GET", f"{_P}/calls/org/{{org_id}}"): "calls:read",
    ("GET", f"{_P}/calls/org/{{org_id}}/analytics"): "analytics:read",
    # campaigns
    # contact lists (only the Owner handles phone numbers)
    ("GET", f"{_P}/contact-lists"): "lists:read",
    ("POST", f"{_P}/contact-lists"): "contacts:write",
    ("GET", f"{_P}/contact-lists/rules"): "lists:read",
    ("GET", f"{_P}/contact-lists/{{list_id}}"): "lists:read",
    ("PATCH", f"{_P}/contact-lists/{{list_id}}"): "contacts:write",
    ("DELETE", f"{_P}/contact-lists/{{list_id}}"): "contacts:write",
    ("GET", f"{_P}/campaign/"): "campaigns:read",
    ("POST", f"{_P}/campaign/upload"): "contacts:write",
    ("POST", f"{_P}/campaign/create"): "campaigns:write",
    ("GET", f"{_P}/campaign/insights"): "analytics:read",
    ("POST", f"{_P}/campaign/{{campaign_id}}/duplicate"): "campaigns:write",
    ("GET", f"{_P}/campaign/{{campaign_id}}"): "campaigns:read",
    ("PATCH", f"{_P}/campaign/{{campaign_id}}"): "campaigns:write",
    ("DELETE", f"{_P}/campaign/{{campaign_id}}"): "campaigns:write",
    ("POST", f"{_P}/campaign/{{campaign_id}}/start"): "campaigns:run",
    ("POST", f"{_P}/campaign/{{campaign_id}}/pause"): "campaigns:run",
    ("POST", f"{_P}/campaign/{{campaign_id}}/resume"): "campaigns:run",
    ("POST", f"{_P}/campaign/{{campaign_id}}/redial"): "campaigns:run",
    ("GET", f"{_P}/campaign/{{campaign_id}}/runs"): "campaigns:read",
    ("GET", f"{_P}/campaign/{{campaign_id}}/progress"): "campaigns:read",
    ("GET", f"{_P}/campaign/{{campaign_id}}/report"): "campaigns:export",
    ("GET", f"{_P}/campaign/{{campaign_id}}/obd-report"): "campaigns:export",
    ("GET", f"{_P}/campaign/{{campaign_id}}/obd-status"): "campaigns:read",
    ("GET", f"{_P}/campaign/{{campaign_id}}/analytics"): "analytics:read",
    ("GET", f"{_P}/campaign/{{campaign_id}}/source-download-url"): "contacts:export",
    ("POST", f"{_P}/campaign/internal/call-status"): SERVICE,
    # copilot
    **{
        (m, f"{_P}/copilot/{path}"): "copilot:use"
        for m, path in (
            ("POST", "chat"), ("POST", "improve-prompt"), ("POST", "attachments"),
            ("GET", "attachments/{attachment_id}"), ("GET", "conversations"),
            ("GET", "conversations/{conversation_id}"), ("DELETE", "conversations/{conversation_id}"),
            ("POST", "conversations/{conversation_id}/truncate"), ("POST", "agent-drafts/{draft_id}/dismiss"),
            ("POST", "campaign-drafts/{draft_id}/dismiss"), ("POST", "voice/session"),
            ("POST", "voice/session/{session_id}/end"), ("GET", "voice/session/{session_id}/bundle"),
            ("POST", "voice/session/{session_id}/tool"), ("POST", "voice/session/{session_id}/turn"),
        )
    },
    ("POST", f"{_P}/copilot/agent-drafts/{{draft_id}}/confirm"): "agents:write",
    ("POST", f"{_P}/copilot/campaign-drafts/{{draft_id}}/confirm"): "campaigns:write",
    # activity log
    ("GET", f"{_P}/audit-log"): "audit:read",
    # VoicEra Secure
    ("POST", f"{_P}/secure/contacts/upload"): "contacts:write",
    ("POST", f"{_P}/secure/contacts/tokenize"): "contacts:write",
    ("GET", f"{_P}/secure/contacts/batches"): "contacts:read",
    ("GET", f"{_P}/secure/contacts"): "contacts:read",
    ("GET", f"{_P}/secure/contacts/export"): "contacts:export",
    ("GET", f"{_P}/secure/contacts/{{contact_id}}"): "contacts:read",
    ("POST", f"{_P}/secure/contacts/{{contact_id}}/status"): "contacts:delete",
    ("DELETE", f"{_P}/secure/contacts/{{contact_id}}"): "contacts:delete",
    ("POST", f"{_P}/secure/contacts/retention/purge"): "security:write",
    ("POST", f"{_P}/secure/contacts/{{contact_id}}/resolve"): SERVICE,
    ("POST", f"{_P}/secure/contact-sets"): "contacts:write",
    ("GET", f"{_P}/secure/campaigns"): "security:read",
    ("POST", f"{_P}/secure/gateway/calls"): "calls:dial",
    ("GET", f"{_P}/secure/gateway/activity"): "gateway:read",
    ("GET", f"{_P}/secure/overview"): "security:read",
    ("GET", f"{_P}/secure/audit"): "audit:read",
    ("GET", f"{_P}/secure/settings"): "security:read",
    ("PATCH", f"{_P}/secure/settings"): "security:write",
    ("POST", f"{_P}/secure/settings/rotate-keys"): "security:write",
    # platform (VoicEra operators)
    ("GET", f"{_P}/platform/adopters"): PLATFORM,
    ("POST", f"{_P}/platform/adopters"): PLATFORM,
    ("GET", f"{_P}/platform/adopters/{{org_id}}"): PLATFORM,
    ("POST", f"{_P}/platform/adopters/{{org_id}}/status"): PLATFORM,
    ("POST", f"{_P}/platform/adopters/{{org_id}}/rotate-key"): PLATFORM,
    ("POST", f"{_P}/platform/adopters/{{org_id}}/revoke-key"): PLATFORM,
    ("POST", f"{_P}/platform/master-key/rewrap"): PLATFORM,
    ("GET", f"{_P}/platform/audit"): PLATFORM,
}


# --- membership, adopter status and platform role (cached) ---------------------------------

_CACHE_TTL = 15.0
_cache: dict[tuple[str, ...], tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def _cached(key: tuple[str, ...], loader):
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL:
            return hit[1]
    value = loader()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _db():
    from app.database import get_database

    return get_database()


def membership_role(email: str, org_id: str) -> str | None:
    def load() -> str | None:
        doc = _db()["Memberships"].find_one({"email": email, "org_id": org_id}, {"role": 1})
        return effective_role(str(doc["role"])) if doc else None

    return _cached(("membership", email, org_id), load)


def adopter_status(org_id: str) -> str:
    def load() -> str:
        doc = _db()["Organizations"].find_one({"org_id": org_id}, {"status": 1})
        if not doc:
            return "missing"
        return str(doc.get("status") or "active")

    return _cached(("org", org_id), load)


def is_platform_admin(email: str | None) -> bool:
    if not email:
        return False
    configured = {e.strip().lower() for e in get_settings().PLATFORM_ADMIN_EMAILS.split(",") if e.strip()}
    if email.lower() in configured:
        return True

    def load() -> bool:
        doc = _db()["Users"].find_one({"email": email}, {"platform_role": 1})
        return bool(doc and doc.get("platform_role") == "platform_admin")

    return bool(_cached(("platform", email), load))


# --- enforcement -----------------------------------------------------------------------------

_bearer = HTTPBearer(auto_error=False)


def _deny(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail, headers={"WWW-Authenticate": "Bearer"} if code == 401 else None)


def _record_denial(payload: dict[str, Any], permission: str, method: str, path: str, reason: str) -> None:
    try:
        from app.services.secure import security_audit

        security_audit.record(
            "auth.failed",
            org_id=payload.get("org_id"),
            actor_type="user",
            actor_id=str(payload.get("sub") or ""),
            actor_role=str(payload.get("role") or ""),
            outcome="denied",
            action="permission_denied",
            reason=reason,
            metadata={"permission": permission, "method": method, "route": path},
        )
    except Exception:
        logger.exception("Failed to record RBAC denial")


async def authorize(request: Request) -> None:
    """Router-level dependency: enforce :data:`ROUTE_POLICY` for the matched route."""
    route = request.scope.get("route")
    path = getattr(route, "path", None) or request.url.path
    # FastAPI >= 0.16x mounts included routers, so the matched route's path
    # lacks the include prefix (API_V1_PREFIX); restore it for the lookup.
    prefix = get_settings().API_V1_PREFIX
    if route is not None and not path.startswith(prefix):
        path = f"{prefix}{path}"
    method = request.method.upper()
    if method in ("HEAD", "OPTIONS"):
        return
    policy = ROUTE_POLICY.get((method, path))
    if policy is None:
        logger.error("RBAC: no policy for %s %s; refusing", method, path)
        raise _deny(status.HTTP_403_FORBIDDEN, "This endpoint has no access policy")
    if policy in (PUBLIC, SERVICE):
        return

    credentials = await _bearer(request)
    payload = verify_token(credentials.credentials) if credentials else None
    if not payload or not payload.get("sub"):
        raise _deny(status.HTTP_401_UNAUTHORIZED, "Invalid authentication credentials")
    email = str(payload["sub"])
    request.state.rbac_email = email

    if policy == AUTHENTICATED:
        return
    if policy == PLATFORM:
        if not is_platform_admin(email):
            _record_denial(payload, policy, method, path, "Platform admin role required")
            raise _deny(status.HTTP_403_FORBIDDEN, "Platform admin role required")
        return

    org_id = str(payload.get("org_id") or "")
    if not org_id:
        raise _deny(status.HTTP_400_BAD_REQUEST, "No active organisation in token")

    adopter = adopter_status(org_id)
    if adopter == "suspended":
        _record_denial(payload, policy, method, path, "Adopter is suspended")
        raise _deny(status.HTTP_403_FORBIDDEN, "This organisation is suspended. Contact the VoicEra platform team.")
    if adopter == "missing":
        raise _deny(status.HTTP_403_FORBIDDEN, "Organisation not found")

    if email == BOT_SERVICE_EMAIL:
        role = str(payload.get("role") or "")
    else:
        role = membership_role(email, org_id)
        if role is None:
            _record_denial(payload, policy, method, path, "Not a member of this organisation")
            raise _deny(status.HTTP_403_FORBIDDEN, "You are no longer a member of this organisation")
    request.state.rbac_role = role
    if not has_permission(role, policy):
        label = ROLES[role].label if role in ROLES else role
        _record_denial(payload, policy, method, path, f"Role '{label}' lacks {policy}")
        raise _deny(
            status.HTTP_403_FORBIDDEN,
            f"Your role ({label}) does not allow this: {PERMISSIONS.get(policy, policy)}",
        )
