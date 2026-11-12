"""Campaign outbound calling API."""

from __future__ import annotations

import csv
import io
import logging
import zipfile
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.auth import get_current_user, verify_api_key
from app.constants.campaign import DEFAULT_CAMPAIGN_RETRY_CONFIG
from app.config import settings
from app.database_init import ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.models.schemas import (
    CampaignAnalyticsResponse,
    CampaignCallStatusRequest,
    CampaignCsvUploadResponse,
    CampaignProgressResponse,
    CampaignResponse,
    CampaignRunsListResponse,
    CreateCampaignRequest,
    ObdCampaignStatusResponse,
    ObdReportResponse,
    RedialCampaignRequest,
    SuccessResponse,
    UpdateCampaignRequest,
)
from app.services.agent_telephony_service import (
    AgentTelephonyError,
    load_telephony_client,
)
from app.services import agent_service, audit_log, campaign_insights, naming
from app.services.agent_service import AgentNotFoundError
from app.services.call_log_service import (
    CallLogListFilters,
    count_call_logs,
    get_call_analytics,
    get_call_log_by_provider_sid,
    list_call_logs_by_campaign,
    transform_call_log_urls,
)
from app.services.campaign import campaign_repository as repo
from app.services.campaign.campaign_repository import CampaignNotFoundError, get_org_concurrent_limit
from app.services.campaign.runner import campaign_runner_service
from app.services.campaign.source_sync_factory import get_sync_service
from app.services.campaign.status_processor import handle_call_terminal
from app.services import phone_number_service
from app.services.campaign.source_sync import CampaignSourceSyncService
from app.services.campaign.sources.secure_contacts import SOURCE_TYPE as SECURE_CONTACTS_SOURCE
from app.services.secure import insights as secure_insights
from app.services.secure import vault_repository as secure_vault
from app.services.secure.contact_ingest import protect_numbers
from app.services.secure.keys import VaultKeyError, get_key_provider
from app.services.secure.phone import InvalidPhoneNumberError, normalize_phone
from app.services.secure.tokenization import generate_contact_set_id
from apps.pii import mask_phone, redact_text, scrub_mapping
from app.services.secure import security_audit
from app.services.secure.masking import csv_safe, mask_call_logs
from app.storage.minio_client import MinIOStorage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/campaign", tags=["campaign"])

_DELETE_ROLES = frozenset({ROLE_SUPER_ADMIN})


def _campaign_name(org_id: str, value: str | None, *, exclude_id: str | None = None) -> str:
    """The standard, unique form of a campaign name (``naming``), or a 400/409 saying what to change."""
    try:
        name = naming.clean_name(value, what="campaign")
        others = [str(c.get("name") or "") for c in repo.list_campaigns(org_id) if c.get("campaign_id") != exclude_id]
        return naming.ensure_unique(name, others, what="campaign")
    except naming.NameError_ as exc:
        # A taken name says which free one to use: 'A campaign called "X" already exists. Try "X (2)".'
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _require_org(current_user: dict[str, Any]) -> str:
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="No active organisation in token")
    return str(org_id)


_OBD_CONFLICTS = frozenset({"missing_credentials", "missing_campaign", "missing_dni"})


def _load_campaign_client(org_id: str, campaign: dict[str, Any]) -> Any:
    provider = str(campaign.get("telephony_provider") or "").strip().lower()
    if not provider:
        raise HTTPException(
            status_code=404,
            detail="Provider report is not available for this campaign",
        )
    try:
        return load_telephony_client(org_id, provider)
    except AgentTelephonyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


async def _call_obd_method(client: Any, method_name: str, **kwargs: Any) -> dict[str, Any]:
    method = getattr(client, method_name, None)
    if not callable(method):
        raise HTTPException(
            status_code=404,
            detail="Provider report is not available for this campaign",
        )
    result = await method(**kwargs)
    if not isinstance(result, dict) or result.get("status") != "success":
        message = "Provider request failed"
        code = ""
        if isinstance(result, dict):
            message = redact_text(str(result.get("message") or message))
            code = str(result.get("code") or "")
        status_code = 409 if code in _OBD_CONFLICTS else 502
        raise HTTPException(status_code=status_code, detail=message)
    return result


def _require_delete_role(current_user: dict[str, Any]) -> None:
    if current_user.get("role") not in _DELETE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can delete campaigns",
        )


