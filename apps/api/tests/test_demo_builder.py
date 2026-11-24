"""Demo builder internals: knowledge-base loader, flow engine, agent assembly, masking."""

from __future__ import annotations

import asyncio
import copy
import re

import pytest

from app.services.demo import builder, kb
from app.services.demo import flows as fe
from app.services.demo.privacy import mask_personal


@pytest.fixture(scope="module")
def snap():
    return kb._bundled()


# --- loader ---------------------------------------------------------------------------------


def _sheets() -> dict[str, list[list[str]]]:
    """A tiny valid workbook: one template, sector, card, contact, flow, record, role, guardrail."""
    return {
        "Templates": [
            ["template_id", "name", "job", "description", "example_uses", "q1", "q2", "q3", "records_fields", "greeting_pattern", "active", "default_flow"],
            ["T-ANSWER", "Citizen helpline", "ANSWER", "Answers questions.", "Bills", "About?", "Know?", "Language?", "topic_asked; answered (yes/no)", "Hello, I'm the {sector} helpline assistant. How can I help you?", "Yes", "F-ANSWER"],
        ],
        "Sectors": [
            ["sector_id", "name", "description", "example_topics", "main_helpline", "demo_state", "active"],
            ["S-AGRI", "Agriculture", "Farmers.", "Income support", "1800-180-1551", "KA", "Yes"],
        ],
        "Knowledge": [
            ["card_id", "sector_id", "type", "title", "who_its_for", "answer", "steps", "documents", "fee_and_time", "where_to_go", "source_link", "state", "status", "last_checked", "check_note"],
            ["K-AGRI-01", "S-AGRI", "Benefit", "PM-KISAN", "Farmers", "Six thousand a year.", "", "", "", "", "", "National", "Verified", "", ""],
            ["K-AGRI-02", "S-AGRI", "FAQ", "Draft card", "Farmers", "Not checked.", "", "", "", "", "", "National", "Draft – verify", "", ""],
        ],
        "Contacts": [
            ["contact_id", "sector_id", "name", "number_or_link", "when_to_use", "hours", "scope", "status", "last_checked", "source"],
            ["C-001", "ALL", "Emergency", "112", "Emergencies", "24x7", "National", "Verified", "", ""],
        ],
        "Question flows": [
            ["flow_id", "flow_name", "sector_id", "template_id", "starts_when", "step", "asks_for", "question", "answer_type", "if_answer", "then", "default_next"],
            ["F-ANSWER", "Understand", "ALL", "T-ANSWER", "Start", "1", "topic", "What do you need?", "text", "", "", "step 2"],
            ["F-ANSWER", "Understand", "ALL", "T-ANSWER", "", "2", "more", "Anything else?", "yes_no", "Yes", "Back to step 1", "end"],
            ["F-AGRI-X", "PM-KISAN", "S-AGRI", "T-ANSWER", "Asks about PM-KISAN", "1", "registered", "Registered?", "yes_no", "No", "→ K-AGRI-01 (PM-KISAN); end flow", "end"],
        ],
        "Demo records": [
            ["record_id", "sector_id", "template_id", "person (fictional)", "details", "date_or_ref", "what_the_agent_does"],
            ["D-001", "S-AGRI", "T-ANSWER", "Basavaraj", "eKYC pending", "10 Dec", "Reminds"],
        ],
        "Role cards": [
            ["role_id", "sector_id", "template_id", "you_are (shown to tester)", "try_asking", "good_call_looks_like"],
            ["R-001", "S-AGRI", "T-ANSWER", "Lakshmi, a farmer.", "Why did PM-KISAN stop?", "Explains eKYC"],
        ],
        "Guardrails": [["rule_id", "applies_to", "rule", "what_the_agent_says"], ["G-01", "All", "Say AI.", "I'm an AI assistant."]],
    }


def test_loader_builds_a_snapshot_and_leaves_out_drafts():
    snap = kb.build_snapshot(_sheets())
    assert list(snap["cards"]) == ["K-AGRI-01"]
    assert any("K-AGRI-02" in line for line in snap["report"]["left_out"])
    assert snap["templates"]["T-ANSWER"]["records_fields"] == [{"key": "topic_asked", "kind": "text"}, {"key": "answered", "kind": "yes/no"}]
    assert snap["role_cards"]["R-001"]["you_are"] == "Lakshmi, a farmer."  # header note "(shown to tester)" dropped


