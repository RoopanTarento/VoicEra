"""Who am I and what may I do: the dashboard uses this to show only what a role allows."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app import rbac
from app.auth import get_current_user

router = APIRouter(prefix="/rbac", tags=["rbac"])


@router.get("/me")
async def me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    email = str(current_user.get("email") or "")
    org_id = str(current_user.get("org_id") or "")
    role = rbac.membership_role(email, org_id) if org_id else None
    if email == rbac.BOT_SERVICE_EMAIL:
        role = str(current_user.get("role") or "")
    found = rbac.ROLES.get(role or "")
    return {
        "email": email,
        "org_id": org_id or None,
        "role": role,
        "role_label": found.label if found else None,
        "permissions": sorted(rbac.permissions_for(role)),
        "platform_admin": rbac.is_platform_admin(email),
        "adopter_status": rbac.adopter_status(org_id) if org_id else None,
    }


@router.get("/roles")
async def roles(_: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """The fixed role catalogue, permission descriptions and the table the dashboard shows."""
    return {
        "roles": [
            {
                "id": r.id,
                "label": r.label,
                "description": r.description,
                "assignable": r.assignable,
                "permissions": sorted(r.permissions),
            }
            for r in rbac.ROLES.values()
        ],
        "permissions": rbac.PERMISSIONS,
        "matrix": [
            {"area": group["area"], "rows": [{"label": label, "permission": perm} for label, perm in group["rows"]]}
            for group in rbac.PERMISSION_MATRIX
        ],
    }
