"""Per-call state and the six tools the voice runtime calls (build spec, "Call runtime").

The runtime posts every GPT-4.1 tool call here (``/try/runtime/tool``, internal
API key). This module holds the call's flow state in ``DemoCalls`` and answers
from the agent's knowledge-base version, so the model can't skip flow steps or
use a card the agent doesn't have.

Tools: search_cards, get_card, start_flow, record_slot, log_gap, end_call.
Every result carries ``state_block``, which the runtime writes into the
system prompt so the next turn sees the current step.

Preview calls (the no-login demo) keep nothing beyond the session: their state
expires with the preview agent, and the gaps list stores only the caller's
question, masked, with its sector.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import settings
from app.database import get_database
from app.services.demo import builder, kb
from app.services.demo import flows as flow_engine
from app.services.demo.privacy import mask_personal, public_numbers

logger = logging.getLogger(__name__)

COLLECTION = "DemoCalls"
GAPS = "DemoGaps"
MAX_SEARCH_RESULTS = 3
MAX_RECORD_CHARS = 300
TOOLS = ("search_cards", "get_card", "start_flow", "record_slot", "log_gap", "end_call")

_indexes_ready = False


class ToolError(Exception):
    """Refused; the message is returned to the model as the tool result."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _calls():
    global _indexes_ready
    db = get_database()
    if not _indexes_ready:
        db[COLLECTION].create_index("call_id", name="call_id_unique", unique=True)
        db[COLLECTION].create_index("expires_at", name="expires_ttl", expireAfterSeconds=0)
        db[GAPS].create_index([("sector_id", 1), ("at", -1)], name="sector_recent")
        _indexes_ready = True
    return db[COLLECTION]


def agent_demo(org_id: str, agent_id: str) -> dict[str, Any]:
    doc = get_database()["Agents"].find_one({"org_id": org_id, "agent_id": agent_id}, {"config.demo": 1, "_id": 0})
    demo = ((doc or {}).get("config") or {}).get("demo")
    if not demo:
        raise ToolError("This agent isn't a demo-builder agent.")
    return demo


def _ctx(demo: dict[str, Any]) -> tuple[dict[str, Any], flow_engine.Ctx]:
    snap = kb.get(demo.get("kb_version"))
    return snap, builder.flow_ctx(snap, demo)


def open_call(org_id: str, agent_id: str, call_id: str) -> dict[str, Any]:
    """The call's state, created on first use from the agent's default flow."""
    col = _calls()
    doc = col.find_one({"call_id": call_id}, {"_id": 0})
    if doc:
        if doc["org_id"] != org_id or doc["agent_id"] != agent_id:
            raise ToolError("This call belongs to another agent.")
        return doc
    demo = agent_demo(org_id, agent_id)
    snap = kb.get(demo.get("kb_version"))
    keep = timedelta(minutes=settings.TRY_AGENT_TTL_MINUTES * 2) if demo.get("preview") else timedelta(days=30)
    doc = {
        "call_id": call_id,
        "org_id": org_id,
        "agent_id": agent_id,
        "preview": bool(demo.get("preview")),
        "template_id": demo["template_id"],
        "sector_id": demo["sector_id"],
        "kb_version": snap["kb_version"],
        "state": flow_engine.new_state(builder.template(snap, demo["template_id"])["default_flow"]),
        "turns": [],
        "created_at": _now(),
        "expires_at": _now() + keep,
    }
    try:
        col.insert_one(dict(doc))
    except Exception:  # noqa: BLE001 - created by a concurrent first tool call
        found = col.find_one({"call_id": call_id}, {"_id": 0})
        if not found:
            raise
        return found
    return doc


def _agent_cards(snap: dict[str, Any], demo: dict[str, Any]) -> dict[str, dict[str, Any]]:
    cards = {cid: snap["cards"][cid] for cid in demo.get("card_ids") or [] if cid in snap["cards"]}
    for c in demo.get("session_cards") or []:
        cards[c["card_id"]] = c
    return cards


