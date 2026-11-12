"""Platform API for VoicEra operators: adopters, their keys, platform-wide audit.

Access is enforced by ``app.rbac`` (permission ``platform:manage``).
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field

from app.auth import get_current_user
from app.services import platform_service
from app.services.platform_service import PlatformError
from app.services.secure.keys import VaultKeyError

router = APIRouter(prefix="/platform", tags=["platform"])


class AdopterCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    owner_email: EmailStr
    owner_password: Optional[str] = Field(
        default=None, min_length=8, description="First password for a new owner account; omit if the user exists"
    )


class AdopterStatus(BaseModel):
    status: Literal["active", "suspended"]
    reason: Optional[str] = Field(default=None, max_length=300)


class RevokeRequest(BaseModel):
    confirm_name: str


def _actor(user: dict[str, Any]) -> str:
    return str(user.get("email") or "")


def _raise(exc: PlatformError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/adopters")
async def list_adopters(_: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    """Every adopter with counts and key status. No contact data."""
    return platform_service.list_adopters()


@router.post("/adopters", status_code=status.HTTP_201_CREATED)
async def create_adopter(body: AdopterCreate, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Create an adopter, its own keys, and an owner membership."""
    try:
        return platform_service.create_adopter(
            name=body.name.strip(), owner_email=str(body.owner_email), owner_password=body.owner_password, actor=_actor(user)
        )
    except PlatformError as exc:
        _raise(exc)
    except VaultKeyError as exc:
        raise HTTPException(status_code=503, detail=f"Master key not configured: {exc}") from exc


@router.get("/adopters/{org_id}")
async def get_adopter(org_id: str, _: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return platform_service.get_adopter(org_id)
    except PlatformError as exc:
        _raise(exc)


@router.post("/adopters/{org_id}/status")
async def set_adopter_status(org_id: str, body: AdopterStatus, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Suspend (blocks users, keys and campaigns) or reactivate an adopter."""
    try:
        return platform_service.set_status(org_id, status=body.status, reason=body.reason, actor=_actor(user))
    except PlatformError as exc:
        _raise(exc)


@router.post("/adopters/{org_id}/rotate-key")
async def rotate_adopter_key(org_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Generate a new key version for the adopter and re-encrypt and re-hash its records."""
    try:
        return platform_service.rotate_key(org_id, actor=_actor(user))
    except PlatformError as exc:
        _raise(exc)
    except VaultKeyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/adopters/{org_id}/revoke-key")
async def revoke_adopter_key(org_id: str, body: RevokeRequest, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Offboard: destroy the adopter's keys. Every stored number becomes unreadable. Irreversible."""
    try:
        return platform_service.revoke_key(org_id, confirm_name=body.confirm_name, actor=_actor(user))
    except PlatformError as exc:
        _raise(exc)


@router.post("/master-key/rewrap")
async def rewrap_master_key(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Re-wrap every adopter's keys under the active master key version."""
    try:
        return platform_service.rewrap_master(actor=_actor(user))
    except VaultKeyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/audit")
async def platform_audit(
    event_type: str | None = Query(default=None),
    outcome: str | None = Query(default=None, pattern="^(success|denied|error)$"),
    org_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """Security events across adopters (metadata only; never numbers)."""
    return platform_service.platform_events(event_type=event_type, outcome=outcome, org_id=org_id, limit=limit)
