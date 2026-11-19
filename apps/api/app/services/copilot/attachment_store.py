"""Org-scoped storage for files attached to Copilot messages (images, contact
CSVs and documents).

The file bytes live in MinIO (same bucket as knowledge-base documents and
call artifacts); this collection only tracks metadata + ownership, so
GET /copilot/attachments/{id} can enforce "only your org" before ever
touching MinIO. A document also keeps its extracted text here, so a turn
never has to download and parse it again.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.database import get_database
from app.utils.mongo_utils import prepare_mongo_response

COLLECTION = "CopilotAttachments"


class CopilotAttachmentNotFoundError(Exception):
    """Raised when an attachment is missing or belongs to another org."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_response(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    prepared = prepare_mongo_response(doc) or {}
    prepared.pop("_id", None)
    return prepared


def create_attachment(
    org_id: str,
    created_by: str,
    *,
    storage_key: str,
    content_type: str,
    original_filename: str,
    size_bytes: int,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "attachment_id": str(uuid.uuid4()),
        "org_id": org_id,
        "created_by": created_by,
        "storage_key": storage_key,
        "content_type": content_type,
        "original_filename": original_filename,
        "size_bytes": size_bytes,
        "created_at": _now_iso(),
    }
    if extracted_text is not None:
        doc["extracted_text"] = extracted_text
    get_database()[COLLECTION].insert_one(dict(doc))
    return _to_response(doc) or {}


def get_attachment(org_id: str, attachment_id: str) -> dict[str, Any]:
    """Fetch one attachment's metadata, scoped to org — never another org's."""
    doc = get_database()[COLLECTION].find_one({"attachment_id": attachment_id, "org_id": org_id})
    if not doc:
        raise CopilotAttachmentNotFoundError(attachment_id)
    return _to_response(doc) or {}
