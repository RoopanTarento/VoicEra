"""Turn the visitor's three answers into one agent config (build spec, "Builder logic").

Nothing is generated freely: every part of the agent is selected from the
knowledge-base snapshot. The only model calls are the router (free text →
template and sector) and translating the opening line.

Config, stored per session so the same agent can be saved after sign-in::

    {"template_id": "T-ANSWER", "sector_id": "S-AGRI", "language": "kn",
     "flows": ["F-ANSWER", "F-AGRI-PMKISAN-ELIG", ...], "card_ids": [...],
     "contact_ids": [...], "guardrail_ids": [...], "demo_record_id": null,
     "role_card_id": "R-005", "kb_version": "2026-11-24.1", ...}
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from app.services.demo import flows as flow_engine
from app.services.demo import kb

logger = logging.getLogger(__name__)

PROMPTS = Path(__file__).with_name("data") / "prompts"

# Q3: the languages both speech models support (spec, "Fixed demo stack"), in
# the order the wireframe shows them. Assamese is beta: Maya 2 has no voice
# trained on it.
LANGUAGES: list[tuple[str, str, str]] = [
    ("kn", "Kannada", "ಕನ್ನಡ"),
    ("hi", "Hindi", "हिन्दी"),
    ("en", "English", "English"),
    ("mr", "Marathi", "मराठी"),
    ("ta", "Tamil", "தமிழ்"),
    ("te", "Telugu", "తెలుగు"),
    ("bn", "Bengali", "বাংলা"),
    ("gu", "Gujarati", "ગુજરાતી"),
    ("ml", "Malayalam", "മലയാളം"),
    ("pa", "Punjabi", "ਪੰਜਾਬੀ"),
    ("od", "Odia", "ଓଡ଼ିଆ"),
    ("as", "Assamese", "অসমীয়া"),
]
BETA_LANGUAGES = {"as"}
LANGUAGE_NAMES = {code: name for code, name, _ in LANGUAGES}
STATE_NAMES = {"KA": "Karnataka"}
DEMO_LANGUAGE = {"KA": "kn"}

# Callers ring these agents with any question, so they share the sector's
# inbound flows; outbound agents (they make the call) use only their own.
INBOUND = ("T-ANSWER", "T-GUIDE", "T-RESOLVE")
OUTBOUND = ("T-INFORM", "T-REMIND", "T-COLLECT")

# G-01 and G-02, spoken in every opening line.
NOTICE = "This is an AI demo call with sample information."

MAX_TOPIC = 160
MAX_ANNOUNCEMENT = 700
MAX_AUDIENCE = 200
MAX_REMINDER = 300
MAX_SURVEY_QUESTIONS = 8
MAX_QUESTION = 200
MAX_SOURCES = 3


class BuildError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _clean(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _sentence_case_name(name: str) -> str:
    return name[:1].lower() + name[1:] if name and not name[:2].isupper() else name


# --- reading the snapshot ---------------------------------------------------------------


def template(snap: dict[str, Any], template_id: str) -> dict[str, Any]:
    t = snap["templates"].get(template_id)
    if not t:
        raise BuildError("Pick one of the templates.")
    return t


def sector(snap: dict[str, Any], sector_id: str) -> dict[str, Any]:
    s = snap["sectors"].get(sector_id)
    if not s:
        raise BuildError("Pick one of the sectors.")
    return s


def language_name(code: str) -> str:
    name = LANGUAGE_NAMES.get(code)
    if not name:
        raise BuildError("Pick one of the offered languages.")
    return name


def flows_for(snap: dict[str, Any], template_id: str, sector_id: str) -> list[str]:
    """The template's default flow, plus the sector's flows for this kind of call."""
    t = template(snap, template_id)
    out = [t["default_flow"]]
    kinds = INBOUND if template_id in INBOUND else (template_id,)
    for fid, f in snap["flows"].items():
        if f["sector_id"] == sector_id and f["template_id"] in kinds and fid not in out:
            out.append(fid)
    return out


def cards_for(snap: dict[str, Any], sector_id: str) -> list[str]:
    return [cid for cid, c in snap["cards"].items() if c["sector_id"] == sector_id]


def contacts_for(snap: dict[str, Any], sector_id: str) -> list[str]:
    """This sector's and everyone's contacts first; the rest stay for out-of-sector referrals."""
    near = [cid for cid, c in snap["contacts"].items() if c["sector_id"] in (sector_id, "ALL")]
    rest = [cid for cid in snap["contacts"] if cid not in near]
    return near + rest


def guardrails_for(snap: dict[str, Any], template_id: str) -> list[dict[str, Any]]:
    return [g for g in snap["guardrails"] if g["applies_to"] == "All" or template_id in g["applies_to"]]


def demo_record(snap: dict[str, Any], template_id: str, sector_id: str) -> dict[str, Any] | None:
    for r in snap["demo_records"].values():
        if r["sector_id"] == sector_id and r["template_id"] == template_id:
            return r
    return None


_ROLE_WORDS = {
    "account", "all", "applicant", "citizen", "citizens", "commuter", "complainant", "family", "farmer", "father",
    "household", "mother", "owner", "parent", "parents", "patient", "pensioner", "resident", "residents", "student",
    "voter", "voters", "worker", "workers",
}
FALLBACK_PERSON = "Ramesh (fictional)"


def person_name(person: str) -> str:
    """A first name to greet: "Savitha (mother of …)" → "Savitha", "Account 7845XXXX (Ravi)"
    → "Ravi", "First-time voter (Akash, 18)" → "Akash"; "" when the record names a
    role, not a person ("Farmer in Belagavi", "Applicant")."""
    person = (person or "").strip()
    lead = re.match(r"([A-Z][a-z]+)(?:\s*\(|$)", person)
    if lead and lead.group(1).lower() not in _ROLE_WORDS:
        return lead.group(1)
    inside = re.search(r"\(([A-Z][a-z]+)\s*[,)]", person)
    return inside.group(1) if inside else ""


def person_label(person: str) -> str:
    """How to ask for the person: their name, else the role ("the farmer in Belagavi")."""
    name = person_name(person)
    if name:
        return name
    base = re.split(r"\s*\(", person or "", maxsplit=1)[0].strip()
    if not base:
        return "the person this call is for"
    base = base[:1].lower() + base[1:]
    return base if base.startswith("all ") else f"the {base}"


def role_card(snap: dict[str, Any], template_id: str, sector_id: str, record: dict[str, Any] | None) -> dict[str, Any]:
    """Who the tester plays. The sheet's role card when there is one; for an
    outbound call, the person in the demo record; else a plain resident."""
    rows = list(snap["role_cards"].values())
    for r in rows:
        if r["sector_id"] == sector_id and r["template_id"] == template_id:
            return {"role_id": r["role_id"], "you_are": r["you_are"], "try_asking": r["try_asking"]}
    s = sector(snap, sector_id)
    if template_id in OUTBOUND and record:
        lead = {
            "T-REMIND": "Say you can't make it on that date and ask what you can do.",
            "T-COLLECT": "Answer the questions honestly, and mention anything that went wrong.",
            "T-INFORM": "Ask a question about the message, or ask for part of it again.",
        }[template_id]
        return {"role_id": None, "you_are": f"{record['person']}. {record['details']} ({record['date_or_ref']}).", "try_asking": lead}
    if template_id == "T-INFORM":
        return {"role_id": None, "you_are": "Someone the announcement is meant for.", "try_asking": "Ask a question about the message, or ask for part of it again."}
    if template_id in ("T-REMIND", "T-COLLECT"):
        lead = "Say you can't make it and ask what you can do." if template_id == "T-REMIND" else "Answer the questions, and mention anything that went wrong."
        return {"role_id": None, "you_are": f"{FALLBACK_PERSON}, the person the agent is calling.", "try_asking": lead}
    if template_id in INBOUND:
        for r in rows:
            if r["sector_id"] == sector_id and r["template_id"] in INBOUND:
                return {"role_id": r["role_id"], "you_are": r["you_are"], "try_asking": r["try_asking"]}
    topics = [t.strip() for t in s["example_topics"].split(";") if t.strip()]
    ask = f"Ask about {topics[0].lower()}." if topics else "Ask your own question."
    return {"role_id": None, "you_are": f"A resident of Bengaluru with a question about {s['name'].lower()}.", "try_asking": ask}


# --- the catalogue and Q2 -----------------------------------------------------------------


def catalogue(snap: dict[str, Any]) -> dict[str, Any]:
    keep_t = ("template_id", "name", "job", "description", "example_uses", "q1", "q2", "q3")
    keep_s = ("sector_id", "name", "description", "example_topics")
    return {
        "kb_version": snap["kb_version"],
        "templates": [{k: t[k] for k in keep_t} for t in snap["templates"].values()],
        "sectors": [{k: s[k] for k in keep_s} for s in snap["sectors"].values()],
        "languages": [{"code": c, "name": n, "native": native, "beta": c in BETA_LANGUAGES} for c, n, native in LANGUAGES],
        "demo_language": DEMO_LANGUAGE.get(next(iter(snap["sectors"].values()))["demo_state"], "kn") if snap["sectors"] else "kn",
    }


def _goes_to(snap: dict[str, Any], flow: dict[str, Any], sector_row: dict[str, Any]) -> str:
    """Where a complaint type is sent: the office on the card its flow ends at, else the sector helpline."""
    for s in reversed(flow["steps"]):
        for key in ("then", "default_next"):
            for cid in (s.get(key) or {}).get("cards", []):
                card = snap["cards"].get(cid)
                if card and card.get("where_to_go"):
                    return card["where_to_go"]
    helpline = sector_row["main_helpline"].strip()
    return f"Helpline {helpline}" if helpline and helpline != "—" else "The department office"


_STOPWORDS = {"about", "after", "and", "are", "for", "from", "have", "into", "that", "the", "their", "them", "they",
              "this", "what", "when", "with", "your", "who", "how", "can", "get", "people", "call", "calls", "agent"}


def _words(text: str) -> set[str]:
    """Word stems for matching: the first six letters, so "vaccination" meets "vaccinations"."""
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {w[:6] for w in words if len(w) > 2 and w not in _STOPWORDS}


def best_card(snap: dict[str, Any], card_ids: list[str], text: str) -> str | None:
    want = _words(text)
    if not want:
        return None
    scored = sorted(
        ((len(want & _words(f"{snap['cards'][c]['title']} {snap['cards'][c]['who_its_for']}")), c) for c in card_ids),
        reverse=True,
    )
    return scored[0][1] if scored and scored[0][0] > 0 else None


def survey_questions(snap: dict[str, Any], sector_id: str) -> tuple[str | None, list[str]]:
    """The sector's survey flow (if any) and its questions, else a suggested set."""
    for fid, f in snap["flows"].items():
        if f["sector_id"] == sector_id and f["template_id"] == "T-COLLECT":
            return fid, [s["question"] for s in f["steps"]]
    name = sector(snap, sector_id)["name"].lower()
    return None, [
        f"How would you rate the {name} service you received, from 1 to 5?",
        "Was your problem solved?",
        "Did anyone ask you for money to get this service?",
    ]


