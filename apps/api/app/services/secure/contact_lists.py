"""Contact lists: the Owner's named uploads that campaigns are created from.

A contact list is a ``SecureContactSets`` document (``set_id`` ``CSET-...``),
the same record the ``secure_contacts`` campaign source already dials from.
Uploading a CSV or Excel file here protects every number on arrival (keyed
hash + encryption under the adopter's own keys, see ``protect_numbers``) and
keeps only contact IDs plus the non-phone columns as call variables. The file
itself is never stored.

Unlike the legacy campaign upload, a list upload does not reject the whole
file for one bad row: invalid and repeated numbers are skipped and reported
by row number.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree

from app.database import get_database
from app.services import naming
from app.services.secure import security_audit
from app.services.secure import vault_repository as vault
from app.services.secure.contact_ingest import NAME_ALIASES, PHONE_ALIASES, protect_numbers
from app.services.secure.phone import InvalidPhoneNumberError, normalize_phone
from app.services.secure.tokenization import generate_contact_set_id
from apps.pii import scrub_mapping

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_ROWS = 50_000
PREVIEW_LIMIT = 50
_REPORTED_ROWS = 20
ACTIVE_CAMPAIGN_STATES = ("created", "syncing", "running", "paused")
_HEADER_CLEAN = re.compile(r"[^a-z0-9_]+")
_XLSX_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


class ContactListError(ValueError):
    """The upload or change can't be done; the message is safe to show."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _list_name(org_id: str, value: str | None, *, exclude_id: str | None = None) -> str:
    """Standard, unique (ignoring case) list name; deleted lists free their names."""
    try:
        name = naming.clean_name(value, what="contact list")
        others = [
            str(d.get("name") or "")
            for d in get_database()[vault.CONTACT_SETS].find(
                {"org_id": org_id, "kind": "list", "deleted_at": {"$exists": False}, "set_id": {"$ne": exclude_id}},
                {"_id": 0, "name": 1},
            )
        ]
        return naming.ensure_unique(name, others, what="contact list")
    except naming.NameError_ as exc:
        raise ContactListError(str(exc), status_code=exc.status_code) from exc


