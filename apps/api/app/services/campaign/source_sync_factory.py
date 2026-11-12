"""Factory for campaign source sync services."""

from __future__ import annotations

from app.services.campaign.source_sync import CampaignSourceSyncService
from app.services.campaign.sources.csv import CSVSyncService
from app.services.campaign.sources.secure_contacts import SOURCE_TYPE as SECURE_CONTACTS
from app.services.campaign.sources.secure_contacts import SecureContactsSyncService


def get_sync_service(source_type: str) -> CampaignSourceSyncService:
    if source_type == "csv":
        return CSVSyncService()
    if source_type == SECURE_CONTACTS:
        return SecureContactsSyncService()
    raise ValueError(f"Unsupported campaign source type: {source_type}")