def sources(snap: dict[str, Any], template_id: str, sector_id: str, topic: str = "") -> dict[str, Any]:
    """What Q1 and Q2 show for this template and sector."""
    t = template(snap, template_id)
    s = sector(snap, sector_id)
    card_ids = cards_for(snap, sector_id)
    flow_ids = flows_for(snap, template_id, sector_id)
    record = demo_record(snap, template_id, sector_id)
    cards = [snap["cards"][c] for c in card_ids]
    out: dict[str, Any] = {
        "template_id": template_id,
        "sector_id": sector_id,
        "kb_version": snap["kb_version"],
        "cards": {
            "count": len(cards),
            "verified": sum(1 for c in cards if c["status"] == "Verified"),
            "partly_verified": sum(1 for c in cards if c["status"] == "Partly verified"),
            "preview": [{"card_id": c["card_id"], "title": c["title"], "type": c["type"], "status": c["status"]} for c in cards[:4]],
        },
        "flows": [{"flow_id": f, "name": snap["flows"][f]["name"]} for f in flow_ids],
        "record": {k: record[k] for k in ("record_id", "person", "details", "date_or_ref")} if record else None,
        "role": role_card(snap, template_id, sector_id, record),
        "helpline": s["main_helpline"] if s["main_helpline"] not in ("", "—") else None,
    }
    if template_id == "T-INFORM":
        out["announcement"] = f"{record['details']}: {record['date_or_ref']}." if record else ""
        out["audience"] = record["person"] if record else ""
    if template_id == "T-REMIND":
        out["reminder"] = f"{record['details']}: {record['date_or_ref']}" if record else ""
    if template_id == "T-COLLECT":
        fid, questions = survey_questions(snap, sector_id)
        out["survey"] = {"flow_id": fid, "questions": questions}
    if template_id == "T-RESOLVE":
        out["complaints"] = [
            {"flow_id": fid, "name": snap["flows"][fid]["name"], "goes_to": _goes_to(snap, snap["flows"][fid], s)}
            for fid in flow_ids
            if snap["flows"][fid]["template_id"] == "T-RESOLVE" and fid != t["default_flow"]
        ]
    if template_id == "T-GUIDE":
        services = [c for c in cards if c["type"] == "Service"]
        out["services"] = [
            {k: c[k] for k in ("card_id", "title", "steps", "documents", "fee_and_time", "where_to_go", "status")} for c in services
        ]
        out["service_match"] = best_card(snap, [c["card_id"] for c in services], topic)
    return out


