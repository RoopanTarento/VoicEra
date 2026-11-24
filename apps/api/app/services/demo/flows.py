"""Server-held question flows (build spec, "Call runtime").

The model never keeps the flow state: every call has a state document here,
and the model moves through it with ``start_flow`` and ``record_slot``. So it
can't skip or invent steps; it only judges whether the caller's answer matches
a step's ``if_answer`` (``branch_matched``). Links to cards, step jumps and
ends are read exactly from the spreadsheet (``kb.parse_action``).

A call starts in its template's default flow. Starting a sector flow pushes
the current one; when the sector flow ends the call returns to it, and the
model continues from whichever of its remaining steps still applies.

All functions take and mutate a plain ``state`` dict, so they are easy to test
and to store.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

MAX_STACK = 3
MAX_VALUE_CHARS = 200


class FlowError(Exception):
    """A tool call the current state can't accept; the message goes back to the model."""


@dataclass
class Ctx:
    """What one call's flows are read from: the knowledge-base snapshot, this
    agent's flows (session flows, e.g. an edited survey, win over the
    snapshot's), and the values that fill {sector}, {name}, ... in questions."""

    snapshot: dict[str, Any]
    allowed: list[str]
    values: dict[str, str] = field(default_factory=dict)
    session_flows: dict[str, dict[str, Any]] = field(default_factory=dict)

    def flow(self, flow_id: str) -> dict[str, Any]:
        flow = self.session_flows.get(flow_id) or self.snapshot["flows"].get(flow_id)
        if not flow:
            raise FlowError(f"There is no flow {flow_id}.")
        return flow


def new_state(default_flow: str) -> dict[str, Any]:
    return {
        "active_flow": default_flow,
        "step": 1,
        "stack": [],
        "slots": {},
        "cards_spoken": [],
        "gaps": [],
        "flows_done": [],
        "log": [{"flow_id": default_flow, "step": 1}],
        "records": None,
        "ended": False,
    }


def fill(text: str, values: dict[str, str]) -> str:
    """Replace {sector}, {name}, {date}, {area}, ... where a value is known."""

    def sub(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower()
        return values.get(key) or match.group(0)

    return re.sub(r"\{([a-z_ ]+)\}", sub, text or "")


def _step(flow: dict[str, Any], number: int) -> dict[str, Any]:
    for s in flow["steps"]:
        if s["step"] == number:
            return s
    raise FlowError(f"{flow['flow_id']} has no step {number}.")


def step_view(ctx: Ctx, flow_id: str, number: int) -> dict[str, Any]:
    """One step as the model sees it."""
    values = ctx.values
    flow = ctx.flow(flow_id)
    s = _step(flow, number)
    view: dict[str, Any] = {
        "flow_id": flow_id,
        "step": number,
        "of": len(flow["steps"]),
        "asks_for": s["asks_for"],
        "question": fill(s["question"], values),
        "answer_type": s["answer_type"],
    }
    if s.get("if_answer"):
        # The condition is shown so the model can judge the answer; what the
        # branch says comes back from record_slot, so it can't skip the server.
        view["if_answer"] = fill(s["if_answer"], values)
    return view


def card_view(snapshot: dict[str, Any], card_id: str) -> dict[str, Any] | None:
    card = snapshot["cards"].get(card_id)
    if not card:
        return None
    keep = ("card_id", "title", "who_its_for", "answer", "steps", "documents", "fee_and_time", "where_to_go", "status")
    return {k: card.get(k, "") for k in keep}


def _remember_cards(state: dict[str, Any], card_ids: list[str]) -> None:
    for cid in card_ids:
        if cid not in state["cards_spoken"]:
            state["cards_spoken"].append(cid)


def start_flow(ctx: Ctx, state: dict[str, Any], flow_id: str) -> dict[str, Any]:
    """Begin ``flow_id`` (one of this agent's flows); returns its step 1."""
    if state.get("ended"):
        raise FlowError("The call has ended.")
    flow_id = str(flow_id or "").strip()
    if flow_id not in ctx.allowed:
        raise FlowError(f"{flow_id} isn't one of this agent's flows. Use one of: {', '.join(ctx.allowed)}.")
    if flow_id == state.get("active_flow"):
        return {"started": flow_id, "step": step_view(ctx, flow_id, state["step"]), "note": "Already in this flow."}
    if state.get("active_flow"):
        if len(state["stack"]) >= MAX_STACK:
            raise FlowError("Finish the current flow first.")
        state["stack"].append({"flow_id": state["active_flow"], "step": state["step"]})
    state["active_flow"], state["step"] = flow_id, 1
    state["log"].append({"flow_id": flow_id, "step": 1})
    return {"started": flow_id, "step": step_view(ctx, flow_id, 1)}


def _clean_value(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value if value is not None else "")).strip()[:MAX_VALUE_CHARS]