class ContactListNotFoundError(LookupError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_header(value: str) -> str:
    return _HEADER_CLEAN.sub("_", str(value or "").strip().lower()).strip("_")


# --- file parsing --------------------------------------------------------------------


def _read_csv(content: bytes) -> list[list[str]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ContactListError("Save the file as CSV UTF-8 and upload it again.") from exc
    return [row for row in csv.reader(io.StringIO(text)) if any(c.strip() for c in row)]


def _col_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    index = 0
    for ch in letters.upper():
        index = index * 26 + (ord(ch) - 64)
    return index - 1


def _cell_text(cell: ElementTree.Element, shared: list[str]) -> str:
    kind = cell.get("t")
    if kind == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(f"{{{_XLSX_NS['m']}}}t"))
    value = cell.find("m:v", _XLSX_NS)
    raw = value.text if value is not None and value.text is not None else ""
    if kind == "s":
        try:
            return shared[int(raw)]
        except (ValueError, IndexError):
            return ""
    if kind in (None, "n") and raw:
        # Excel keeps long numbers as floats (9.19876543210E+11); give the digits back.
        try:
            number = float(raw)
        except ValueError:
            return raw
        if number.is_integer():
            return str(int(number))
    return raw


def _read_xlsx(content: bytes) -> list[list[str]]:
    """First worksheet of an .xlsx file as rows of text (no third-party parser)."""
    try:
        book = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise ContactListError("That Excel file can't be read. Save it as .xlsx or CSV and try again.") from exc
    with book:
        names = set(book.namelist())
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ElementTree.fromstring(book.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", _XLSX_NS):
                shared.append("".join(t.text or "" for t in item.iter(f"{{{_XLSX_NS['m']}}}t")))
        sheet_path = _first_sheet_path(book, names)
        if not sheet_path:
            raise ContactListError("That Excel file has no worksheet.")
        root = ElementTree.fromstring(book.read(sheet_path))
    rows: list[list[str]] = []
    for row in root.iter(f"{{{_XLSX_NS['m']}}}row"):
        values: dict[int, str] = {}
        for position, cell in enumerate(row.findall("m:c", _XLSX_NS)):
            ref = cell.get("r")
            values[_col_index(ref) if ref else position] = _cell_text(cell, shared).strip()
        if values and any(values.values()):
            width = max(values) + 1
            rows.append([values.get(i, "") for i in range(width)])
        if len(rows) > MAX_ROWS + 1:
            break
    return rows


def _first_sheet_path(book: zipfile.ZipFile, names: set[str]) -> str | None:
    try:
        workbook = ElementTree.fromstring(book.read("xl/workbook.xml"))
        rels = ElementTree.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        first = workbook.find("m:sheets/m:sheet", _XLSX_NS)
        rel_id = first.get(_REL_NS) if first is not None else None
        for rel in rels:
            if rel.get("Id") == rel_id:
                target = rel.get("Target", "").lstrip("/")
                path = target if target.startswith("xl/") else f"xl/{target}"
                if path in names:
                    return path
    except (KeyError, ElementTree.ParseError):
        pass
    sheets = sorted(n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
    return sheets[0] if sheets else None


def read_rows(filename: str, content: bytes) -> list[list[str]]:
    name = filename.lower()
    if not content:
        raise ContactListError("The file is empty.")
    if len(content) > MAX_FILE_BYTES:
        raise ContactListError("The file is too large (10 MB maximum).", status_code=413)
    if name.endswith(".csv"):
        rows = _read_csv(content)
    elif name.endswith(".xlsx"):
        rows = _read_xlsx(content)
    else:
        raise ContactListError("Upload a CSV (.csv) or Excel (.xlsx) file.")
    if len(rows) < 2:
        raise ContactListError("The file needs a header row (for example phone_number) and at least one contact.")
    if len(rows) - 1 > MAX_ROWS:
        raise ContactListError(f"Too many rows ({MAX_ROWS:,} maximum per list).")
    return rows


# --- create / read / change ------------------------------------------------------------


def create_list(
    org_id: str,
    *,
    name: str,
    filename: str,
    content: bytes,
    actor_email: str,
    actor_role: str,
) -> dict[str, Any]:
    list_name = _list_name(org_id, name)

    rows = read_rows(filename, content)
    headers = [_clean_header(h) for h in rows[0]]
    phone_idx = next((headers.index(a) for a in PHONE_ALIASES if a in headers), None)
    if phone_idx is None:
        raise ContactListError("Add a column named phone_number (or phone / mobile) with the numbers.")
    name_idx = next((headers.index(a) for a in NAME_ALIASES if a in headers), None)

    entries: list[dict[str, Any]] = []
    members: list[dict[str, Any]] = []
    invalid: list[int] = []
    repeated: list[int] = []
    seen: set[str] = set()
    for row_no, row in enumerate(rows[1:], start=2):
        raw = row[phone_idx].strip() if len(row) > phone_idx else ""
        if not raw:
            invalid.append(row_no)
            continue
        try:
            e164 = normalize_phone(raw).e164
        except InvalidPhoneNumberError:
            invalid.append(row_no)
            continue
        if e164 in seen:
            repeated.append(row_no)
            continue
        seen.add(e164)
        padded = row + [""] * max(0, len(headers) - len(row))
        variables = {h: v for h, v in zip(headers, padded) if h and h != headers[phone_idx]}
        display = padded[name_idx].strip() if name_idx is not None else ""
        entries.append({"e164": e164, "name": display or None, "row": row_no})
        members.append({"variables": scrub_mapping(variables)})
    del seen
    if not entries:
        raise ContactListError("No valid phone numbers found. Check the phone_number column and the country code.")

    before = vault.count_contacts(org_id)
    contact_ids = protect_numbers(org_id, entries, actor_email=actor_email, source={"contact_list": list_name})
    del entries
    for member, cid in zip(members, contact_ids):
        member["contact_id"] = cid
    doc = vault.create_contact_set(
        {
            "set_id": generate_contact_set_id(),
            "org_id": org_id,
            "kind": "list",
            "name": list_name,
            # Uploaded names are never trusted: store the standard form, keep the original for display.
            "filename": naming.safe_filename(filename, default_stem="contacts"),
            "original_filename": filename.replace("/", "_").replace("\\", "_")[:200],
            "contact_ids": list(dict.fromkeys(contact_ids)),
            "members": members,
            "columns": [h for h in headers if h and h != headers[phone_idx]],
            "created_by": actor_email,
            "created_at": _now_iso(),
            "origin": "contact_list",
        }
    )
    summary = {
        "rows": len(rows) - 1,
        "contacts": len(doc["contact_ids"]),
        "new_contacts": max(0, vault.count_contacts(org_id) - before),
        "invalid_rows": len(invalid),
        "repeated_rows": len(repeated),
    }
    security_audit.record(
        "contact_set.create",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success",
        action="contact_list_created",
        metadata={"set_id": doc["set_id"], "list_name": list_name, **summary},
    )
    return {
        **_summary_view(doc),
        **summary,
        "invalid_row_numbers": invalid[:_REPORTED_ROWS],
        "repeated_row_numbers": repeated[:_REPORTED_ROWS],
    }


def _campaign_usage(org_id: str, set_ids: list[str]) -> dict[str, dict[str, int]]:
    usage: dict[str, dict[str, int]] = {sid: {"campaigns": 0, "active_campaigns": 0} for sid in set_ids}
    cursor = get_database()["Campaigns"].find(
        {"org_id": org_id, "source_id": {"$in": set_ids}}, {"source_id": 1, "state": 1}
    )
    for doc in cursor:
        entry = usage.get(str(doc.get("source_id")))
        if entry is None:
            continue
        entry["campaigns"] += 1
        if str(doc.get("state") or "") in ACTIVE_CAMPAIGN_STATES:
            entry["active_campaigns"] += 1
    return usage


def upload_rules() -> dict[str, Any]:
    """What an upload must look like, for the guidelines shown next to the upload button."""
    return {
        "formats": [".csv", ".xlsx"],
        "max_bytes": MAX_FILE_BYTES,
        "max_rows": MAX_ROWS,
        "phone_columns": list(PHONE_ALIASES),
        "name_columns": list(NAME_ALIASES),
        "name_min": naming.NAME_MIN,
        "name_max": naming.NAME_MAX,
        "name_characters": naming.ALLOWED_TEXT,
    }


def _summary_view(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "list_id": doc["set_id"],
        "name": doc.get("name") or doc["set_id"],
        "filename": doc.get("filename"),
        "original_filename": doc.get("original_filename") or doc.get("filename"),
        "size": len(doc.get("contact_ids") or []),
        "columns": doc.get("columns") or [],
        "created_by": doc.get("created_by"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "origin": doc.get("origin") or "contact_list",
    }


def list_lists(org_id: str) -> list[dict[str, Any]]:
    """Every list campaigns can use, newest first (includes older campaign uploads)."""
    docs = list(
        get_database()[vault.CONTACT_SETS]
        .find({"org_id": org_id, "deleted_at": {"$exists": False}}, {"_id": 0, "members": 0})
        .sort("created_at", -1)
    )
    usage = _campaign_usage(org_id, [d["set_id"] for d in docs])
    return [{**_summary_view(d), **usage.get(d["set_id"], {})} for d in docs]


def _get(org_id: str, list_id: str) -> dict[str, Any]:
    doc = get_database()[vault.CONTACT_SETS].find_one(
        {"org_id": org_id, "set_id": list_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    )
    if not doc:
        raise ContactListNotFoundError(list_id)
    return doc


def get_list(org_id: str, list_id: str, *, preview: int = PREVIEW_LIMIT) -> dict[str, Any]:
    """List details with a masked preview of its first contacts."""
    doc = _get(org_id, list_id)
    ids = list(doc.get("contact_ids") or [])[: max(0, min(preview, 200))]
    views = vault.safe_views_for(org_id, ids)
    variables = {m.get("contact_id"): m.get("variables") or {} for m in doc.get("members") or []}
    contacts = [
        {
            "contact_id": cid,
            "masked_phone": views.get(cid, {}).get("masked_phone"),
            "display_name": views.get(cid, {}).get("display_name"),
            "status": views.get(cid, {}).get("status"),
            "variables": variables.get(cid, {}),
        }
        for cid in ids
    ]
    usage = _campaign_usage(org_id, [list_id]).get(list_id, {})
    return {**_summary_view(doc), **usage, "contacts": contacts}


def rename_list(org_id: str, list_id: str, name: str, *, actor_email: str, actor_role: str) -> dict[str, Any]:
    doc = _get(org_id, list_id)
    new_name = _list_name(org_id, name, exclude_id=list_id)
    now = _now_iso()
    get_database()[vault.CONTACT_SETS].update_one(
        {"org_id": org_id, "set_id": list_id}, {"$set": {"name": new_name, "updated_at": now}}
    )
    security_audit.record(
        "contact_set.update",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success",
        action="contact_list_renamed",
        metadata={"set_id": list_id, "from": doc.get("name"), "to": new_name},
    )
    return _summary_view({**doc, "name": new_name, "updated_at": now})


def delete_list(org_id: str, list_id: str, *, actor_email: str, actor_role: str) -> None:
    """Remove a list. Contacts stay in the vault (other lists may share them)."""
    doc = _get(org_id, list_id)
    active = _campaign_usage(org_id, [list_id])[list_id]["active_campaigns"]
    if active:
        raise ContactListError(
            "This list is used by a campaign that hasn't finished. Finish or delete that campaign first.",
            status_code=409,
        )
    now = _now_iso()
    get_database()[vault.CONTACT_SETS].update_one(
        {"org_id": org_id, "set_id": list_id},
        {"$set": {"deleted_at": now, "deleted_by": actor_email}, "$unset": {"members": ""}},
    )
    security_audit.record(
        "contact_set.delete",
        org_id=org_id,
        actor_type="user",
        actor_id=actor_email,
        actor_role=actor_role,
        outcome="success",
        action="contact_list_deleted",
        metadata={"set_id": list_id, "list_name": doc.get("name"), "size": len(doc.get("contact_ids") or [])},
    )
