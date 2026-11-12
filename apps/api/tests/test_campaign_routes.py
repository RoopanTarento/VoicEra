"""Campaign API route tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.routers import campaign as campaign_router
from app.services.agent_service import AgentNotFoundError


@pytest.fixture(autouse=True)
def _no_existing_campaigns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Name and source checks read the org's campaigns and Secure policy; no Mongo here."""
    monkeypatch.setattr("app.routers.campaign.repo.list_campaigns", lambda *a, **k: [])
    # Plain CSV campaigns are allowed unless the org's Secure policy says otherwise.
    monkeypatch.setattr(
        "app.routers.campaign.secure_insights.get_org_policy",
        lambda org_id: {"require_vault_campaigns": False},
    )


def _admin() -> dict[str, Any]:
    return {"email": "admin@example.com", "org_id": "org-1", "role": "admin"}


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(campaign_router.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = _admin
    return TestClient(app)


def test_upload_campaign_csv_protects_numbers_and_stores_no_file(client, vault_env, secure_db) -> None:
    """VoicEra Secure: numbers are hashed + encrypted on arrival; the CSV is not stored."""
    csv_body = b"phone_number,customer_name\n+14155551234,Jane\n+919876543210,Arun\n"
    with patch("app.routers.campaign.MinIOStorage") as storage_cls:
        response = client.post(
            "/api/v1/campaign/upload",
            files={"file": ("contacts.csv", csv_body, "text/csv")},
        )
        storage_cls.assert_not_called()
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source_id"].startswith("CSET-")
    assert body["source_type"] == "secure_contacts"
    assert body["contact_rows"] == 2 and body["new_contacts"] == 2 and body["protected"] is True
    contact_set = secure_db["SecureContactSets"].find_one({"set_id": body["source_id"]})
    assert contact_set["org_id"] == "org-1"
    assert {m["variables"]["customer_name"] for m in contact_set["members"]} == {"Jane", "Arun"}
    stored = str(list(secure_db["SecureContacts"].find())) + str(contact_set)
    assert "4155551234" not in stored and "9876543210" not in stored

    again = client.post(
        "/api/v1/campaign/upload", files={"file": ("again.csv", b"phone_number\n+14155551234\n", "text/csv")}
    ).json()
    assert again["new_contacts"] == 0  # same number hashes to the same protected contact


def test_upload_campaign_csv_rejects_invalid_numbers(client, vault_env, secure_db) -> None:
    response = client.post(
        "/api/v1/campaign/upload",
        files={"file": ("c.csv", b"phone_number\n+9198765\n", "text/csv")},
    )
    assert response.status_code == 400
    assert "+9198765" not in response.text


def test_upload_campaign_csv_fails_closed_without_vault_keys(client, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("SECURE_VAULT_KEYS", "")
    get_settings.cache_clear()
    try:
        response = client.post(
            "/api/v1/campaign/upload",
            files={"file": ("c.csv", b"phone_number\n+14155551234\n", "text/csv")},
        )
    finally:
        get_settings.cache_clear()
    assert response.status_code == 503


def test_upload_campaign_csv_rejects_non_csv(client: TestClient) -> None:
    response = client.post(
        "/api/v1/campaign/upload",
        files={"file": ("contacts.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400


def test_create_campaign_validates_agent(client: TestClient) -> None:
    with patch(
        "app.routers.campaign.agent_service.get_agent",
        side_effect=AgentNotFoundError("missing"),
    ):
        response = client.post(
            "/api/v1/campaign/create",
            json={
                "name": "Camp",
                "agent_id": "missing",
                "source_id": "campaigns/org-1/x.csv",
            },
        )
    assert response.status_code == 404


def test_create_campaign_stores_obd_config(client: TestClient) -> None:
    captured: dict[str, Any] = {}

    def _create(doc: dict[str, Any]) -> dict[str, Any]:
        captured.update(doc)
        return {
            **doc,
            "campaign_id": "camp-obd-1",
            "state": "created",
            "total_rows": 0,
            "processed_rows": 0,
            "failed_rows": 0,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }

    with (
        patch(
            "app.routers.campaign.agent_service.get_agent",
            return_value={
                "agent_id": "agent-1",
                "agent_category": "telephony",
                "telephony": {"provider": "vi"},
                "linked_phone_number": "+919876543210",
            },
        ),
        patch(
            "app.routers.campaign.phone_number_service.list_by_org",
            return_value=[],
        ),
        patch("app.routers.campaign.get_org_concurrent_limit", return_value=20),
        patch("app.routers.campaign.get_sync_service") as sync_factory,
        patch("app.routers.campaign.repo.create_campaign", side_effect=_create),
    ):
        sync_service = AsyncMock()
        sync_service.validate_source.return_value = type(
            "VR",
            (),
            {"is_valid": True, "error": None, "headers": [], "rows": []},
        )()
        sync_factory.return_value = sync_service
        response = client.post(
            "/api/v1/campaign/create",
            json={
                "name": "VI Camp",
                "agent_id": "agent-1",
                "source_id": "campaigns/org-1/x.csv",
                "obd_config": {
                    "description": "Kharif OBD",
                    "fromdate": "2026-10-15",
                    "todate": "2026-10-15",
                    "fromtime": "10:00:00",
                    "totime": "18:00:00",
                    "dialtimeout": 45,
                    "retrycount": 2,
                    "retryintervalvalue": 10,
                    "retryintervaltype": 0,
                },
            },
        )
    assert response.status_code == 201
    assert captured.get("telephony_provider") == "vi"
    assert captured.get("from_number") == "+919876543210"
    meta = captured.get("orchestrator_metadata") or {}
    assert "max_concurrency" not in meta
    obd = meta.get("obd_config")
    assert obd is not None
    assert obd["description"] == "Kharif OBD"
    assert obd["fromdate"] == "2026-10-15"
    assert obd["dialtimeout"] == 45
    assert obd["retrycount"] == 2
    assert obd["retryintervalvalue"] == 10