# --- assembling the agent -------------------------------------------------------------------


def _survey_flow(snap: dict[str, Any], sector_id: str, questions: list[str]) -> dict[str, Any]:
    """The survey as a session flow: the sheet's steps where the question is
    unchanged (keeping their branches), plain steps for new or edited ones."""
    fid, original = survey_questions(snap, sector_id)
    source_steps = {s["question"]: s for s in snap["flows"][fid]["steps"]} if fid else {}
    steps = []
    for i, q in enumerate(questions, start=1):
        kept = source_steps.get(q)
        nxt = {"text": f"step {i + 1}", "cards": [], "goto": i + 1} if i < len(questions) else {"text": "end", "cards": [], "end": True}
        if kept:
            then = dict(kept["then"]) if kept.get("then") else None
            if then and then.get("goto") is not None:
                then = {**then, "goto": None}  # steps were renumbered; keep the branch's words and cards
                then.pop("goto")
            steps.append({**kept, "step": i, "then": then, "default_next": nxt})
        else:
            steps.append(
                {"step": i, "asks_for": f"q{i}", "question": q, "answer_type": "text", "if_answer": "", "then": None, "default_next": nxt}
            )
    name = snap["flows"][fid]["name"] if fid else f"{sector(snap, sector_id)['name']} survey"
    return {"flow_id": "F-SESSION-SURVEY", "name": name, "sector_id": sector_id, "template_id": "T-COLLECT", "starts_when": "After the caller agrees to the survey", "steps": steps}


