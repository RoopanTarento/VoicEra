"""Platform default providers: new workspaces can build agents on lent keys,
which only the server and the voice runtime ever see."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token
from app.config import get_settings, settings
from app.rbac import BOT_SERVICE_EMAIL
from app.services import auth_service
from app.services.copilot import tools as copilot_tools

PLATFORM = "platform01"
NEW = "neworg01"
OWN = "ownkey01"
GROQ_KEY = "gsk_platform_key_0000000000000000000000000000"


@pytest.fixture
def client(vault_env, secure_db, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PROVIDER_AUTH_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "DEFAULT_PROVIDERS_ORG_ID", PLATFORM)
    monkeypatch.setattr(settings, "DEFAULT_PROVIDERS", "groq, openai, plivo")
    get_settings.cache_clear()
    rbac.invalidate_cache()
    for org in (PLATFORM, NEW, OWN):
        secure_db["Organizations"].insert_one({"org_id": org, "name": org, "status": "active"})
        secure_db["Memberships"].insert_one({"email": f"owner@{org}.example", "org_id": org, "role": "super_admin"})
    auth_service.upsert_provider_auth(PLATFORM, "groq", {"api_key": GROQ_KEY})
    import app.main as main_module

    yield TestClient(main_module.app)
    rbac.invalidate_cache()


def _owner(org: str) -> dict[str, str]:
    token = create_access_token({"sub": f"owner@{org}.example", "org_id": org, "role": "super_admin"})
    return {"Authorization": f"Bearer {token}"}


def _bot(org: str) -> dict[str, str]:
    token = create_access_token({"sub": BOT_SERVICE_EMAIL, "email": BOT_SERVICE_EMAIL, "org_id": org, "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


def test_only_stored_ai_providers_are_lent(client):
    # openai is listed but the platform has no key for it; plivo is telephony.
    assert auth_service.lent_providers() == {"groq"}
    assert "plivo" not in auth_service.default_providers()
    assert auth_service.available_providers(NEW) == ["groq"]


def test_off_without_a_source_workspace(client, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "DEFAULT_PROVIDERS_ORG_ID", "")
    assert auth_service.lent_providers() == set()
    assert auth_service.resolve_provider_auth(NEW, "groq") is None


def test_new_workspace_sees_lent_llm_as_connected(client):
    llm = client.get("/api/v1/configuration/llm", headers=_owner(NEW)).json()
    assert llm["groq"]["authenticated"] is True
    assert llm["openai"]["authenticated"] is False


def test_people_never_get_the_lent_key(client):
    r = client.get("/api/v1/auth/groq", headers=_owner(NEW))
    assert r.status_code == 404
    assert GROQ_KEY not in r.text
    # Nor does it show up as something they connected themselves.
    assert client.get("/api/v1/auth/configured", headers=_owner(NEW)).json() == []


def test_voice_runtime_gets_the_lent_key(client):
    r = client.get("/api/v1/auth/groq", headers=_bot(NEW))
    assert r.status_code == 200
    assert r.json()["auth"]["api_key"] == GROQ_KEY
    assert r.json()["org_id"] == NEW


def test_a_workspace_key_wins(client):
    auth_service.upsert_provider_auth(OWN, "groq", {"api_key": "gsk_own_key_111111111111111111111111111111111"})
    assert auth_service.resolve_provider_auth(OWN, "groq")["auth"]["api_key"].startswith("gsk_own")
    assert client.get("/api/v1/auth/groq", headers=_bot(OWN)).json()["auth"]["api_key"].startswith("gsk_own")


def test_runtime_still_404s_for_providers_nobody_lends(client):
    assert client.get("/api/v1/auth/openai", headers=_bot(NEW)).status_code == 404


def test_agent_builder_offers_lent_providers(client):
    available = copilot_tools.list_available_providers(NEW)
    assert "groq" in {p["provider"] for p in available["llm"]}
