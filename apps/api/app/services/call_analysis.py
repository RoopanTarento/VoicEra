"""Call analysis: outcome, sentiment, summary and agent feedback from a transcript.

Two engines, and every result says which one produced it:

* ``llm``   - the organisation's own OpenAI key (Integrations), asked for a
  strict JSON verdict. Used when that key is configured.
* ``rules`` - keyword and conversation-shape rules. Always available, works
  offline, and is the fallback when the LLM call fails.

Transcripts are redacted (phone numbers, emails, ID numbers) before they are
stored or sent anywhere. Unanswered calls are analysed from the call record
alone (no transcript needed).

Transcripts come from the voice runtime (``transcript_url`` in object
storage). Calls placed through the mock provider get a clearly labelled
synthetic transcript so the whole flow can be tried without a carrier.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from apps.pii import redact_text

logger = logging.getLogger(__name__)

OUTCOMES = {
    "interested": "Interested",
    "not_interested": "Not interested",
    "callback": "Call back later",
    "wrong_person": "Wrong person",
    "no_answer": "No answer",
    "unclear": "Unclear",
    "will_apply": "Will apply",
    "already_enrolled": "Already enrolled",
    "informed": "Knows next steps",
    "issue_reported": "Problem reported",
    "no_issue": "No problem",
    "survey_completed": "Survey completed",
    "survey_partial": "Survey partly done",
    "survey_declined": "Declined survey",
}
SENTIMENTS = ("positive", "neutral", "negative")

# feedback code -> text shown to people (codes are counted for campaign themes)
FEEDBACK = {
    "no_greeting": "Agent didn't introduce itself or the organisation at the start.",
    "long_turns": "Agent spoke in long turns; shorter sentences keep people engaged.",
    "agent_dominated": "Agent did most of the talking; ask more questions and listen.",
    "no_next_step": "Call ended without a clear next step for the person.",
    "handled_objection": "Agent handled a concern politely and stayed on purpose.",
    "confirmed_next_step": "Agent confirmed a clear next step before ending.",
    "respected_opt_out": "Agent respected the person's wish not to continue.",
    "verified_identity": "Agent checked it was talking to the right person.",
    "short_call": "Call was very short; the opening may need to grab attention sooner.",
}

_INTERESTED = ("interested", "yes please", "sounds good", "tell me more", "how do i apply", "sign me up",
               "haan", "ha ji", "sure", "okay i will", "i'd like", "i would like", "send me")
_NOT_INTERESTED = ("not interested", "no thanks", "no thank you", "don't call", "do not call", "stop calling",
                   "nahi chahiye", "remove my number", "not needed")
_CALLBACK = ("call later", "call back", "call me later", "busy right now", "in a meeting", "tomorrow",
             "another time", "baad mein")
_WRONG = ("wrong number", "not me", "doesn't live here", "no one by that name", "you have the wrong")
_POSITIVE = ("thank", "great", "good", "helpful", "happy", "yes", "sure", "wonderful", "dhanyavaad")
_NEGATIVE = ("angry", "annoyed", "waste", "stop", "not interested", "don't", "irritat", "bad", "complain")
_GREETING = ("hello", "namaste", "good morning", "good afternoon", "good evening", "this is", "calling from", "my name is")
_ALREADY = ("already have", "already registered", "already enrolled", "already getting", "already get it", "already applied",
            "already covered", "already taken", "we have the card", "i have the card", "already a member")
_ISSUE = ("problem", "issue", "not received", "haven't received", "have not received", "didn't get", "did not get", "not credited",
          "hasn't come", "has not come", "refused", "denied", "asked me to pay", "asked us to pay", "asked for money", "bribe",
          "rejected", "pending", "still waiting", "not working", "nobody helped", "no one helped", "no response")
_NO_ISSUE = ("no problem", "no issue", "no issues", "no problems", "everything is fine", "all good", "working fine",
             "it's fine", "it is fine", "got it on time", "received it", "koi problem nahi", "sab theek")
_WILL_APPLY = ("will apply", "i'll apply", "i will register", "i'll register", "will go to the centre", "will go to the center",
               "i will go this week", "i will go tomorrow", "apply this week", "apply tomorrow")
# The intent whose path a call ended up on, by outcome (see ``use_cases._routing``).
_OUTCOME_PATH = {"will_apply": "enrolment", "already_enrolled": "utilisation", "informed": "utilisation", "issue_reported": "support"}
_SCHEME_OUTCOMES = ("interested", "will_apply", "already_enrolled", "informed", "issue_reported", "no_issue",
                    "not_interested", "callback", "wrong_person", "unclear")
_NEXT_STEP = ("i will send", "we will send", "sms", "message you", "visit", "call you back", "registered",
              "next step", "you can apply", "link", "appointment", "scheduled")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has(text: str, phrases: tuple[str, ...]) -> bool:
    return any(p in text for p in phrases)


def clean_turns(turns: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Keep role/text only, with personal identifiers redacted."""
    cleaned = []
    for turn in turns or []:
        role = "agent" if str(turn.get("role") or "").lower() in ("agent", "assistant", "bot") else "user"
        text = redact_text(str(turn.get("text") or turn.get("content") or "")).strip()
        if text:
            cleaned.append({"role": role, "text": text[:2000]})
    return cleaned[:400]