_YES = re.compile(r"^(?:yes|yeah|yep|haan|ha|ho|houdu|hav|sari|correct|right|i have|i did|done|it is|they are)\b", re.I)
_NO = re.compile(r"^(?:no|nope|not|illa|nahi|nahin|never|i haven't|i have not|i didn't|i did not|don't know|not sure)\b", re.I)


def _yes_no(value: str) -> bool | None:
    """True / False for a clear yes or no answer, None otherwise."""
    text = value.strip().lower()
    if _NO.match(text):
        return False
    if _YES.match(text):
        return True
    return None


def branch_for(step: dict[str, Any], value: str, model_says: bool) -> bool:
    """Whether the answer takes the step's branch. For a plain Yes/No branch on a
    yes/no step the server decides from the answer itself; otherwise the
    model's judgement of the free-text condition is used."""
    condition = (step.get("if_answer") or "").strip().lower().rstrip(".")
    if step.get("answer_type") == "yes_no" and condition in ("yes", "no"):
        answer = _yes_no(value)
        if answer is not None:
            return answer == (condition == "yes")
    return bool(model_says)


_CARD_REF = re.compile(r"\bK-[A-Z]+-\d+\b(?:\s*\(((?:[^()]|\([^()]*\))*)\))?")


def spoken_instruction(text: str) -> str:
    """A branch's ``then`` as an instruction to the agent: card ids become the
    card's title, rule ids and "end" markers go (the cards and the flow's end
    come back separately), so no code is ever read out."""
    raw = (text or "").strip()
    pointer = raw.startswith("→")
    out = _CARD_REF.sub(lambda m: m.group(1) or "the card", raw)
    out = re.sub(r"\s*\((?:G-\d+)\)", "", out)
    parts = [p.strip(" ;,.") for p in out.split(";")]
    parts = [p for p in parts if p and p.lower() not in ("end", "end flow", "continue")]
    out = "; ".join(parts).strip()
    if pointer:
        title = out.lstrip("→ ").strip()
        steps = title.endswith(" steps")
        title = title[: -len(" steps")] if steps else title
        return f"Speak the card's answer: {title}." + (" Then give its steps, one at a time." if steps else "")
    return out


