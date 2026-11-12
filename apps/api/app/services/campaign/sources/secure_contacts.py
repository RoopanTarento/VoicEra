"""Campaign source backed by the VoicEra Secure contact vault.

``source_id`` is a contact set ID (``CSET-…``) owned by the campaign's org.
Queued runs carry ``contact_id`` and non-sensitive attributes only; the
dispatcher resolves the number through the secure gateway at dial time, so
no phone number is written to QueuedRuns, retries or redials.
"""

from __future__ import annotations

import logging

from app.services.campaign import campaign_repository as repo
from app.services.campaign.source_sync import (
    CampaignSourceSyncService,
    ValidationError,
    ValidationResult,
)
from app.services.secure import vault_repository as vault

logger = logging.getLogger(__name__)

SOURCE_TYPE = "secure_contacts"


class SecureContactsSyncService(CampaignSourceSyncService):
    async def validate_source(
        self, source_id: str, organization_id: str | None = None
    ) -> ValidationResult:
        if not organization_id:
            return ValidationResult(is_valid=False, error=ValidationError(message="Organisation required"))
        contact_set = vault.get_contact_set(organization_id, source_id)
        if not contact_set:
            return ValidationResult(
                is_valid=False,
                error=ValidationError(message="Contact set not found in this organisation"),
            )
        active = vault.active_contact_ids(organization_id, list(contact_set.get("contact_ids") or []))
        if not active:
            return ValidationResult(
                is_valid=False,
                error=ValidationError(message="Contact set has no active contacts"),
            )
        return ValidationResult(is_valid=True, headers=["contact_id"], rows=[[c] for c in active])

    async def sync_source_data(self, campaign_id: str) -> int:
        campaign = repo.get_campaign_by_id(campaign_id)
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")
        org_id = str(campaign["org_id"])
        contact_set = vault.get_contact_set(org_id, str(campaign.get("source_id") or ""))
        if not contact_set:
            raise ValueError("Contact set not found for campaign")
        contact_ids = vault.active_contact_ids(org_id, list(contact_set.get("contact_ids") or []))
        views = vault.safe_views_for(org_id, contact_ids)
        # Campaign CSV uploads keep each row's own columns as prompt variables.
        row_variables: dict[str, dict] = {}
        for member in contact_set.get("members") or []:
            if member.get("contact_id"):
                row_variables.setdefault(member["contact_id"], member.get("variables") or {})
        queued_runs = []
        for contact_id in contact_ids:
            view = views.get(contact_id) or {}
            context = {
                **{k: v for k, v in (view.get("attributes") or {}).items() if k not in ("contact_id",)},
                **{k: v for k, v in row_variables.get(contact_id, {}).items() if k not in ("contact_id", "phone_number")},
                "contact_id": contact_id,
            }
            if view.get("display_name") and "name" not in context:
                context["name"] = view["display_name"]
            queued_runs.append(
                {
                    "campaign_id": campaign_id,
                    "source_uuid": f"vault_{contact_id}",
                    "context_variables": context,
                    "state": "queued",
                }
            )
        if queued_runs:
            repo.bulk_create_queued_runs(queued_runs)
        repo.update_campaign(
            campaign_id,
            total_rows=len(queued_runs),
            source_sync_status="completed",
        )
        logger.info("Secure contact sync campaign=%s contacts=%s", campaign_id, len(queued_runs))
        return len(queued_runs)
