"""Org activity log — who created, edited, or deleted what, and when."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import get_current_user
from app import rbac
from app.services import audit_log

router = APIRouter(prefix="/audit-log", tags=["audit-log"])



@router.get("")
async def list_audit_log(
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """Recent activity for the caller's org (roles with audit:read)."""
    if not rbac.has_permission(current_user.get("role"), "audit:read"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view the activity log",
        )
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active organisation in token",
        )
    return audit_log.list_events(
        str(org_id),
        entity_type=entity_type,
        entity_id=entity_id,
        limit=limit,
    )
