"""VoicEra Secure API: contact vault, resolution, gateway, audit and settings.

All routes are scoped to the organisation in the caller's JWT. No route
returns a phone number except ``POST /secure/contacts/{id}/resolve``, and
that one only to an authenticated *service* identity (never a user).
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import get_current_user, verify_token
from app.config import settings
from app import rbac
from app.models.secure_schemas import (
    ContactSetRequest,
    ContactSetResponse,
    ContactStatusRequest,
    GatewayCallRequest,
    OrgPolicyUpdate,
    ResolveRequest,
    ResolveResponse,
    SecureContact,
    SecureContactList,
    TokenizeRequest,
    TokenizeResponse,
)
from app.services.secure import contact_ingest, insights, resolution, security_audit
from app.services.secure import gateway as secure_gateway
from app.services.secure import vault_repository as vault
from app.services.secure.keys import VaultKeyError
from app.services.secure.masking import csv_safe
from app.services.secure.service_identity import authenticate_service
from app.services.secure.tokenization import generate_contact_set_id, is_contact_id

router = APIRouter(prefix="/secure", tags=["secure"])

_optional_bearer = HTTPBearer(auto_error=False)


def _org(user: dict[str, Any]) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="No active organisation in token")
    return str(org_id)


def _actor(user: dict[str, Any]) -> tuple[str, str]:
    return str(user.get("email") or ""), str(user.get("role") or "")


def _require(user: dict[str, Any], permission: str, action: str) -> None:
    """Defence in depth behind ``app.rbac.authorize`` (which runs first in the app)."""
    if not rbac.has_permission(user.get("role"), permission):
        email, role = _actor(user)
        security_audit.record(
            "auth.failed",
            org_id=user.get("org_id"),
            actor_type="user",
            actor_id=email,
            actor_role=role,
            outcome="denied",
            action="insufficient_role",
            reason=f"'{action}' requires {permission}",
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Your role does not allow you to {action}")


def _vault_unavailable(exc: VaultKeyError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"Contact vault is not configured: {exc}",
    )


# --- contacts ---------------------------------------------------------------------


@router.post("/contacts/upload", status_code=status.HTTP_201_CREATED)
async def upload_contacts(
    file: UploadFile = File(...),
    synthetic: bool = Form(default=False, description="Mark contacts as synthetic demo data"),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Validate a contact CSV and stage valid rows encrypted for 24 hours.

    The response lists every row with masked numbers, validation errors and
    duplicates (within the file and against the vault). Nothing is
    tokenised until ``POST /secure/contacts/tokenize``.
    """
    org_id = _org(current_user)
    _require(current_user, "contacts:write", "upload contacts")
    email, role = _actor(current_user)
    filename = (file.filename or "").strip().replace("/", "_").replace("\\", "_")
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(content) > settings.CAMPAIGN_MAX_CSV_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (max {settings.CAMPAIGN_MAX_CSV_BYTES // (1024 * 1024)} MB)",
        )
    try:
        return contact_ingest.upload(
            org_id, filename=filename, content=content, actor_email=email, actor_role=role, synthetic=synthetic
        )
    except contact_ingest.ContactFileError as exc:
        security_audit.record(
            "contact.upload",
            org_id=org_id,
            actor_type="user",
            actor_id=email,
            actor_role=role,
            outcome="error",
            reason=str(exc),
            metadata={"filename": filename},
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except VaultKeyError as exc:
        raise _vault_unavailable(exc) from exc


@router.post("/contacts/tokenize", response_model=TokenizeResponse)
async def tokenize_contacts(
    body: TokenizeRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Encrypt a validated upload into the vault under new opaque contact IDs."""
    org_id = _org(current_user)
    _require(current_user, "contacts:write", "tokenize contacts")
    email, role = _actor(current_user)
    try:
        return contact_ingest.tokenize(org_id, body.batch_id, actor_email=email, actor_role=role)
    except contact_ingest.BatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Upload not found") from exc
    except contact_ingest.BatchStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VaultKeyError as exc:
        raise _vault_unavailable(exc) from exc


@router.get("/contacts/batches")
async def list_batches(current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    """Recent uploads with their validation summary and tokenisation result."""
    return vault.list_batches(_org(current_user))


@router.get("/contacts", response_model=SecureContactList)
async def list_contacts(
    status_filter: str | None = Query(default=None, alias="status", pattern="^(active|inactive|deleted)$"),
    search: str | None = Query(default=None, max_length=80, description="Name, contact ID prefix, or last 1-4 digits"),
    batch_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    org_id = _org(current_user)
    contacts, total = vault.list_contacts(
        org_id, status=status_filter, search=search, batch_id=batch_id, limit=limit, offset=offset
    )
    return {"contacts": contacts, "total": total, "limit": limit, "offset": offset}


@router.get("/contacts/export")
async def export_contacts(current_user: dict[str, Any] = Depends(get_current_user)) -> StreamingResponse:
    """CSV of the vault with opaque IDs and masked numbers only."""
    org_id = _org(current_user)
    email, role = _actor(current_user)
    contacts, total = vault.list_contacts(org_id, limit=500, offset=0)
    rows = list(contacts)
    offset = len(rows)
    while offset < total:
        more, _ = vault.list_contacts(org_id, limit=500, offset=offset)
        if not more:
            break
        rows.extend(more)
        offset += len(more)
    security_audit.record(
        "contact.export",
        org_id=org_id,
        actor_type="user",
        actor_id=email,
        actor_role=role,
        outcome="success",
        action="vault_export",
        metadata={"rows": len(rows), "numbers": "masked"},
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["contact_id", "name", "masked_phone", "masked_email", "status", "key_version", "created_at"])
    for c in rows:
        writer.writerow(
            [
                csv_safe(v)
                for v in (
                    c.get("contact_id"),
                    c.get("display_name"),
                    c.get("masked_phone"),
                    c.get("masked_email"),
                    c.get("status"),
                    c.get("key_version"),
                    c.get("created_at"),
                )
            ]
        )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="protected_contacts_{stamp}.csv"'},
    )


@router.get("/contacts/{contact_id}")
async def get_contact(contact_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """One vault record (masked) with its recent security events."""
    org_id = _org(current_user)
    email, role = _actor(current_user)
    try:
        contact = vault.get_contact(org_id, contact_id)
    except vault.ContactNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Contact not found") from exc
    security_audit.record(
        "contact.view",
        org_id=org_id,
        actor_type="user",
        actor_id=email,
        actor_role=role,
        outcome="success",
        contact_id=contact_id,
    )
    events, _ = security_audit.list_events(org_id, contact_id=contact_id, limit=20)
    return {"contact": SecureContact(**contact).model_dump(), "events": events}


@router.post("/contacts/{contact_id}/status")
async def set_contact_status(
    contact_id: str,
    body: ContactStatusRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Activate or deactivate a contact. Inactive contacts cannot be dialled."""
    _require(current_user, "contacts:delete", "change contact status")
    org_id = _org(current_user)
    email, role = _actor(current_user)
    try:
        contact = vault.set_status(org_id, contact_id, body.status)
    except vault.ContactNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Contact not found") from exc
    security_audit.record(
        "contact.status_change",
        org_id=org_id,
        actor_type="user",
        actor_id=email,
        actor_role=role,
        outcome="success",
        contact_id=contact_id,
        metadata={"status": body.status},
    )
    return contact


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Erase a contact: ciphertext and duplicate index are destroyed; a masked tombstone stays for audit."""
    _require(current_user, "contacts:delete", "delete contacts")
    org_id = _org(current_user)
    email, role = _actor(current_user)
    try:
        contact = vault.erase_contact(org_id, contact_id)
    except vault.ContactNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Contact not found") from exc
    security_audit.record(
        "contact.delete",
        org_id=org_id,
        actor_type="user",
        actor_id=email,
        actor_role=role,
        outcome="success",
        contact_id=contact_id,
        metadata={"erasure": "ciphertext and duplicate index destroyed"},
    )
    return contact


@router.post("/contacts/retention/purge")
async def purge_retention(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Erase inactive contacts older than the retention period and expired uploads."""
    _require(current_user, "security:write", "run retention purges")
    email, role = _actor(current_user)
    return insights.purge_retention(_org(current_user), actor_email=email, actor_role=role)


@router.post("/contacts/{contact_id}/resolve", response_model=ResolveResponse)
async def resolve_contact(
    contact_id: str,
    body: ResolveRequest,
    x_service_id: str | None = Header(default=None, alias="X-Service-Id"),
    x_service_key: str | None = Header(default=None, alias="X-Service-Key"),
    bearer: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
) -> dict[str, Any]:
    """Service-to-service resolution of a contact ID to its number.

    Requires ``X-Service-Id`` / ``X-Service-Key`` for a service listed in
    ``SECURE_SERVICE_CREDENTIALS`` with a resolve scope. User sessions are
    always refused, and every attempt is audited.
    """
    if x_service_id or x_service_key:
        identity = authenticate_service(x_service_id, x_service_key)
        if identity is None:
            security_audit.record(
                "auth.failed",
                org_id=body.org_id,
                actor_type="anonymous",
                actor_id=(x_service_id or "")[:64] or None,
                outcome="denied",
                action="invalid_service_credentials",
                contact_id=contact_id if is_contact_id(contact_id) else None,
                reason="Unknown service or wrong key",
            )
            raise HTTPException(status_code=401, detail="Invalid service credentials")
        try:
            resolved = resolution.resolve_contact(
                org_id=body.org_id, contact_id=contact_id, identity=identity, purpose=body.purpose
            )
        except resolution.ResolutionDenied as exc:
            code = 404 if exc.reason == resolution.DENY_NOT_FOUND else 429 if exc.reason == resolution.DENY_RATE_LIMIT else 403
            raise HTTPException(status_code=code, detail=exc.message) from exc
        return {"contact_id": contact_id, "phone_number": resolved.reveal(), "masked_phone": resolved.masked}

    payload = verify_token(bearer.credentials) if bearer else None
    if payload:
        org_id = str(payload.get("org_id") or body.org_id)
        exc = resolution.deny_user(org_id, contact_id, user_email=str(payload.get("sub") or ""), role=payload.get("role"))
        raise HTTPException(status_code=403, detail=exc.message)
    security_audit.record(
        "auth.failed",
        org_id=body.org_id,
        actor_type="anonymous",
        actor_id=None,
        outcome="denied",
        action="missing_credentials",
        contact_id=contact_id if is_contact_id(contact_id) else None,
        reason="No service credentials presented",
    )
    raise HTTPException(status_code=401, detail="Service credentials required")


# --- contact sets ---------------------------------------------------------------


@router.post("/contact-sets", response_model=ContactSetResponse, status_code=status.HTTP_201_CREATED)
async def create_contact_set(
    body: ContactSetRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Group vault contacts for a campaign. Pass the returned ``set_id`` as
    ``source_id`` with ``source_type='secure_contacts'`` to ``POST /campaign/create``."""
    org_id = _org(current_user)
    _require(current_user, "contacts:write", "create contact lists")
    email, role = _actor(current_user)
    if body.all_active or body.batch_id:
        ids = vault.all_active_contact_ids(org_id, batch_id=body.batch_id if not body.all_active else None)
        requested = len(ids)
    else:
        requested = len(body.contact_ids)
        ids = vault.active_contact_ids(org_id, list(dict.fromkeys(body.contact_ids)))
    if not ids:
        raise HTTPException(status_code=422, detail="No active contacts in this organisation match the selection")
    now = datetime.now(timezone.utc).isoformat()
    doc = vault.create_contact_set(
        {
            "set_id": generate_contact_set_id(),
            "org_id": org_id,
            "name": body.name,
            "contact_ids": ids,
            "created_by": email,
            "created_at": now,
        }
    )
    security_audit.record(
        "contact_set.create",
        org_id=org_id,
        actor_type="user",
        actor_id=email,
        actor_role=role,
        outcome="success",
        metadata={"set_id": doc["set_id"], "size": len(ids), "skipped": max(0, requested - len(ids))},
    )
    return {
        "set_id": doc["set_id"],
        "name": doc["name"],
        "size": len(ids),
        "skipped": max(0, requested - len(ids)),
        "created_at": now,
    }


# --- gateway ----------------------------------------------------------------------


@router.post("/gateway/calls", status_code=status.HTTP_201_CREATED)
async def gateway_call(
    body: GatewayCallRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Place one outbound call to a vault contact. The caller never sees the number."""
    org_id = _org(current_user)
    email, _ = _actor(current_user)
    try:
        return await secure_gateway.dial_contact(
            org_id,
            body.agent_id,
            body.contact_id,
            from_number=body.from_number,
            custom_variables=body.custom_variables,
            initiated_by=f"user:{email}",
        )
    except secure_gateway.GatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except VaultKeyError as exc:
        raise _vault_unavailable(exc) from exc


@router.get("/gateway/activity")
async def gateway_activity(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Recent gateway calls, resolutions and sanitised callbacks for this org."""
    org_id = _org(current_user)
    calls, _ = security_audit.list_events(org_id, event_type="gateway.call", limit=limit)
    resolutions, _ = security_audit.list_events(org_id, event_type="contact.resolve", limit=limit)
    callbacks, _ = security_audit.list_events(org_id, event_type="callback.sanitized", limit=limit)
    from apps.telephony.providers.mock import is_mock_enabled
    from apps.telephony.registry import registered_providers

    return {
        "providers": sorted(registered_providers()),
        "mock_enabled": is_mock_enabled(),
        "calls": calls,
        "resolutions": resolutions,
        "callbacks": callbacks,
    }


# --- overview, campaigns, audit, settings -------------------------------------------------


@router.get("/overview")
async def overview(
    days: int = Query(default=14, ge=7, le=90),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return insights.overview(_org(current_user), days=days)


@router.get("/campaigns")
async def campaign_protection(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    org_id = _org(current_user)
    return {
        "campaigns": insights.campaign_protection(org_id),
        "contact_sets": vault.list_contact_sets(org_id),
        "policy": insights.get_org_policy(org_id),
    }


@router.get("/audit")
async def list_audit_events(
    event_type: str | None = Query(default=None),
    category: str | None = Query(default=None),
    outcome: str | None = Query(default=None, pattern="^(success|denied|error)$"),
    actor: str | None = Query(default=None),
    contact_id: str | None = Query(default=None),
    date_from: str | None = Query(default=None, description="ISO date or timestamp (inclusive)"),
    date_to: str | None = Query(default=None, description="ISO date or timestamp (inclusive)"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Security audit events for the caller's organisation (admins only)."""
    _require(current_user, "audit:read", "view the security audit log")
    org_id = _org(current_user)
    if date_to and len(date_to) == 10:
        date_to = f"{date_to}T23:59:59.999999+00:00"
    events, total = security_audit.list_events(
        org_id,
        event_type=event_type,
        category=category,
        outcome=outcome,
        actor=actor,
        contact_id=contact_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return {
        "events": events,
        "total": total,
        "limit": limit,
        "offset": offset,
        "event_types": sorted(security_audit.EVENT_CATEGORIES),
        "categories": sorted(set(security_audit.EVENT_CATEGORIES.values())),
        "actors": security_audit.distinct_actors(org_id),
    }


@router.get("/settings")
async def get_settings_view(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    _require(current_user, "security:read", "view security settings")
    org_id = _org(current_user)
    return {**insights.settings_view(org_id), "health": insights.health(org_id)}


@router.patch("/settings")
async def update_policy(body: OrgPolicyUpdate, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    _require(current_user, "security:write", "change security settings")
    email, role = _actor(current_user)
    return insights.update_org_policy(
        _org(current_user),
        actor_email=email,
        actor_role=role,
        require_vault_campaigns=body.require_vault_campaigns,
        retention_days=body.retention_days,
    )


@router.post("/settings/rotate-keys")
async def rotate_keys(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Re-encrypt every record not on the active key version."""
    _require(current_user, "security:write", "rotate encryption keys")
    email, role = _actor(current_user)
    try:
        return insights.rotate_keys(_org(current_user), actor_email=email, actor_role=role)
    except VaultKeyError as exc:
        raise _vault_unavailable(exc) from exc