def _to_campaign_response(doc: dict[str, Any]) -> CampaignResponse:
    return CampaignResponse(
        campaign_id=str(doc["campaign_id"]),
        org_id=str(doc["org_id"]),
        name=str(doc["name"]),
        agent_id=str(doc["agent_id"]),
        telephony_provider=doc.get("telephony_provider"),
        source_type=str(doc.get("source_type") or "csv"),
        source_id=str(doc["source_id"]),
        state=doc.get("state", "created"),
        total_rows=int(doc.get("total_rows") or 0),
        processed_rows=int(doc.get("processed_rows") or 0),
        failed_rows=int(doc.get("failed_rows") or 0),
        rate_limit_per_second=int(doc.get("rate_limit_per_second") or 1),
        retry_config=doc.get("retry_config") or {},
        orchestrator_metadata=doc.get("orchestrator_metadata") or {},
        from_number=doc.get("from_number"),
        created_by=doc.get("created_by"),
        created_at=doc.get("created_at"),
        updated_at=doc.get("updated_at"),
        started_at=doc.get("started_at"),
        completed_at=doc.get("completed_at"),
    )


def _agent_from_numbers(org_id: str, agent_id: str, agent: dict[str, Any]) -> list[str]:
    """CLI numbers attached to the agent (linked + inventory)."""
    numbers: list[str] = []
    linked = agent.get("linked_phone_number")
    if linked:
        numbers.append(str(linked))
    for doc in phone_number_service.list_by_org(org_id):
        if doc.get("agent_id") == agent_id:
            num = doc.get("phone_number")
            if num and str(num) not in numbers:
                numbers.append(str(num))
    return numbers


def _count_agent_from_numbers(org_id: str, agent_id: str) -> int:
    try:
        agent = agent_service.get_agent(org_id, agent_id)
    except AgentNotFoundError:
        agent = {}
    return len(_agent_from_numbers(org_id, agent_id, agent))


def _validate_telephony_agent(org_id: str, agent_id: str) -> dict[str, Any]:
    try:
        agent = agent_service.get_agent(org_id, agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(agent.get("agent_category") or "") != "telephony":
        raise HTTPException(status_code=422, detail="Campaign requires a telephony agent")
    if not _agent_from_numbers(org_id, agent_id, agent):
        raise HTTPException(
            status_code=422,
            detail="Attach a phone number to this agent before creating a campaign",
        )
    return agent


def _snapshot_telephony_binding(
    org_id: str,
    agent: dict[str, Any],
    from_number_override: str | None,
) -> tuple[str, str]:
    """Freeze provider + CLI on the campaign so dial-time does not re-resolve agent."""
    telephony = agent.get("telephony") or {}
    provider = str(telephony.get("provider") or "").strip().lower()
    if not provider:
        raise HTTPException(
            status_code=422,
            detail="Agent has no telephony provider configured",
        )
    agent_id = str(agent["agent_id"])
    attached = _agent_from_numbers(org_id, agent_id, agent)
    if from_number_override:
        from_number = str(from_number_override).strip()
        if from_number not in attached:
            raise HTTPException(
                status_code=422,
                detail="from_number must be a phone number attached to this agent",
            )
    else:
        from_number = attached[0]
    return provider, from_number


def _validate_source_owner(org_id: str, source_type: str, source_id: str) -> None:
    """Reject sources that belong to another organisation or are disallowed."""
    if source_type == "csv":
        if secure_insights.get_org_policy(org_id)["require_vault_campaigns"]:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Plain CSV campaigns are disabled. Upload contacts to the "
                    "secure vault and create the campaign from a contact set."
                ),
            )
        if not str(source_id).startswith(f"campaigns/{org_id}/"):
            raise HTTPException(status_code=404, detail="Campaign source not found")


def _validate_max_concurrency(org_id: str, agent_id: str, max_concurrency: int) -> None:
    org_limit = get_org_concurrent_limit(org_id)
    if max_concurrency > org_limit:
        raise HTTPException(
            status_code=400,
            detail=(
                f"max_concurrency ({max_concurrency}) cannot exceed org limit "
                f"({org_limit})"
            ),
        )