def test_loader_fails_on_a_link_to_a_card_that_does_not_load():
    sheets = _sheets()
    sheets["Question flows"][3][10] = "→ K-AGRI-02 (Draft card); end flow"
    with pytest.raises(kb.KnowledgeBaseError) as err:
        kb.build_snapshot(sheets)
    assert "Question flows F-AGRI-X step 1: links to K-AGRI-02, which doesn't pass the status and scope gates" in err.value.problems


def test_loader_rejects_real_looking_numbers():
    sheets = _sheets()
    sheets["Demo records"][1][4] = "Call back on 98450 12345"
    with pytest.raises(kb.KnowledgeBaseError, match="D-001: looks like a real phone or Aadhaar number"):
        kb.build_snapshot(sheets)


def test_loader_rejects_duplicate_ids():
    sheets = _sheets()
    sheets["Knowledge"].append(list(sheets["Knowledge"][1]))
    with pytest.raises(kb.KnowledgeBaseError, match="K-AGRI-01 is used twice"):
        kb.build_snapshot(sheets)


def test_loader_needs_every_tab():
    sheets = _sheets()
    del sheets["Guardrails"]
    with pytest.raises(kb.KnowledgeBaseError, match="Missing tab 'Guardrails'"):
        kb.build_snapshot(sheets)


@pytest.mark.parametrize(
    "text, expected",
    [
        ("step 3", {"goto": 3}),
        ("Back to step 1", {"goto": 1}),
        ("Ask again", {"repeat": True}),
        ("Ask the caller to say it again in their own words, then repeat this step", {"repeat": True}),
        ("Not eligible; end flow", {"end": True}),
        ("Not eligible for this pension", {"end": True}),
        ("Confirm and end", {"end": True}),
        ("→ K-AGRI-03 (PM-KISAN eKYC); end flow", {"end": True, "cards": ["K-AGRI-03"]}),
        ("Crop → K-DISA-10 (Crop); house → K-DISA-09 (House)", {"cards": ["K-DISA-10", "K-DISA-09"]}),
        ("Ask if {name} is available; if not, end politely without sharing details", {}),
        ("Ask them to register first; continue", {}),
    ],
)
def test_flow_actions_are_read_exactly(text, expected):
    action = kb.parse_action(text)
    for key in ("goto", "repeat", "end"):
        assert action.get(key) == expected.get(key), (text, key)
    assert action["cards"] == expected.get("cards", [])


def test_bundled_snapshot_is_complete(snap):
    assert len(snap["templates"]) == 6 and len(snap["sectors"]) == 12
    for flow in snap["flows"].values():
        for s in flow["steps"]:
            for key in ("then", "default_next"):
                for cid in (s.get(key) or {}).get("cards", []):
                    assert cid in snap["cards"], (flow["flow_id"], cid)


# --- flow engine ----------------------------------------------------------------------------


def _ctx(snap, template_id="T-ANSWER", sector_id="S-AGRI"):
    config = builder.assemble(snap, {"template_id": template_id, "sector_id": sector_id, "language": "kn"})
    return config, builder.flow_ctx(snap, config)


def test_flow_runs_on_the_server_and_returns_to_the_main_flow(snap):
    config, ctx = _ctx(snap)
    state = fe.new_state("F-ANSWER")
    started = fe.start_flow(ctx, state, "F-AGRI-PMKISAN-STOP")
    assert started["step"]["asks_for"] == "ekyc_done" and state["stack"] == [{"flow_id": "F-ANSWER", "step": 1}]
    # eKYC done (doesn't match "No") → default next step.
    r = fe.record_slot(ctx, state, "ekyc_done", "yes, last year", False)
    assert r["next"]["asks_for"] == "aadhaar_bank" and "say" not in r
    # Bank not linked (matches "No") → the branch's instruction, then the flow ends.
    r = fe.record_slot(ctx, state, "aadhaar_bank", "no", True)
    assert "link it at the bank" in r["say"] and r["flow_done"] == "F-AGRI-PMKISAN-STOP"
    assert r["back_in"] == "F-ANSWER" and state["active_flow"] == "F-ANSWER"
    assert [s["asks_for"] for s in r["remaining_steps"]] == ["topic_match", "answer", "more_detail", "anything_else"]
    assert state["slots"]["ekyc_done"] == "yes, last year"