def not_answered(call_response: str | None) -> dict[str, Any]:
    reason = {"busy": "Line was busy.", "no_answer": "Nobody picked up.", "failed": "The call didn't connect.",
              "cancelled": "The call was cancelled."}.get(str(call_response or ""), "The call wasn't answered.")
    return {
        "outcome": "no_answer",
        "outcome_label": OUTCOMES["no_answer"],
        "sentiment": "neutral",
        "summary": reason,
        "feedback": [],
        "feedback_codes": [],
        "engine": "rules",
        "transcript_source": None,
        "analysed_at": _now_iso(),
    }


def issue_themes(text: str) -> list[str]:
    """Problem types (``use_cases.ISSUE_THEMES``) mentioned in a caller's words."""
    from app.services.use_cases import ISSUE_THEMES

    lower = text.lower()
    return [theme for theme, words in ISSUE_THEMES.items() if any(w in lower for w in words)]


def _has_issue(user_text: str) -> bool:
    text = user_text
    for phrase in _NO_ISSUE:
        text = text.replace(phrase, " ")
    return _has(text, _ISSUE) or bool(issue_themes(text))


def _intent_outcome(intent: str | None, outcome: str, user_text: str) -> str:
    """Re-read a generic outcome for a scheme agent's call.

    Any scheme agent can switch path mid-call, so a problem is a problem
    whatever the agent was set up for, and someone who says they'll apply
    "will apply" even on an awareness call.
    """
    if not intent or outcome in ("wrong_person", "callback"):
        return outcome
    if _has_issue(user_text):
        return "issue_reported"
    if intent == "support" and _has(user_text, _NO_ISSUE):
        return "no_issue"
    if intent in ("awareness", "discovery", "enrolment") and _has(user_text, _ALREADY):
        return "already_enrolled"
    if outcome == "not_interested":
        return outcome
    if _has(user_text, _WILL_APPLY) or (intent == "enrolment" and outcome == "interested"):
        return "will_apply"
    if intent in ("utilisation", "support") and outcome == "interested":
        return "informed"
    return outcome


def switched_path(intent: str | None, outcome: str) -> str | None:
    """The other intent whose path the call took, if any."""
    path = _OUTCOME_PATH.get(outcome)
    return path if intent and path and path != intent else None


def analyse_rules(turns: list[dict[str, str]], *, duration: float | None = None, intent: str | None = None) -> dict[str, Any]:
    user_text = " ".join(t["text"].lower() for t in turns if t["role"] == "user")
    agent_turns = [t["text"] for t in turns if t["role"] == "agent"]
    agent_text = " ".join(a.lower() for a in agent_turns)

    if _has(user_text, _WRONG):
        outcome = "wrong_person"
    elif _has(user_text, _NOT_INTERESTED):
        outcome = "not_interested"
    elif _has(user_text, _CALLBACK):
        outcome = "callback"
    elif _has(user_text, _INTERESTED):
        outcome = "interested"
    else:
        outcome = "unclear"
    outcome = _intent_outcome(intent, outcome, user_text)

    pos = sum(user_text.count(w) for w in _POSITIVE)
    neg = sum(user_text.count(w) for w in _NEGATIVE)
    sentiment = "positive" if pos > neg + 1 else "negative" if neg > pos else "neutral"
    if outcome in ("interested", "will_apply", "informed", "no_issue") and sentiment == "negative":
        sentiment = "neutral"

    codes: list[str] = []
    first_agent = agent_turns[0].lower() if agent_turns else ""
    if agent_turns and not _has(first_agent, _GREETING):
        codes.append("no_greeting")
    if any(len(a.split()) > 60 for a in agent_turns):
        codes.append("long_turns")
    agent_words = len(agent_text.split())
    user_words = len(user_text.split())
    if agent_words and agent_words > 3 * max(user_words, 1) and agent_words > 80:
        codes.append("agent_dominated")
    if _has(agent_text, ("am i speaking with", "is this", "confirm your name", "speaking to")):
        codes.append("verified_identity")
    if outcome == "not_interested" and _has(agent_text, ("understand", "no problem", "sorry to disturb", "thank you for your time")):
        codes.append("respected_opt_out")
    if outcome in ("interested", "will_apply", "informed", "issue_reported", "callback"):
        codes.append("confirmed_next_step" if _has(agent_text, _NEXT_STEP) else "no_next_step")
    if _has(user_text, ("but", "worried", "not sure", "how much", "is it safe")) and outcome != "not_interested":
        codes.append("handled_objection")
    if duration is not None and 0 < duration < 15:
        codes.append("short_call")

    summary = _rules_summary(outcome, agent_turns, turns)
    result = {
        "outcome": outcome,
        "outcome_label": OUTCOMES[outcome],
        "sentiment": sentiment,
        "summary": summary,
        "feedback": [FEEDBACK[c] for c in codes],
        "feedback_codes": codes,
        "engine": "rules",
        "analysed_at": _now_iso(),
    }
    if outcome == "issue_reported":
        result["issues"] = issue_themes(user_text)
    if switched_path(intent, outcome):
        result["switched_to"] = switched_path(intent, outcome)
    return result