def _search(cards: dict[str, dict[str, Any]], query: str) -> list[dict[str, Any]]:
    want = {w for w in re.findall(r"[a-z0-9]+", (query or "").lower()) if len(w) > 2}
    if not want:
        return []
    scored = []
    for c in cards.values():
        title = set(re.findall(r"[a-z0-9]+", c["title"].lower()))
        body = set(re.findall(r"[a-z0-9]+", f"{c.get('who_its_for', '')} {c['answer']}".lower()))
        score = 3 * len(want & title) + len(want & body)
        if score:
            scored.append((score, c["card_id"]))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [cards[cid] for _, cid in scored[:MAX_SEARCH_RESULTS]]


_PUBLIC: dict[str, frozenset[str]] = {}


def published(snap: dict[str, Any]) -> frozenset[str]:
    """Numbers printed in this knowledge-base version (never masked)."""
    version = snap["kb_version"]
    if version not in _PUBLIC:
        texts = [c["number_or_link"] for c in snap["contacts"].values()]
        texts += [s["main_helpline"] for s in snap["sectors"].values()]
        texts += [" ".join(str(v) for v in c.values()) for c in snap["cards"].values()]
        _PUBLIC[version] = public_numbers(texts)
    return _PUBLIC[version]


def _brief(c: dict[str, Any]) -> dict[str, Any]:
    return {k: c.get(k, "") for k in ("card_id", "title", "who_its_for", "answer", "status")}


def _full(c: dict[str, Any]) -> dict[str, Any]:
    keep = ("card_id", "title", "who_its_for", "answer", "steps", "documents", "fee_and_time", "where_to_go", "status")
    return {k: c.get(k, "") for k in keep}


def clean_record_value(snap: dict[str, Any], value: Any) -> Any:
    keep = published(snap)
    if isinstance(value, list):
        return [mask_personal(str(v), keep)[:MAX_RECORD_CHARS] for v in value if str(v).strip()][:10]
    if isinstance(value, bool):
        return "yes" if value else "no"
    if value is not None and str(value).strip():
        return mask_personal(str(value).strip(), keep)[:MAX_RECORD_CHARS]
    return None


def _clean_records(snap: dict[str, Any], template_id: str, records: Any) -> dict[str, Any]:
    fields = [f["key"] for f in builder.template(snap, template_id)["records_fields"]]
    if not isinstance(records, dict):
        raise ToolError(f"records must be an object with: {', '.join(fields)}.")
    out: dict[str, Any] = {}
    for key in fields:
        value = clean_record_value(snap, records.get(key))
        if value not in (None, []):
            out[key] = value
    return out


