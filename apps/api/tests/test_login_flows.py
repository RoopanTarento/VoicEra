"""Sign-in, sign-up, invite, organisation switching and lockout, through the real app."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token, get_password_hash
from app.config import get_settings
from app.services import login_guard
from app.services.secure import security_audit

PASSWORD = "Corr3ct-Horse!"
_HASH = get_password_hash(PASSWORD)


@pytest.fixture
def client(vault_env, secure_db, monkeypatch):
    monkeypatch.setenv("PLATFORM_ADMIN_EMAILS", "ops@voicera.example")
    get_settings.cache_clear()
    rbac.invalidate_cache()
    import app.main as main_module

    db = secure_db
    db["Organizations"].insert_many(
        [
            {"org_id": "orga01", "name": "Adopter A", "status": "active", "created_at": "2026-11-01"},
            {"org_id": "orgb02", "name": "Adopter B", "status": "active", "created_at": "2026-11-02"},
        ]
    )
    # A legacy account stored with mixed case, member of two adopters.
    db["Users"].insert_one({"email": "Lead@Adopter.Example", "password": _HASH, "default_org_id": "orga01"})
    db["Memberships"].insert_many(
        [
            {"email": "Lead@Adopter.Example", "org_id": "orga01", "role": "super_admin", "created_at": "2026-11-01"},
            {"email": "Lead@Adopter.Example", "org_id": "orgb02", "role": "campaign_manager", "created_at": "2026-11-02"},
        ]
    )
    db["Users"].insert_one({"email": "loner@adopter.example", "password": _HASH})
    yield TestClient(main_module.app)
    rbac.invalidate_cache()
    get_settings.cache_clear()


def _login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/v1/users/login", json={"email": email, "password": password})


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_login_ignores_email_case_and_whitespace(client):
    for email in ("lead@adopter.example", "LEAD@ADOPTER.EXAMPLE", "  Lead@Adopter.Example "):
        r = _login(client, email)
        assert r.status_code == 200, (email, r.text)
        assert r.json()["org_id"] == "orga01" and r.json()["role"] == "super_admin"


def test_wrong_password_and_unknown_email_get_the_same_message(client):
    wrong = _login(client, "lead@adopter.example", "nope-nope")
    unknown = _login(client, "nobody@adopter.example")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"] == "Incorrect email or password."


def test_repeated_failures_lock_the_account_then_success_clears(client, secure_db):
    for _ in range(login_guard.MAX_PER_EMAIL):
        assert _login(client, "lead@adopter.example", "bad-password").status_code == 401
    locked = _login(client, "lead@adopter.example")  # even the right password is refused while locked
    assert locked.status_code == 429
    assert "Too many failed sign-in attempts" in locked.json()["detail"]
    assert int(locked.headers["Retry-After"]) > 0
    actions = [e["action"] for e in secure_db[security_audit.COLLECTION].find({"event_type": "auth.failed"})]
    assert actions.count("login_failed") == login_guard.MAX_PER_EMAIL and "login_locked" in actions
    # Failures are recorded against the user's adopter, so its admins can see them.
    assert secure_db[security_audit.COLLECTION].find_one({"action": "login_failed"})["org_id"] == "orga01"

    secure_db[login_guard.COLLECTION].delete_many({})  # window elapsed
    assert _login(client, "lead@adopter.example").status_code == 200
    assert secure_db[login_guard.COLLECTION].count_documents({"key": "email:lead@adopter.example"}) == 0


def test_lockout_is_per_email(client):
    for _ in range(login_guard.MAX_PER_EMAIL):
        _login(client, "lead@adopter.example", "bad-password")
    assert _login(client, "loner@adopter.example").status_code != 429


def test_user_without_memberships_gets_a_clear_message(client):
    r = _login(client, "loner@adopter.example")
    assert r.status_code == 403
    assert "isn't a member of any organisation" in r.json()["detail"]


def test_login_skips_a_suspended_adopter_and_uses_an_active_one(client, secure_db):
    secure_db["Organizations"].update_one({"org_id": "orga01"}, {"$set": {"status": "suspended"}})
    r = _login(client, "lead@adopter.example")
    assert r.status_code == 200
    assert r.json()["org_id"] == "orgb02" and r.json()["role"] == "campaign_manager"


def test_login_refused_when_every_adopter_is_suspended(client, secure_db):
    secure_db["Organizations"].update_many({}, {"$set": {"status": "suspended"}})
    r = _login(client, "lead@adopter.example")
    assert r.status_code == 403
    assert "suspended" in r.json()["detail"]
    secure_db["Organizations"].update_many({}, {"$set": {"status": "offboarded"}})
    assert "no longer active" in _login(client, "lead@adopter.example").json()["detail"]


def test_switch_organisation_updates_role_and_refuses_suspended(client, secure_db):
    token = _login(client, "lead@adopter.example").json()["access_token"]
    orgs = client.get("/api/v1/users/organisations", headers=_bearer(token)).json()
    assert {o["org_id"] for o in orgs["organisations"]} == {"orga01", "orgb02"}

    switched = client.post("/api/v1/users/switch-organisation", json={"org_id": "orgb02"}, headers=_bearer(token))
    assert switched.status_code == 200
    me = client.get("/api/v1/rbac/me", headers=_bearer(switched.json()["access_token"])).json()
    assert me["org_id"] == "orgb02" and me["role"] == "campaign_manager"

    secure_db["Organizations"].update_one({"org_id": "orga01"}, {"$set": {"status": "suspended"}})
    back = client.post("/api/v1/users/switch-organisation", json={"org_id": "orga01"}, headers=_bearer(token))
    assert back.status_code == 400 and "suspended" in back.json()["detail"]
    other = client.post("/api/v1/users/switch-organisation", json={"org_id": "zzz999"}, headers=_bearer(token))
    assert other.status_code == 400


def test_signup_stores_lowercase_and_logs_in_any_case(client, secure_db):
    r = client.post(
        "/api/v1/users/signup",
        json={"email": "New.Owner@Example.Gov.In", "password": PASSWORD, "organisation_name": "New Adopter"},
    )
    assert r.status_code == 201, r.text
    assert secure_db["Users"].find_one({"email": "new.owner@example.gov.in"})
    org_id = r.json()["org_id"]
    assert secure_db["SecureTenantKeys"].find_one({"org_id": org_id})["status"] == "active"
    assert _login(client, "NEW.OWNER@example.gov.in").json()["org_id"] == org_id


def test_signup_with_existing_email_in_other_case_reuses_the_account(client, secure_db):
    r = client.post(
        "/api/v1/users/signup",
        json={"email": "lead@adopter.example", "password": PASSWORD, "organisation_name": "Third Adopter"},
    )
    assert r.status_code == 201, r.text
    assert secure_db["Users"].count_documents({"email": {"$regex": "^lead@adopter.example$", "$options": "i"}}) == 1
    wrong = client.post(
        "/api/v1/users/signup",
        json={"email": "LEAD@adopter.example", "password": "wrong-pass", "organisation_name": "Fourth"},
    )
    assert wrong.status_code == 400


def test_invite_with_role_then_invitee_signs_in_with_that_role(client, secure_db):
    owner = _login(client, "lead@adopter.example").json()["access_token"]
    r = client.post(
        "/api/v1/members/invite",
        json={"email": "Field.Officer@Adopter.Example", "password": PASSWORD, "role": "campaign_manager"},
        headers=_bearer(owner),
    )
    assert r.status_code == 201, r.text
    login = _login(client, "field.officer@adopter.example")
    assert login.status_code == 200 and login.json()["role"] == "campaign_manager"


def test_invite_does_not_duplicate_a_mixed_case_account(client, secure_db):
    secure_db["Memberships"].insert_one({"email": "admin@b.example", "org_id": "orgb02", "role": "admin"})
    secure_db["Users"].insert_one({"email": "admin@b.example", "password": _HASH, "default_org_id": "orgb02"})
    admin_b = create_access_token({"sub": "admin@b.example", "org_id": "orgb02", "role": "admin"})
    secure_db["Memberships"].delete_one({"email": "Lead@Adopter.Example", "org_id": "orgb02"})
    rbac.invalidate_cache()
    r = client.post(
        "/api/v1/members/invite",
        json={"email": "lead@adopter.example", "password": PASSWORD, "role": "campaign_manager"},
        headers=_bearer(admin_b),
    )
    assert r.status_code == 201, r.text
    assert secure_db["Users"].count_documents({"email": {"$regex": "^lead@adopter.example$", "$options": "i"}}) == 1


def test_expired_or_tampered_tokens_are_rejected(client):
    from datetime import timedelta

    expired = create_access_token({"sub": "lead@adopter.example", "org_id": "orga01", "role": "super_admin"}, timedelta(seconds=-5))
    assert client.get("/api/v1/users/me", headers=_bearer(expired)).status_code == 401
    good = _login(client, "lead@adopter.example").json()["access_token"]
    tampered = good[:-3] + ("aaa" if not good.endswith("aaa") else "bbb")
    assert client.get("/api/v1/users/me", headers=_bearer(tampered)).status_code == 401
    assert client.get("/api/v1/users/me", headers=_bearer(good)).status_code == 200


def test_role_changes_reach_existing_sessions(client, secure_db):
    token = _login(client, "lead@adopter.example").json()["access_token"]  # signed in as owner
    assert client.get("/api/v1/secure/audit", headers=_bearer(token)).status_code == 200
    secure_db["Memberships"].update_one({"email": "Lead@Adopter.Example", "org_id": "orga01"}, {"$set": {"role": "campaign_manager"}})
    rbac.invalidate_cache()
    assert client.get("/api/v1/secure/audit", headers=_bearer(token)).status_code == 403
    assert client.get("/api/v1/rbac/me", headers=_bearer(token)).json()["role"] == "campaign_manager"


def test_invalid_email_gets_a_plain_message(client):
    r = client.post("/api/v1/users/signup", json={"email": "a@b.test", "password": PASSWORD, "organisation_name": "X"})
    assert r.status_code == 422
    assert r.json()["detail"][0]["msg"].startswith("Enter a valid email address")


def _invite(client, email: str, role: str = "member", org_id: str = "orga01", send_email: bool = False):
    owner = create_access_token({"sub": "Lead@Adopter.Example", "org_id": org_id, "role": "super_admin"})
    return client.post(
        "/api/v1/members/invitations",
        json={"email": email, "role": role, "send_email": send_email},
        headers=_bearer(owner),
    )


def _token(invite_response) -> str:
    return invite_response.json()["invite_url"].split("invite=", 1)[1]


def test_join_via_invitation_creates_account_with_its_role(client, secure_db):
    inv = _invite(client, "New.Member@Example.org", "campaign_manager")
    assert inv.status_code == 201, inv.text
    assert inv.json()["role_label"] == "Campaign manager" and "token_hash" not in inv.json()
    token = _token(inv)
    stored = secure_db["Invitations"].find_one({"email": "new.member@example.org"})
    assert stored["token_hash"] != token and token not in str(stored)
    lookup = client.get(f"/api/v1/members/invitations/lookup/{token}").json()
    assert lookup["org_name"] == "Adopter A" and lookup["email"] == "new.member@example.org"
    r = client.post("/api/v1/members/join", json={"email": "New.Member@Example.org", "password": PASSWORD, "invite_token": token})
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "campaign_manager" and r.json()["org_id"] == "orga01"
    again = client.post("/api/v1/members/join", json={"email": "new.member@example.org", "password": PASSWORD, "invite_token": token})
    assert again.status_code == 400 and "isn't valid any more" in again.json()["detail"]
    assert _login(client, "NEW.MEMBER@example.org").json()["role"] == "campaign_manager"


def test_join_without_invitation_or_with_wrong_email_is_refused(client):
    r = client.post("/api/v1/members/join", json={"email": "x@example.org", "password": PASSWORD, "org_id": "orga01"})
    assert r.status_code == 400 and "isn't valid any more" in r.json()["detail"]
    token = _token(_invite(client, "invited@example.org"))
    r = client.post("/api/v1/members/join", json={"email": "someone.else@example.org", "password": PASSWORD, "invite_token": token})
    assert r.status_code == 400 and "different email" in r.json()["detail"]


def test_invitation_rules_and_revoke(client, secure_db):
    admin = create_access_token({"sub": "adm@a.example", "org_id": "orga01", "role": "admin"})
    secure_db["Memberships"].insert_one({"email": "adm@a.example", "org_id": "orga01", "role": "admin"})
    rbac.invalidate_cache()
    r = client.post("/api/v1/members/invitations", json={"email": "z@example.org", "role": "admin"}, headers=_bearer(admin))
    assert r.status_code == 403 and "Only the Super admin can invite Admins" in r.json()["detail"]
    assert _invite(client, "lead@adopter.example").status_code == 409  # already a member
    inv = _invite(client, "later@example.org", send_email=True)
    assert inv.json()["email_sent"] is False and "MAILTRAP_API_TOKEN" in inv.json()["email_note"]
    owner = create_access_token({"sub": "Lead@Adopter.Example", "org_id": "orga01", "role": "super_admin"})
    pending = client.get("/api/v1/members/invitations", headers=_bearer(owner)).json()
    assert [p["email"] for p in pending] == ["later@example.org"] and "invite_url" not in pending[0]
    assert client.delete(f"/api/v1/members/invitations/{inv.json()['invite_id']}", headers=_bearer(owner)).status_code == 200
    assert client.get(f"/api/v1/members/invitations/lookup/{_token(inv)}").status_code == 404


def test_existing_mixed_case_account_joins_without_duplicate(client, secure_db):
    secure_db["Memberships"].delete_one({"email": "Lead@Adopter.Example", "org_id": "orgb02"})
    secure_db["Memberships"].insert_one({"email": "owner@b.example", "org_id": "orgb02", "role": "super_admin"})
    owner_b = create_access_token({"sub": "owner@b.example", "org_id": "orgb02", "role": "super_admin"})
    rbac.invalidate_cache()
    inv = client.post("/api/v1/members/invitations", json={"email": "lead@adopter.example"}, headers=_bearer(owner_b))
    token = _token(inv)
    r = client.post("/api/v1/members/join", json={"email": "lead@adopter.example", "password": PASSWORD, "invite_token": token})
    assert r.status_code == 201, r.text
    assert secure_db["Users"].count_documents({"email": {"$regex": "^lead@adopter.example$", "$options": "i"}}) == 1
    assert secure_db["Memberships"].count_documents({"org_id": "orgb02", "email": {"$regex": "^lead@", "$options": "i"}}) == 1


def test_cannot_join_a_suspended_adopter(client, secure_db):
    token = _token(_invite(client, "x@example.org"))
    secure_db["Organizations"].update_one({"org_id": "orga01"}, {"$set": {"status": "suspended"}})
    r = client.post("/api/v1/members/join", json={"email": "x@example.org", "password": PASSWORD, "invite_token": token})
    assert r.status_code == 400 and "isn't accepting new members" in r.json()["detail"]
