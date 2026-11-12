"""Campaign outbound calling API."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import get_current_user, verify_api_key
from app.constants.campaign import DEFAULT_CAMPAIGN_RETRY_CONFIG
from app.config import settings
from app.database_init import ROLE_ADMIN, ROLE_SUPER_ADMIN
from app.models.schemas import (
    CampaignCallStatusRequest,
    CampaignCsvUploadResponse,
    CampaignProgressResponse,
    CampaignResponse,
    CreateCampaignRequest,
    RedialCampaignRequest,
    SuccessResponse,
    UpdateCampaignRequest,
)
from app.services import agent_service, audit_log, campaign_insights, naming
from app.services.agent_service import AgentNotFoundError
from app.services.call_log_service import list_call_logs_by_campaign, transform_call_log_urls
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
from apps.pii import scrub_mapping
from app.services.secure import security_audit
from app.services.secure.masking import csv_safe, mask_call_log, mask_call_logs
from app.storage.minio_client import MinIOStorage

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


def _count_agent_from_numbers(org_id: str, agent_id: str) -> int:
    count = 0
    try:
        agent = agent_service.get_agent(org_id, agent_id)
        if agent.get("linked_phone_number"):
            count += 1
    except AgentNotFoundError:
        pass
    for doc in phone_number_service.list_by_org(org_id):
        if doc.get("agent_id") == agent_id and doc.get("phone_number"):
            count += 1
    return count


def _validate_telephony_agent(org_id: str, agent_id: str) -> dict[str, Any]:
    try:
        agent = agent_service.get_agent(org_id, agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(agent.get("agent_category") or "") != "telephony":
        raise HTTPException(status_code=422, detail="Campaign requires a telephony agent")
    if _count_agent_from_numbers(org_id, agent_id) == 0:
        raise HTTPException(
            status_code=422,
            detail="Attach a phone number to this agent before creating a campaign",
        )
    return agent


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
    _validate_telephony_agent(org_id, body.agent_id)
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

    orchestrator_metadata: dict[str, Any] = {
        "max_concurrency": body.max_concurrency,
    }
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
            "source_type": body.source_type,
            "source_id": body.source_id,
            "rate_limit_per_second": body.rate_limit_per_second,
            "retry_config": retry_config,
            "orchestrator_metadata": orchestrator_metadata,
            "from_number": body.from_number,
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
    _validate_telephony_agent(org_id, str(source["agent_id"]))
    _validate_source_owner(org_id, str(source.get("source_type") or ""), str(source["source_id"]))
    metadata = {
        k: v for k, v in dict(source.get("orchestrator_metadata") or {}).items()
        if k in ("max_concurrency", "schedule_config", "circuit_breaker")
    }
    doc = repo.create_campaign(
        {
            "org_id": org_id,
            "name": name,
            "agent_id": source["agent_id"],
            "source_type": source.get("source_type", "csv"),
            "source_id": source["source_id"],
            "rate_limit_per_second": source.get("rate_limit_per_second", 1),
            "retry_config": source.get("retry_config") or dict(DEFAULT_CAMPAIGN_RETRY_CONFIG),
            "orchestrator_metadata": metadata,
            "from_number": source.get("from_number"),
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


@router.get("/{campaign_id}/runs")
async def get_campaign_runs(
    campaign_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    org_id = _require_org(current_user)
    try:
        repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    logs = list_call_logs_by_campaign(org_id, campaign_id, limit=limit, offset=offset)
    return mask_call_logs((transform_call_log_urls(log) for log in logs), org_id=org_id)


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
    return CampaignProgressResponse(**status_doc)


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
    current_user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    org_id = _require_org(current_user)
    try:
        repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    logs = list_call_logs_by_campaign(org_id, campaign_id, limit=500, offset=0)
    security_audit.record(
        "contact.export",
        org_id=org_id,
        actor_type="user",
        actor_id=str(current_user.get("email") or ""),
        actor_role=str(current_user.get("role") or ""),
        outcome="success",
        action="campaign_report",
        metadata={"campaign_id": campaign_id, "rows": len(logs), "numbers": "masked"},
    )

    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "call_id",
                "contact_id",
                "to_number",
                "status",
                "call_response",
                "duration",
                "created_at",
            ]
        )
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        for log in logs:
            log, _ = mask_call_log(log)
            writer.writerow(
                [
                    csv_safe(v)
                    for v in (
                        log.get("call_id"),
                        log.get("contact_id"),
                        log.get("to_number"),
                        log.get("status"),
                        log.get("call_response"),
                        log.get("duration"),
                        log.get("created_at"),
                    )
                ]
            )
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="campaign_{campaign_id}.csv"'
        },
    )


@router.get("/{campaign_id}/analytics")
async def campaign_analytics(
    campaign_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Post-campaign results: reach, outcomes, sentiment and agent feedback themes."""
    org_id = _require_org(current_user)
    try:
        campaign = repo.get_campaign_for_org(org_id, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    from app.services import call_analysis

    return call_analysis.campaign_analytics(org_id, campaign)


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
