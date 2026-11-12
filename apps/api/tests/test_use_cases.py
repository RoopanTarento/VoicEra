"""Agent use cases: scheme intents, survey catalogue, presets, custom schemes, call analysis."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token
from app.config import get_settings
from app.services import call_analysis, use_cases

ORG_A = "orga01"
ORG_B = "orgb02"
USERS = {"super_admin": "owner@a.example", "admin": "admin@a.example", "campaign_manager": "cm@a.example", "member": "member@a.example"}


@pytest.fixture
def client(vault_env, secure_db):
    get_settings.cache_clear()
    rbac.invalidate_cache()
    import app.main as main_module

    secure_db["Organizations"].insert_many(
        [{"org_id": ORG_A, "name": "Pune Municipal Corporation", "status": "active"}, {"org_id": ORG_B, "name": "B", "status": "active"}]
    )
    for role, email in USERS.items():
        secure_db["Memberships"].insert_one({"email": email, "org_id": ORG_A, "role": role})
    secure_db["Memberships"].insert_one({"email": "owner@b.example", "org_id": ORG_B, "role": "super_admin"})
    yield TestClient(main_module.app)
    rbac.invalidate_cache()


def _h(role: str, org_id: str = ORG_A) -> dict[str, str]:
    email = "owner@b.example" if org_id == ORG_B else USERS[role]
    return {"Authorization": f"Bearer {create_access_token({'sub': email, 'org_id': org_id, 'role': role})}"}


def test_catalogue_has_two_use_cases_and_complete_entries(client):
    body = client.get("/api/v1/use-cases", headers=_h("member")).json()
    assert [u["id"] for u in body["use_cases"]] == ["scheme", "city_survey"]
    assert [i["id"] for i in body["intents"]] == ["awareness", "discovery", "enrolment", "utilisation", "support", "feedback"]
    assert len(body["schemes"]) == 16 and len(body["surveys"]) == 8
    kinds = {k["id"] for k in body["kinds"]}
    for s in body["schemes"]:
        for field in ("name", "benefit", "eligibility", "how_to_apply", "website", "sources", "questions", "last_checked"):
            assert s[field], (s["id"], field)
        assert s["kind"] in kinds and s["kind"] != "other", s["id"]
    assert {f["scheme_id"] for f in body["feedback_surveys"]} == {s["id"] for s in body["schemes"]}
    for survey in body["surveys"]:
        kinds = [q["kind"] for q in survey["questions"]]
        assert 4 <= len(kinds) <= 6 and "rating" in kinds and kinds[-1] == "open"
    assert len({s["id"] for s in body["schemes"]}) == 16


def test_scheme_preset_uses_only_listed_facts_and_safety_rules(client):
    r = client.post("/api/v1/use-cases/preset", json={"use_case": "scheme_discovery", "scheme_ids": ["pm-kisan", "pm-jay"]}, headers=_h("admin"))
    assert r.status_code == 200, r.text
    preset = r.json()
    assert preset["use_case"] == {"type": "scheme", "intent": "discovery", "scheme_ids": ["pm-kisan", "pm-jay"], "survey_id": None}
    assert "Pune Municipal Corporation" in preset["prompt"] and "Pune Municipal Corporation" in preset["welcome"]
    assert "### PM-KISAN" in preset["prompt"] and "### Ayushman Bharat PM-JAY" in preset["prompt"]
    assert "### PM Mudra" not in preset["prompt"]
    for rule in ("Never ask for Aadhaar", "definitely eligible", "Never invent amounts", "myscheme.gov.in"):
        assert rule in preset["prompt"]
    assert preset["name"] == "Scheme discovery – 2 schemes"


@pytest.mark.parametrize(
    "body,message",
    [
        ({"use_case": "scheme_discovery", "scheme_ids": []}, "at least one scheme"),
        ({"use_case": "scheme_discovery", "scheme_ids": ["made-up"]}, "Unknown scheme"),
        ({"use_case": "city_survey", "survey_id": "nope"}, "Pick a survey"),
        ({"use_case": "sales"}, "scheme agent or a city feedback survey"),
        ({"use_case": "scheme", "intent": "sales", "scheme_ids": ["pm-jay"]}, "Pick what the agent is for"),
        ({"use_case": "scheme", "intent": "enrolment", "scheme_ids": ["pm-jay", "pm-kisan"]}, "covers one scheme"),
        ({"use_case": "scheme", "intent": "awareness", "scheme_ids": ["pm-jay", "pm-kisan", "apy", "ssy"]}, "up to 3 schemes"),
    ],
)
def test_preset_errors(client, body, message):
    r = client.post("/api/v1/use-cases/preset", json=body, headers=_h("admin"))
    assert r.status_code == 400 and message in r.json()["detail"]


def test_survey_preset_lists_every_question(client):
    preset = client.post("/api/v1/use-cases/preset", json={"use_case": "city_survey", "survey_id": "water"}, headers=_h("super_admin")).json()
    survey = use_cases.get_survey("water")
    for q in survey["questions"]:
        assert q["text"] in preset["prompt"]
    assert "consent" in preset["prompt"] and "name, address, phone number" in preset["prompt"]
    assert preset["use_case"]["survey_id"] == "water"


def test_custom_schemes_are_per_organisation_and_need_agent_rights(client):
    scheme = {"name": "Mahatma Phule Jan Arogya", "benefit": "Free treatment up to ₹5 lakh.", "eligibility": "Families in the state list.",
              "how_to_apply": "At empanelled hospitals.", "website": "jeevandayee.gov.in", "questions": ["Do you have a ration card?"]}
    assert client.post("/api/v1/use-cases/schemes", json=scheme, headers=_h("campaign_manager")).status_code == 403
    r = client.post("/api/v1/use-cases/schemes", json=scheme, headers=_h("admin"))
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert sid.startswith("custom-mahatma-phule") and r.json()["custom"] is True
    ids = {s["id"] for s in client.get("/api/v1/use-cases", headers=_h("member")).json()["schemes"]}
    assert sid in ids
    assert sid not in {s["id"] for s in client.get("/api/v1/use-cases", headers=_h("super_admin", ORG_B)).json()["schemes"]}
    preset = client.post("/api/v1/use-cases/preset", json={"use_case": "scheme_discovery", "scheme_ids": [sid]}, headers=_h("admin")).json()
    assert "### Mahatma Phule Jan Arogya" in preset["prompt"]
    assert client.delete(f"/api/v1/use-cases/schemes/{sid}", headers=_h("super_admin", ORG_B)).status_code == 404
    assert client.delete(f"/api/v1/use-cases/schemes/{sid}", headers=_h("admin")).status_code == 200


def test_agent_keeps_its_use_case(client):
    from app.models.schemas import AgentCreateRequest

    example = AgentCreateRequest.model_config["json_schema_extra"]["examples"][0]
    preset = client.post("/api/v1/use-cases/preset", json={"use_case": "city_survey", "survey_id": "roads"}, headers=_h("admin")).json()
    config = {**example["config"], "use_case": preset["use_case"]}
    config["prompts"] = {**config["prompts"], "system_prompt": preset["prompt"]} if "system_prompt" in config["prompts"] else config["prompts"]
    body = {**example, "name": preset["name"], "agent_category": "websocket", "config": config}
    body.pop("telephony_provider", None)
    r = client.post("/api/v1/agents", json=body, headers=_h("admin"))
    assert r.status_code == 201, r.text
    agent = client.get(f"/api/v1/agents/{r.json()['agent_id']}", headers=_h("member")).json()
    assert agent["config"]["use_case"] == {"type": "city_survey", "intent": None, "scheme_ids": [], "survey_id": "roads"}


def test_survey_answers_and_campaign_results(client, secure_db):
    secure_db["Agents"].insert_one({"agent_id": "agent-s", "org_id": ORG_A, "name": "Survey", "config": {"use_case": {"type": "city_survey", "survey_id": "cleanliness"}}})
    secure_db["Campaigns"].insert_one({"campaign_id": "camp-s", "org_id": ORG_A, "agent_id": "agent-s", "name": "Ward 12", "state": "completed"})
    survey = use_cases.get_survey("cleanliness")
    for cid in "abcdefgh":
        doc = {"call_id": f"s-{cid}", "org_id": ORG_A, "agent_id": "agent-s", "campaign_id": "camp-s", "call_type": "outbound",
               "status": "completed", "call_response": "answered", "duration": 90.0, "from_number": "+918000000101", "to_number": "+919876543210"}
        secure_db["CallLogs"].insert_one(doc)
        call_analysis.analyse_and_store(ORG_A, doc, turns=call_analysis.synthetic_survey_transcript(doc["call_id"], survey), transcript_source="synthetic_mock")
    stored = secure_db["CallLogs"].find_one({"call_id": "s-a"})["analysis"]
    assert stored["outcome"] in ("survey_completed", "survey_declined") and stored["survey"]["survey_id"] == "cleanliness"
    body = client.get("/api/v1/campaign/camp-s/analytics", headers=_h("member")).json()
    summary = body["survey"]
    assert summary["name"] == "Garbage collection and cleanliness" and summary["responses"] == 8
    ratings = [q for q in summary["questions"] if q["kind"] == "rating"]
    assert all(q["average"] is None or 1 <= q["average"] <= 5 for q in ratings)
    assert sum(ratings[0]["distribution"].values()) == ratings[0]["answered"] == summary["completed"]
    assert any(q["kind"] == "yes_no" and q["yes_percent"] is not None for q in summary["questions"])
    assert {o["key"] for o in body["outcomes"]} <= {"survey_completed", "survey_partial", "survey_declined"}


def test_reworded_question_still_matches():
    turns = [
        {"role": "agent", "text": "Could you rate the condition of the roads near your house from 1 to 5?"},
        {"role": "user", "text": "Maybe two."},
        {"role": "agent", "text": "And are there any potholes on your street that haven't been fixed?"},
        {"role": "user", "text": "Haan, there are many."},
    ]
    assert call_analysis.extract_survey_answers(call_analysis.clean_turns(turns), use_cases.get_survey("roads")) == {
        "road_condition": 2, "potholes": True,
    }


def test_scheme_campaign_has_no_survey_section(client, secure_db):
    secure_db["Campaigns"].insert_one({"campaign_id": "camp-k", "org_id": ORG_A, "agent_id": "missing", "name": "K", "state": "completed"})
    assert client.get("/api/v1/campaign/camp-k/analytics", headers=_h("member")).json()["survey"] is None


# --- scheme intents ------------------------------------------------------------------------

def _preset(client, intent, scheme_ids, role="admin"):
    r = client.post("/api/v1/use-cases/preset", json={"use_case": "scheme", "intent": intent, "scheme_ids": scheme_ids}, headers=_h(role))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize(
    "intent,expected",
    [
        ("awareness", ["Say what each scheme gives", "Don't run a full eligibility check"]),
        ("enrolment", ["Do you or your family already have the Ayushman Bharat PM-JAY card?", "documents to bring", "never ask them to read out any document number"]),
        ("utilisation", ["go to a listed hospital", "pgportal.gov.in", "helpline 14555"]),
        ("support", ["at most one follow-up question", "pgportal.gov.in", "don't promise it will be fixed"]),
    ],
)
def test_each_intent_writes_its_own_call(client, intent, expected):
    preset = _preset(client, intent, ["pm-jay"])
    assert preset["use_case"] == {"type": "scheme", "intent": intent, "scheme_ids": ["pm-jay"], "survey_id": None}
    for text in expected:
        assert text in preset["prompt"], (intent, text)
    for rule in ("Never ask for Aadhaar", "definitely eligible", "Never invent amounts"):
        assert rule in preset["prompt"]
    assert "### Ayushman Bharat PM-JAY" in preset["prompt"] and "Ayushman Bharat PM-JAY" in preset["name"]


def test_kind_changes_how_the_benefit_is_used(client):
    cash = _preset(client, "utilisation", ["pm-kisan"])["prompt"]
    insurance = _preset(client, "utilisation", ["pmsby"])["prompt"]
    assert "paid into the bank account" in cash and "Are you already registered for PM-KISAN?" in cash
    assert "making a claim" in insurance and "Are you already covered under PM Suraksha Bima Yojana?" in insurance
    # Every intent carries the screening questions, since any call can switch to the discovery path.
    assert "Questions to check if it may fit" in cash


def test_feedback_intent_runs_a_scheme_survey(client):
    preset = _preset(client, "feedback", ["pm-jay"], role="super_admin")
    survey = use_cases.scheme_feedback_survey(use_cases._builtin_scheme(next(s for s in use_cases.SCHEMES if s["id"] == "pm-jay")))
    assert preset["name"] == "Feedback – Ayushman Bharat PM-JAY"
    for q in survey["questions"]:
        assert q["text"] in preset["prompt"]
    assert survey["questions"][0]["text"] == "When your family needed treatment, did you get it without paying at the hospital?"
    assert "consent" in preset["prompt"] and "pgportal.gov.in" in preset["prompt"]


def test_legacy_scheme_discovery_still_works(client):
    r = client.post("/api/v1/use-cases/preset", json={"use_case": "scheme_discovery", "scheme_ids": ["pm-kisan"]}, headers=_h("admin"))
    assert r.json()["use_case"]["intent"] == "discovery"
    assert use_cases.normalise_use_case({"type": "scheme_discovery", "scheme_ids": ["x"]}) == {
        "type": "scheme", "intent": "discovery", "scheme_ids": ["x"], "survey_id": None,
    }
    from app.models.schemas import AgentUseCase

    assert AgentUseCase(type="scheme_discovery", scheme_ids=["x"]).model_dump() == {
        "type": "scheme", "intent": "discovery", "scheme_ids": ["x"], "survey_id": None,
    }


def test_custom_scheme_kind_is_checked(client):
    base = {"name": "Ladli Behna", "benefit": "₹1,250 a month.", "eligibility": "Women in the state list.", "how_to_apply": "At the camp."}
    assert client.post("/api/v1/use-cases/schemes", json={**base, "kind": "magic"}, headers=_h("admin")).status_code == 400
    r = client.post("/api/v1/use-cases/schemes", json={**base, "kind": "cash"}, headers=_h("admin"))
    assert r.status_code == 201 and r.json()["kind"] == "cash"
    prompt = _preset(client, "utilisation", [r.json()["id"]])["prompt"]
    assert "Are you already registered for Ladli Behna?" in prompt


@pytest.mark.parametrize(
    "intent,reply,outcome,issues",
    [
        ("support", "Yes. The office refused my form and someone asked me to pay extra money.", "issue_reported",
         ["Asked for money", "Refused at office or hospital"]),
        ("support", "No problem at all, everything is fine.", "no_issue", None),
        ("support", "My name is not in the list and nobody at the office replies.", "issue_reported",
         ["Name or details wrong", "No response from helpline or office"]),
        ("utilisation", "Okay I will check the website, thank you. No problem so far.", "informed", None),
        ("utilisation", "The money has not come for two months.", "issue_reported", ["Benefit or payment not received", "Delay"]),
        ("enrolment", "Okay I will go to the centre this week.", "will_apply", None),
        ("awareness", "We already have the card.", "already_enrolled", None),
        ("support", "I'm busy, call me later.", "callback", None),
        # Set up for one intent, the call took another path.
        ("awareness", "We are in it, but the money has not come for two months.", "issue_reported",
         ["Benefit or payment not received", "Delay"]),
        ("discovery", "Okay, I will apply this week.", "will_apply", None),
    ],
)
def test_rules_read_outcomes_for_the_intent(intent, reply, outcome, issues):
    turns = call_analysis.clean_turns([{"role": "agent", "text": "Namaste, I'm calling from the district office."}, {"role": "user", "text": reply}])
    result = call_analysis.analyse_rules(turns, intent=intent)
    assert result["outcome"] == outcome, result
    assert result["outcome_label"] == call_analysis.OUTCOMES[outcome]
    assert result.get("issues") == issues
    assert result.get("switched_to") == call_analysis.switched_path(intent, outcome)


@pytest.mark.parametrize("intent", ["awareness", "discovery", "enrolment", "utilisation", "support", "feedback"])
def test_every_agent_can_switch_path(client, intent):
    prompt = _preset(client, intent, ["pm-kisan"])["prompt"]
    assert "## Switch path when the person's situation is different" in prompt
    for name in ("Awareness:", "Discovery:", "Enrolment:", "Utilisation:", "Support:", "Feedback:"):
        assert f"- {name} if " in prompt, (intent, name)
    # The paths need each scheme's own details, whatever the agent was set up for.
    assert "To check if they're already enrolled, ask: \"Are you already registered for PM-KISAN?\"" in prompt
    assert "If they have a problem: contact the helpline 155261 or the official website pmkisan.gov.in" in prompt


def test_campaign_shows_switched_paths(client, secure_db):
    secure_db["Agents"].insert_one({"agent_id": "agent-aw", "org_id": ORG_A, "name": "Aware",
                                     "config": {"use_case": {"type": "scheme", "intent": "awareness", "scheme_ids": ["pm-kisan"]}}})
    secure_db["Campaigns"].insert_one({"campaign_id": "camp-aw", "org_id": ORG_A, "agent_id": "agent-aw", "name": "Aware", "state": "completed"})
    replies = ["The money has not come for two months.", "Okay, I will apply this week.", "Tell me more, that sounds good."]
    for n, reply in enumerate(replies):
        doc = {"call_id": f"aw-{n}", "org_id": ORG_A, "agent_id": "agent-aw", "campaign_id": "camp-aw", "call_type": "outbound",
               "status": "completed", "call_response": "answered", "duration": 40.0}
        secure_db["CallLogs"].insert_one(doc)
        call_analysis.analyse_and_store(ORG_A, doc, turns=[{"role": "agent", "text": "Namaste, calling about PM-KISAN."}, {"role": "user", "text": reply}],
                                        transcript_source="runtime")
    body = client.get("/api/v1/campaign/camp-aw/analytics", headers=_h("admin")).json()
    assert {p["intent"]: p["calls"] for p in body["switched_paths"]} == {"support": 1, "enrolment": 1}


# --- knowledge packs ---------------------------------------------------------------------

def test_pack_covers_all_six_intents():
    import io

    from pypdf import PdfReader

    from app.services import knowledge_packs

    scheme = use_cases._builtin_scheme(next(s for s in use_cases.SCHEMES if s["id"] == "pm-jay"))
    data = knowledge_packs.pack_pdf(scheme)
    assert data == knowledge_packs.pack_pdf(scheme)  # same facts, same file, so packs aren't duplicated
    text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)
    for heading in ("1. Awareness", "2. Discovery", "3. Enrolment", "4. Utilisation", "5. Support", "6. Feedback",
                    "Which path to follow on a call", "More checked answers"):
        assert heading in text, heading
    assert "Ayushman Vay Vandana" in text and "1800110770" in text and "pgportal.gov.in" in text
    assert "Rs. 5 lakh" in text  # the rupee sign is spelled out for the built-in font
    for s in use_cases.SCHEMES:
        PdfReader(io.BytesIO(knowledge_packs.pack_pdf(use_cases._builtin_scheme(s))))


def test_packs_are_built_into_the_agent(client, secure_db):
    preset = _preset(client, "awareness", ["pm-jay", "pm-kisan"])
    assert preset["knowledge"] == [
        {"scheme_id": "pm-jay", "name": "Knowledge pack - Ayushman Bharat PM-JAY.pdf"},
        {"scheme_id": "pm-kisan", "name": "Knowledge pack - PM-KISAN.pdf"},
    ]
    prompt = preset["prompt"]
    assert "## Knowledge base (built in)" in prompt
    assert "Ayushman Vay Vandana" in prompt and "1800110770" in prompt and "PIB release 2082288" in prompt
    assert "Q: What should I bring?" in prompt
    # Nothing is uploaded or indexed: the org's knowledge base stays as it was.
    assert secure_db["KnowledgeDocuments"].count_documents({}) == 0
    survey = _preset(client, "feedback", ["pm-jay"])["prompt"]
    assert "## Knowledge base (built in)" in survey
    assert client.post("/api/v1/use-cases/preset", json={"use_case": "city_survey", "survey_id": "water"},
                       headers=_h("admin")).json()["knowledge"] == []


def test_pack_pdf_is_served_to_every_role(client):
    catalogue = client.get("/api/v1/use-cases", headers=_h("member")).json()
    assert next(s for s in catalogue["schemes"] if s["id"] == "pm-jay")["pack_name"] == "Knowledge pack - Ayushman Bharat PM-JAY.pdf"
    r = client.get("/api/v1/use-cases/knowledge/pm-jay", headers=_h("member"))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert client.get("/api/v1/use-cases/knowledge/nope", headers=_h("member")).status_code == 404
    # An organisation's own scheme has a pack too, visible only to that organisation.
    custom = client.post("/api/v1/use-cases/schemes", json={"name": "Ladli Behna", "benefit": "Rs 1,250 a month.",
                         "eligibility": "Women in the state list.", "how_to_apply": "At the camp.", "kind": "cash"},
                         headers=_h("admin")).json()
    assert client.get(f"/api/v1/use-cases/knowledge/{custom['id']}", headers=_h("member")).status_code == 200
    assert client.get(f"/api/v1/use-cases/knowledge/{custom['id']}", headers=_h("super_admin", ORG_B)).status_code == 404