@router.post(
    "/upload",
    response_model=CampaignCsvUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_campaign_csv(
    file: UploadFile = File(...),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignCsvUploadResponse:
    """Upload a campaign contact CSV (same pattern as knowledge PDF upload)."""
    org_id = _require_org(current_user)
    filename = (file.filename or "").strip()
    safe_name = filename.replace("/", "_").replace("\\", "_")
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only CSV files are allowed",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file",
        )
    if len(content) > settings.CAMPAIGN_MAX_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File too large (max {settings.CAMPAIGN_MAX_CSV_BYTES // (1024 * 1024)} MB)"
            ),
        )

    # VoicEra Secure: validate in memory, hash and encrypt every number under
    # this adopter's own keys, and keep only contact IDs. The CSV itself is
    # never written to object storage.
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded") from exc
    all_rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if len(all_rows) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file must have a header row and at least one data row",
        )
    validation = CampaignSourceSyncService.validate_source_data(all_rows[0], all_rows[1:])
    if not validation.is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=validation.error.message if validation.error else "Invalid CSV",
        )
    headers = validation.headers or []
    phone_idx = headers.index("phone_number")
    entries: list[dict[str, Any]] = []
    members: list[dict[str, Any]] = []
    invalid_rows: list[int] = []
    for row_no, row in enumerate(validation.rows or [], start=2):
        if len(row) <= phone_idx or not str(row[phone_idx]).strip():
            continue
        try:
            phone = normalize_phone(str(row[phone_idx]))
        except InvalidPhoneNumberError:
            invalid_rows.append(row_no)
            continue
        variables = {
            h: v
            for h, v in CampaignSourceSyncService.build_context_variables(headers, row).items()
            if h != "phone_number" and h
        }
        entries.append({"e164": phone.e164, "name": variables.get("name") or variables.get("customer_name"), "row": row_no})
        members.append({"variables": scrub_mapping(variables)})
    if invalid_rows:
        shown = ", ".join(map(str, invalid_rows[:5]))
        more = f" and {len(invalid_rows) - 5} more" if len(invalid_rows) > 5 else ""
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid phone numbers in rows: {shown}{more}. Check the number and country code.",
        )
    email = str(current_user.get("email") or "")
    try:
        get_key_provider()
        before = secure_vault.count_contacts(org_id)
        contact_ids = protect_numbers(
            org_id, entries, actor_email=email, source={"campaign_upload": safe_name}
        )
    except VaultKeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Numbers can't be protected right now: {exc}",
        ) from exc
    for member, cid in zip(members, contact_ids):
        member["contact_id"] = cid
    contact_set = secure_vault.create_contact_set(
        {
            "set_id": generate_contact_set_id(),
            "org_id": org_id,
            "name": safe_name,
            "contact_ids": list(dict.fromkeys(contact_ids)),
            "members": members,
            "created_by": email,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "origin": "campaign_upload",
        }
    )
    security_audit.record(
        "contact.upload",
        org_id=org_id,
        actor_type="user",
        actor_id=email,
        actor_role=str(current_user.get("role") or ""),
        outcome="success",
        action="campaign_csv_protected",
        metadata={"filename": safe_name, "rows": len(entries), "set_id": contact_set["set_id"], "stored_file": False},
    )
    del entries
    return CampaignCsvUploadResponse(
        source_id=contact_set["set_id"],
        source_type=SECURE_CONTACTS_SOURCE,
        filename=safe_name,
        contact_rows=len(contact_ids),
        new_contacts=max(0, secure_vault.count_contacts(org_id) - before),
        protected=True,
    )