def _rules_summary(outcome: str, agent_turns: list[str], turns: list[dict[str, str]]) -> str:
    purpose = ""
    for text in agent_turns[:2]:
        sentences = re.split(r"(?<=[.!?])\s+", text.strip())
        purpose = next((s for s in sentences if re.search(r"\b(about|regarding|scheme|calling)\b", s, re.I)), "")
        if purpose:
            break
    ending = {
        "interested": "The person was interested.",
        "not_interested": "The person said they weren't interested.",
        "callback": "The person asked to be called back later.",
        "wrong_person": "The call reached the wrong person.",
        "unclear": "The person's response wasn't clear.",
        "will_apply": "The person said they would apply.",
        "already_enrolled": "The person is already enrolled.",
        "informed": "The person now knows how to get the benefit.",
        "issue_reported": "The person reported a problem.",
        "no_issue": "The person hasn't had any problem.",
    }.get(outcome, "")
    lead = f"Agent: {purpose[:160]}" if purpose else f"{len(turns)}-turn conversation."
    return f"{lead} {ending}".strip()


# --- surveys ---------------------------------------------------------------------------------

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
}
_YES = ("yes", "yeah", "haan", "han ", "ha ji", "ji haan", "yes it does", "it does", "every day", "sure", "correct")


def agent_use_case(org_id: str, agent_id: str | None) -> dict[str, Any] | None:
    if not agent_id:
        return None
    try:
        from app.services import agent_service

        config = agent_service.get_agent(org_id, agent_id).get("config") or {}
    except Exception:  # noqa: BLE001 - deleted agent or lookup failure
        return None
    from app.services.use_cases import normalise_use_case

    return normalise_use_case(config.get("use_case"))


def _parse_answer(kind: str, text: str) -> Any:
    lower = f" {text.lower()} "
    if kind == "rating":
        digit = re.search(r"\b([1-5])\b", lower)
        if digit:
            return int(digit.group(1))
        for word, value in _NUMBER_WORDS.items():
            if re.search(rf"\b{word}\b", lower):
                return value
        return None
    if kind == "yes_no":
        if any(w in lower for w in (" no ", " no,", " no.", "nahi", "nahin", "never", "doesn't", "does not", "don't", "didn't", " not ")):
            return False
        if any(w in lower for w in _YES):
            return True
        return None
    return text.strip()[:240] or None


_STOP = {"the", "a", "an", "you", "your", "do", "does", "is", "are", "how", "would", "rate", "from", "1", "to", "5", "in", "of", "at", "and", "what", "it"}


def _words(text: str) -> set[str]:
    return {w for w in re.sub(r"[^a-z0-9 ]+", " ", text.lower()).split() if w not in _STOP}


def extract_survey_answers(turns: list[dict[str, str]], survey: dict[str, Any]) -> dict[str, Any]:
    """Map each survey question to the caller's reply that follows it (rules).

    An agent turn counts as asking a question when it shares most of that
    question's distinctive words, so light rewording still matches. Calls in
    other languages need the LLM engine for reliable answers.
    """
    question_words = {q["id"]: _words(q["text"]) for q in survey["questions"]}
    answers: dict[str, Any] = {}
    for i, turn in enumerate(turns):
        if turn["role"] != "agent":
            continue
        spoken = _words(turn["text"])
        scored = [
            (len(spoken & words) / len(words), q)
            for q in survey["questions"]
            if q["id"] not in answers and (words := question_words[q["id"]])
        ]
        if not scored:
            continue
        score, question = max(scored, key=lambda pair: pair[0])
        if score < 0.6:
            continue
        reply = next((t["text"] for t in turns[i + 1:i + 2] if t["role"] == "user"), None)
        value = _parse_answer(question["kind"], reply) if reply else None
        if value is not None:
            answers[question["id"]] = value
    return answers


def _survey_result(survey: dict[str, Any], answers: dict[str, Any], base_outcome: str) -> dict[str, Any]:
    total = len(survey["questions"])
    if base_outcome in ("wrong_person", "callback") and not answers:
        outcome = base_outcome
    elif len(answers) == total:
        outcome = "survey_completed"
    elif answers:
        outcome = "survey_partial"
    else:
        outcome = "survey_declined"
    themes = []
    open_text = " ".join(str(v).lower() for q in survey["questions"] if q["kind"] == "open" for v in [answers.get(q["id"])] if v)
    for theme, words in (survey.get("complaint_themes") or {}).items():
        if open_text and any(w in open_text for w in words):
            themes.append(theme)
    return {
        "outcome": outcome,
        "outcome_label": OUTCOMES[outcome],
        "survey": {"survey_id": survey["id"], "answers": answers, "answered": len(answers), "questions": total, "themes": themes},
    }


