"""Org+user-scoped persistence for Copilot conversations."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app.database import get_database
from app.utils.mongo_utils import prepare_mongo_response, prepare_mongo_response_list

logger = logging.getLogger(__name__)

COLLECTION = "CopilotConversations"
DEFAULT_TITLE = "New conversation"


class CopilotConversationNotFoundError(Exception):
    """Raised when a conversation is missing for this org/user."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_response(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    prepared = prepare_mongo_response(doc) or {}
    prepared.pop("_id", None)
    return prepared


def _title_from_message(message: str) -> str:
    text = " ".join(message.strip().split())
    if not text:
        return DEFAULT_TITLE
    return text if len(text) <= 60 else text[:59] + "…"


def create_conversation(org_id: str, created_by: str, first_message: str) -> dict[str, Any]:
    """Create a new, empty conversation titled from the first user message."""
    now = _now_iso()
    doc = {
        "conversation_id": str(uuid.uuid4()),
        "org_id": org_id,
        "created_by": created_by,
        "title": _title_from_message(first_message),
        "messages": [],
        "created_at": now,
        "updated_at": now,
    }
    get_database()[COLLECTION].insert_one(doc)
    return _to_response(doc) or {}


def get_conversation(org_id: str, created_by: str, conversation_id: str) -> dict[str, Any]:
    """Fetch a conversation scoped to both org and the requesting user."""
    doc = get_database()[COLLECTION].find_one(
        {"conversation_id": conversation_id, "org_id": org_id, "created_by": created_by}
    )
    if not doc:
        raise CopilotConversationNotFoundError(conversation_id)
    return _to_response(doc) or {}


def list_conversations(org_id: str, created_by: str, *, limit: int = 30) -> list[dict[str, Any]]:
    """List a user's own conversations within their active org, most recent first."""
    cursor = (
        get_database()[COLLECTION]
        .find({"org_id": org_id, "created_by": created_by})
        .sort("updated_at", -1)
        .limit(max(1, min(limit, 100)))
    )
    return prepare_mongo_response_list(
        [{k: v for k, v in doc.items() if k != "_id" and k != "messages"} for doc in cursor]
    )


def append_messages(
    org_id: str,
    created_by: str,
    conversation_id: str,
    messages: list[dict[str, Any]],
) -> None:
    """Append one or more messages (user + assistant turn) to a conversation.

    If this conversation currently has no messages — e.g. its original first
    message was just edited away via truncate_messages — the title (set once,
    from whatever was first) is regenerated from the new first message too,
    so it doesn't keep describing content that no longer exists.
    """
    query = {"conversation_id": conversation_id, "org_id": org_id, "created_by": created_by}
    update: dict[str, Any] = {
        "$push": {"messages": {"$each": messages}},
        "$set": {"updated_at": _now_iso()},
    }
    existing = get_database()[COLLECTION].find_one(query, {"messages": 1})
    if existing is None:
        raise CopilotConversationNotFoundError(conversation_id)
    if not existing.get("messages"):
        first_user = next((m for m in messages if m.get("role") == "user"), None)
        if first_user:
            update["$set"]["title"] = _title_from_message(first_user["content"])

    result = get_database()[COLLECTION].update_one(query, update)
    if result.matched_count == 0:
        raise CopilotConversationNotFoundError(conversation_id)


def truncate_messages(org_id: str, created_by: str, conversation_id: str, keep_count: int) -> None:
    """Drop every stored message from ``keep_count`` onward — used when the
    user edits a past message: the old reply (and anything after it) is no
    longer accurate context, so it's removed before the edited turn is sent."""
    doc = get_database()[COLLECTION].find_one(
        {"conversation_id": conversation_id, "org_id": org_id, "created_by": created_by}
    )
    if not doc:
        raise CopilotConversationNotFoundError(conversation_id)
    kept = (doc.get("messages") or [])[: max(0, keep_count)]
    get_database()[COLLECTION].update_one(
        {"conversation_id": conversation_id, "org_id": org_id, "created_by": created_by},
        {"$set": {"messages": kept, "updated_at": _now_iso()}},
    )


def delete_conversation(org_id: str, created_by: str, conversation_id: str) -> None:
    """Delete a conversation scoped to org + owning user."""
    result = get_database()[COLLECTION].delete_one(
        {"conversation_id": conversation_id, "org_id": org_id, "created_by": created_by}
    )
    if result.deleted_count == 0:
        raise CopilotConversationNotFoundError(conversation_id)
