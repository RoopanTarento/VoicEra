"""Sign in with an emailed one-time code; first sign-in creates the account."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import rbac
from app.config import get_settings, settings
from app.services import email_service, login_codes


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch):
    box: list[tuple[str, str]] = []
    monkeypatch.setattr(settings, "MAILTRAP_API_TOKEN", "test-token")
    monkeypatch.setattr(email_service, "send_login_code_email", lambda email, code: box.append((email, code)) or True)
    return box


@pytest.fixture
def client(vault_env, secure_db, monkeypatch: pytest.MonkeyPatch):
    get_settings.cache_clear()
    rbac.invalidate_cache()
    monkeypatch.setattr(login_codes, "_indexes_ready", False)
    import app.main as main_module

    yield TestClient(main_module.app)
    rbac.invalidate_cache()


def test_new_email_gets_an_account_and_workspace(client, secure_db, sent):
    r = client.post("/api/v1/users/login-code", json={"email": "Asha@Agri.Karnataka.gov.in"})
    assert r.status_code == 200 and "code" in r.json()["message"]
    email, code = sent[-1]
    assert email == "asha@agri.karnataka.gov.in"
    assert not secure_db["LoginCodes"].find_one({"code_hash": code})  # only a hash is stored

    r = client.post("/api/v1/users/login-code/verify", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] and body["role"] == "super_admin" and body["is_first_login"] is True
    org = secure_db["Organizations"].find_one({"org_id": body["org_id"]})
    assert org["name"] == "agri.karnataka.gov.in"
    assert "password" not in secure_db["Users"].find_one({"email": email})


def test_existing_user_signs_into_their_workspace(client, secure_db, sent):
    secure_db["Organizations"].insert_one({"org_id": "ex01", "name": "Existing", "status": "active"})
    secure_db["Users"].insert_one({"email": "old@x.gov.in", "default_org_id": "ex01", "last_logged_in_at": "2026-01-01"})
    secure_db["Memberships"].insert_one({"email": "old@x.gov.in", "org_id": "ex01", "role": "admin"})
    client.post("/api/v1/users/login-code", json={"email": "old@x.gov.in"})
    body = client.post("/api/v1/users/login-code/verify", json={"email": "old@x.gov.in", "code": sent[-1][1]}).json()
    assert body["org_id"] == "ex01" and body["role"] == "admin" and body["is_first_login"] is False
    assert secure_db["Organizations"].count_documents({}) == 1


def test_codes_work_once(client, sent):
    client.post("/api/v1/users/login-code", json={"email": "a@b.in"})
    code = sent[-1][1]
    assert client.post("/api/v1/users/login-code/verify", json={"email": "a@b.in", "code": code}).status_code == 200
    assert client.post("/api/v1/users/login-code/verify", json={"email": "a@b.in", "code": code}).status_code == 400


def test_wrong_codes_burn_attempts(client, sent):
    client.post("/api/v1/users/login-code", json={"email": "a@b.in"})
    code = sent[-1][1]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(login_codes.MAX_ATTEMPTS):
        assert client.post("/api/v1/users/login-code/verify", json={"email": "a@b.in", "code": wrong}).status_code == 400
    # Even the right code is refused once the attempts are used up.
    assert client.post("/api/v1/users/login-code/verify", json={"email": "a@b.in", "code": code}).status_code in (400, 429)


def test_a_new_code_replaces_the_old_one(client, sent):
    client.post("/api/v1/users/login-code", json={"email": "a@b.in"})
    first = sent[-1][1]
    client.post("/api/v1/users/login-code", json={"email": "a@b.in"})
    second = sent[-1][1]
    if first != second:
        assert client.post("/api/v1/users/login-code/verify", json={"email": "a@b.in", "code": first}).status_code == 400
    assert client.post("/api/v1/users/login-code/verify", json={"email": "a@b.in", "code": second}).status_code == 200


def test_sends_are_rate_limited(client, sent):
    for _ in range(login_codes.MAX_SENDS_PER_EMAIL):
        assert client.post("/api/v1/users/login-code", json={"email": "a@b.in"}).status_code == 200
    assert client.post("/api/v1/users/login-code", json={"email": "a@b.in"}).status_code == 429


def test_refuses_when_email_is_not_set_up(client, monkeypatch):
    monkeypatch.setattr(settings, "MAILTRAP_API_TOKEN", "")
    assert client.post("/api/v1/users/login-code", json={"email": "a@b.in"}).status_code == 503


def test_rejects_bad_emails(client, sent):
    assert client.post("/api/v1/users/login-code", json={"email": "not-an-email"}).status_code == 400