def _openai_key(org_id: str) -> str | None:
    try:
        from app.services import auth_service

        stored = auth_service.get_provider_auth(org_id, "openai", mask_secrets=False) or {}
        auth = stored.get("auth") if isinstance(stored.get("auth"), dict) else stored
        key = str(auth.get("api_key") or "").strip()
        return key or None
    except Exception:  # noqa: BLE001 - no key or encryption not configured
        return None


_LLM_PROMPT = (
    "You review phone calls made by a voice agent for a public-service organisation. "
    "Return only JSON with keys: outcome (one of {outcomes}), "
    "sentiment (positive, neutral, negative), summary (max 2 sentences, no personal details), "
    "feedback (list of up to 4 short, specific suggestions or strengths for the agent)."
)
_GENERIC_OUTCOMES = ("interested", "not_interested", "callback", "wrong_person", "unclear")
_OUTCOME_HINTS = {
    "will_apply": "will_apply = they said they will apply or register",
    "already_enrolled": "already_enrolled = they already have or get the scheme",
    "informed": "informed = they now know how to get the benefit",
    "issue_reported": "issue_reported = they described a problem getting the benefit",
    "no_issue": "no_issue = they said they have had no problem",
}


def _llm_outcomes(intent: str | None) -> tuple[str, ...]:
    # A scheme agent can end on any intent's outcome, because it switches path when needed.
    return _SCHEME_OUTCOMES if intent else _GENERIC_OUTCOMES


def analyse_llm(
    org_id: str, turns: list[dict[str, str]], survey: dict[str, Any] | None = None, intent: str | None = None
) -> dict[str, Any] | None:
    key = _openai_key(org_id)
    if not key or not turns:
        return None
    allowed = _GENERIC_OUTCOMES if survey else _llm_outcomes(intent)
    system = _LLM_PROMPT.format(outcomes=", ".join(allowed))
    hints = [_OUTCOME_HINTS[o] for o in allowed if o in _OUTCOME_HINTS]
    if hints:
        system += " Outcome meanings: " + "; ".join(hints) + "."
    if "issue_reported" in allowed:
        from app.services.use_cases import ISSUE_THEMES

        system += (
            " If the outcome is issue_reported, also return issues: a list of the problem types mentioned, chosen only from: "
            + ", ".join(ISSUE_THEMES) + "."
        )
    if survey:
        spec = "; ".join(f"{q['id']} ({q['kind']}): {q['text']}" for q in survey["questions"])
        system += (
            " This call is a survey. Also return survey_answers: an object keyed by question id with the caller's answer"
            " (rating as an integer 1-5, yes_no as true/false, open as a short phrase without personal details);"
            f" leave out questions that weren't answered. Questions: {spec}"
        )
    try:
        from openai import OpenAI

        transcript = "\n".join(f"{t['role'].upper()}: {t['text']}" for t in turns)[:24000]
        reply = OpenAI(api_key=key, timeout=30).chat.completions.create(
            model="gpt-4.1-mini",
            temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": transcript}],
        )
        data = json.loads(reply.choices[0].message.content or "{}")
    except Exception as exc:  # noqa: BLE001 - fall back to rules
        logger.warning("LLM call analysis failed, using rules: %s", type(exc).__name__)
        return None
    outcome = data.get("outcome") if data.get("outcome") in allowed else "unclear"
    sentiment = data.get("sentiment") if data.get("sentiment") in SENTIMENTS else "neutral"
    feedback = [redact_text(str(f))[:240] for f in (data.get("feedback") or []) if str(f).strip()][:4]
    if survey and isinstance(data.get("survey_answers"), dict):
        kinds = {q["id"]: q["kind"] for q in survey["questions"]}
        llm_answers = {}
        for qid, value in data["survey_answers"].items():
            if qid not in kinds or value in (None, ""):
                continue
            if kinds[qid] == "rating" and isinstance(value, (int, float)) and 1 <= value <= 5:
                llm_answers[qid] = int(value)
            elif kinds[qid] == "yes_no" and isinstance(value, bool):
                llm_answers[qid] = value
            elif kinds[qid] == "open":
                llm_answers[qid] = redact_text(str(value))[:240]
        data["_survey_answers"] = llm_answers
    result = {
        "outcome": outcome,
        "outcome_label": OUTCOMES[outcome],
        "sentiment": sentiment,
        "summary": redact_text(str(data.get("summary") or ""))[:500],
        "feedback": feedback,
        "feedback_codes": [],
        "engine": "llm",
        "analysed_at": _now_iso(),
        "_survey_answers": data.get("_survey_answers"),
    }
    if outcome == "issue_reported":
        from app.services.use_cases import ISSUE_THEMES

        result["issues"] = [t for t in (data.get("issues") or []) if t in ISSUE_THEMES]
    if switched_path(intent, outcome):
        result["switched_to"] = switched_path(intent, outcome)
    return result


