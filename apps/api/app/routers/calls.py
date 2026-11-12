"""Outbound and inbound call routes."""

from __future__ import annotations

import logging
from typing import Any, Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.auth import get_current_user
from app.config import settings
from app.models.schemas import (
    CallAnalyticsResponse,
    CallLogListResponse,
    CallLogResponse,
    CallLogUpdateRequest,
    CallMetricsBody,
    CallMetricsResponse,
    InboundCallRegisterRequest,
    InboundCallRegisterResponse,
    OutboundCallRequest,
    OutboundCallResponse,
    WebCallRegisterRequest,
    WebCallRegisterResponse,
)
from app import rbac
from app.services import call_analysis, member_service, org_service
from app.services.call_log_service import (
    CallLogNotFoundError,
    count_call_logs_by_org,
    get_call_log,
    get_org_call_analytics,
    list_call_logs_by_org,
    patch_call_log,
    patch_call_log_by_provider_sid,
    transform_call_log_urls,
)
from app.services.call_metrics_service import (
    CallMetricsNotFoundError,
    get_call_metrics,
    upsert_call_metrics,
)
from app.services.inbound_call_service import InboundCallError, register_inbound_call
from app.services.outbound_call_service import OutboundCallError, initiate_outbound_call
from app.services.web_call_service import WebCallError, register_web_call
from app.services.secure.contact_ingest import protect_number
from app.services.secure.keys import VaultKeyError
from app.services.secure.masking import mask_call_logs, mask_one
from app.storage.minio_client import MinIOStorage

router = APIRouter(prefix="/calls", tags=["calls"])
logger = logging.getLogger(__name__)


def _require_active_org(current_user: dict[str, Any]) -> str:
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active organisation in token",
        )
    return str(org_id)


def _raise_outbound_error(exc: OutboundCallError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail=exc.message,
    ) from exc


def _raise_inbound_error(exc: InboundCallError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail=exc.message,
    ) from exc


def _raise_web_call_error(exc: WebCallError) -> None:
    raise HTTPException(
        status_code=exc.status_code,
        detail=exc.message,
    ) from exc


def _raise_call_not_found(exc: CallLogNotFoundError) -> None:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=str(exc),
    ) from exc


def _raise_call_metrics_not_found(exc: CallMetricsNotFoundError) -> None:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=str(exc),
    ) from exc


def _artifact_content_type(object_name: str, default: str) -> str:
    if object_name.endswith(".wav"):
        return "audio/wav"
    if object_name.endswith(".mp3"):
        return "audio/mpeg"
    if object_name.endswith(".txt"):
        return "text/plain; charset=utf-8"
    return default


def _stream_minio_object(bucket_name: str, object_name: str, content_type: str):
    storage = MinIOStorage()

    def iterator() -> Iterator[bytes]:
        response = storage.client.get_object(bucket_name, object_name)
        try:
            for chunk in response.stream(32 * 1024):
                yield chunk
        finally:
            response.close()
            response.release_conn()

    return StreamingResponse(iterator(), media_type=content_type)


