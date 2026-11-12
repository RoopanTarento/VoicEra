"""Contact lists (Owner-only uploads, CSV and Excel), call analysis and campaign analytics.

Runs through ``app.main.app`` so central RBAC applies exactly as in production.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token
from app.config import get_settings
from app.services import call_analysis
from app.services.secure import contact_lists, resolution
from app.services.secure import vault_repository as vault

ORG_A = "orga01"
ORG_B = "orgb02"
USERS = {
    "super_admin": "owner@a.example",
    "admin": "admin@a.example",
    "campaign_manager": "cm@a.example",
    "member": "member@a.example",
}


@pytest.fixture
def app_client(vault_env, secure_db, monkeypatch):
    monkeypatch.setenv("PLATFORM_ADMIN_EMAILS", "")
    get_settings.cache_clear()
    rbac.invalidate_cache()
    resolution.rate_limiter.reset()
    import app.main as main_module

    for org_id, name in ((ORG_A, "Adopter A"), (ORG_B, "Adopter B")):
        secure_db["Organizations"].insert_one({"org_id": org_id, "name": name, "status": "active"})
    for role, email in USERS.items():
        secure_db["Memberships"].insert_one({"email": email, "org_id": ORG_A, "role": role})
    secure_db["Memberships"].insert_one({"email": "owner@b.example", "org_id": ORG_B, "role": "super_admin"})
    yield TestClient(main_module.app)
    rbac.invalidate_cache()
    get_settings.cache_clear()


def _h(role: str, org_id: str = ORG_A) -> dict[str, str]:
    email = "owner@b.example" if org_id == ORG_B else USERS[role]
    return {"Authorization": f"Bearer {create_access_token({'sub': email, 'email': email, 'org_id': org_id, 'role': role})}"}


def _upload(client, role="super_admin", name="Pune farmers", filename="list.csv", content=None, org_id=ORG_A):
    content = content if content is not None else b"phone_number,name,district\n+919876543210,Arun,Pune\n919876543211,Priya,Pune\n"
    return client.post(
        "/api/v1/contact-lists",
        data={"name": name},
        files={"file": (filename, content, "text/csv")},
        headers=_h(role, org_id),
    )


def _xlsx(rows: list[list[object]]) -> bytes:
    """A minimal .xlsx: text cells as shared strings, numbers as Excel stores them."""
    strings: list[str] = []
    xml_rows = []
    for r, row in enumerate(rows, start=1):
        cells = []
        for c, value in enumerate(row):
            ref = f"{chr(65 + c)}{r}"
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value:.11E}</v></c>')
            else:
                strings.append(str(value))
                cells.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
        xml_rows.append(f'<row r="{r}">{"".join(cells)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>')
        z.writestr("xl/sharedStrings.xml", f'<sst {ns}>' + "".join(f"<si><t>{s}</t></si>" for s in strings) + "</sst>")
        z.writestr("xl/worksheets/sheet1.xml", f'<worksheet {ns}><sheetData>{"".join(xml_rows)}</sheetData></worksheet>')
    return buf.getvalue()


# --- contact lists -----------------------------------------------------------------------------


def test_owner_uploads_a_list_and_numbers_are_protected(app_client, secure_db):
    r = _upload(app_client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["list_id"].startswith("CSET-") and body["contacts"] == 2 and body["new_contacts"] == 2
    assert body["columns"] == ["name", "district"]
    assert "9876543210" not in r.text
    stored = secure_db[vault.CONTACT_SETS].find_one({"set_id": body["list_id"]})
    assert "9876543210" not in str(stored)
    detail = app_client.get(f"/api/v1/contact-lists/{body['list_id']}", headers=_h("campaign_manager")).json()
    assert [c["masked_phone"][-4:] for c in detail["contacts"]] == ["3210", "3211"]
    assert all("*" in c["masked_phone"] for c in detail["contacts"])
    assert detail["contacts"][0]["variables"] == {"name": "Arun", "district": "Pune"}


@pytest.mark.parametrize("role", ["admin", "campaign_manager", "member"])
def test_only_the_owner_can_upload_rename_or_delete(app_client, role):
    assert _upload(app_client, role).status_code == 403
    list_id = _upload(app_client).json()["list_id"]
    assert app_client.patch(f"/api/v1/contact-lists/{list_id}", json={"name": "x"}, headers=_h(role)).status_code == 403
    assert app_client.delete(f"/api/v1/contact-lists/{list_id}", headers=_h(role)).status_code == 403
    can_see = role != "member"
    assert (app_client.get("/api/v1/contact-lists", headers=_h(role)).status_code == 200) is can_see


def test_excel_upload_keeps_long_numbers_and_skips_bad_rows(app_client):
    content = _xlsx([["Phone Number", "Name"], [919876543210, "Arun"], ["98765", "Short"], ["+91 98765 43211", "Priya"], [919876543210, "Repeat"]])
    r = _upload(app_client, filename="farmers.xlsx", content=content)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["contacts"] == 2 and body["invalid_rows"] == 1 and body["repeated_rows"] == 1
    assert body["invalid_row_numbers"] == [3] and body["repeated_row_numbers"] == [5]


@pytest.mark.parametrize(
    "filename,content,message",
    [
        ("list.txt", b"phone_number\n+919876543210\n", "CSV (.csv) or Excel"),
        ("list.csv", b"mobile_no_typo\n+919876543210\n", "phone_number"),
        ("list.csv", b"phone_number\nabc\n", "No valid phone numbers"),
        ("list.csv", b"phone_number\n", "header row"),
        ("list.xlsx", b"not a zip", "can't be read"),
    ],
)
def test_bad_files_get_a_plain_message(app_client, filename, content, message):
    r = _upload(app_client, filename=filename, content=content)
    assert r.status_code == 400 and message in r.json()["detail"]


def test_rename_delete_and_names_are_unique(app_client, secure_db):
    list_id = _upload(app_client).json()["list_id"]
    assert _upload(app_client).status_code == 409  # same name
    r = app_client.patch(f"/api/v1/contact-lists/{list_id}", json={"name": "Pune farmers – Nov"}, headers=_h("super_admin"))
    assert r.status_code == 200 and r.json()["name"] == "Pune farmers – Nov"
    secure_db["Campaigns"].insert_one({"campaign_id": "c1", "org_id": ORG_A, "source_id": list_id, "state": "running"})
    blocked = app_client.delete(f"/api/v1/contact-lists/{list_id}", headers=_h("super_admin"))
    assert blocked.status_code == 409 and "hasn't finished" in blocked.json()["detail"]
    secure_db["Campaigns"].update_one({"campaign_id": "c1"}, {"$set": {"state": "completed"}})
    assert app_client.delete(f"/api/v1/contact-lists/{list_id}", headers=_h("super_admin")).status_code == 200
    assert app_client.get(f"/api/v1/contact-lists/{list_id}", headers=_h("super_admin")).status_code == 404
    assert vault.get_contact_set(ORG_A, list_id) is None  # campaigns can't use it any more
    assert secure_db[vault.CONTACTS].count_documents({"org_id": ORG_A}) == 2  # contacts stay in the vault


def test_lists_are_isolated_between_adopters(app_client):
    list_id = _upload(app_client).json()["list_id"]
    assert app_client.get(f"/api/v1/contact-lists/{list_id}", headers=_h("super_admin", ORG_B)).status_code == 404
    assert app_client.get("/api/v1/contact-lists", headers=_h("super_admin", ORG_B)).json() == []


# --- call analysis ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "user_says,outcome",
    [
        ("Yes, tell me more. How do I apply?", "interested"),
        ("I'm not interested, don't call again.", "not_interested"),
        ("I'm busy right now, call me later.", "callback"),
        ("You have the wrong number.", "wrong_person"),
        ("Hmm.", "unclear"),
    ],
)
def test_rules_engine_outcomes(user_says, outcome):
    turns = [{"role": "agent", "text": "Namaste, this is Asha calling from the health mission about a scheme."}, {"role": "user", "text": user_says}]
    result = call_analysis.analyse("org", turns, transcript_source="test")
    assert result["outcome"] == outcome and result["engine"] == "rules"


def test_transcripts_are_redacted_before_storage():
    turns = call_analysis.clean_turns([{"role": "user", "text": "My number is +91 98765 43210, call me"}])
    assert "98765" not in turns[0]["text"]


def _call(secure_db, call_id, **extra):
    doc = {
        "call_id": call_id, "org_id": ORG_A, "agent_id": "agent-1", "call_type": "outbound", "status": "completed",
        "from_number": "+918000000101", "to_number": "+919876543210", "telephony_provider": "mock",
        "campaign_id": "camp-1", **extra,
    }
    secure_db["CallLogs"].insert_one(doc)
    return doc


@pytest.mark.asyncio
async def test_mock_call_gets_a_labelled_synthetic_transcript_and_analysis(app_client, secure_db, monkeypatch):
    from app.services.campaign import status_processor
    from app.services.secure.gateway import handle_provider_callback

    async def _no_campaign(**_kwargs):
        return None

    monkeypatch.setattr(status_processor, "handle_call_terminal", _no_campaign)

    _call(secure_db, "call-1", call_response="pending", campaign_id=None)
    await handle_provider_callback(
        {"org_id": ORG_A, "call_id": "call-1", "CallStatus": "completed", "AnswerTime": "1", "Duration": "64",
         "From": "+918000000101", "To": "+919876543210"}
    )
    stored = secure_db["CallLogs"].find_one({"call_id": "call-1"})
    assert stored["transcript_source"] == "synthetic_mock" and stored["transcript_inline"]
    assert stored["analysis"]["outcome"] in call_analysis.OUTCOMES and stored["analysis"]["summary"]
    transcript = app_client.get("/api/v1/calls/call-1/transcript", headers=_h("campaign_manager"))
    assert transcript.status_code == 200 and transcript.text.startswith("SYNTHETIC TEST TRANSCRIPT")


def test_member_sees_only_the_outcome(app_client, secure_db):
    _call(secure_db, "call-2", call_response="answered", duration=40.0)
    call_analysis.analyse_and_store(
        ORG_A, secure_db["CallLogs"].find_one({"call_id": "call-2"}),
        turns=call_analysis.synthetic_transcript("call-2"), transcript_source="synthetic_mock",
    )
    full = app_client.get("/api/v1/calls/call-2", headers=_h("campaign_manager")).json()["analysis"]
    limited = app_client.get("/api/v1/calls/call-2", headers=_h("member")).json()["analysis"]
    assert full["summary"] and "feedback" in full
    assert set(limited) == {"outcome", "outcome_label", "analysed_at"}
    assert app_client.get("/api/v1/calls/call-2/transcript", headers=_h("member")).status_code == 403
    listed = app_client.get(f"/api/v1/calls/org/{ORG_A}", headers=_h("member")).json()["calls"][0]["analysis"]
    assert "summary" not in listed
    rerun = app_client.post("/api/v1/calls/call-2/analyze", headers=_h("campaign_manager"))
    assert rerun.status_code == 200 and rerun.json()["analysis"]["outcome"] == full["outcome"]
    assert app_client.post("/api/v1/calls/call-2/analyze", headers=_h("member")).status_code == 403


def test_campaign_analytics(app_client, secure_db):
    secure_db["Campaigns"].insert_one({"campaign_id": "camp-1", "org_id": ORG_A, "name": "Wave 1", "state": "completed", "total_rows": 4, "processed_rows": 4})
    for i, response in enumerate(["answered", "answered", "busy", "no_answer"]):
        doc = _call(secure_db, f"c{i}", call_response=response, duration=60.0 if response == "answered" else None)
        turns = call_analysis.synthetic_transcript(f"c{i}") if response == "answered" else None
        call_analysis.analyse_and_store(ORG_A, doc, turns=turns, transcript_source="synthetic_mock" if turns else None)
    r = app_client.get("/api/v1/campaign/camp-1/analytics", headers=_h("member"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["calls_attempted"] == 4 and body["calls_answered"] == 2 and body["answer_rate"] == 50.0
    assert body["avg_duration_seconds"] == 60.0 and body["analysed_calls"] == 4 and body["synthetic_transcripts"] == 2
    assert sum(o["count"] for o in body["outcomes"]) == 4
    assert {o["key"] for o in body["outcomes"]} >= {"no_answer"}
    assert app_client.get("/api/v1/campaign/camp-1/analytics", headers=_h("super_admin", ORG_B)).status_code == 404


def test_contact_list_feeds_a_campaign(app_client, secure_db):
    list_id = _upload(app_client).json()["list_id"]
    assert contact_lists.get_list(ORG_A, list_id)["campaigns"] == 0
    secure_db["Campaigns"].insert_one({"campaign_id": "c9", "org_id": ORG_A, "source_id": list_id, "state": "created"})
    rows = app_client.get("/api/v1/contact-lists", headers=_h("campaign_manager")).json()
    assert rows[0]["campaigns"] == 1 and rows[0]["active_campaigns"] == 1
