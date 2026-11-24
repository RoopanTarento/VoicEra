"""Demo knowledge base: the content team's spreadsheet as a validated, versioned snapshot.

Export → validate → version (build spec, "Keeping the knowledge base in sync"):

    python -m app.services.demo.kb check   path/to/knowledge-base.xlsx
    python -m app.services.demo.kb publish path/to/knowledge-base.xlsx

``publish`` stores a passing snapshot in Mongo under a new ``kb_version``; new
demo agents use the latest version and a saved agent keeps its own. With
nothing published, the snapshot bundled in ``data/knowledge_base.json`` is
used (``python -m app.services.demo.kb bundle <xlsx>`` rewrites it).

Rules the loader enforces (spec, "Data model"):

- Status gate: knowledge and contacts load only when Verified or Partly verified.
- Scope gate: ``state`` must be National or a demo-state value (DEMO_KB_STATES).
- IDs are unique and every card a flow links to exists and passes the gates.
- No personal data: demo records and role cards that look like real phone or
  Aadhaar numbers are rejected.

Rows that fail a gate are left out and listed in the report; broken links and
personal data fail the whole load, naming the rows.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from app.config import settings
from app.database import get_database

logger = logging.getLogger(__name__)

COLLECTION = "DemoKnowledgeBase"
BUNDLED = Path(__file__).with_name("data") / "knowledge_base.json"
LOADABLE_STATUSES = ("Verified", "Partly verified")
CARD_ID = re.compile(r"\bK-[A-Z]+-\d+\b")

# Tab name → (key column, required columns). Headers are matched without the
# bracketed note some carry, e.g. "person (fictional)" → "person".
TABS: dict[str, tuple[str, tuple[str, ...]]] = {
    "Templates": ("template_id", ("name", "job", "description", "q1", "q2", "q3", "records_fields", "greeting_pattern", "active", "default_flow")),
    "Sectors": ("sector_id", ("name", "description", "example_topics", "main_helpline", "demo_state", "active")),
    "Knowledge": ("card_id", ("sector_id", "type", "title", "who_its_for", "answer", "steps", "documents", "fee_and_time", "where_to_go", "source_link", "state", "status")),
    "Contacts": ("contact_id", ("sector_id", "name", "number_or_link", "when_to_use", "hours", "scope", "status")),
    "Question flows": ("flow_id", ("flow_name", "sector_id", "template_id", "starts_when", "step", "asks_for", "question", "answer_type", "if_answer", "then", "default_next")),
    "Demo records": ("record_id", ("sector_id", "template_id", "person", "details", "date_or_ref", "what_the_agent_does")),
    "Role cards": ("role_id", ("sector_id", "template_id", "you_are", "try_asking", "good_call_looks_like")),
    "Guardrails": ("rule_id", ("applies_to", "rule", "what_the_agent_says")),
}

_PHONE_LIKE = re.compile(r"(?<!\d)(?:\d[\s-]?){10}(?!\d)")
_AADHAAR_LIKE = re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")


class KnowledgeBaseError(Exception):
    """The spreadsheet can't be loaded; ``problems`` names each failing row."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems[:5]) + (f" (+{len(problems) - 5} more)" if len(problems) > 5 else ""))
        self.problems = problems


# --- reading the workbook (standard library only) ---------------------------------------

_NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def _column_index(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():  # type: ignore[union-attr]
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_workbook(path: str | Path) -> dict[str, list[list[str]]]:
    """Every sheet as rows of cell text (empty rows dropped)."""
    with zipfile.ZipFile(path) as book:
        names = set(book.namelist())
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            for si in ElementTree.fromstring(book.read("xl/sharedStrings.xml")).findall("m:si", _NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t")))
        workbook = ElementTree.fromstring(book.read("xl/workbook.xml"))
        rels = ElementTree.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        targets = {r.get("Id"): r.get("Target") or "" for r in rels}
        sheets: dict[str, list[list[str]]] = {}
        for sheet in workbook.find("m:sheets", _NS) or []:
            target = targets.get(sheet.get(f"{{{_NS['r']}}}id"), "").lstrip("/")
            target = target if target.startswith("xl/") else f"xl/{target}"
            rows: list[list[str]] = []
            for row in ElementTree.fromstring(book.read(target)).iter(f"{{{_NS['m']}}}row"):
                cells: dict[int, str] = {}
                for cell in row.findall("m:c", _NS):
                    kind, value = cell.get("t"), cell.find("m:v", _NS)
                    if kind == "s" and value is not None:
                        text = shared[int(value.text or 0)]
                    elif kind == "inlineStr":
                        text = "".join(t.text or "" for t in cell.iter(f"{{{_NS['m']}}}t"))
                    else:
                        text = value.text if value is not None and value.text else ""
                    cells[_column_index(cell.get("r") or "A1")] = text
                if any(str(v).strip() for v in cells.values()):
                    rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
            sheets[sheet.get("name") or target] = rows
    return sheets


def _header(name: str) -> str:
    return re.sub(r"\s*\(.*\)\s*$", "", str(name)).strip().lower()


def _records(sheet: list[list[str]]) -> list[dict[str, str]]:
    if not sheet:
        return []
    head = [_header(h) for h in sheet[0]]
    out = []
    for row in sheet[1:]:
        cells = [re.sub(r"[ \t]+", " ", str(c)).strip() for c in row] + [""] * (len(head) - len(row))
        out.append(dict(zip(head, cells)))
    return out


# --- building the snapshot --------------------------------------------------------------


def _list(value: str) -> list[str]:
    return [p.strip() for p in re.split(r"[;,]", value or "") if p.strip()]


def _records_fields(value: str) -> list[dict[str, str]]:
    """'topic_asked; answered (yes/no); referred_to' → [{key, kind}]."""
    fields = []
    for part in _list(value.replace(",", ";")):
        match = re.match(r"([a-z_]+)\s*(?:\((.+)\))?", part)
        if match:
            fields.append({"key": match.group(1), "kind": (match.group(2) or "text").strip()})
    return fields


def parse_action(text: str) -> dict[str, Any]:
    """What a flow step's ``then`` / ``default_next`` cell does, as far as it can
    be read exactly: cards it points to, a step to go to, or the end. Anything
    else in the cell stays an instruction for the agent to say or do."""
    raw = (text or "").strip()
    low = raw.lower()
    action: dict[str, Any] = {"text": raw, "cards": list(dict.fromkeys(CARD_ID.findall(raw)))}
    goto = re.fullmatch(r"step\s+(\d+)", low) or re.search(r"\b(?:back to|go to)\s+step\s+(\d+)\b", low)
    if goto:
        action["goto"] = int(goto.group(1))
    elif re.search(r"\b(?:repeat this step|ask again)\b", low):
        action["repeat"] = True
    clauses = [c.strip(" .") for c in low.split(";")]
    if any(c in ("end", "end flow", "end politely") or c.endswith(" and end") for c in clauses):
        action["end"] = True
    elif re.match(r"not (?:yet )?eligible\b", low) and "continue" not in low:
        # "Not eligible", "Not eligible for this pension": nothing further in this flow.
        action["end"] = True
    return action


def _flows(rows: list[dict[str, str]], problems: list[str]) -> dict[str, dict[str, Any]]:
    flows: dict[str, dict[str, Any]] = {}
    for row in rows:
        fid = row.get("flow_id", "")
        if not fid:
            continue
        flow = flows.setdefault(
            fid,
            {
                "flow_id": fid,
                "name": row.get("flow_name", ""),
                "sector_id": row.get("sector_id", ""),
                "template_id": row.get("template_id", ""),
                "starts_when": row.get("starts_when", ""),
                "steps": [],
            },
        )
        if row.get("starts_when") and not flow["starts_when"]:
            flow["starts_when"] = row["starts_when"]
        try:
            number = int(float(row.get("step") or 0))
        except ValueError:
            problems.append(f"Question flows {fid}: step '{row.get('step')}' isn't a number")
            continue
        flow["steps"].append(
            {
                "step": number,
                "asks_for": row.get("asks_for", ""),
                "question": row.get("question", ""),
                "answer_type": row.get("answer_type", ""),
                "if_answer": row.get("if_answer", ""),
                "then": parse_action(row.get("then", "")) if row.get("then") else None,
                "default_next": parse_action(row.get("default_next", "") or "end"),
            }
        )
    for fid, flow in flows.items():
        flow["steps"].sort(key=lambda s: s["step"])
        numbers = [s["step"] for s in flow["steps"]]
        if numbers != list(range(1, len(numbers) + 1)):
            problems.append(f"Question flows {fid}: steps must be numbered 1..{len(numbers)}, found {numbers}")
        for s in flow["steps"]:
            for key in ("then", "default_next"):
                goto = (s.get(key) or {}).get("goto")
                if goto is not None and goto not in numbers:
                    problems.append(f"Question flows {fid} step {s['step']}: {key} points to step {goto}, which doesn't exist")
    return flows


def build_snapshot(sheets: dict[str, list[list[str]]], *, source: str = "") -> dict[str, Any]:
    """Validate the workbook and return the snapshot the app reads.

    Raises KnowledgeBaseError naming every row that blocks the load."""
    problems: list[str] = []
    left_out: list[str] = []
    notes: list[str] = []
    tabs: dict[str, list[dict[str, str]]] = {}
    for tab, (key, required) in TABS.items():
        if tab not in sheets:
            problems.append(f"Missing tab '{tab}'")
            continue
        rows = [r for r in _records(sheets[tab]) if r.get(key)]
        have = set(_records(sheets[tab])[0].keys()) if rows else set()
        missing = [c for c in (key, *required) if rows and c not in have]
        if missing:
            problems.append(f"{tab}: missing columns {', '.join(missing)}")
        if tab != "Question flows":
            seen: set[str] = set()
            for r in rows:
                if r[key] in seen:
                    problems.append(f"{tab}: {key} {r[key]} is used twice")
                seen.add(r[key])
        tabs[tab] = rows
    if problems:
        raise KnowledgeBaseError(problems)

    states = {s.strip() for s in settings.DEMO_KB_STATES.split(",") if s.strip()}

    templates = {r["template_id"]: r for r in tabs["Templates"] if r["active"].lower() == "yes"}
    for t in templates.values():
        t["records_fields"] = _records_fields(t["records_fields"])  # type: ignore[assignment]
    sectors = {r["sector_id"]: r for r in tabs["Sectors"] if r["active"].lower() == "yes"}

    cards: dict[str, dict[str, str]] = {}
    for r in tabs["Knowledge"]:
        why = None
        if r["status"] not in LOADABLE_STATUSES:
            why = f"status '{r['status']}'"
        elif r["state"] not in states:
            why = f"state '{r['state']}'"
        elif r["sector_id"] not in sectors:
            why = f"sector {r['sector_id']} isn't active"
        elif not r["answer"]:
            why = "no answer"
        if why:
            left_out.append(f"Knowledge {r['card_id']} ({why})")
            continue
        cards[r["card_id"]] = r
    non_ka = sorted(c for c, r in cards.items() if r["state"] not in ("National", "KA"))
    if non_ka:
        notes.append(f"Loaded as Karnataka rows (state is not National or KA): {', '.join(non_ka)}")

    contacts: dict[str, dict[str, str]] = {}
    for r in tabs["Contacts"]:
        if r["status"] not in LOADABLE_STATUSES:
            left_out.append(f"Contacts {r['contact_id']} (status '{r['status']}')")
            continue
        contacts[r["contact_id"]] = r

    flows = _flows(tabs["Question flows"], problems)
    for fid, flow in flows.items():
        if flow["template_id"] not in templates:
            problems.append(f"Question flows {fid}: template {flow['template_id']} isn't an active template")
        if flow["sector_id"] != "ALL" and flow["sector_id"] not in sectors:
            problems.append(f"Question flows {fid}: sector {flow['sector_id']} isn't an active sector")
        for s in flow["steps"]:
            for key in ("then", "default_next"):
                for cid in (s.get(key) or {}).get("cards", []):
                    if cid not in cards:
                        reason = "doesn't exist" if not any(r["card_id"] == cid for r in tabs["Knowledge"]) else "doesn't pass the status and scope gates"
                        problems.append(f"Question flows {fid} step {s['step']}: links to {cid}, which {reason}")
    for tid, t in templates.items():
        if t["default_flow"] not in flows:
            problems.append(f"Templates {tid}: default_flow {t['default_flow']} isn't in Question flows")

    records = {r["record_id"]: r for r in tabs["Demo records"]}
    roles = {r["role_id"]: r for r in tabs["Role cards"]}
    for label, rows, key in (("Demo records", records, "record_id"), ("Role cards", roles, "role_id")):
        for rid, r in rows.items():
            text = " ".join(v for k, v in r.items() if k != key)
            if _PHONE_LIKE.search(text) or _AADHAAR_LIKE.search(text):
                problems.append(f"{label} {rid}: looks like a real phone or Aadhaar number; use a fictional, masked one")

    guardrails = []
    for r in tabs["Guardrails"]:
        applies = "All" if r["applies_to"].strip().lower() == "all" else _list(r["applies_to"])
        guardrails.append({**r, "applies_to": applies})

    if problems:
        raise KnowledgeBaseError(problems)

    return {
        "kb_version": "",
        "source": source,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "templates": templates,
        "sectors": sectors,
        "cards": cards,
        "contacts": contacts,
        "flows": flows,
        "demo_records": records,
        "role_cards": roles,
        "guardrails": guardrails,
        "report": {"left_out": left_out, "notes": notes},
    }


# --- versions ---------------------------------------------------------------------------

_cache_lock = threading.Lock()
_by_version: dict[str, dict[str, Any]] = {}
_latest: tuple[float, dict[str, Any]] | None = None
_CACHE_SECONDS = 30.0


def _bundled() -> dict[str, Any]:
    with BUNDLED.open(encoding="utf-8") as f:
        return json.load(f)


def current() -> dict[str, Any]:
    """The latest published snapshot (cached briefly), else the bundled one."""
    global _latest
    with _cache_lock:
        if _latest and time.monotonic() - _latest[0] < _CACHE_SECONDS:
            return _latest[1]
    try:
        doc = get_database()[COLLECTION].find_one({}, sort=[("published_at", -1)], projection={"_id": 0, "kb_version": 1})
    except Exception:  # noqa: BLE001 - the bundled snapshot keeps the demo working
        logger.warning("Demo knowledge base: couldn't read published versions; using the bundled one")
        doc = None
    snap = get(doc["kb_version"]) if doc else _bundled()
    with _cache_lock:
        _latest = (time.monotonic(), snap)
        _by_version.setdefault(snap["kb_version"], snap)
    return snap


def get(kb_version: str | None) -> dict[str, Any]:
    """A specific version (a saved agent keeps the one it was built from)."""
    if not kb_version:
        return current()
    with _cache_lock:
        if kb_version in _by_version:
            return _by_version[kb_version]
    bundled = _bundled()
    if bundled["kb_version"] == kb_version:
        snap = bundled
    else:
        doc = get_database()[COLLECTION].find_one({"kb_version": kb_version}, {"_id": 0, "snapshot": 1})
        snap = doc["snapshot"] if doc else current()
    with _cache_lock:
        if len(_by_version) > 20:
            _by_version.clear()
        _by_version[snap["kb_version"]] = snap
    return snap


def _next_version() -> str:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    used = get_database()[COLLECTION].count_documents({"kb_version": {"$regex": f"^{day}\\."}})
    return f"{day}.{used + 1}"


def publish(path: str | Path) -> dict[str, Any]:
    """Validate the workbook and store it as the newest version."""
    global _latest
    snap = build_snapshot(read_workbook(path), source=Path(path).name)
    snap["kb_version"] = _next_version()
    get_database()[COLLECTION].insert_one(
        {
            "kb_version": snap["kb_version"],
            "published_at": datetime.now(timezone.utc).isoformat(),
            "source": snap["source"],
            "report": snap["report"],
            "snapshot": snap,
        }
    )
    with _cache_lock:
        _latest = None
    return snap


def bundle(path: str | Path) -> dict[str, Any]:
    """Rewrite the bundled snapshot from a workbook (for the repository)."""
    snap = build_snapshot(read_workbook(path), source=Path(path).name)
    snap["kb_version"] = "bundled-" + datetime.now(timezone.utc).strftime("%Y-%m-%d")
    BUNDLED.parent.mkdir(parents=True, exist_ok=True)
    BUNDLED.write_text(json.dumps(snap, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return snap


def _print_report(snap: dict[str, Any]) -> None:
    print(
        f"OK  {len(snap['templates'])} templates, {len(snap['sectors'])} sectors, {len(snap['cards'])} cards, "
        f"{len(snap['contacts'])} contacts, {len(snap['flows'])} flows, {len(snap['demo_records'])} demo records, "
        f"{len(snap['role_cards'])} role cards, {len(snap['guardrails'])} guardrails"
    )
    for line in snap["report"]["left_out"]:
        print(f"    left out: {line}")
    for line in snap["report"]["notes"]:
        print(f"    note: {line}")


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("check", "publish", "bundle"):
        print(__doc__)
        return 2
    command, path = argv
    try:
        if command == "check":
            snap = build_snapshot(read_workbook(path), source=Path(path).name)
        elif command == "publish":
            snap = publish(path)
            print(f"Published kb_version {snap['kb_version']}")
        else:
            snap = bundle(path)
            print(f"Wrote {BUNDLED}")
    except KnowledgeBaseError as exc:
        print("NOT LOADED. Fix these rows and try again:")
        for p in exc.problems:
            print(f"  - {p}")
        return 1
    _print_report(snap)
    return 0


if __name__ == "__main__":
    logging.disable(logging.WARNING)
    sys.exit(main(sys.argv[1:]))