def analyse(
    org_id: str,
    turns: list[dict[str, Any]],
    *,
    duration: float | None = None,
    transcript_source: str,
    survey: dict[str, Any] | None = None,
    intent: str | None = None,
) -> dict[str, Any]:
    cleaned = clean_turns(turns)
    if not cleaned:
        result = {**not_answered(None), "outcome": "unclear", "outcome_label": OUTCOMES["unclear"],
                  "summary": "No transcript was available for this call."}
    else:
        result = analyse_llm(org_id, cleaned, survey, intent) or analyse_rules(
            cleaned, duration=duration, intent=None if survey else intent
        )
    llm_answers = result.pop("_survey_answers", None)
    if survey and cleaned:
        answers = llm_answers if llm_answers else extract_survey_answers(cleaned, survey)
        result.update(_survey_result(survey, answers, result["outcome"]))
        result["feedback_codes"] = [c for c in result.get("feedback_codes", []) if c not in ("no_next_step", "confirmed_next_step")]
        result["feedback"] = [FEEDBACK[c] for c in result["feedback_codes"] if c in FEEDBACK] if result.get("engine") == "rules" else result.get("feedback", [])
        if result.get("engine") == "rules":
            result["summary"] = f"Survey: {result['survey']['answered']} of {result['survey']['questions']} questions answered."
    return {**result, "transcript_source": transcript_source}


# --- synthetic transcripts for the mock provider -------------------------------------------

_SCENARIOS: list[list[tuple[str, str]]] = [
    [
        ("agent", "Namaste, this is Asha calling from the District Health Mission about the Ayushman Bharat health cover. Am I speaking with the account holder?"),
        ("user", "Yes, speaking. Tell me more."),
        ("agent", "Your family may be eligible for free treatment up to five lakh rupees a year at listed hospitals."),
        ("user", "That sounds good. How do I apply?"),
        ("agent", "I will send you an SMS with the nearest enrolment centre and the documents to bring. Is that okay?"),
        ("user", "Yes please, thank you."),
        ("agent", "Thank you for your time. Have a good day."),
    ],
    [
        ("agent", "Hello, this is Asha calling from the District Health Mission regarding a government health scheme."),
        ("user", "I'm not interested, please don't call again."),
        ("agent", "I understand, sorry to disturb you. Thank you for your time."),
    ],
    [
        ("agent", "Good afternoon, this is Asha calling from the District Health Mission about the PM-KISAN instalment update. Is this a good time?"),
        ("user", "I'm busy right now, can you call me later? Maybe tomorrow."),
        ("agent", "No problem, we will call you back tomorrow. Thank you."),
    ],
    [
        ("agent", "Hello, this is Asha calling from the District Health Mission. Am I speaking with the registered farmer?"),
        ("user", "No, you have the wrong number. No one by that name lives here."),
        ("agent", "Sorry for the trouble. We will update our records. Goodbye."),
    ],
    [
        ("agent", "The PM-KISAN scheme gives eligible farmers six thousand rupees a year in three instalments directly into their bank account, and to receive the next instalment you need to complete your e-KYC at the nearest common service centre or on the portal with your Aadhaar-linked mobile, and you should also check that your land records are updated with the local office."),
        ("user", "But is it safe to share my details? I'm not sure."),
        ("agent", "That's a fair concern. You only share details at the official centre or portal. We never ask for OTPs on the phone."),
        ("user", "Okay, I will go to the centre. Thank you."),
    ],
]


# Made-up open answers for mock survey calls, per survey.
_OPEN_REPLIES: dict[str, list[str]] = {
    "cleanliness": ["The garbage vehicle doesn't come regularly, sometimes it is late by two days.",
                    "Garbage piles up near the corner and it starts to smell."],
    "water": ["Water is irregular, we get it only on alternate days.", "The water pressure is very low."],
    "roads": ["Please fix the potholes on the main road before the rains.",
              "Streetlights near the market are not working, it is dark at night."],
    "toilets": ["The toilet near the bus stand is dirty and has no water."],
    "buses": ["Buses are always crowded and we wait a long time."],
    "complaint_followup": ["My complaint is still pending, nobody called me back."],
    "parks": ["The park needs more benches and lights in the evening."],
    "overall": ["Garbage collection should be fixed first.", "Water supply is the biggest problem."],
    "scheme_feedback": ["The money came late, we had to wait two months.", "I had to visit the office many times with documents.",
                        "Someone at the centre asked for extra money to fill the form."],
}
_FINE = "Nothing much, things are fine."
_HOURS = "About two hours in the morning."