def test_branch_cards_are_returned_and_remembered(snap):
    _config, ctx = _ctx(snap)
    state = fe.new_state("F-ANSWER")
    fe.start_flow(ctx, state, "F-AGRI-PMKISAN-STOP")
    r = fe.record_slot(ctx, state, "ekyc_done", "no", True)
    assert [c["card_id"] for c in r["cards"]] == ["K-AGRI-03"] and r["cards"][0]["answer"]
    assert state["cards_spoken"] == ["K-AGRI-03"] and r["flow_done"] == "F-AGRI-PMKISAN-STOP"


def test_flow_refuses_unknown_flows_and_steps(snap):
    _config, ctx = _ctx(snap)
    state = fe.new_state("F-ANSWER")
    with pytest.raises(fe.FlowError, match="isn't one of this agent's flows"):
        fe.start_flow(ctx, state, "F-HEAL-TB")
    with pytest.raises(fe.FlowError, match="no step asking for 'income'"):
        fe.record_slot(ctx, state, "income", "low", False)


def test_looping_back_clears_the_answers_it_replaces(snap):
    _config, ctx = _ctx(snap)
    state = fe.new_state("F-ANSWER")
    fe.record_slot(ctx, state, "topic", "PM-KISAN", False)
    fe.record_slot(ctx, state, "anything_else", "yes, crop loss", True)  # caller skipped ahead
    assert state["step"] == 1 and "topic" not in state["slots"]


def test_main_flow_end_asks_for_end_call(snap):
    _config, ctx = _ctx(snap)
    state = fe.new_state("F-ANSWER")
    r = fe.record_slot(ctx, state, "anything_else", "no", False)
    assert r["next"] == "end" and state["active_flow"] is None
    assert "end_call" in fe.state_block(ctx, state)


# --- assembling agents ----------------------------------------------------------------------


def test_every_template_and_sector_builds_a_complete_prompt(snap):
    for tid in snap["templates"]:
        for sid in snap["sectors"]:
            config = builder.assemble(
                snap, {"template_id": tid, "sector_id": sid, "language": "kn", "announcement": "Camp on 3 Dec", "reminder": "Due 5 Dec"}
            )
            opening = builder.opening_line(snap, config)["opening"]
            _, state_text = builder.initial_state_text(snap, config, opening)
            prompt = builder.system_prompt(snap, config, opening, state_text)
            assert not re.search(r"\{\{|\{[a-z_ ]+\}", prompt), (tid, sid)
            assert builder.NOTICE in opening and "<state>" in prompt and "Kannada" in prompt
            assert set(config["flows"]) <= set(snap["flows"]) | set(config["session_flows"])


def test_helpline_agent_loads_the_sector_and_its_inbound_flows(snap):
    config = builder.assemble(snap, {"template_id": "T-ANSWER", "sector_id": "S-AGRI", "language": "kn"})
    assert config["flows"][0] == "F-ANSWER"
    assert set(config["flows"]) == {"F-ANSWER", "F-AGRI-PMKISAN-ELIG", "F-AGRI-PMKISAN-STOP", "F-AGRI-CROPLOSS"}
    agri = [c for c in config["card_ids"] if snap["cards"][c]["sector_id"] == "S-AGRI"]
    assert len(agri) == 21 and config["role"]["you_are"].startswith("Lakshmi")
    assert config["demo_record_id"] is None
    # The crop-loss flow points to a disaster-relief card, so the agent keeps it.
    assert "K-DISA-10" in config["card_ids"]


def test_unticked_cards_are_left_out(snap):
    base = {"template_id": "T-ANSWER", "sector_id": "S-AGRI", "language": "kn"}
    linked = builder.flow_cards(snap, builder.flows_for(snap, "T-ANSWER", "S-AGRI"))
    free = [c for c in builder.cards_for(snap, "S-AGRI") if c not in linked]
    config = builder.assemble(snap, {**base, "excluded_cards": free[:2]})
    assert free[0] not in config["card_ids"] and free[1] not in config["card_ids"]
    assert free[2] in config["card_ids"] and config["chosen_cards"] == 19
    with pytest.raises(builder.BuildError):
        builder.assemble(snap, {**base, "excluded_cards": ["K-HEAL-01"]})
    every = builder.cards_for(snap, "S-AGRI")
    with pytest.raises(builder.BuildError):
        builder.assemble(snap, {**base, "excluded_cards": every})