def run_tool(org_id: str, agent_id: str, call_id: str, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Run one tool call and return its result (with the new ``state_block``)."""
    if name not in TOOLS:
        raise ToolError(f"Unknown tool {name}.")
    call = open_call(org_id, agent_id, call_id)
    demo = agent_demo(org_id, agent_id)
    snap, ctx = _ctx(demo)
    state = call["state"]
    cards = _agent_cards(snap, demo)
    args = args if isinstance(args, dict) else {}

    if name == "search_cards":
        found = _search(cards, str(args.get("query") or ""))
        result: dict[str, Any] = {"cards": [_brief(c) for c in found]}
        if found:
            flow_engine._remember_cards(state, [found[0]["card_id"]])
        else:
            result["note"] = "No card covers this. Say you don't have that information, give the most relevant contact, and call log_gap."
    elif name == "get_card":
        cid = str(args.get("card_id") or "").strip()
        if cid not in cards:
            raise ToolError(f"{cid or 'That card'} isn't one of this agent's cards. Use search_cards.")
        flow_engine._remember_cards(state, [cid])
        result = {"card": _full(cards[cid])}
    elif name == "start_flow":
        result = flow_engine.start_flow(ctx, state, str(args.get("flow_id") or ""))
    elif name == "record_slot":
        result = flow_engine.record_slot(
            ctx,
            state,
            str(args.get("asks_for") or ""),
            mask_personal(str(args.get("value") if args.get("value") is not None else "")),
            bool(args.get("branch_matched")),
        )
    elif name == "log_gap":
        text = mask_personal(re.sub(r"\s+", " ", str(args.get("caller_text") or "")).strip(), published(snap))[:300]
        if not text:
            raise ToolError("caller_text is required.")
        state["gaps"].append(text)
        get_database()[GAPS].insert_one(
            {
                "text": text,
                "sector_id": demo["sector_id"],
                "template_id": demo["template_id"],
                "kb_version": snap["kb_version"],
                "preview": bool(demo.get("preview")),
                "at": _now(),
            }
        )
        result = {"ok": True}
    else:  # end_call
        state["records"] = _clean_records(snap, demo["template_id"], args.get("records"))
        state["ended"] = True
        result = {"ok": True}

    block = flow_engine.state_block(ctx, state)
    _calls().update_one(
        {"call_id": call_id},
        {
            "$set": {"state": state, "updated_at": _now()},
            "$push": {"turns": {"at": _now().isoformat(), "tool": name, "flow_id": state.get("active_flow"), "step": state.get("step")}},
        },
    )
    result["state_block"] = block
    return result


def run_tool_safely(org_id: str, agent_id: str, call_id: str, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Like run_tool, but a refusal becomes ``{"error": ...}`` for the model to read."""
    try:
        return run_tool(org_id, agent_id, call_id, name, args)
    except (ToolError, flow_engine.FlowError) as exc:
        return {"error": str(exc)}


def call_state(call_id: str) -> dict[str, Any] | None:
    return _calls().find_one({"call_id": call_id}, {"_id": 0})


def delete_for_agents(org_id: str, agent_ids: list[str]) -> None:
    if agent_ids:
        _calls().delete_many({"org_id": org_id, "agent_id": {"$in": agent_ids}})


# --- after the call --------------------------------------------------------------------------


_LABELS = {
    "topic_asked": "Topics asked",
    "answered": "Answered",
    "referred_to": "Referred to",
    "heard_fully": "Heard it fully",
    "questions_asked": "Questions asked",
    "acknowledged": "Acknowledged",
    "ready_to_apply": "Ready to apply",
    "documents_missing": "Documents missing",
    "sent_to": "Sent to",
    "confirmed": "Confirmed",
    "needs_help": "Needs help",
    "new_date": "New date",
    "answer_per_question": "Answers",
    "issues_flagged": "Issues flagged",
    "completed": "Completed",
    "complaint_type": "Complaint type",
    "place": "Place",
    "details": "Details",
    "reference_no": "Reference number",
    "urgent": "Urgent",
}


def field_label(key: str) -> str:
    return _LABELS.get(key) or key.replace("_", " ").capitalize()


def summary(snap: dict[str, Any], demo: dict[str, Any], call: dict[str, Any] | None) -> dict[str, Any]:
    """What screen 8 shows: the template's records fields, plus the flows run,
    the cards used and the questions it couldn't answer."""
    state = (call or {}).get("state") or {}
    t = builder.template(snap, demo["template_id"])
    records = state.get("records") or {}
    cards = _agent_cards(snap, demo)
    return {
        "fields": [{"key": f["key"], "label": field_label(f["key"]), "kind": f["kind"], "value": records.get(f["key"])} for f in t["records_fields"]],
        "recorded_by_agent": bool(state.get("records")),
        "flows": [
            {"flow_id": f, "name": (demo.get("session_flows", {}).get(f) or snap["flows"].get(f) or {}).get("name", f)}
            for f in dict.fromkeys(state.get("flows_done") or [])
        ],
        "cards": [{"card_id": c, "title": cards[c]["title"]} for c in state.get("cards_spoken") or [] if c in cards],
        "gaps": list(state.get("gaps") or []),
        "steps": [{"flow_id": t_["flow_id"], "step": t_["step"]} for t_ in (call or {}).get("turns") or [] if t_.get("flow_id")],
    }