def synthetic_survey_transcript(call_id: str, survey: dict[str, Any]) -> list[dict[str, str]]:
    """A labelled made-up survey call for mock-provider calls (never a real call)."""
    seed = int(hashlib.sha256(call_id.encode("utf-8")).hexdigest(), 16)
    turns = [
        {"role": "agent", "text": f"Namaste, I'm calling from {'the scheme help desk' if survey.get('scheme_id') else 'the city corporation'} to hear your feedback on {survey['topic']}. It takes about two minutes. Is that okay?"},
    ]
    if seed % 7 == 0:
        return turns + [
            {"role": "user", "text": "No, I'm busy, please don't call again."},
            {"role": "agent", "text": "I understand, thank you for your time."},
        ]
    turns.append({"role": "user", "text": "Yes, okay."})
    for n, q in enumerate(survey["questions"]):
        pick = (seed >> (n * 3)) % 5
        if q["kind"] == "rating":
            reply = f"I would say {pick + 1}."
        elif q["kind"] == "yes_no":
            reply = "Yes, it does." if pick % 2 == 0 else "No, not really."
        elif q["id"] == "hours":
            reply = _HOURS
        else:
            options = _OPEN_REPLIES.get(survey.get("reply_key") or survey["id"], []) + [_FINE]
            reply = options[pick % len(options)]
        turns += [{"role": "agent", "text": q["text"]}, {"role": "user", "text": reply}]
    turns.append({"role": "agent", "text": "Thank you, your answers will help improve the scheme." if survey.get("scheme_id")
                  else "Thank you, your feedback will help improve city services."})
    return turns


# Made-up calls per scheme intent; "{s}" is the scheme's name. The generic
# refusals at the end of _SCENARIOS (not interested, call back, wrong number)
# are mixed in so every campaign shows a realistic spread.
_INTENT_SCENARIOS: dict[str, list[list[tuple[str, str]]]] = {
    "awareness": [
        [("agent", "Namaste, I'm calling from the district office with information about {s}. Do you have a minute?"),
         ("user", "Yes, tell me."), ("agent", "It is a government scheme that may help your family. Do you already get it?"),
         ("user", "No. That sounds good, how do I apply?"),
         ("agent", "You can apply at the official website or call the helpline. I'll repeat the number slowly. Thank you for your time.")],
        [("agent", "Namaste, I'm calling from the district office with information about {s}. Do you have a minute?"),
         ("user", "Yes, but we already have it, we are already registered."),
         ("agent", "That's good to hear. If you have any problem, the helpline can help. Thank you.")],
        # Set up for awareness, switches to the support path.
        [("agent", "Namaste, I'm calling from the district office with information about {s}. Do you have a minute?"),
         ("user", "We are in it, but the money has not come for two months."),
         ("agent", "I'm sorry. Please call the helpline, and if it isn't solved you can complain on the grievance portal. Thank you.")],
    ],
    "enrolment": [
        [("agent", "Namaste, I'm calling from the district office to help you apply for {s}. Is this a good time?"),
         ("user", "Yes, okay."), ("agent", "Are you already registered for {s}?"), ("user", "No, not yet."),
         ("agent", "You can apply at the Common Service Centre. Please bring the documents I'll read out. Applying is free."),
         ("user", "Okay I will go this week. Thank you."),
         ("agent", "Thank you. You can apply at the centre this week; I'll repeat the helpline slowly.")],
        [("agent", "Namaste, I'm calling from the district office to help you apply for {s}. Is this a good time?"),
         ("user", "We already have it, I applied last year and we are already enrolled."),
         ("agent", "That's good. If anything goes wrong, the helpline can help. Thank you.")],
    ],
    "utilisation": [
        [("agent", "Namaste, I'm calling from the district office about your {s} benefit. Is this a good time?"),
         ("user", "Yes."), ("agent", "Are you already getting {s}?"), ("user", "Yes."),
         ("agent", "Here is how you get the benefit, and where to check its status. Have you had any problem?"),
         ("user", "No problem, it's fine. Okay I will check there, thank you."),
         ("agent", "Thank you. You can visit the website or call the helpline any time.")],
        [("agent", "Namaste, I'm calling from the district office about your {s} benefit. Is this a good time?"),
         ("user", "Yes. But the money has not come for two months, it is still pending."),
         ("agent", "I'm sorry. Please call the helpline, and if it isn't solved you can complain on the grievance portal. Thank you.")],
    ],
    "support": [
        [("agent", "Namaste, I'm calling from the district office to check whether you've had any problem with {s}. Is this a good time?"),
         ("user", "Yes. The office refused my form and someone asked me to pay extra money."),
         ("agent", "I'm sorry that happened. Please call the helpline, and you can also complain on the grievance portal. Thank you for telling us.")],
        [("agent", "Namaste, I'm calling from the district office to check whether you've had any problem with {s}. Is this a good time?"),
         ("user", "Yes. My name is not in the list even though I applied, and nobody at the office replies."),
         ("agent", "I'm sorry. Please contact the helpline; if that doesn't work, the grievance portal can help. Thank you.")],
        [("agent", "Namaste, I'm calling from the district office to check whether you've had any problem with {s}. Is this a good time?"),
         ("user", "No problem at all, everything is fine."),
         ("agent", "That's good to hear. Thank you for your time.")],
    ],
}