def test_flow_and_service_cards_stay_even_when_unticked(snap):
    linked = builder.flow_cards(snap, builder.flows_for(snap, "T-ANSWER", "S-AGRI"))
    agri_linked = [c for c in linked if snap["cards"][c]["sector_id"] == "S-AGRI"]
    if agri_linked:
        config = builder.assemble(snap, {"template_id": "T-ANSWER", "sector_id": "S-AGRI", "language": "kn", "excluded_cards": agri_linked[:1]})
        assert agri_linked[0] in config["card_ids"]
    services = builder.sources(snap, "T-GUIDE", "S-MUNI")["services"]
    if services:
        sid = services[0]["card_id"]
        config = builder.assemble(
            snap, {"template_id": "T-GUIDE", "sector_id": "S-MUNI", "language": "en", "service_card_id": sid, "excluded_cards": [sid]}
        )
        assert sid in config["card_ids"]


def test_sources_list_every_card_for_the_tick_boxes(snap):
    view = builder.sources(snap, "T-ANSWER", "S-AGRI")
    assert len(view["cards"]["items"]) == view["cards"]["count"] == 21
    assert view["cards"]["preview"] == view["cards"]["items"][:4]


def test_reminder_opening_does_not_say_what_it_is_about(snap):
    config = builder.assemble(snap, {"template_id": "T-REMIND", "sector_id": "S-HEALTH", "language": "en"})
    opening = builder.opening_line(snap, config)["opening"]
    assert "Measles" not in opening and opening.endswith("Am I speaking with Savitha?")


def test_survey_questions_can_be_edited(snap):
    config = builder.assemble(
        snap,
        {"template_id": "T-COLLECT", "sector_id": "S-HEALTH", "language": "kn", "survey_questions": [
            "How would you rate the care you received, from 1 to 5?", "Was the ward clean?"]},
    )
    flow = config["session_flows"]["F-SESSION-SURVEY"]
    assert [s["question"] for s in flow["steps"]] == ["How would you rate the care you received, from 1 to 5?", "Was the ward clean?"]
    assert flow["steps"][0]["asks_for"] == "care" and flow["steps"][1]["asks_for"] == "q2"
    assert flow["steps"][1]["default_next"].get("end") and "F-SESSION-SURVEY" in config["flows"]


def test_complaint_types_can_be_narrowed_but_not_invented(snap):
    config = builder.assemble(snap, {"template_id": "T-RESOLVE", "sector_id": "S-POWER", "language": "kn", "complaint_flows": ["F-POWE-OUTAGE"]})
    assert "F-POWE-OUTAGE" in config["flows"] and "F-POWE-WATER" not in config["flows"]
    with pytest.raises(builder.BuildError):
        builder.assemble(snap, {"template_id": "T-RESOLVE", "sector_id": "S-POWER", "language": "kn", "complaint_flows": ["F-HEAL-TB"]})


def test_guardrail_g09_never_promises_a_time_a_card_does_not_state(snap):
    config = builder.assemble(snap, {"template_id": "T-RESOLVE", "sector_id": "S-MUNI", "language": "en"})
    prompt = builder.system_prompt(snap, config, "Hello.", "state")
    line = next(line for line in prompt.splitlines() if line.startswith("- G-09"))
    assert "only if a card states it" in line


@pytest.mark.parametrize(
    "person, name",
    [
        ("Savitha (mother of Ananya, 9 months)", "Savitha"),
        ("Account 7845XXXX (Ravi)", "Ravi"),
        ("First-time voter (Akash, 18)", "Akash"),
        ("Farmer in Belagavi", ""),
        ("Applicant", ""),
        ("Family in relief camp", ""),
    ],
)
def test_names_are_read_from_demo_records(person, name):
    assert builder.person_name(person) == name


def test_unknown_ids_are_refused(snap):
    for answers in (
        {"template_id": "T-NOPE", "sector_id": "S-AGRI", "language": "kn"},
        {"template_id": "T-ANSWER", "sector_id": "S-NOPE", "language": "kn"},
        {"template_id": "T-ANSWER", "sector_id": "S-AGRI", "language": "xx"},
    ):
        with pytest.raises(builder.BuildError):
            builder.assemble(snap, answers)


def test_compose_opening_always_keeps_the_notice():
    assert builder.compose_opening("Hello there. How can I help?", "N.") == "Hello there. N. How can I help?"
    assert builder.compose_opening("ನಮಸ್ಕಾರ", "ಡೆಮೊ.") == "ನಮಸ್ಕಾರ ಡೆಮೊ."
    assert builder.compose_opening("Hi. N. Go?", "N.") == "Hi. N. Go?"


# --- router -----------------------------------------------------------------------------------


