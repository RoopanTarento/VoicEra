"""Contact lists: Owner uploads named CSV/Excel lists; campaigns are created from them.

Uploading, renaming and deleting need ``contacts:write`` (Owner only); seeing
the lists (names, counts, masked preview) needs ``lists:read``. Access is
enforced centrally by ``app.rbac.ROUTE_POLICY``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.services.secure import contact_lists
from app.services.secure.contact_lists import ContactListError, ContactListNotFoundError
from app.services.secure.keys import VaultKeyError, get_key_provider

router = APIRouter(prefix="/contact-lists", tags=["contact-lists"])


class ContactListRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def _org(current_user: dict[str, Any]) -> str:
    org_id = str(current_user.get("org_id") or "")
    if not org_id:
        raise HTTPException(status_code=400, detail="No active organisation")
    return org_id


def _actor(current_user: dict[str, Any]) -> dict[str, str]:
    return {"actor_email": str(current_user.get("email") or ""), "actor_role": str(current_user.get("role") or "")}


def _raise(exc: Exception) -> None:
    if isinstance(exc, ContactListNotFoundError):
        raise HTTPException(status_code=404, detail="Contact list not found") from exc
    if isinstance(exc, ContactListError):
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    if isinstance(exc, VaultKeyError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Numbers can't be protected right now: {exc}",
        ) from exc
    raise exc


@router.get("")
async def list_contact_lists(current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    return contact_lists.list_lists(_org(current_user))


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_contact_list(
    name: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    org_id = _org(current_user)
    content = await file.read()
    try:
        get_key_provider()
        return contact_lists.create_list(
            org_id, name=name, filename=(file.filename or "").strip(), content=content, **_actor(current_user)
        )
    except Exception as exc:  # noqa: BLE001 - mapped to HTTP errors
        _raise(exc)
        raise
    finally:
        del content


@router.get("/rules")
async def upload_rules(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Accepted formats, size and row limits, and naming rules for uploads."""
    return contact_lists.upload_rules()


@router.get("/{list_id}")
async def get_contact_list(list_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return contact_lists.get_list(_org(current_user), list_id)
    except Exception as exc:  # noqa: BLE001
        _raise(exc)
        raise


@router.patch("/{list_id}")
async def rename_contact_list(
    list_id: str, body: ContactListRename, current_user: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
    try:
        return contact_lists.rename_list(_org(current_user), list_id, body.name, **_actor(current_user))
    except Exception as exc:  # noqa: BLE001
        _raise(exc)
        raise


@router.delete("/{list_id}")
async def delete_contact_list(list_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    try:
        contact_lists.delete_list(_org(current_user), list_id, **_actor(current_user))
    except Exception as exc:  # noqa: BLE001
        _raise(exc)
        raise
    return {"status": "success", "message": "Contact list deleted"}