def synthetic_transcript(call_id: str, *, intent: str | None = None, scheme_name: str = "") -> list[dict[str, str]]:
    """A labelled made-up conversation for mock-provider calls (never a real call)."""
    seed = int(hashlib.sha256(call_id.encode("utf-8")).hexdigest(), 16)
    own = _INTENT_SCENARIOS.get(intent or "")
    if own and scheme_name:
        options = own + _SCENARIOS[1:4]
        return [{"role": role, "text": text.replace("{s}", scheme_name)} for role, text in options[seed % len(options)]]
    return [{"role": role, "text": text} for role, text in _SCENARIOS[seed % len(_SCENARIOS)]]


# --- stored analysis -------------------------------------------------------------------


def analyse_and_store(org_id: str, call_log: dict[str, Any], *, turns: list[dict[str, Any]] | None, transcript_source: str | None) -> dict[str, Any]:
    from app.services import call_log_service

    answered = str(call_log.get("call_response") or "") == "answered"
    if not answered:
        analysis = not_answered(call_log.get("call_response"))
    else:
        from app.services.use_cases import survey_for

        use_case = agent_use_case(org_id, call_log.get("agent_id")) or {}
        survey = survey_for(org_id, use_case)
        analysis = analyse(
            org_id,
            turns or [],
            duration=call_log.get("duration"),
            transcript_source=transcript_source or "none",
            survey=survey,
            intent=use_case.get("intent"),
        )
    patch: dict[str, Any] = {"analysis": analysis}
    if turns and transcript_source == "synthetic_mock":
        patch["transcript_inline"] = clean_turns(turns)
        patch["transcript_source"] = transcript_source
    call_log_service.patch_call_log(org_id, str(call_log["call_id"]), patch)
    return analysis


def load_stored_transcript(call_log: dict[str, Any]) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Transcript turns for a call: inline (mock) or from object storage (runtime)."""
    if call_log.get("transcript_inline"):
        return list(call_log["transcript_inline"]), str(call_log.get("transcript_source") or "inline")
    url = str(call_log.get("transcript_url") or "")
    if not url.startswith("minio://"):
        return None, None
    try:
        from app.storage.minio_client import MinIOStorage

        parsed = MinIOStorage.parse_minio_url(url)
        if not parsed:
            return None, None
        response = MinIOStorage().client.get_object(*parsed)
        try:
            data = json.loads(response.read())
        finally:
            response.close()
            response.release_conn()
    except Exception as exc:  # noqa: BLE001 - storage not reachable
        logger.warning("Transcript unavailable for analysis: %s", type(exc).__name__)
        return None, None
    turns = data.get("messages") or data.get("transcript") or data.get("turns") if isinstance(data, dict) else data
    return (list(turns) if isinstance(turns, list) else None), "runtime"


def campaign_analytics(org_id: str, campaign: dict[str, Any]) -> dict[str, Any]:
    """Post-campaign results computed from the campaign's call records."""
    from app.database import get_database

    calls = list(
        get_database()["CallLogs"].find(
            {"org_id": org_id, "campaign_id": campaign["campaign_id"]},
            {"_id": 0, "call_response": 1, "duration": 1, "analysis": 1, "status": 1, "created_at": 1},
        )
    )
    responses = Counter(str(c.get("call_response") or "pending") for c in calls)
    answered = [c for c in calls if c.get("call_response") == "answered"]
    durations = [float(c["duration"]) for c in answered if c.get("duration")]
    analysed = [c["analysis"] for c in calls if isinstance(c.get("analysis"), dict)]
    outcomes = Counter(a.get("outcome") for a in analysed)
    sentiments = Counter(a.get("sentiment") for a in analysed if a.get("outcome") != "no_answer")
    themes = Counter(code for a in analysed for code in a.get("feedback_codes") or [])
    engines = Counter(a.get("engine") for a in analysed if a.get("outcome") != "no_answer")
    synthetic = sum(1 for a in analysed if a.get("transcript_source") == "synthetic_mock")
    attempted = len(calls)
    reached = len(answered)
    interested = outcomes.get("interested", 0) + outcomes.get("will_apply", 0)
    use_case = agent_use_case(org_id, campaign.get("agent_id")) or {}
    survey_summary = _survey_summary(org_id, use_case, analysed)
    issues = Counter(t for a in analysed for t in a.get("issues") or [])
    paths = Counter(a["switched_to"] for a in analysed if a.get("switched_to"))
    return {
        "campaign_id": campaign["campaign_id"],
        "name": campaign.get("name"),
        "state": campaign.get("state"),
        "contacts_total": int(campaign.get("total_rows") or 0),
        "contacts_processed": int(campaign.get("processed_rows") or 0),
        "calls_attempted": attempted,
        "calls_answered": reached,
        "answer_rate": round(100 * reached / attempted, 1) if attempted else 0.0,
        "avg_duration_seconds": round(sum(durations) / len(durations), 1) if durations else None,
        "total_talk_minutes": round(sum(durations) / 60, 1) if durations else 0.0,
        "interested": interested,
        "interest_rate": round(100 * interested / reached, 1) if reached else 0.0,
        "call_responses": [{"key": k, "count": v} for k, v in responses.most_common()],
        "outcomes": [{"key": k, "label": OUTCOMES.get(k, k), "count": outcomes.get(k, 0)} for k in OUTCOMES if outcomes.get(k)],
        "sentiments": [{"key": k, "count": sentiments.get(k, 0)} for k in SENTIMENTS],
        "feedback_themes": [{"code": c, "text": FEEDBACK.get(c, c), "calls": n} for c, n in themes.most_common(6)],
        "analysed_calls": len(analysed),
        "analysis_engines": dict(engines),
        "synthetic_transcripts": synthetic,
        "intent": use_case.get("intent"),
        "issues_reported": outcomes.get("issue_reported", 0),
        "issues": [{"theme": t, "calls": n} for t, n in issues.most_common()],
        "switched_paths": [{"intent": i, "calls": n} for i, n in paths.most_common()],
        "survey": survey_summary,
    }