def record_slot(ctx: Ctx, state: dict[str, Any], asks_for: str, value: Any, branch_matched: bool) -> dict[str, Any]:
    """Save the caller's answer to a step of the active flow and move on.

    ``asks_for`` names the step (normally the current one; a later one when the
    caller already answered the steps in between). ``branch_matched`` says the
    answer matches that step's ``if_answer``. Returns what to say (the branch's
    instruction and any cards it links) and the next step, or that the flow ended."""
    if state.get("ended"):
        raise FlowError("The call has ended.")
    flow_id = state.get("active_flow")
    if not flow_id:
        raise FlowError("No flow is active. Call start_flow first.")
    values = ctx.values
    flow = ctx.flow(flow_id)
    key = str(asks_for or "").strip()
    candidates = [s for s in flow["steps"] if s["asks_for"] == key]
    if not candidates:
        names = ", ".join(s["asks_for"] for s in flow["steps"])
        raise FlowError(f"{flow_id} has no step asking for '{key}'. Its steps ask for: {names}.")
    current = next((s for s in candidates if s["step"] == state["step"]), None)
    step = current or next((s for s in candidates if s["step"] > state["step"]), candidates[0])

    state["slots"][key] = _clean_value(value)
    matched = branch_for(step, state["slots"][key], branch_matched)
    branch = step.get("then") if matched and step.get("then") else None
    action = branch or step.get("default_next") or {"text": "end", "cards": [], "end": True}
    result: dict[str, Any] = {"recorded": {key: state["slots"][key]}}

    cards = [c for c in (card_view(ctx.snapshot, cid) for cid in action.get("cards", [])) if c]
    result["branch_matched"] = matched
    instruction = spoken_instruction(fill(branch["text"], values)) if branch and branch.get("text") else ""
    if instruction:
        result["say"] = instruction
    if cards:
        result["cards"] = cards
        _remember_cards(state, [c["card_id"] for c in cards])

    # Where to go: the branch's own jump or end, else the step's default.
    nxt: int | None = None
    ends = bool(action.get("end"))
    if action.get("repeat"):
        nxt = step["step"]
    elif action.get("goto") is not None:
        nxt = int(action["goto"])
        if nxt <= step["step"]:
            # Looping back ("Back to step 1"): the earlier answers no longer hold.
            for s in flow["steps"]:
                if s["step"] >= nxt:
                    state["slots"].pop(s["asks_for"], None)
    elif not ends:
        default = step.get("default_next") or {}
        if default.get("goto") is not None:
            nxt = int(default["goto"])
        else:
            ends = True

    if ends or nxt is None:
        result.update(_end_flow(ctx, state))
    else:
        state["step"] = nxt
        state["log"].append({"flow_id": flow_id, "step": nxt})
        result["next"] = step_view(ctx, flow_id, nxt)
    return result


def _end_flow(ctx: Ctx, state: dict[str, Any]) -> dict[str, Any]:
    done = state["active_flow"]
    state["flows_done"].append(done)
    if state["stack"]:
        parent = state["stack"].pop()
        state["active_flow"], state["step"] = parent["flow_id"], parent["step"]
        flow = ctx.flow(parent["flow_id"])
        remaining = [step_view(ctx, parent["flow_id"], s["step"]) for s in flow["steps"] if s["step"] > parent["step"]]
        state["log"].append({"flow_id": parent["flow_id"], "step": parent["step"]})
        return {
            "flow_done": done,
            "back_in": parent["flow_id"],
            "remaining_steps": remaining,
            "note": (
                f"{done} has covered the caller's need. Continue {parent['flow_id']} from the first remaining step that is "
                "still useful; don't re-confirm or repeat what the flow already covered."
            ),
        }
    state["active_flow"], state["step"] = None, None
    return {"flow_done": done, "next": "end", "note": "This was the last step. Close the call with a one-sentence recap, then call end_call."}


def state_block(ctx: Ctx, state: dict[str, Any]) -> str:
    """The short state the model reads every turn."""
    lines: list[str] = []
    if state.get("ended"):
        return "The call has ended."
    flow_id = state.get("active_flow")
    if flow_id:
        flow = ctx.flow(flow_id)
        v = step_view(ctx, flow_id, state["step"])
        lines.append(f"Active flow: {flow_id} ({flow['name']}), step {v['step']} of {v['of']}.")
        lines.append(f"Current step asks_for: {v['asks_for']} | question: {v['question']} | answer_type: {v['answer_type']}")
        if v.get("if_answer"):
            lines.append(f"Branch if the answer is: {v['if_answer']} (call record_slot to learn what to say next)")
        else:
            lines.append("After the answer: call record_slot to get the next step.")
        if state["stack"]:
            lines.append("Paused flows: " + ", ".join(f"{p['flow_id']} at step {p['step']}" for p in state["stack"]))
    else:
        lines.append("No flow is active: the main flow is finished. Close the call and call end_call.")
    if state["slots"]:
        lines.append("Answers so far: " + "; ".join(f"{k} = {v}" for k, v in state["slots"].items()))
    if state["cards_spoken"]:
        lines.append("Cards used: " + ", ".join(state["cards_spoken"]))
    language = ctx.values.get("language")
    if language and language != "English":
        lines.append(
            f"Speak only {language}: say every question, card and contact in {language}, even though they are written in English here."
        )
    lines.append("Remember: one question per turn; call record_slot after each flow answer; call log_gap for any question no card answers.")
    return "\n".join(lines)