@router.post(
    "/outbound",
    response_model=OutboundCallResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_outbound_call(
    body: OutboundCallRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Initiate an outbound call and register a CallLog with status initiated.

    VoicEra Secure: the destination is hashed and encrypted under the
    adopter's own keys and the CallLog keeps only its contact ID and masked
    form. The plain number is used for the dial and not stored.
    """
    org_id = _require_active_org(current_user)
    contact_id = None
    try:
        contact_id = protect_number(
            org_id, body.to_number, actor_email=str(current_user.get("email") or ""), source={"outbound_api": True}
        )
    except VaultKeyError as exc:
        # Nothing raw is stored either way; the call proceeds without a vault link.
        logger.warning("Outbound number not vaulted (vault unavailable): %s", exc)
    try:
        return await initiate_outbound_call(
            org_id,
            body.agent_id,
            body.to_number,
            from_number=body.from_number,
            custom_variables=body.custom_variables,
            contact_id=contact_id,
        )
    except OutboundCallError as exc:
        _raise_outbound_error(exc)


@router.post(
    "/inbound",
    response_model=InboundCallRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_inbound_call(
    body: InboundCallRegisterRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Register an inbound call when the voice runtime answer webhook fires."""
    org_id = _require_active_org(current_user)
    try:
        return register_inbound_call(
            org_id,
            body.agent_id,
            provider_call_sid=body.provider_call_sid,
            from_number=body.from_number,
            to_number=body.to_number,
        )
    except InboundCallError as exc:
        _raise_inbound_error(exc)


@router.post(
    "/web",
    response_model=WebCallRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_web_call(
    body: WebCallRegisterRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Register a browser websocket session for CallLog artifacts."""
    org_id = _require_active_org(current_user)
    try:
        return register_web_call(
            org_id,
            body.agent_id,
            custom_variables=body.custom_variables,
        )
    except WebCallError as exc:
        _raise_web_call_error(exc)


@router.patch("/by-provider-sid/{provider_call_sid}", response_model=CallLogResponse)
async def patch_call_by_provider_sid(
    provider_call_sid: str,
    body: CallLogUpdateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Patch a CallLog by telephony provider SID (runtime hangup callbacks)."""
    org_id = _require_active_org(current_user)
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )
    try:
        doc = patch_call_log_by_provider_sid(org_id, provider_call_sid, patch)
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)
    return mask_one(transform_call_log_urls(doc, api_prefix=settings.API_V1_PREFIX), org_id=org_id)


@router.patch("/{call_id}", response_model=CallLogResponse)
async def patch_call(
    call_id: str,
    body: CallLogUpdateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Patch artifact URLs on a CallLog (bot JWT supported)."""
    org_id = _require_active_org(current_user)
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )
    try:
        doc = patch_call_log(org_id, call_id, patch)
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)
    if "transcript_url" in patch or "call_response" in patch:
        await call_analysis.after_call_update(org_id, doc)
    return mask_one(transform_call_log_urls(doc, api_prefix=settings.API_V1_PREFIX), org_id=org_id)


@router.get("/{call_id}/recording")
async def get_call_recording(
    call_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    """Stream the call recording from MinIO."""
    org_id = _require_active_org(current_user)
    try:
        call = get_call_log(org_id, call_id)
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)

    recording_url = call.get("recording_url")
    if not recording_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found for this call",
        )

    parsed = MinIOStorage.parse_minio_url(str(recording_url))
    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid recording URL on call log",
        )

    bucket_name, object_name = parsed
    storage = MinIOStorage()
    if not storage.object_exists(bucket_name, object_name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recording file not found: {object_name}",
        )

    content_type = _artifact_content_type(object_name, "audio/wav")
    return _stream_minio_object(bucket_name, object_name, content_type)


@router.get("/{call_id}/transcript")
async def get_call_transcript(
    call_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    """Stream the call transcript from MinIO."""
    org_id = _require_active_org(current_user)
    try:
        call = get_call_log(org_id, call_id)
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)

    if call.get("transcript_inline"):
        label = "SYNTHETIC TEST TRANSCRIPT (mock provider, not a real call)\n\n" if call.get("transcript_source") == "synthetic_mock" else ""
        text = label + "\n".join(f"{t.get('role', '').upper()}: {t.get('text', '')}" for t in call["transcript_inline"])
        return StreamingResponse(iter([text.encode("utf-8")]), media_type="text/plain; charset=utf-8")

    transcript_url = call.get("transcript_url")
    if not transcript_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transcript not found for this call",
        )

    parsed = MinIOStorage.parse_minio_url(str(transcript_url))
    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid transcript URL on call log",
        )

    bucket_name, object_name = parsed
    storage = MinIOStorage()
    if not storage.object_exists(bucket_name, object_name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript file not found: {object_name}",
        )

    content_type = _artifact_content_type(object_name, "text/plain; charset=utf-8")
    return _stream_minio_object(bucket_name, object_name, content_type)


@router.get("/{call_id}/metrics", response_model=CallMetricsResponse)
async def get_call_metrics_route(
    call_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch pipeline metrics for one call (bot JWT supported)."""
    org_id = _require_active_org(current_user)
    try:
        return get_call_metrics(org_id, call_id)
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)
    except CallMetricsNotFoundError as exc:
        _raise_call_metrics_not_found(exc)


@router.put("/{call_id}/metrics", response_model=CallMetricsResponse)
async def put_call_metrics(
    call_id: str,
    body: CallMetricsBody,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Upsert pipeline metrics for one call (bot JWT supported; write-once)."""
    org_id = _require_active_org(current_user)
    try:
        return upsert_call_metrics(org_id, call_id, body.model_dump())
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)


@router.get("/org/{org_id}", response_model=CallLogListResponse)
async def list_org_calls(
    org_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    campaign_id: str | None = Query(default=None, description="Only this campaign's calls"),
    date_from: str | None = Query(default=None, description="First local day, YYYY-MM-DD"),
    date_to: str | None = Query(default=None, description="Last local day, YYYY-MM-DD (inclusive)"),
    tz: str = Query(default="Asia/Kolkata", description="Time zone the days are in"),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CallLogListResponse:
    """List call logs for an organisation (Bearer; must be a member of that org).

    Optional filters: one campaign, and a range of local days (both dates, inclusive).
    """
    token_org_id = _require_active_org(current_user)
    if org_id != token_org_id:
        membership = member_service.get_membership(current_user["email"], org_id)
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access calls for this organisation",
            )

    if not org_service.get_organisation(org_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisation not found",
        )

    filters: dict[str, Any] = {}
    if campaign_id:
        filters["campaign_id"] = campaign_id
    if date_from or date_to:
        from app.services import campaign_insights

        try:
            start, end = campaign_insights.parse_period(date_from or date_to or "", date_to or date_from or "")
            lo, hi = campaign_insights.utc_bounds(start, end, campaign_insights.zone(tz))
        except campaign_insights.InsightsError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        filters["created_at"] = {"$gte": lo, "$lt": hi}
    logs = list_call_logs_by_org(org_id, limit=limit, offset=offset, filters=filters or None)
    total = count_call_logs_by_org(org_id, filters=filters or None)
    details = _can_read_details(current_user, org_id)
    return CallLogListResponse(
        calls=mask_call_logs(
            (
                call_analysis.visible_to(transform_call_log_urls(log, api_prefix=settings.API_V1_PREFIX), details)
                for log in logs
            ),
            org_id=org_id,
        ),
        limit=limit,
        offset=offset,
        total=total,
    )


@router.get("/org/{org_id}/analytics", response_model=CallAnalyticsResponse)
async def get_org_call_analytics_route(
    org_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CallAnalyticsResponse:
    """All-time call analytics for an organisation (Bearer; must be a member of that org)."""
    token_org_id = _require_active_org(current_user)
    if org_id != token_org_id:
        membership = member_service.get_membership(current_user["email"], org_id)
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access calls for this organisation",
            )

    if not org_service.get_organisation(org_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisation not found",
        )

    return CallAnalyticsResponse(**get_org_call_analytics(org_id))


@router.get("/{call_id}", response_model=CallLogResponse)
async def get_call(
    call_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch one call log by id (same organisation only; bot JWT supported)."""
    org_id = _require_active_org(current_user)
    try:
        doc = get_call_log(org_id, call_id)
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)
    doc = call_analysis.visible_to(doc, _can_read_details(current_user, org_id))
    return mask_one(transform_call_log_urls(doc, api_prefix=settings.API_V1_PREFIX), org_id=org_id)


@router.post("/{call_id}/analyze", response_model=CallLogResponse)
async def analyse_call(
    call_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Run (or re-run) the analysis of one call from its transcript."""
    org_id = _require_active_org(current_user)
    try:
        doc = get_call_log(org_id, call_id)
    except CallLogNotFoundError as exc:
        _raise_call_not_found(exc)
    if str(doc.get("call_response") or "") in ("", "pending"):
        raise HTTPException(status_code=409, detail="This call hasn't finished yet.")
    synthetic = str(doc.get("transcript_source") or "") == "synthetic_mock"
    if str(doc.get("call_response")) == "answered" and not synthetic and not doc.get("transcript_url"):
        raise HTTPException(status_code=404, detail="No transcript is available for this call yet.")
    await call_analysis.after_call_update(org_id, {**doc, "analysis": None}, synthetic=synthetic)
    doc = get_call_log(org_id, call_id)
    return mask_one(transform_call_log_urls(doc, api_prefix=settings.API_V1_PREFIX), org_id=org_id)


def _can_read_details(current_user: dict[str, Any], org_id: str) -> bool:
    email = str(current_user.get("email") or "")
    role = str(current_user.get("role") or "") if email == rbac.BOT_SERVICE_EMAIL else rbac.membership_role(email, org_id)
    return rbac.has_permission(role, "recordings:read")
