"""API-boundary masking for call logs and other contact-bearing documents.

New call logs already store contact numbers masked; this layer also covers
records written before VoicEra Secure, so every response is masked
regardless of what is in the database. Only the *contact* side is masked:
the org's own caller ID (from_number on outbound, to_number on inbound) is a
business number and stays visible, as the dashboard already assumes.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.services.secure import vault_repository as vault
from apps.pii import mask_phone, redact_text, scrub_mapping

_MASK_CHAR = "*"


def _is_masked(value: Any) -> bool:
    return isinstance(value, str) and _MASK_CHAR in value


def _mask_field(doc: dict[str, Any], field: str) -> int:
    value = doc.get(field)
    if not value or value == "unknown" or _is_masked(value):
        return 0
    doc[field] = mask_phone(value)
    return 1


def mask_call_log(doc: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Return a masked copy of a call log and how many raw numbers were replaced."""
    out = dict(doc)
    replaced = 0
    call_type = str(out.get("call_type") or "")
    if call_type == "outbound":
        replaced += _mask_field(out, "to_number")
    elif call_type == "inbound":
        replaced += _mask_field(out, "from_number")
    elif call_type != "web":
        replaced += _mask_field(out, "to_number") + _mask_field(out, "from_number")

    variables = out.get("custom_variables")
    if isinstance(variables, dict) and variables:
        scrubbed = scrub_mapping(variables)
        replaced += sum(1 for k in variables if variables[k] != scrubbed.get(k))
        out["custom_variables"] = scrubbed
    if out.get("error_message"):
        cleaned = redact_text(str(out["error_message"]))
        replaced += int(cleaned != out["error_message"])
        out["error_message"] = cleaned
    return out, replaced


def mask_call_logs(docs: Iterable[dict[str, Any]], *, org_id: str | None = None) -> list[dict[str, Any]]:
    """Mask a batch of call logs and record how many raw values were withheld."""
    masked: list[dict[str, Any]] = []
    total = 0
    for doc in docs:
        out, replaced = mask_call_log(doc)
        masked.append(out)
        total += replaced
    if org_id and total:
        vault.increment_metric(org_id, "exposures_prevented", total)
    return masked


def mask_one(doc: dict[str, Any], *, org_id: str | None = None) -> dict[str, Any]:
    return mask_call_logs([doc], org_id=org_id)[0]


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: Any) -> Any:
    """Neutralise spreadsheet formula injection for one CSV cell."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value
