"""Provider-level auth catalog and credential persistence routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user
from app.database_init import ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.rbac import BOT_SERVICE_EMAIL
from app.models.schemas import (
    ProviderAuthResponse,
    ProviderAuthUpsert,
    SuccessResponse,
)
from app.services import audit_log, auth_service
from app.services.provider_auth_catalog import (
    UnknownAuthProviderError,
    all_auth_catalog,
    provider_auth_catalog,
)
from app.services.secret_crypto import EncryptionNotConfiguredError

router = APIRouter(prefix="/auth", tags=["auth"])

_WRITE_ROLES = frozenset({ROLE_SUPER_ADMIN, ROLE_ADMIN})


def _require_write_role(current_user: dict[str, Any]) -> None:
    if current_user.get("role") not in _WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can manage provider credentials",
        )


def _mask_for_user(current_user: dict[str, Any]) -> bool:
    return current_user.get("role") not in _WRITE_ROLES


def _catalog_http_error(exc: Exception) -> None:
    if isinstance(exc, UnknownAuthProviderError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    if isinstance(exc, EncryptionNotConfiguredError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
    raise exc


@router.get("/catalog")
async def auth_catalog(
    _current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Provider-level auth schemas for every registered provider."""
    return all_auth_catalog()


@router.get("/catalog/{provider}")
async def auth_catalog_for_provider(
    provider: str,
    _current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Auth schema for one provider (fields merged across kinds)."""
    try:
        return provider_auth_catalog(provider)
    except Exception as exc:
        _catalog_http_error(exc)
        raise


@router.get("/configured")
async def list_configured(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[str]:
    """Provider ids that have auth stored for the caller's organisation."""
    return auth_service.list_configured_providers(current_user["org_id"])


@router.post("", response_model=ProviderAuthResponse, status_code=status.HTTP_201_CREATED)
async def upsert_auth(
    body: ProviderAuthUpsert,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Create or update stored auth for a provider (admin / super_admin)."""
    _require_write_role(current_user)
    try:
        provider_auth_catalog(body.provider)
        result = auth_service.upsert_provider_auth(
            current_user["org_id"],
            body.provider,
            body.auth,
        )
    except Exception as exc:
        _catalog_http_error(exc)
        raise
    # Never include body.auth (raw secrets) in the log — only that this
    # provider's credentials were touched, by whom, and when.
    audit_log.record(
        current_user["org_id"],
        entity_type="provider_auth",
        action="updated",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=body.provider,
        entity_name=body.provider,
    )
    return result


@router.get("/{provider}", response_model=ProviderAuthResponse)
async def get_auth(
    provider: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Stored auth for one provider in the caller's organisation."""
    try:
        provider_auth_catalog(provider)
    except Exception as exc:
        _catalog_http_error(exc)
        raise

    try:
        stored = auth_service.get_provider_auth(
            current_user["org_id"],
            provider,
            mask_secrets=_mask_for_user(current_user),
        )
        # The voice runtime (service token only) gets the platform's lent key
        # when the workspace has none of its own. People never see it.
        if not stored and current_user.get("email") == BOT_SERVICE_EMAIL:
            stored = auth_service.resolve_provider_auth(current_user["org_id"], provider)
    except Exception as exc:
        _catalog_http_error(exc)
        raise

    if not stored:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No auth stored for provider: {provider}",
        )
    return stored


@router.delete("/{provider}", response_model=SuccessResponse)
async def delete_auth(
    provider: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> SuccessResponse:
    """Remove stored auth for a provider (admin / super_admin)."""
    _require_write_role(current_user)
    try:
        provider_auth_catalog(provider)
    except Exception as exc:
        _catalog_http_error(exc)
        raise

    deleted = auth_service.delete_provider_auth(current_user["org_id"], provider)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No auth stored for provider: {provider}",
        )
    audit_log.record(
        current_user["org_id"],
        entity_type="provider_auth",
        action="deleted",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=provider,
        entity_name=provider,
    )
    return SuccessResponse(message=f"Auth deleted for provider: {provider}")
