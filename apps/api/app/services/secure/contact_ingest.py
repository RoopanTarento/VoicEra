"""CSV contact ingest: validate, detect duplicates, stage encrypted, tokenise.

Upload never writes a plaintext number anywhere. Valid rows are encrypted
straight into a 24-hour staging collection (AAD bound to the batch row); the
upload response carries only masked numbers. Tokenisation decrypts each
staged row in memory, re-encrypts it under a fresh contact ID and inserts the
vault record, then deletes the staging rows.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.services.secure import crypto, security_audit
from app.services.secure import vault_repository as vault
from app.services.secure.phone import InvalidPhoneNumberError, normalize_phone
from app.services.secure.tokenization import generate_batch_id
from apps.pii import mask_email, redact_text

logger = logging.getLogger(__name__)

MAX_ROWS = 50_000
PREVIEW_ROWS = 200
MAX_ATTRIBUTES = 20

PHONE_ALIASES = ("phone_number", "phone", "mobile", "mobile_number", "contact_number", "msisdn")
NAME_ALIASES = ("name", "full_name", "contact_name", "customer_name")
EMAIL_ALIASES = ("email", "email_address")
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
_HEADER_CLEAN = re.compile(r"[^a-z0-9_]+")

ROW_VALID = "valid"
ROW_INVALID = "invalid"
ROW_DUPLICATE_IN_FILE = "duplicate_in_file"
ROW_DUPLICATE_EXISTING = "duplicate_existing"


class ContactFileError(ValueError):
    """The file as a whole is unusable (encoding, header, size)."""


@dataclass
class _Columns:
    headers: list[str]
    phone: int
    name: int | None
    email: int | None
    attributes: list[int]


def _normalize_header(value: str) -> str:
    return _HEADER_CLEAN.sub("_", value.strip().lower()).strip("_")


def _find(headers: list[str], aliases: tuple[str, ...]) -> int | None:
    for alias in aliases:
        if alias in headers:
            return headers.index(alias)
    return None


def _detect_columns(raw_headers: list[str]) -> _Columns:
    headers = [_normalize_header(h) for h in raw_headers]
    if not any(headers):
        raise ContactFileError("The first row must be a header row")
    phone = _find(headers, PHONE_ALIASES)
    if phone is None:
        raise ContactFileError(
            "Missing required column 'phone_number' (also accepted: phone, mobile, contact_number, msisdn)"
        )
    name = _find(headers, NAME_ALIASES)
    email = _find(headers, EMAIL_ALIASES)
    used = {phone, name, email}
    attributes = [i for i, h in enumerate(headers) if i not in used and h][:MAX_ATTRIBUTES]
    return _Columns(headers=headers, phone=phone, name=name, email=email, attributes=attributes)


def _cell(row: list[str], idx: int | None) -> str:
    if idx is None or idx >= len(row):
        return ""
    return str(row[idx]).strip()


def parse_csv(content: bytes) -> tuple[_Columns, list[list[str]]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ContactFileError("File is not UTF-8 encoded text") from exc
    rows = list(csv.reader(io.StringIO(text)))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ContactFileError("CSV must have a header row and at least one contact row")
    if len(rows) - 1 > MAX_ROWS:
        raise ContactFileError(f"CSV has more than {MAX_ROWS} contact rows")
    return _detect_columns(rows[0]), rows[1:]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def upload(
    org_id: str,
    *,
    filename: str,
    content: bytes,
    actor_email: str,
    actor_role: str | None = None,
    synthetic: bool = False,
) -> dict[str, Any]:
    """Validate a CSV, stage valid rows encrypted, and return a masked report."""
    columns, data_rows = parse_csv(content)
    batch_id = generate_batch_id()
    now = _now_iso()
    expires = (datetime.now(timezone.utc) + vault.STAGING_TTL).isoformat()

    report_rows: list[dict[str, Any]] = []
    staged: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    pending_index: dict[str, int] = {}

    for offset, row in enumerate(data_rows):
        row_no = offset + 2  # spreadsheet row number (header is row 1)
        name = _cell(row, columns.name)[:120]
        entry: dict[str, Any] = {"row": row_no, "name": name or None, "masked_phone": None}
        raw_phone = _cell(row, columns.phone)
        if not raw_phone:
            entry.update(status=ROW_INVALID, reason="Phone number is empty")
            report_rows.append(entry)
            continue
        try:
            phone = normalize_phone(raw_phone)
        except InvalidPhoneNumberError as exc:
            entry.update(status=ROW_INVALID, reason=str(exc), masked_phone=None)
            report_rows.append(entry)
            continue
        entry["masked_phone"] = phone.masked
        if phone.e164 in seen:
            entry.update(status=ROW_DUPLICATE_IN_FILE, reason=f"Same number as row {seen[phone.e164]}")
            report_rows.append(entry)
            continue
        seen[phone.e164] = row_no

        email_raw = _cell(row, columns.email)
        email_ok = bool(email_raw and _EMAIL_RE.match(email_raw))
        attributes = {
            columns.headers[i]: redact_text(_cell(row, i)[:200]) for i in columns.attributes if _cell(row, i)
        }
        index = crypto.blind_index(org_id, phone.e164)
        for candidate in crypto.blind_indexes(org_id, phone.e164):
            pending_index[candidate] = len(report_rows)
        staging_key = f"{batch_id}:{row_no}"
        staged_doc: dict[str, Any] = {
            "batch_id": batch_id,
            "org_id": org_id,
            "row": row_no,
            "phone_index": index,
            "phone": crypto.encrypt_value(phone.e164, org_id=org_id, contact_id=staging_key).to_doc(),
            "masked_phone": phone.masked,
            "country_code": phone.country_code,
            "region": phone.region,
            "display_name": name or None,
            "attributes": attributes,
            "masked_email": mask_email(email_raw) if email_ok else None,
            "expires_at": expires,
        }
        if email_ok:
            staged_doc["email"] = crypto.encrypt_value(
                email_raw, org_id=org_id, contact_id=staging_key, field="email"
            ).to_doc()
        entry.update(status=ROW_VALID, reason=None)
        if email_raw and not email_ok:
            entry["warning"] = "Email address ignored: not a valid address"
        report_rows.append(entry)
        staged.append(staged_doc)

    # Numbers already protected in this organisation's vault.
    existing = vault.existing_indexes(org_id, list(pending_index))
    if existing:
        duplicate_rows = set()
        for index, contact_id in existing.items():
            entry = report_rows[pending_index[index]]
            entry.update(status=ROW_DUPLICATE_EXISTING, reason="Already protected in the vault", existing_contact_id=contact_id)
            duplicate_rows.add(entry["row"])
        staged = [s for s in staged if s["row"] not in duplicate_rows]

    vault.stage_rows(staged)
    summary = _summarise(report_rows)
    batch = {
        "batch_id": batch_id,
        "org_id": org_id,
        "filename": filename,
        "status": "validated",
        "synthetic": synthetic,
        "columns": columns.headers,
        "detected": {
            "phone": columns.headers[columns.phone],
            "name": columns.headers[columns.name] if columns.name is not None else None,
            "email": columns.headers[columns.email] if columns.email is not None else None,
            "attributes": [columns.headers[i] for i in columns.attributes],
        },
        "summary": summary,
        "created_by": actor_email,
        "created_at": now,
        "expires_at": expires,
        "tokenized_at": None,
        "result": None,
    }
    vault.save_batch(batch)
    security_audit.record(
        "contact.upload",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success",
        metadata={"batch_id": batch_id, "filename": filename, **summary},
    )
    issues = [r for r in report_rows if r["status"] != ROW_VALID or r.get("warning")]
    return {
        **{k: v for k, v in batch.items() if k not in ("org_id",)},
        "rows": report_rows[:PREVIEW_ROWS],
        "issues": issues[:1000],
        "rows_truncated": len(report_rows) > PREVIEW_ROWS,
    }


def _summarise(rows: list[dict[str, Any]]) -> dict[str, int]:
    def count(status: str) -> int:
        return sum(1 for r in rows if r["status"] == status)

    return {
        "total_rows": len(rows),
        "valid_rows": count(ROW_VALID),
        "invalid_rows": count(ROW_INVALID),
        "duplicate_in_file": count(ROW_DUPLICATE_IN_FILE),
        "duplicate_existing": count(ROW_DUPLICATE_EXISTING),
    }


class BatchNotFoundError(LookupError):
    pass


class BatchStateError(ValueError):
    pass


def tokenize(
    org_id: str,
    batch_id: str,
    *,
    actor_email: str,
    actor_role: str | None = None,
) -> dict[str, Any]:
    """Move a validated batch into the vault under fresh contact IDs."""
    batch = vault.get_batch(org_id, batch_id)
    if not batch:
        raise BatchNotFoundError(batch_id)
    if batch.get("status") == "tokenized":
        raise BatchStateError("This upload has already been tokenised")
    if str(batch.get("expires_at") or "") < _now_iso():
        vault.delete_staging(batch_id)
        raise BatchStateError("This upload expired after 24 hours. Upload the file again.")

    created: list[dict[str, Any]] = []
    skipped_duplicates = 0
    failed = 0
    now = _now_iso()

    for staged in vault.staged_rows(batch_id):
        staging_key = f"{batch_id}:{staged['row']}"
        try:
            e164 = crypto.decrypt_value(staged["phone"], org_id=org_id, contact_id=staging_key)
            email = (
                crypto.decrypt_value(staged["email"], org_id=org_id, contact_id=staging_key, field="email")
                if staged.get("email")
                else None
            )
        except crypto.VaultDecryptionError:
            failed += 1
            logger.warning("Staged row failed authentication batch=%s row=%s", batch_id, staged["row"])
            continue

        def build(contact_id: str, staged=staged, e164=e164, email=email) -> dict[str, Any]:
            phone_enc = crypto.encrypt_value(e164, org_id=org_id, contact_id=contact_id)
            record = {
                "contact_id": contact_id,
                "org_id": org_id,
                "display_name": staged.get("display_name"),
                "attributes": staged.get("attributes") or {},
                "phone": phone_enc.to_doc(),
                "phone_index": staged["phone_index"],
                "masked_phone": staged["masked_phone"],
                "country_code": staged.get("country_code"),
                "region": staged.get("region"),
                "masked_email": staged.get("masked_email"),
                "key_version": phone_enc.key_version,
                "status": vault.STATUS_ACTIVE,
                "synthetic": bool(batch.get("synthetic")),
                "source": {"batch_id": batch_id, "filename": batch.get("filename"), "row": staged["row"]},
                "created_by": actor_email,
                "created_at": now,
                "updated_at": now,
                "deleted_at": None,
                "last_resolved_at": None,
                "resolution_count": 0,
            }
            if email:
                record["email"] = crypto.encrypt_value(
                    email, org_id=org_id, contact_id=contact_id, field="email"
                ).to_doc()
            return record

        try:
            record = vault.insert_contact_with_builder(build)
        except vault.DuplicateContactError:
            skipped_duplicates += 1
            continue
        created.append(vault.to_safe_view(record) or {})

    vault.delete_staging(batch_id)
    result = {
        "created": len(created),
        "skipped_duplicates": skipped_duplicates,
        "failed": failed,
    }
    vault.update_batch(batch_id, status="tokenized", tokenized_at=now, result=result)
    vault.increment_metric(org_id, "contacts_tokenized", len(created))
    security_audit.record(
        "contact.tokenize",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success" if not failed else "error",
        metadata={"batch_id": batch_id, **result},
    )
    return {"batch_id": batch_id, **result, "contacts": created[:PREVIEW_ROWS]}


# --- transparent protection for existing VoicEra flows ---------------------------------


def protect_numbers(
    org_id: str,
    entries: list[dict[str, Any]],
    *,
    actor_email: str,
    source: dict[str, Any],
    synthetic: bool = False,
) -> list[str]:
    """Hash and encrypt numbers that arrive through normal VoicEra flows.

    ``entries`` items carry ``e164`` (already normalised) and optionally
    ``name`` / ``attributes``. A number already protected for this adopter
    (matched by its keyed hash under any live key version) reuses its contact
    ID; anything new is encrypted under a fresh one. Returns contact IDs in
    input order. Plaintext exists only in memory for the duration of the call.
    """
    if not entries:
        return []
    now = _now_iso()
    index_to_positions: dict[str, list[int]] = {}
    active_index: list[str] = []
    for pos, entry in enumerate(entries):
        active_index.append(crypto.blind_index(org_id, entry["e164"]))
        for candidate in crypto.blind_indexes(org_id, entry["e164"]):
            index_to_positions.setdefault(candidate, []).append(pos)
    existing = vault.existing_indexes(org_id, list(index_to_positions))
    result: list[str | None] = [None] * len(entries)
    for index, contact_id in existing.items():
        for pos in index_to_positions.get(index, []):
            result[pos] = contact_id

    created = 0
    for pos, entry in enumerate(entries):
        if result[pos] is not None:
            continue
        e164 = entry["e164"]
        phone = normalize_phone(e164)

        def build(contact_id: str, entry=entry, phone=phone, index=active_index[pos]) -> dict[str, Any]:
            enc = crypto.encrypt_value(phone.e164, org_id=org_id, contact_id=contact_id)
            return {
                "contact_id": contact_id,
                "org_id": org_id,
                "display_name": (entry.get("name") or None),
                "attributes": entry.get("attributes") or {},
                "phone": enc.to_doc(),
                "phone_index": index,
                "masked_phone": phone.masked,
                "country_code": phone.country_code,
                "region": phone.region,
                "masked_email": None,
                "key_version": enc.key_version,
                "status": vault.STATUS_ACTIVE,
                "synthetic": synthetic,
                "source": {**source, "row": entry.get("row")},
                "created_by": actor_email,
                "created_at": now,
                "updated_at": now,
                "deleted_at": None,
                "last_resolved_at": None,
                "resolution_count": 0,
            }

        try:
            record = vault.insert_contact_with_builder(build)
            contact_id = record["contact_id"]
            created += 1
        except vault.DuplicateContactError:
            # Same number inserted concurrently (or earlier in this batch).
            found = vault.find_active_by_index(org_id, active_index[pos])
            if not found:
                raise
            contact_id = found["contact_id"]
        result[pos] = contact_id
        for other in range(pos + 1, len(entries)):
            if result[other] is None and active_index[other] == active_index[pos]:
                result[other] = contact_id

    vault.increment_metric(org_id, "contacts_tokenized", created)
    security_audit.record(
        "contact.tokenize",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        outcome="success",
        action="transparent_protection",
        metadata={**{k: v for k, v in source.items() if k != "row"}, "numbers": len(entries), "new_contacts": created},
    )
    return [c for c in result if c is not None]


def protect_number(org_id: str, raw_number: str, *, actor_email: str, source: dict[str, Any]) -> str | None:
    """Protect one number (e.g. from ``POST /calls/outbound``). None if it can't be parsed."""
    try:
        phone = normalize_phone(raw_number)
    except InvalidPhoneNumberError:
        return None
    return protect_numbers(org_id, [{"e164": phone.e164}], actor_email=actor_email, source=source)[0]
