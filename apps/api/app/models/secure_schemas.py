"""Request / response models for the VoicEra Secure API (``/api/v1/secure``)."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class TokenizeRequest(BaseModel):
    batch_id: str = Field(description="batch_id returned by POST /secure/contacts/upload")


class TokenizeResponse(BaseModel):
    batch_id: str
    created: int
    skipped_duplicates: int
    failed: int
    contacts: list[dict[str, Any]] = Field(default_factory=list, description="First 200 created contacts (masked)")


class SecureContact(BaseModel):
    """A vault record as the API exposes it: opaque ID and masked values only."""

    contact_id: str
    display_name: Optional[str] = None
    masked_phone: Optional[str] = None
    masked_email: Optional[str] = None
    country_code: Optional[int] = None
    region: Optional[str] = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    key_version: Optional[str] = None
    status: str
    synthetic: bool = False
    encrypted: bool = False
    encryption_algorithm: Optional[str] = None
    source: Optional[dict[str, Any]] = None
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None
    last_resolved_at: Optional[str] = None
    resolution_count: int = 0


class SecureContactList(BaseModel):
    contacts: list[SecureContact]
    total: int
    limit: int
    offset: int


class ContactStatusRequest(BaseModel):
    status: Literal["active", "inactive"]


class ResolveRequest(BaseModel):
    org_id: str = Field(description="Organisation that owns the contact")
    purpose: Literal["dial"] = "dial"


class ResolveResponse(BaseModel):
    contact_id: str
    phone_number: str = Field(description="E.164 number; returned only to authorised service identities")
    masked_phone: str


class ContactSetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    contact_ids: list[str] = Field(default_factory=list, max_length=50_000)
    batch_id: Optional[str] = Field(default=None, description="Use every active contact from this upload")
    all_active: bool = Field(default=False, description="Use every active contact in the organisation")


class ContactSetResponse(BaseModel):
    set_id: str
    name: str
    size: int
    skipped: int = Field(description="Requested IDs that were not active contacts in this organisation")
    created_at: str


class GatewayCallRequest(BaseModel):
    agent_id: str
    contact_id: str
    from_number: Optional[str] = Field(default=None, description="Optional caller ID (the org's own number)")
    custom_variables: dict[str, Any] = Field(default_factory=dict)


class OrgPolicyUpdate(BaseModel):
    require_vault_campaigns: Optional[bool] = None
    retention_days: Optional[int] = Field(default=None, ge=1, le=3650)