@router.post("/create", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    body: CreateCampaignRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignResponse:
    org_id = _require_org(current_user)
    if body.source_type == "csv" and str(body.source_id).startswith("CSET-"):
        # Uploads are protected on arrival; older clients still send "csv".
        body.source_type = SECURE_CONTACTS_SOURCE
    body.name = _campaign_name(org_id, body.name)
    agent = _validate_telephony_agent(org_id, body.agent_id)
    provider, from_number = _snapshot_telephony_binding(
        org_id, agent, body.from_number
    )
    # VI / OBD bulk campaigns are paced by the provider, not VoicERA concurrency.
    is_obd = bool(body.obd_config) or provider == "vi"
    if not is_obd:
        _validate_max_concurrency(org_id, body.agent_id, body.max_concurrency)
    _validate_source_owner(org_id, body.source_type, body.source_id)

    try:
        sync_service = get_sync_service(body.source_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    validation = await sync_service.validate_source(body.source_id, org_id)
    if not validation.is_valid:
        raise HTTPException(
            status_code=400,
            detail=validation.error.message if validation.error else "Invalid source",
        )

    orchestrator_metadata: dict[str, Any] = {}
    if is_obd:
        if body.obd_config:
            orchestrator_metadata["obd_config"] = body.obd_config.model_dump()
    else:
        orchestrator_metadata["max_concurrency"] = body.max_concurrency
        if body.schedule_config:
            orchestrator_metadata["schedule_config"] = body.schedule_config.model_dump()
        if body.circuit_breaker:
            orchestrator_metadata["circuit_breaker"] = body.circuit_breaker.model_dump()

    retry_config = (
        body.retry_config.model_dump()
        if body.retry_config
        else dict(DEFAULT_CAMPAIGN_RETRY_CONFIG)
    )

    doc = repo.create_campaign(
        {
            "org_id": org_id,
            "name": body.name,
            "agent_id": body.agent_id,
            "telephony_provider": provider,
            "source_type": body.source_type,
            "source_id": body.source_id,
            "rate_limit_per_second": 1 if is_obd else body.rate_limit_per_second,
            "retry_config": (
                dict(DEFAULT_CAMPAIGN_RETRY_CONFIG) if is_obd else retry_config
            ),
            "orchestrator_metadata": orchestrator_metadata,
            "from_number": from_number,
            "created_by": current_user.get("email"),
        }
    )
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="created",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=doc.get("campaign_id"),
        entity_name=doc.get("name"),
    )
    return _to_campaign_response(doc)


@router.get("/", response_model=list[CampaignResponse])
async def list_campaigns(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[CampaignResponse]:
    org_id = _require_org(current_user)
    return [_to_campaign_response(c) for c in repo.list_campaigns(org_id)]


@router.get("/insights")
async def campaign_insights_for_period(
    date_from: str = Query(..., alias="from", description="First local day, YYYY-MM-DD"),
    date_to: str = Query(..., alias="to", description="Last local day, YYYY-MM-DD (inclusive)"),
    tz: str = Query(default=campaign_insights.DEFAULT_TZ),
    campaign_id: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Campaign analysis for a day, month, year or custom range: totals, days for
    a calendar, calls by hour, and each campaign that placed calls."""
    org_id = _require_org(current_user)
    try:
        return campaign_insights.period(org_id, date_from, date_to, tz=tz, campaign_id=campaign_id, agent_id=agent_id)
    except campaign_insights.InsightsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class DuplicateCampaignRequest(BaseModel):
    name: str | None = None


@router.post("/{campaign_id}/duplicate", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def duplicate_campaign(
    campaign_id: str,
    body: DuplicateCampaignRequest | None = None,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignResponse:
    """A new, not-yet-started campaign with the same agent, contact list and
    settings. Without a name it is called "<name> (copy)", "(copy 2)" …"""
    org_id = _require_org(current_user)
    try:
        source = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    existing = [str(c.get("name") or "") for c in repo.list_campaigns(org_id)]
    wanted = (body.name if body else None) or naming.copy_name(str(source.get("name") or "Campaign"), existing)
    name = _campaign_name(org_id, wanted)
    agent = _validate_telephony_agent(org_id, str(source["agent_id"]))
    _validate_source_owner(org_id, str(source.get("source_type") or ""), str(source["source_id"]))
    # Re-snapshot provider + CLI like create does; keep the old CLI while it is
    # still attached to the agent, otherwise fall back to the agent's first one.
    telephony = agent.get("telephony") or {}
    provider = str(telephony.get("provider") or "").strip().lower() or source.get("telephony_provider")
    previous_from = str(source.get("from_number") or "").strip()
    attached = _agent_from_numbers(org_id, str(source["agent_id"]), agent)
    from_number = previous_from if previous_from in attached else attached[0]
    metadata = {
        k: v for k, v in dict(source.get("orchestrator_metadata") or {}).items()
        if k in ("max_concurrency", "schedule_config", "circuit_breaker", "obd_config")
    }
    doc = repo.create_campaign(
        {
            "org_id": org_id,
            "name": name,
            "agent_id": source["agent_id"],
            "telephony_provider": provider,
            "source_type": source.get("source_type", "csv"),
            "source_id": source["source_id"],
            "rate_limit_per_second": source.get("rate_limit_per_second", 1),
            "retry_config": source.get("retry_config") or dict(DEFAULT_CAMPAIGN_RETRY_CONFIG),
            "orchestrator_metadata": metadata,
            "from_number": from_number,
            "created_by": current_user.get("email"),
        }
    )
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="created",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=doc.get("campaign_id"),
        entity_name=name,
        detail=f"duplicate of {campaign_id}",
    )
    return _to_campaign_response(doc)


@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignResponse:
    org_id = _require_org(current_user)
    try:
        doc = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_campaign_response(doc)


@router.delete("/{campaign_id}", response_model=SuccessResponse)
async def delete_campaign(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> SuccessResponse:
    """Delete a campaign (admin / super_admin only)."""
    _require_delete_role(current_user)
    org_id = _require_org(current_user)
    try:
        existing = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    repo.delete_queued_runs_for_campaign(campaign_id)
    repo.delete_campaign(campaign_id)
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="deleted",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=campaign_id,
        entity_name=existing.get("name"),
    )
    return SuccessResponse(message=f"Campaign deleted: {campaign_id}")


@router.post("/{campaign_id}/start")
async def start_campaign(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    org_id = _require_org(current_user)
    try:
        campaign = repo.get_campaign_for_org(org_id, campaign_id)
        await campaign_runner_service.start_campaign(campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="started",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=campaign_id,
        entity_name=campaign.get("name"),
    )
    return {"status": "started", "campaign_id": campaign_id}


@router.post("/{campaign_id}/pause")
async def pause_campaign(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    org_id = _require_org(current_user)
    try:
        campaign = repo.get_campaign_for_org(org_id, campaign_id)
        await campaign_runner_service.pause_campaign(campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="paused",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=campaign_id,
        entity_name=campaign.get("name"),
    )
    return {"status": "paused", "campaign_id": campaign_id}


@router.post("/{campaign_id}/resume")
async def resume_campaign(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    org_id = _require_org(current_user)
    try:
        campaign = repo.get_campaign_for_org(org_id, campaign_id)
        await campaign_runner_service.resume_campaign(campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="resumed",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=campaign_id,
        entity_name=campaign.get("name"),
    )
    return {"status": "resumed", "campaign_id": campaign_id}


@router.patch("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    campaign_id: str,
    body: UpdateCampaignRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignResponse:
    org_id = _require_org(current_user)
    try:
        doc = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    patch: dict[str, Any] = {}
    if body.name is not None:
        patch["name"] = _campaign_name(org_id, body.name, exclude_id=campaign_id)
    if body.rate_limit_per_second is not None:
        patch["rate_limit_per_second"] = body.rate_limit_per_second
    metadata = dict(doc.get("orchestrator_metadata") or {})
    if body.max_concurrency is not None:
        _validate_max_concurrency(org_id, str(doc["agent_id"]), body.max_concurrency)
        metadata["max_concurrency"] = body.max_concurrency
    if body.schedule_config is not None:
        metadata["schedule_config"] = body.schedule_config.model_dump()
    if body.circuit_breaker is not None:
        metadata["circuit_breaker"] = body.circuit_breaker.model_dump()
    if metadata != doc.get("orchestrator_metadata"):
        patch["orchestrator_metadata"] = metadata
    if body.retry_config is not None:
        patch["retry_config"] = body.retry_config.model_dump()

    if patch:
        updated = repo.update_campaign(campaign_id, **patch)
        doc = updated or doc
        audit_log.record(
            org_id,
            entity_type="campaign",
            action="updated",
            actor_email=str(current_user["email"]),
            actor_role=str(current_user.get("role") or ""),
            entity_id=campaign_id,
            entity_name=doc.get("name"),
        )
    return _to_campaign_response(doc)


@router.get("/{campaign_id}/runs", response_model=CampaignRunsListResponse)
async def get_campaign_runs(
    campaign_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    call_response: str | None = Query(default=None),
    created_after: str | None = Query(default=None),
    created_before: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignRunsListResponse:
    org_id = _require_org(current_user)
    try:
        repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    filters = CallLogListFilters(
        campaign_id=campaign_id,
        status=status_filter,
        call_response=call_response,
        created_after=created_after,
        created_before=created_before,
    )
    logs = list_call_logs_by_campaign(
        org_id,
        campaign_id,
        limit=limit,
        offset=offset,
        filters=filters,
    )
    total = count_call_logs(org_id, filters)
    return CampaignRunsListResponse(
        calls=mask_call_logs(
            (transform_call_log_urls(log, api_prefix=settings.API_V1_PREFIX) for log in logs),
            org_id=org_id,
        ),
        limit=limit,
        offset=offset,
        total=total,
    )


@router.get("/{campaign_id}/progress", response_model=CampaignProgressResponse)
async def get_campaign_progress(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignProgressResponse:
    org_id = _require_org(current_user)
    try:
        repo.get_campaign_for_org(org_id, campaign_id)
        status_doc = await campaign_runner_service.get_campaign_status(campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return CampaignProgressResponse(**status_doc)


@router.get("/{campaign_id}/analytics", response_model=CampaignAnalyticsResponse)
async def get_campaign_analytics_route(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignAnalyticsResponse:
    """Campaign progress + connection stats, plus post-campaign results
    (reach, outcomes, sentiment and agent feedback themes) on one path."""
    org_id = _require_org(current_user)
    try:
        campaign = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    from app.services import call_analysis

    results = call_analysis.campaign_analytics(org_id, campaign)
    stats = get_call_analytics(org_id, CallLogListFilters(campaign_id=campaign_id))
    total_rows = int(campaign.get("total_rows") or 0)
    processed_rows = int(campaign.get("processed_rows") or 0)
    failed_rows = int(campaign.get("failed_rows") or 0)
    # Typed progress/connection fields win where both report the same key.
    extra = {k: v for k, v in results.items() if k not in CampaignAnalyticsResponse.model_fields}
    return CampaignAnalyticsResponse(
        **extra,
        campaign_id=campaign_id,
        state=campaign.get("state", "created"),
        total_rows=total_rows,
        processed_rows=processed_rows,
        failed_rows=failed_rows,
        progress_percentage=(processed_rows / total_rows * 100) if total_rows > 0 else 0.0,
        **stats,
    )


def _obd_campaign_kwargs(campaign: dict[str, Any]) -> dict[str, Any]:
    return {
        "metadata": campaign.get("orchestrator_metadata") or {},
        "from_number": campaign.get("from_number"),
        "started_at": campaign.get("started_at"),
    }


_OBD_CSV_FIELDS = (
    "phone",
    "dial_status",
    "when",
    "duration_seconds",
    "recording_url",
    "provider_call_id",
    "system_call_id",
    "circle",
    "operator",
    "campaign_id",
    "campaign_name",
)


def _provider_call_id(row: dict[str, Any]) -> str:
    return str(row.get("provider_call_id") or "").strip()


def _mask_obd_row(row: dict[str, Any]) -> dict[str, Any]:
    """VoicEra Secure: provider report rows carry the dialled number; mask it."""
    out = dict(row)
    for key in ("phone", "to", "to_number", "msisdn", "mobile"):
        if out.get(key):
            out[key] = mask_phone(out[key])
    return out


def _call_logs_for_rows(
    org_id: str,
    rows: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """History rows keyed by provider call id."""
    found: dict[str, dict[str, Any]] = {}
    for row in rows:
        sid = _provider_call_id(row)
        if not sid or sid in found:
            continue
        log = get_call_log_by_provider_sid(org_id, sid)
        if log:
            found[sid] = log
    return found


def _system_call_id(log: dict[str, Any] | None) -> str:
    if not log:
        return ""
    return str(log.get("call_id") or "").strip()


def _obd_report_csv_text(
    rows: list[dict[str, Any]],
    logs: dict[str, dict[str, Any]] | None = None,
) -> str:
    saved = logs or {}
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(_OBD_CSV_FIELDS)
    for row in rows:
        sid = _provider_call_id(row)
        writer.writerow(
            [
                csv_safe(v)
                for v in (
                    mask_phone(row.get("phone")) if row.get("phone") else "",
                    row.get("dial_status") or "",
                    row.get("when") or "",
                    "" if row.get("duration_seconds") is None else row.get("duration_seconds"),
                    row.get("recording_url") or "",
                    sid,
                    _system_call_id(saved.get(sid)),
                    row.get("circle") or "",
                    row.get("operator") or "",
                    row.get("campaign_id") or "",
                    row.get("campaign_name") or "",
                )
            ]
        )
    return buffer.getvalue()


def _obd_report_csv(
    campaign_id: str,
    rows: list[dict[str, Any]],
    logs: dict[str, dict[str, Any]],
) -> StreamingResponse:
    return StreamingResponse(
        iter([_obd_report_csv_text(rows, logs)]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="obd-report-{campaign_id}.csv"'
        },
    )


def _call_filename(call_id: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in call_id.strip())
    return f"calls/{cleaned or 'call'}.txt"


async def _transcript_text(log: dict[str, Any] | None) -> str:
    if not log:
        return ""
    parsed = MinIOStorage.parse_minio_url(str(log.get("transcript_url") or ""))
    if not parsed:
        return ""
    bucket, key = parsed
    try:
        data = await MinIOStorage().get_object_bytes(key, bucket_name=bucket)
    except Exception:
        logger.warning(
            "OBD transcript read failed call_id=%s",
            log.get("call_id"),
            exc_info=True,
        )
        return ""
    # Transcripts can contain numbers the caller spoke: redact before export.
    return redact_text(data.decode("utf-8", errors="replace").strip())


def _call_file(
    provider_call_id: str,
    system_call_id: str,
    recording_url: str,
    transcript: str,
) -> str:
    body = (
        f"provider_call_id: {provider_call_id}\n"
        f"system_call_id: {system_call_id}\n"
        f"recording_url: {recording_url}\n"
    )
    if transcript:
        body = f"{body}\n{transcript}\n"
    return body


async def _obd_report_zip(
    campaign_id: str,
    rows: list[dict[str, Any]],
    logs: dict[str, dict[str, Any]],
) -> Response:
    """Full CSV in ``csv/``, and one file per call in ``calls/``."""
    buffer = io.BytesIO()
    seen: set[str] = set()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            f"csv/obd-report-{campaign_id}.csv",
            _obd_report_csv_text(rows, logs),
        )
        for row in rows:
            sid = _provider_call_id(row)
            if not sid:
                continue
            log = logs.get(sid)
            system_id = _system_call_id(log)
            name = _call_filename(system_id or sid)
            if name in seen:
                continue
            seen.add(name)
            archive.writestr(
                name,
                _call_file(
                    sid,
                    system_id,
                    str(row.get("recording_url") or "").strip(),
                    await _transcript_text(log),
                ),
            )
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="obd-report-{campaign_id}.zip"'
        },
    )


@router.get("/{campaign_id}/obd-report")
async def get_obd_report_route(
    campaign_id: str,
    report_format: str = Query(default="json", alias="format"),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    if report_format not in {"json", "csv", "zip"}:
        raise HTTPException(status_code=400, detail="format must be json, csv, or zip")
    org_id = _require_org(current_user)
    try:
        campaign = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    client = _load_campaign_client(org_id, campaign)
    result = await _call_obd_method(
        client, "get_obd_report", **_obd_campaign_kwargs(campaign)
    )
    rows = result.get("rows") if isinstance(result.get("rows"), list) else []
    rows = [_mask_obd_row(row) for row in rows if isinstance(row, dict)]
    if report_format in {"csv", "zip"}:
        security_audit.record(
            "contact.export",
            org_id=org_id,
            actor_type="user",
            actor_id=str(current_user.get("email") or ""),
            actor_role=str(current_user.get("role") or ""),
            outcome="success",
            action="obd_report",
            metadata={
                "campaign_id": campaign_id,
                "format": report_format,
                "rows": len(rows),
                "numbers": "masked",
            },
        )
        logs = _call_logs_for_rows(org_id, rows)
        if report_format == "csv":
            return _obd_report_csv(campaign_id, rows, logs)
        return await _obd_report_zip(campaign_id, rows, logs)
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    return ObdReportResponse(summary=summary, rows=rows)


@router.get("/{campaign_id}/obd-status", response_model=ObdCampaignStatusResponse)
async def get_obd_status_route(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ObdCampaignStatusResponse:
    org_id = _require_org(current_user)
    try:
        campaign = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    client = _load_campaign_client(org_id, campaign)
    result = await _call_obd_method(
        client,
        "get_obd_status",
        metadata=campaign.get("orchestrator_metadata") or {},
    )
    statuses = result.get("statuses") if isinstance(result.get("statuses"), list) else []
    return ObdCampaignStatusResponse(statuses=statuses)


@router.post("/{campaign_id}/redial", response_model=CampaignResponse, status_code=201)
async def redial_campaign(
    campaign_id: str,
    body: RedialCampaignRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CampaignResponse:
    org_id = _require_org(current_user)
    try:
        parent = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    candidates = repo.get_redial_candidates(campaign_id)
    if not candidates:
        raise HTTPException(status_code=400, detail="No failed contacts to redial")
    body.name = _campaign_name(org_id, body.name)

    metadata = dict(parent.get("orchestrator_metadata") or {})
    metadata["parent_campaign_id"] = campaign_id

    child = repo.create_campaign(
        {
            "org_id": org_id,
            "name": body.name,
            "agent_id": parent["agent_id"],
            "telephony_provider": parent.get("telephony_provider"),
            "source_type": parent.get("source_type", "csv"),
            "source_id": parent["source_id"],
            "rate_limit_per_second": parent.get("rate_limit_per_second", 1),
            "retry_config": parent.get("retry_config"),
            "orchestrator_metadata": metadata,
            "from_number": parent.get("from_number"),
            "created_by": current_user.get("email"),
        }
    )
    child_id = str(child["campaign_id"])
    runs = []
    for idx, candidate in enumerate(candidates, 1):
        ctx = dict(candidate.get("context_variables") or {})
        runs.append(
            {
                "campaign_id": child_id,
                "source_uuid": f"redial_{campaign_id}_{idx}",
                "context_variables": ctx,
                "state": "queued",
            }
        )
    repo.bulk_create_queued_runs(runs)
    repo.update_campaign(child_id, total_rows=len(runs))
    audit_log.record(
        org_id,
        entity_type="campaign",
        action="created",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=child_id,
        entity_name=body.name,
        detail=f"redial of {campaign_id}",
    )
    return _to_campaign_response(repo.get_campaign_by_id(child_id) or child)


@router.get("/{campaign_id}/source-download-url")
async def source_download_url(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    org_id = _require_org(current_user)
    _require_delete_role(current_user)
    try:
        doc = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(doc.get("source_type") or "csv") != "csv":
        raise HTTPException(
            status_code=400,
            detail="Vault-backed campaigns have no source file; numbers stay in the vault",
        )
    security_audit.record(
        "contact.export",
        org_id=org_id,
        actor_type="user",
        actor_id=str(current_user.get("email") or ""),
        actor_role=str(current_user.get("role") or ""),
        outcome="success",
        action="legacy_source_download",
        metadata={"campaign_id": campaign_id, "format": "raw_csv_presigned_url"},
    )
    storage = MinIOStorage()
    url = storage.presigned_get_url(str(doc["source_id"]), expiration_seconds=300)
    return {"download_url": url}


@router.get("/{campaign_id}/report")
async def campaign_report(
    campaign_id: str,
    created_after: str | None = Query(default=None),
    created_before: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    org_id = _require_org(current_user)
    try:
        repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    filters = CallLogListFilters(
        campaign_id=campaign_id,
        created_after=created_after,
        created_before=created_before,
    )
    page_size = 500

    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "call_id",
                "campaign_id",
                "agent_id",
                "contact_id",
                "from_number",
                "to_number",
                "status",
                "call_response",
                "duration",
                "created_at",
                "recording_url",
                "transcript_url",
            ]
        )
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        exported = 0
        offset = 0
        try:
            while True:
                logs = list_call_logs_by_campaign(
                    org_id,
                    campaign_id,
                    limit=page_size,
                    offset=offset,
                    filters=filters,
                    enrich_campaign_names=False,
                )
                if not logs:
                    break
                masked_logs = mask_call_logs(
                    (
                        transform_call_log_urls(log, api_prefix=settings.API_V1_PREFIX)
                        for log in logs
                    ),
                    org_id=org_id,
                )
                for transformed in masked_logs:
                    writer.writerow(
                        [
                            csv_safe(v)
                            for v in (
                                transformed.get("call_id"),
                                campaign_id,
                                transformed.get("agent_id"),
                                transformed.get("contact_id"),
                                transformed.get("from_number"),
                                transformed.get("to_number"),
                                transformed.get("status"),
                                transformed.get("call_response"),
                                transformed.get("duration"),
                                transformed.get("created_at"),
                                transformed.get("recording_url"),
                                transformed.get("transcript_url"),
                            )
                        ]
                    )
                    exported += 1
                    yield buffer.getvalue()
                    buffer.seek(0)
                    buffer.truncate(0)
                if len(logs) < page_size:
                    break
                offset += page_size
        finally:
            # Audit the export once streaming ends (or the client goes away),
            # with the number of masked rows actually written.
            security_audit.record(
                "contact.export",
                org_id=org_id,
                actor_type="user",
                actor_id=str(current_user.get("email") or ""),
                actor_role=str(current_user.get("role") or ""),
                outcome="success",
                action="campaign_report",
                metadata={"campaign_id": campaign_id, "rows": exported, "numbers": "masked"},
            )

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="campaign_{campaign_id}.csv"'
        },
    )


@router.post("/internal/call-status")
async def internal_call_status(
    body: CampaignCallStatusRequest,
    _: bool = Depends(verify_api_key),
) -> dict[str, str]:
    from app.services.call_log_service import get_call_log, CallLogNotFoundError

    try:
        call_log = get_call_log(body.org_id, body.call_id)
    except CallLogNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await handle_call_terminal(
        call_id=body.call_id,
        campaign_id=call_log.get("campaign_id"),
        queued_run_id=call_log.get("queued_run_id"),
        call_response=body.call_response or call_log.get("call_response"),
    )
    return {"status": "ok"}