def assemble(snap: dict[str, Any], answers: dict[str, Any], session_cards: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The agent config for these answers (validated; ids only from the snapshot)."""
    template_id = str(answers.get("template_id") or "")
    sector_id = str(answers.get("sector_id") or "")
    t = template(snap, template_id)
    s = sector(snap, sector_id)
    language = str(answers.get("language") or "")
    language_name(language)
    topic = _clean(answers.get("topic"), MAX_TOPIC)
    sample = answers.get("sample_knowledge", True) is not False
    session_cards = list(session_cards or [])
    if not sample and not session_cards:
        raise BuildError("Keep the sample knowledge, or add a document or link.")

    flow_ids = flows_for(snap, template_id, sector_id)
    record = demo_record(snap, template_id, sector_id)
    config: dict[str, Any] = {
        "kb_version": snap["kb_version"],
        "template_id": template_id,
        "sector_id": sector_id,
        "language": language,
        "topic": topic,
        "sample_knowledge": sample,
        "card_ids": cards_for(snap, sector_id) if sample else [],
        "session_cards": session_cards,
        "contact_ids": contacts_for(snap, sector_id),
        "guardrail_ids": [g["rule_id"] for g in guardrails_for(snap, template_id)],
        "demo_record_id": record["record_id"] if record and template_id in OUTBOUND + ("T-RESOLVE",) else None,
        "session_flows": {},
        "options": {},
    }

    if template_id == "T-INFORM":
        announcement = _clean(answers.get("announcement"), MAX_ANNOUNCEMENT) or (
            f"{record['details']}: {record['date_or_ref']}." if record else ""
        )
        if not announcement:
            raise BuildError("Paste the announcement the agent should give.")
        config["options"]["announcement"] = announcement
        config["options"]["audience"] = _clean(answers.get("audience"), MAX_AUDIENCE) or (record["person"] if record else "")
    if template_id == "T-REMIND":
        config["options"]["reminder"] = _clean(answers.get("reminder"), MAX_REMINDER) or (
            f"{record['details']}: {record['date_or_ref']}" if record else ""
        )
        if not config["options"]["reminder"]:
            raise BuildError("Say what the reminder is about, and by when.")
        choice = str(answers.get("if_cant_make_it") or "reschedule")
        config["options"]["if_cant_make_it"] = choice if choice in ("reschedule", "helpline") else "reschedule"
    if template_id == "T-COLLECT":
        raw = answers.get("survey_questions")
        questions = [_clean(q, MAX_QUESTION) for q in (raw if isinstance(raw, list) else survey_questions(snap, sector_id)[1])]
        questions = [q for q in questions if q][:MAX_SURVEY_QUESTIONS]
        if not questions:
            raise BuildError("Keep at least one survey question.")
        config["session_flows"]["F-SESSION-SURVEY"] = _survey_flow(snap, sector_id, questions)
        flow_ids = [f for f in flow_ids if snap["flows"][f]["template_id"] != "T-COLLECT" or f == t["default_flow"]]
        flow_ids.append("F-SESSION-SURVEY")
    if template_id == "T-RESOLVE":
        offered = [f for f in flow_ids if snap["flows"][f]["template_id"] == "T-RESOLVE" and f != t["default_flow"]]
        chosen = answers.get("complaint_flows")
        if isinstance(chosen, list):
            unknown = [f for f in chosen if f not in offered]
            if unknown:
                raise BuildError("Pick complaint types from the list.")
            flow_ids = [f for f in flow_ids if f not in offered or f in chosen]
    if template_id == "T-GUIDE":
        services = [c for c in cards_for(snap, sector_id) if snap["cards"][c]["type"] == "Service"]
        chosen_service = str(answers.get("service_card_id") or "") or best_card(snap, services, topic) or ""
        if chosen_service and chosen_service not in services:
            raise BuildError("Pick a service from the list.")
        config["options"]["service_card_id"] = chosen_service or None

    config["flows"] = flow_ids
    config["records_fields"] = t["records_fields"]
    config["role"] = role_card(snap, template_id, sector_id, record)
    config["role_card_id"] = config["role"]["role_id"]
    config["values"] = fill_values(snap, config)
    return config


def fill_values(snap: dict[str, Any], config: dict[str, Any]) -> dict[str, str]:
    """Values for {sector}, {name}, {date}, ... in greetings, questions and rules."""
    s = sector(snap, config["sector_id"])
    record = snap["demo_records"].get(config.get("demo_record_id") or "") or demo_record(snap, config["template_id"], config["sector_id"])
    options = config.get("options") or {}
    helpline = s["main_helpline"] if s["main_helpline"] not in ("", "—") else ""
    if not helpline:
        near = [snap["contacts"][c] for c in config["contact_ids"] if snap["contacts"][c]["sector_id"] == config["sector_id"]]
        helpline = f"{near[0]['name']} on {near[0]['number_or_link']}" if near else "the department office"
    service = ""
    if options.get("service_card_id"):
        service = _sentence_case_name(snap["cards"][options["service_card_id"]]["title"])
    person = record["person"] if record else (FALLBACK_PERSON if config["template_id"] in ("T-REMIND", "T-COLLECT") else "")
    values = {
        "language": LANGUAGE_NAMES.get(config.get("language") or "", ""),
        "sector": s["name"].lower(),
        "helpline": helpline,
        "service": service or config.get("topic") or f"a service from the {s['name'].lower()} department",
        "area": options.get("audience") or "",
        "name": person_label(person) if person else "",
        "greeting_name": person_name(person),
        "item": _sentence_case_name(record["details"]) if record else "",
        "date": record["date_or_ref"] if record else "",
        "ref": record["date_or_ref"].replace("Ref ", "") if record and record["date_or_ref"].startswith("Ref ") else "",
    }
    if config["template_id"] == "T-REMIND" and options.get("reminder"):
        values["item"] = options["reminder"]
    return {k: v for k, v in values.items() if v}


def opening_line(snap: dict[str, Any], config: dict[str, Any]) -> dict[str, str]:
    """The English opening: the template's greeting with the AI and demo notice
    before its last sentence. Outbound calls end on their first flow question."""
    t = template(snap, config["template_id"])
    values = config.get("values") or fill_values(snap, config)
    pattern = t["greeting_pattern"]
    if config["template_id"] == "T-REMIND":
        # The flow confirms who answered before saying what the reminder is about
        # (template rule: never reveal it to anyone else), so the opening doesn't name it.
        pattern = re.sub(r"\s+about \{item\}", "", pattern)
    # Greet by name only when the record has one ("Hello Savitha", never "Hello the farmer").
    greeting = flow_engine.fill(pattern, {**values, "name": values.get("greeting_name", "")})
    greeting = re.sub(r"\{[a-z_ ]+\}", "", greeting).replace(" ,", ",").strip()
    sentences = [x for x in re.split(r"(?<=[.?!])\s+", greeting) if x]
    if config["template_id"] in OUTBOUND and not any(x.endswith("?") for x in sentences):
        first = snap["flows"][t["default_flow"]]["steps"][0]["question"]
        asks = [x for x in re.split(r"(?<=[.?!])\s+", flow_engine.fill(first, values)) if x.endswith("?")]
        if asks:
            sentences.append(asks[-1])
    if len(sentences) > 1:
        spoken = " ".join(sentences[:-1] + [NOTICE, sentences[-1]])
    else:
        spoken = " ".join(sentences + [NOTICE])
    return {"greeting": greeting, "opening": spoken}


def compose_opening(greeting: str, notice: str) -> str:
    """The visitor may edit the greeting; the notice is always spoken, before its last sentence."""
    greeting = re.sub(r"\s+", " ", greeting or "").strip()
    parts = [x for x in re.split(r"(?<=[.?!।])\s+", greeting) if x]
    if notice and notice in greeting:
        return greeting
    if len(parts) > 1:
        return " ".join(parts[:-1] + [notice, parts[-1]])
    return f"{greeting} {notice}".strip()


# --- the filled prompt -----------------------------------------------------------------------

STATE_OPEN, STATE_CLOSE = "<state>", "</state>"


def _read(name: str) -> str:
    return (PROMPTS / name).read_text(encoding="utf-8").strip()


def _card_line(c: dict[str, Any]) -> str:
    return f"{c['card_id']} · {c['status']} · {c['title']} · {c.get('who_its_for') or '—'} · {c['answer']}"


def _record_text(snap: dict[str, Any], config: dict[str, Any]) -> str:
    record = snap["demo_records"].get(config.get("demo_record_id") or "")
    options = config.get("options") or {}
    if not record and not options.get("reminder"):
        return "none"
    parts = []
    if record:
        parts.append(f"{record['person']} · {record['details']} · {record['date_or_ref']} · what you do: {record['what_the_agent_does']}")
    if options.get("reminder") and (not record or options["reminder"] != f"{record['details']}: {record['date_or_ref']}"):
        parts.append(f"Reminder set by the builder: {options['reminder']}")
    if options.get("if_cant_make_it") == "reschedule":
        parts.append("If they can't make it: offer to note a new date that suits them.")
    elif options.get("if_cant_make_it") == "helpline":
        values = config.get("values") or {}
        parts.append(f"If they can't make it: give the helpline, {values.get('helpline', 'the department office')}.")
    return "\n".join(parts)


def system_prompt(snap: dict[str, Any], config: dict[str, Any], opening: str, state_text: str) -> str:
    """The base prompt and the template block, with every placeholder filled."""
    t = template(snap, config["template_id"])
    s = sector(snap, config["sector_id"])
    values = config.get("values") or fill_values(snap, config)
    language = language_name(config["language"])
    cards = [_card_line(snap["cards"][c]) for c in config["card_ids"]]
    cards += [_card_line(c) for c in config.get("session_cards") or []]
    contacts = [
        f"{c['name']} · {c['number_or_link']} · {c['when_to_use']} · {c['hours']}"
        for c in (snap["contacts"][cid] for cid in config["contact_ids"])
    ]
    flow_lines = []
    for fid in config["flows"]:
        f = config["session_flows"].get(fid) or snap["flows"][fid]
        flow_lines.append(f"{fid} · {f['starts_when'] or f['name']}")

    block = _read(f"{config['template_id']}.md")
    rails = []
    for g in guardrails_for(snap, config["template_id"]):
        say = flow_engine.fill(g["what_the_agent_says"], values)
        say = re.sub(r"\{[a-z_ ]+\}", "the number", say)
        rule = g["rule"]
        if g["rule_id"] == "G-09":
            # Base rule 7: never promise a date that isn't on a card.
            rule += " Give the expected time only if a card states it; otherwise say the office will follow up."
        rails.append(f"- {g['rule_id']}: {rule} Say it like: \"{say}\"")
    block += "\n\n# Guardrails (from the knowledge base)\n" + "\n".join(rails)
    if config.get("session_cards"):
        block += (
            "\n\n# Uploaded knowledge\nCards whose status is \"Uploaded\" come from a document or link the builder added. "
            "They are not checked: treat them like \"Partly verified\"."
        )
    if config["template_id"] == "T-GUIDE" and (config.get("options") or {}).get("service_card_id"):
        block += f"\n\nThe builder set this agent up for: {snap['cards'][config['options']['service_card_id']]['title']} ({config['options']['service_card_id']})."
    if config.get("topic"):
        block += f"\n\nWhat the builder said this agent is for: {config['topic']}"

    filled = {
        "agent_name": f"{s['name']} helpline assistant",
        "sector_name": s["name"],
        "state_name": STATE_NAMES.get(s["demo_state"], s["demo_state"]),
        "language_name": language,
        "template_job": _sentence_case_name(t["description"]).rstrip("."),
        "greeting": opening,
        "knowledge_cards": "\n".join(cards) or "none",
        "contacts": "\n".join(contacts) or "none",
        "flows": "\n".join(flow_lines),
        "state_block": f"{STATE_OPEN}\n{state_text}\n{STATE_CLOSE}",
        "demo_record": _record_text(snap, config),
        "announcement": (config.get("options") or {}).get("announcement", ""),
        "audience": (config.get("options") or {}).get("audience", ""),
    }
    base = _read("base.md").replace("{{template_block}}", block)
    out = re.sub(r"\{\{([a-z_]+)\}\}", lambda m: filled.get(m.group(1), m.group(0)), base)
    left = re.findall(r"\{\{[a-z_]+\}\}", out)
    if left:
        raise BuildError(f"Prompt placeholders left unfilled: {', '.join(sorted(set(left)))}", status_code=500)
    return out


def flow_ctx(snap: dict[str, Any], config: dict[str, Any]) -> flow_engine.Ctx:
    return flow_engine.Ctx(
        snapshot=snap,
        allowed=list(config["flows"]),
        values=config.get("values") or fill_values(snap, config),
        session_flows=config.get("session_flows") or {},
    )


def initial_state_text(snap: dict[str, Any], config: dict[str, Any], opening: str) -> tuple[dict[str, Any], str]:
    ctx = flow_ctx(snap, config)
    state = flow_engine.new_state(template(snap, config["template_id"])["default_flow"])
    text = f"Your opening line (already spoken): {opening}\n" + flow_engine.state_block(ctx, state)
    return state, text


# --- the router (the "Describe your agent" box) ------------------------------------------------

_JOB_WORDS = {
    "T-REMIND": ("remind", "reminder", "due", "follow up", "follow-up", "renewal", "appointment", "dose"),
    "T-RESOLVE": ("complaint", "complain", "grievance", "report a", "pothole", "garbage", "faulty", "not working"),
    "T-COLLECT": ("survey", "feedback", "verify", "verification", "check whether", "rate"),
    "T-INFORM": ("announce", "announcement", "alert", "warn", "inform", "notify", "tell people about"),
    "T-GUIDE": ("apply", "application", "certificate", "licence", "license", "documents", "step by step", "register"),
}
_REFUSE = ("aadhaar", "otp", "bank account", "card number", "password", "pin number", "vote for", "persuade voters", "pretend to be")


def _keyword_route(snap: dict[str, Any], text: str) -> dict[str, Any]:
    low = (text or "").lower()
    if any(w in low for w in _REFUSE):
        return {"template_id": None, "sector_id": None, "topic": _clean(text, 80), "language": None, "confidence": 0.6,
                "ask_next": None, "reason": "Agents must never ask for Aadhaar, bank details or OTPs, or persuade voters."}
    tid = next((t for t, words in _JOB_WORDS.items() if any(w in low for w in words)), "T-ANSWER")
    want = _words(low)
    best = max(
        ((len(want & _words(f"{s['name']} {s['description']} {s['example_topics']}")), sid) for sid, s in snap["sectors"].items()),
        default=(0, None),
    )
    sid = best[1] if best[0] > 0 else None
    lang = next((c for c, n, native in LANGUAGES if n.lower() in low or native in text), None)
    ask = "q1" if not sid else "q2"
    return {"template_id": tid if tid in snap["templates"] else None, "sector_id": sid, "topic": _clean(text, 80), "language": lang,
            "confidence": 0.4, "ask_next": ask, "reason": "Matched on keywords."}


def _validated_route(snap: dict[str, Any], data: dict[str, Any], text: str) -> dict[str, Any]:
    tid = data.get("template_id") if data.get("template_id") in snap["templates"] else None
    sid = data.get("sector_id") if data.get("sector_id") in snap["sectors"] else None
    lang = data.get("language") if data.get("language") in LANGUAGE_NAMES else None
    ask = data.get("ask_next") if data.get("ask_next") in ("q1", "q2", "q3") else None
    if tid and not sid:
        ask = "q1"
    try:
        confidence = max(0.0, min(1.0, float(data.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "template_id": tid,
        "sector_id": sid,
        "topic": _clean(data.get("topic") or text, 100),
        "language": lang,
        "confidence": confidence,
        "ask_next": ask if tid else None,
        "reason": _clean(data.get("reason"), 160),
    }


def router_prompt(snap: dict[str, Any], text: str) -> str:
    templates = [{k: t[k] for k in ("template_id", "name", "job", "example_uses")} for t in snap["templates"].values()]
    sectors = [{k: s[k] for k in ("sector_id", "name", "example_topics")} for s in snap["sectors"].values()]
    filled = {
        "user_text": json.dumps(_clean(text, 600), ensure_ascii=False),
        "templates_json": json.dumps(templates, ensure_ascii=False),
        "sectors_json": json.dumps(sectors, ensure_ascii=False),
    }
    return re.sub(r"\{\{([a-z_]+)\}\}", lambda m: filled.get(m.group(1), m.group(0)), _read("router.md"))


async def route(snap: dict[str, Any], text: str, complete) -> dict[str, Any]:
    """Template, sector, topic and language for a typed description. ``complete``
    is the preview's text-model call; on any failure the keyword match is used."""
    text = _clean(text, 600)
    if not text:
        raise BuildError("Describe the agent in a few words.")
    try:
        reply = await complete(router_prompt(snap, text))
        match = re.search(r"\{.*\}", reply, re.S)
        data = json.loads(match.group(0)) if match else None
    except Exception as exc:  # noqa: BLE001 - the keyword route keeps the page working
        logger.info("Demo router fell back to keywords: %s", type(exc).__name__)
        data = None
    if not isinstance(data, dict):
        return {**_keyword_route(snap, text), "source": "keywords"}
    return {**_validated_route(snap, data, text), "source": "model"}
