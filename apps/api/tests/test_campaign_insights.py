"""Standard names, campaign duplicates, period analysis (calendar) and call filters."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token
from app.config import get_settings
from app.services import agent_service, campaign_insights, naming
from app.services.secure import resolution

ORG_A = "orga01"
ORG_B = "orgb02"
USERS = {"super_admin": "owner@a.example", "admin": "admin@a.example", "campaign_manager": "cm@a.example", "member": "member@a.example"}


@pytest.fixture
def client(vault_env, secure_db, monkeypatch):
    monkeypatch.setenv("PLATFORM_ADMIN_EMAILS", "")
    get_settings.cache_clear()
    rbac.invalidate_cache()
    resolution.rate_limiter.reset()
    import app.main as main_module

    agents = {"agent-1": {"agent_id": "agent-1", "org_id": ORG_A, "name": "Kisan helpline", "agent_category": "telephony",
                          "linked_phone_number": "+918000000101", "config": {}}}

    def get_agent(org_id, agent_id):
        if agent_id not in agents or agents[agent_id]["org_id"] != org_id:
            raise agent_service.AgentNotFoundError(agent_id)
        return dict(agents[agent_id])

    monkeypatch.setattr(agent_service, "get_agent", get_agent)
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


def _list(client, name="Pune farmers", filename="Ward 12 – Wave 1 (final).CSV"):
    r = client.post("/api/v1/contact-lists", data={"name": name},
                    files={"file": (filename, b"phone_number,name\n+919876543210,Arun\n+919876543211,Priya\n", "text/csv")},
                    headers=_h("super_admin"))
    assert r.status_code == 201, r.text
    return r.json()


def _campaign(secure_db, campaign_id, name, *, source_id="CSET-x", org_id=ORG_A, state="completed"):
    secure_db["Campaigns"].insert_one({
        "campaign_id": campaign_id, "org_id": org_id, "name": name, "agent_id": "agent-1", "state": state,
        "source_type": "secure_contacts", "source_id": source_id, "rate_limit_per_second": 2,
        "retry_config": {"enabled": True, "max_retries": 2}, "total_rows": 2, "processed_rows": 2,
        "orchestrator_metadata": {"max_concurrency": 3, "schedule_config": {"enabled": True}, "parent_campaign_id": "old"},
        "created_at": "2026-11-01T04:00:00+00:00",
    })


def _call(secure_db, call_id, campaign_id, created_at, *, response="answered", outcome="interested", org_id=ORG_A, **analysis):
    secure_db["CallLogs"].insert_one({
        "call_id": call_id, "org_id": org_id, "campaign_id": campaign_id, "agent_id": "agent-1", "call_type": "outbound",
        "status": "completed", "call_response": response, "duration": 60.0 if response == "answered" else 0.0,
        "created_at": created_at, "to_number": "+919876543210", "from_number": "+918000000101",
        "analysis": {"outcome": outcome if response == "answered" else "no_answer", **analysis},
    })


# --- names ---------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "value,expected",
    [
        ("  Kharif   advisory — Belagavi ", "Kharif advisory — Belagavi"),
        ("Ward 12 (Nov), phase 2", "Ward 12 (Nov), phase 2"),
        ("पुणे किसान", "पुणे किसान"),
    ],
)
def test_clean_name_accepts_standard_names(value, expected):
    assert naming.clean_name(value) == expected


@pytest.mark.parametrize(
    "value,message",
    [("", "Give the campaign a name"), ("ab", "at least 3"), ("x" * 81, "80 characters"),
     ("Drive 🚀", "can't contain"), ('He said "hi"', "can't contain"), ("a\tb\x00c", "can't contain")],
)
def test_clean_name_rejects_with_a_fix(value, message):
    with pytest.raises(naming.NameError_) as err:
        naming.clean_name(value)
    assert message in str(err.value)


def test_copies_and_suggestions_are_unique():
    existing = ["Ward 12", "ward 12 (copy)", "Ward 12 (copy 2)"]
    assert naming.copy_name("Ward 12", existing) == "Ward 12 (copy 3)"
    assert naming.copy_name("Ward 12 (copy 2)", existing) == "Ward 12 (copy 3)"  # no "(copy) (copy)"
    assert naming.next_free("WARD 12", existing) == "WARD 12 (2)"
    assert len(naming.copy_name("x" * 80, [])) == 80
    with pytest.raises(naming.NameError_) as err:
        naming.ensure_unique("ward 12", existing)
    assert err.value.status_code == 409 and err.value.suggestion == "ward 12 (2)"


def test_file_names_are_standardised():
    assert naming.safe_filename("Ward 12 – Wave 1 (final).XLSX") == "ward-12-wave-1-final.xlsx"
    assert naming.safe_filename("../../etc/passwd") == "passwd"
    assert naming.safe_filename("  .csv") == "upload.csv"
    assert naming.download_name("Ward 12 drive", "report", "csv", on=__import__("datetime").date(2026, 11, 11)) == \
        "voicera_ward-12-drive_report_2026-11-11.csv"


def test_contact_list_names_and_files(client):
    first = _list(client)
    assert first["filename"] == "ward-12-wave-1-final.csv"
    assert first["original_filename"] == "Ward 12 – Wave 1 (final).CSV"
    dup = client.post("/api/v1/contact-lists", data={"name": "PUNE FARMERS"},
                      files={"file": ("a.csv", b"phone_number\n+919876543212\n", "text/csv")}, headers=_h("super_admin"))
    assert dup.status_code == 409 and "Pune farmers" not in dup.json()["detail"] and "(2)" in dup.json()["detail"]
    bad = client.patch(f"/api/v1/contact-lists/{first['list_id']}", json={"name": "Pune 🌾"}, headers=_h("super_admin"))
    assert bad.status_code == 400 and "can't contain" in bad.json()["detail"]
    rules = client.get("/api/v1/contact-lists/rules", headers=_h("campaign_manager")).json()
    assert rules["max_bytes"] == 10 * 1024 * 1024 and rules["max_rows"] == 50_000 and rules["formats"] == [".csv", ".xlsx"]
    assert client.get("/api/v1/contact-lists/rules", headers=_h("member")).status_code == 403


def test_campaign_names_are_checked_on_create_and_rename(client, secure_db):
    r = client.post("/api/v1/campaign/create", json={"name": "x", "agent_id": "agent-1", "source_id": "CSET-x"}, headers=_h("super_admin"))
    assert r.status_code == 400 and "at least 3" in r.json()["detail"]
    _campaign(secure_db, "c1", "Ward 12 drive")
    _campaign(secure_db, "c2", "Ward 13 drive")
    r = client.patch("/api/v1/campaign/c2", json={"name": "ward 12 DRIVE"}, headers=_h("super_admin"))
    assert r.status_code == 409 and r.json()["detail"].endswith('Try "ward 12 DRIVE (2)".')
    assert client.patch("/api/v1/campaign/c2", json={"name": "Ward 13 drive"}, headers=_h("super_admin")).status_code == 200


# --- duplicate -------------------------------------------------------------------------------

def test_duplicate_campaign(client, secure_db):
    lst = _list(client)
    _campaign(secure_db, "c1", "Ward 12 drive", source_id=lst["list_id"])
    assert client.post("/api/v1/campaign/c1/duplicate", headers=_h("admin")).status_code == 403
    first = client.post("/api/v1/campaign/c1/duplicate", headers=_h("super_admin"))
    assert first.status_code == 201, first.text
    copy = first.json()
    assert copy["name"] == "Ward 12 drive (copy)" and copy["state"] == "created" and copy["campaign_id"] != "c1"
    assert copy["source_id"] == lst["list_id"] and copy["agent_id"] == "agent-1"
    stored = secure_db["Campaigns"].find_one({"campaign_id": copy["campaign_id"]})
    assert stored["orchestrator_metadata"] == {"max_concurrency": 3, "schedule_config": {"enabled": True}}
    assert stored["rate_limit_per_second"] == 2 and stored["retry_config"]["max_retries"] == 2
    again = client.post(f"/api/v1/campaign/{copy['campaign_id']}/duplicate", headers=_h("super_admin")).json()
    assert again["name"] == "Ward 12 drive (copy 2)"
    named = client.post("/api/v1/campaign/c1/duplicate", json={"name": "Ward 12 – December"}, headers=_h("super_admin"))
    assert named.status_code == 201 and named.json()["name"] == "Ward 12 – December"
    clash = client.post("/api/v1/campaign/c1/duplicate", json={"name": "ward 12 drive"}, headers=_h("super_admin"))
    assert clash.status_code == 409
    assert client.post("/api/v1/campaign/c1/duplicate", headers=_h("super_admin", ORG_B)).status_code == 404


# --- period analysis ---------------------------------------------------------------------------

def _seed_calls(secure_db):
    _campaign(secure_db, "c1", "Ward 12 drive")
    _campaign(secure_db, "c2", "Kisan support")
    # 10 Nov 23:00 IST = 10 Nov 17:30 UTC; 11 Nov 00:30 IST = 10 Nov 19:00 UTC (a different local day)
    _call(secure_db, "k1", "c1", "2026-11-10T17:30:00+00:00")
    _call(secure_db, "k2", "c1", "2026-11-10T19:00:00+00:00", response="no_answer")
    _call(secure_db, "k3", "c2", "2026-11-11T05:00:00+00:00", outcome="issue_reported", issues=["Delay"], switched_to="support")
    _call(secure_db, "k4", "c2", "2026-11-11T06:00:00+00:00", outcome="will_apply")
    _call(secure_db, "k5", "c1", "2026-12-02T06:00:00+00:00")
    _call(secure_db, "k6", "gone", "2026-11-11T06:30:00+00:00")
    _call(secure_db, "other-org", "c9", "2026-11-11T06:00:00+00:00", org_id=ORG_B)
    secure_db["CallLogs"].insert_one({"call_id": "web", "org_id": ORG_A, "campaign_id": None, "agent_id": "agent-1", "call_type": "web",
                                      "status": "completed", "from_number": "web", "to_number": "web", "created_at": "2026-11-11T06:00:00+00:00"})


def test_period_groups_calls_by_local_day(client, secure_db):
    _seed_calls(secure_db)
    body = client.get("/api/v1/campaign/insights", params={"from": "2026-11-01", "to": "2026-11-30"}, headers=_h("member"))
    assert body.status_code == 200, body.text
    data = body.json()
    assert data["tz"] == "Asia/Kolkata"
    assert [(d["date"], d["calls"]) for d in data["days"]] == [("2026-11-10", 1), ("2026-11-11", 4)]
    day11 = data["days"][1]
    assert {c["name"]: c["calls"] for c in day11["campaigns"]} == {"Kisan support": 2, "Ward 12 drive": 1, "Deleted campaign": 1}
    t = data["totals"]
    assert t["calls"] == 5 and t["answered"] == 4 and t["answer_rate"] == 80.0 and t["campaigns"] == 3
    assert t["issues_reported"] == 1 and t["switched_path"] == 1 and t["interested"] == 3 and t["days_active"] == 2
    assert data["issues"] == [{"theme": "Delay", "calls": 1}]
    assert sum(h["calls"] for h in data["hours"]) == 5 and data["hours"][23]["calls"] == 1
    assert [c["name"] for c in data["campaigns"]] == ["Kisan support", "Ward 12 drive", "Deleted campaign"]  # most calls, then name
    first = next(c for c in data["campaigns"] if c["name"] == "Ward 12 drive")
    assert first["calls"] == 2 and first["days_active"] == 2
    assert first["answer_rate"] == 50.0 and first["first_call"].startswith("2026-11-10T23:00:00+05:30")


def test_period_filters_and_errors(client, secure_db):
    _seed_calls(secure_db)
    one = client.get("/api/v1/campaign/insights", params={"from": "2026-11-11", "to": "2026-11-11", "campaign_id": "c2"},
                     headers=_h("member")).json()
    assert one["totals"]["calls"] == 2 and [c["campaign_id"] for c in one["campaigns"]] == ["c2"]
    utc = client.get("/api/v1/campaign/insights", params={"from": "2026-11-10", "to": "2026-11-10", "tz": "UTC"},
                     headers=_h("member")).json()
    assert utc["totals"]["calls"] == 2  # both 10 Nov calls are on 10 Nov in UTC
    for params, message in [({"from": "2026-11-30", "to": "2026-11-01"}, "before the start"),
                            ({"from": "2025-01-01", "to": "2026-12-31"}, "at most"),
                            ({"from": "11/11/2026", "to": "2026-11-12"}, "look like"),
                            ({"from": "2026-11-01", "to": "2026-11-02", "tz": "Mars/Base"}, "time zone")]:
        r = client.get("/api/v1/campaign/insights", params=params, headers=_h("member"))
        assert r.status_code == 400 and message in r.json()["detail"], (params, r.text)
    other = client.get("/api/v1/campaign/insights", params={"from": "2026-11-01", "to": "2026-11-30"},
                       headers=_h("super_admin", ORG_B)).json()
    assert other["totals"]["calls"] == 1


def test_call_list_filters_by_campaign_and_day(client, secure_db):
    _seed_calls(secure_db)
    r = client.get(f"/api/v1/calls/org/{ORG_A}", params={"campaign_id": "c1", "date_from": "2026-11-11", "date_to": "2026-11-11"},
                   headers=_h("member"))
    assert r.status_code == 200, r.text
    assert [c["call_id"] for c in r.json()["calls"]] == ["k2"] and r.json()["total"] == 1
    month = client.get(f"/api/v1/calls/org/{ORG_A}", params={"date_from": "2026-11-01", "date_to": "2026-11-30"}, headers=_h("member")).json()
    assert month["total"] == 6  # campaign calls plus the web call that day
    assert client.get(f"/api/v1/calls/org/{ORG_A}", params={"date_from": "2026-13-01"}, headers=_h("member")).status_code == 400


def test_utc_bounds_follow_the_zone():
    from datetime import date

    lo, hi = campaign_insights.utc_bounds(date(2026, 11, 11), date(2026, 11, 11), campaign_insights.zone("Asia/Kolkata"))
    assert (lo, hi) == ("2026-11-10T18:30:00+00:00", "2026-11-11T18:30:00+00:00")