def _survey_summary(org_id: str, use_case: dict[str, Any], analysed: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Per-question results for a survey campaign (city or scheme feedback; None for other campaigns)."""
    from app.services.use_cases import survey_for

    survey = survey_for(org_id, use_case)
    if not survey:
        return None
    rows = [a["survey"] for a in analysed if isinstance(a.get("survey"), dict)]
    questions = []
    for q in survey["questions"]:
        values = [r["answers"][q["id"]] for r in rows if q["id"] in (r.get("answers") or {})]
        entry: dict[str, Any] = {"id": q["id"], "text": q["text"], "kind": q["kind"], "answered": len(values)}
        if q["kind"] == "rating":
            ratings = [int(v) for v in values if isinstance(v, (int, float))]
            entry["average"] = round(sum(ratings) / len(ratings), 2) if ratings else None
            entry["distribution"] = {str(n): ratings.count(n) for n in range(1, 6)}
        elif q["kind"] == "yes_no":
            flags = [v for v in values if isinstance(v, bool)]
            entry["yes_percent"] = round(100 * sum(flags) / len(flags), 1) if flags else None
        questions.append(entry)
    themes = Counter(t for r in rows for t in r.get("themes") or [])
    return {
        "survey_id": survey["id"],
        "name": survey["name"],
        "responses": len(rows),
        "completed": sum(1 for r in rows if r.get("answered") == r.get("questions")),
        "questions": questions,
        "themes": [{"theme": t, "calls": n} for t, n in themes.most_common()],
    }


def visible_to(call_log: dict[str, Any], can_read_details: bool) -> dict[str, Any]:
    """Members (no ``recordings:read``) see only the outcome of a call, not what was said."""
    analysis = call_log.get("analysis")
    if can_read_details or not isinstance(analysis, dict):
        return call_log
    return {**call_log, "analysis": {k: analysis.get(k) for k in ("outcome", "outcome_label", "analysed_at")}}


async def after_call_update(org_id: str, call_log: dict[str, Any], *, synthetic: bool = False) -> None:
    """Analyse a finished call once: unanswered from the record, answered from its transcript.

    Never raises: analysis must not break the callback or update that triggered it.
    """
    import asyncio

    try:
        if isinstance(call_log.get("analysis"), dict) and not synthetic:
            return
        response = str(call_log.get("call_response") or "")
        if not response or response == "pending":
            return
        if response != "answered":
            await asyncio.to_thread(analyse_and_store, org_id, call_log, turns=None, transcript_source=None)
            return
        if synthetic:
            from app.services import use_cases

            use_case = await asyncio.to_thread(agent_use_case, org_id, call_log.get("agent_id")) or {}
            survey = await asyncio.to_thread(use_cases.survey_for, org_id, use_case)
            call_id = str(call_log["call_id"])
            if survey:
                turns = synthetic_survey_transcript(call_id, survey)
            else:
                schemes = use_case.get("scheme_ids") or []
                names = {s["id"]: s["name"] for s in (await asyncio.to_thread(use_cases.catalogue, org_id))["schemes"]} if schemes else {}
                turns = synthetic_transcript(call_id, intent=use_case.get("intent"), scheme_name=names.get(schemes[0], "") if schemes else "")
            source = "synthetic_mock"
        else:
            turns, source = await asyncio.to_thread(load_stored_transcript, call_log)
            if not turns:
                return
        await asyncio.to_thread(analyse_and_store, org_id, call_log, turns=turns, transcript_source=source)
    except Exception:  # noqa: BLE001
        logger.exception("Call analysis failed for call_id=%s", call_log.get("call_id"))