def test_router_keeps_only_ids_from_the_snapshot(snap):
    async def complete(_prompt):
        return '{"template_id": "T-MADEUP", "sector_id": "S-AGRI", "topic": "x", "language": "zz", "confidence": 3, "ask_next": "q9", "reason": "r"}'

    out = asyncio.run(builder.route(snap, "help farmers", complete))
    assert out["template_id"] is None and out["sector_id"] == "S-AGRI" and out["language"] is None and out["confidence"] == 1.0


def test_router_falls_back_to_keywords_and_refuses_aadhaar(snap):
    async def broken(_prompt):
        raise RuntimeError("down")

    out = asyncio.run(builder.route(snap, "Remind mothers about their child's vaccination in Kannada", broken))
    assert out["source"] == "keywords" and out["template_id"] == "T-REMIND" and out["sector_id"] == "S-HEALTH" and out["language"] == "kn"
    refused = asyncio.run(builder.route(snap, "Call people and collect their Aadhaar", broken))
    assert refused["template_id"] is None and "Aadhaar" in refused["reason"]


def test_router_prompt_is_filled(snap):
    prompt = builder.router_prompt(snap, "Take complaints about potholes")
    assert "{{" not in prompt and "T-RESOLVE" in prompt and "S-MUNI" in prompt and "potholes" in prompt


# --- masking ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, kept, gone",
    [
        ("My Aadhaar is 1234 5678 9012", "My Aadhaar is", "1234"),
        ("ನನ್ನ ಸಂಖ್ಯೆ ೯೮೪೫೦೧೨೩೪೫", "ನನ್ನ ಸಂಖ್ಯೆ", "೯೮೪೫೦"),
        ("The OTP is 4821", "The OTP is", "4821"),
        ("Write to me at ravi@example.com", "Write to me at", "ravi@example.com"),
    ],
)
def test_personal_numbers_are_masked(text, kept, gone):
    out = mask_personal(text)
    assert kept in out and gone not in out


def test_amounts_and_dates_are_not_masked():
    text = "You get ₹6,000 a year; the next instalment is due on 10 Dec 2026, call 1800-180-1551."
    assert mask_personal(text).startswith("You get ₹6,000 a year; the next instalment is due on 10 Dec 2026")


def test_snapshot_fixture_is_not_mutated(snap):
    before = copy.deepcopy(snap["flows"]["F-ANSWER"])
    _config, ctx = _ctx(snap)
    state = fe.new_state("F-ANSWER")
    fe.record_slot(ctx, state, "topic", "x", False)
    assert snap["flows"]["F-ANSWER"] == before


# --- safeguards found by simulated calls -------------------------------------------------------


@pytest.mark.parametrize(
    "value, model_says, expected",
    [("Yes, last year", True, False), ("no", False, True), ("I haven't", False, True), ("maybe later", True, True)],
)
def test_yes_no_branches_are_decided_on_the_server(snap, value, model_says, expected):
    """F-AGRI-PMKISAN-STOP step 1 branches on "No"; a clear yes/no answer overrides the model."""
    step = snap["flows"]["F-AGRI-PMKISAN-STOP"]["steps"][0]
    assert fe.branch_for(step, value, model_says) is expected


@pytest.mark.parametrize(
    "then, said",
    [
        ("→ K-AGRI-03 (PM-KISAN eKYC); end flow", "Speak the card's answer: PM-KISAN eKYC."),
        ("→ K-AGRI-01 (PM-KISAN income support) steps", "Speak the card's answer: PM-KISAN income support. Then give its steps, one at a time."),
        ("Not eligible for PM-KISAN; offer K-AGRI-06 (Kisan Credit Card (KCC)) (also for tenant farmers); end flow",
         "Not eligible for PM-KISAN; offer Kisan Credit Card (KCC) (also for tenant farmers)"),
        ("Say 'Please call 112 now' (G-05); end", "Say 'Please call 112 now'"),
    ],
)
def test_instructions_never_carry_card_or_rule_ids(then, said):
    assert fe.spoken_instruction(then) == said


def test_branch_outcomes_are_only_learned_through_record_slot(snap):
    _config, ctx = _ctx(snap)
    view = fe.step_view(ctx, "F-AGRI-PMKISAN-STOP", 1)
    assert view["if_answer"] == "No" and "then" not in view and "default_next" not in view


def test_state_block_keeps_the_call_language(snap):
    config = builder.assemble(snap, {"template_id": "T-RESOLVE", "sector_id": "S-MUNI", "language": "kn"})
    text = fe.state_block(builder.flow_ctx(snap, config), fe.new_state("F-RESOLVE"))
    assert "Speak only Kannada" in text and "log_gap" in text
