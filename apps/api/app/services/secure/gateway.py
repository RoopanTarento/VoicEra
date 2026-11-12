"""Secure telephony gateway: dial by contact ID, sanitise callbacks.

``dial_contact`` is the only place a vault number is decrypted for a call. It
resolves under the gateway's in-process service identity, hands the number to
the existing vendor-agnostic ``initiate_outbound_call`` (so Plivo, Vobiz and
the Pipecat media flow are unchanged) and lets it go out of scope. The
CallLog keeps ``contact_id`` and the masked number only.

``handle_provider_callback`` is the in-process equivalent of the voice
runtime's hangup webhook, used by the mock provider when the runtime is not
running. It masks ``From`` / ``To`` before anything else sees the payload.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.services import agent_service, call_log_service
from app.services.agent_service import AgentNotFoundError
from app.services.outbound_call_service import OutboundCallError, initiate_outbound_call
from app.services.secure import security_audit
from app.services.secure import vault_repository as vault
from app.services.secure.resolution import ResolutionDenied, resolve_contact
from app.services.secure.service_identity import SECURE_GATEWAY_IDENTITY
from apps.pii import scrub_mapping
from apps.telephony import map_hangup_call_response, sanitize_webhook_payload

logger = logging.getLogger(__name__)

MOCK_PROVIDER = "mock"


class GatewayError(Exception):
    def __init__(self, message: str, *, status_code: int = 422, reason: str | None = None) -> None:
        self.message = message
        self.status_code = status_code
        self.reason = reason
        super().__init__(message)


def _agent_provider(org_id: str, agent_id: str) -> str:
    try:
        agent = agent_service.get_agent(org_id, agent_id)
    except AgentNotFoundError as exc:
        raise GatewayError(str(exc), status_code=404) from exc
    return str((agent.get("telephony") or {}).get("provider") or "").strip().lower()


async def dial_contact(
    org_id: str,
    agent_id: str,
    contact_id: str,
    *,
    from_number: str | None = None,
    custom_variables: dict[str, Any] | None = None,
    initiated_by: str,
) -> dict[str, Any]:
    """Resolve ``contact_id`` for this one dial and place the call."""
    provider = _agent_provider(org_id, agent_id)
    try:
        contact = vault.get_contact(org_id, contact_id)
    except vault.ContactNotFoundError:
        contact = None
    if contact and contact.get("synthetic") and provider != MOCK_PROVIDER:
        security_audit.record(
            "gateway.call",
            org_id=org_id,
            actor_type="service",
            actor_id=SECURE_GATEWAY_IDENTITY.service_id,
            outcome="denied",
            contact_id=contact_id,
            reason="synthetic_contact_real_provider",
            metadata={"agent_id": agent_id, "provider": provider, "initiated_by": initiated_by},
        )
        raise GatewayError(
            "Synthetic demo contacts can only be dialled through the mock provider",
            status_code=403,
            reason="synthetic_contact_real_provider",
        )

    variables = dict(custom_variables or {})
    variables.setdefault("contact_id", contact_id)
    if contact:
        variables.setdefault("called_number", contact.get("masked_phone"))
        if contact.get("display_name"):
            variables.setdefault("name", contact["display_name"])

    try:
        resolved = resolve_contact(
            org_id=org_id,
            contact_id=contact_id,
            identity=SECURE_GATEWAY_IDENTITY,
            purpose="dial",
            metadata={"agent_id": agent_id, "initiated_by": initiated_by},
        )
    except ResolutionDenied as exc:
        raise GatewayError(exc.message, status_code=403 if exc.reason != "contact_not_found" else 404, reason=exc.reason) from exc

    try:
        result = await initiate_outbound_call(
            org_id,
            agent_id,
            resolved.reveal(),
            from_number=from_number,
            custom_variables=scrub_mapping(variables),
            contact_id=contact_id,
        )
    except OutboundCallError as exc:
        security_audit.record(
            "gateway.call",
            org_id=org_id,
            actor_type="service",
            actor_id=SECURE_GATEWAY_IDENTITY.service_id,
            outcome="error",
            contact_id=contact_id,
            reason=exc.message,
            metadata={"agent_id": agent_id, "provider": provider, "initiated_by": initiated_by},
        )
        raise GatewayError(exc.message, status_code=exc.status_code) from exc
    finally:
        del resolved

    security_audit.record(
        "gateway.call",
        org_id=org_id,
        actor_type="service",
        actor_id=SECURE_GATEWAY_IDENTITY.service_id,
        outcome="success",
        contact_id=contact_id,
        metadata={
            "agent_id": agent_id,
            "provider": provider,
            "call_id": result.get("call_id"),
            "initiated_by": initiated_by,
        },
    )
    vault.increment_metric(org_id, "secure_calls")
    return result


async def handle_provider_callback(payload: dict[str, Any]) -> dict[str, Any]:
    """Apply a provider hangup callback after masking its numbers.

    Mirrors ``apps/runtime/routes/telephony.py`` for the hangup branch:
    patch the CallLog by ``call_id`` and notify the campaign status processor.
    """
    from app.services.campaign.status_processor import handle_call_terminal

    raw_had_numbers = any(payload.get(k) for k in ("From", "To", "from", "to"))
    clean = sanitize_webhook_payload(payload)
    org_id = str(clean.get("org_id") or "")
    call_id = str(clean.get("call_id") or "")
    if not org_id or not call_id:
        logger.warning("Provider callback without org_id/call_id ignored")
        return {"status": "ignored"}

    call_status = str(clean.get("CallStatus") or "").lower()
    answered = call_status == "completed" and bool(clean.get("AnswerTime"))
    call_response = "answered" if answered else map_hangup_call_response(call_status, str(clean.get("HangupCause") or ""))
    patch: dict[str, Any] = {"status": "completed"}
    if call_response:
        patch["call_response"] = call_response
    try:
        duration = float(clean.get("Duration") or 0)
    except ValueError:
        duration = 0.0
    if answered and duration:
        patch["duration"] = duration
    patch["end_time_utc"] = datetime.now(timezone.utc).isoformat()
    try:
        call_log = call_log_service.patch_call_log(org_id, call_id, patch)
    except call_log_service.CallLogNotFoundError:
        logger.warning("Provider callback for unknown call_id=%s", call_id)
        return {"status": "unknown_call"}

    if raw_had_numbers:
        security_audit.record(
            "callback.sanitized",
            org_id=org_id,
            actor_type="system",
            actor_id="telephony-callback",
            outcome="success",
            contact_id=call_log.get("contact_id"),
            metadata={"call_id": call_id, "fields_masked": ["From", "To"], "call_response": call_response},
        )
        vault.increment_metric(org_id, "callbacks_sanitized")

    if call_response:
        from app.services import call_analysis

        await call_analysis.after_call_update(
            org_id, call_log, synthetic=str(call_log.get("telephony_provider") or "") == "mock" and answered
        )
        await handle_call_terminal(
            call_id=call_id,
            campaign_id=call_log.get("campaign_id"),
            queued_run_id=call_log.get("queued_run_id"),
            call_response=call_response,
        )
    return {"status": "ok", "call_response": call_response}
