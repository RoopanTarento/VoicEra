"""Audit log: the record/list service, org-scoping, the Copilot's
list_recent_activity tool and its admin-only gate, and the GET /audit-log
route's own permission check.
"""

from __future__ import annotations

from typing import Any

import mongomock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database as database_module
from app.auth import get_current_user
from app.routers import audit_log as audit_log_router
from app.services import audit_log
from app.services.copilot import tools
from app.services.copilot.tools import CopilotToolError


@pytest.fixture(autouse=True)
def fake_mongo(monkeypatch: pytest.MonkeyPatch):
    client = mongomock.MongoClient()
    db = client["voicera_audit_log_test"]
    monkeypatch.setattr(database_module.mongodb, "database", db)
    monkeypatch.setattr(database_module.mongodb, "client", client)
    yield db


def _admin_user(org_id: str = "org-a") -> dict[str, Any]:
    return {"email": "admin@example.com", "org_id": org_id, "role": "admin"}


def _member_user(org_id: str = "org-a") -> dict[str, Any]:
    return {"email": "member@example.com", "org_id": org_id, "role": "member"}


def _make_client(user_factory) -> TestClient:
    app = FastAPI()
    app.include_router(audit_log_router.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = user_factory
    return TestClient(app)


def test_record_and_list_events_most_recent_first(fake_mongo):
    audit_log.record(
        "org-a",
        entity_type="agent",
        action="created",
        actor_email="alice@example.com",
        entity_id="agent-1",
        entity_name="Farmer Support",
    )
    audit_log.record(
        "org-a",
        entity_type="agent",
        action="deleted",
        actor_email="bob@example.com",
        entity_id="agent-1",
        entity_name="Farmer Support",
    )

    events = audit_log.list_events("org-a")
    assert [e["action"] for e in events] == ["deleted", "created"]
    assert events[0]["actor_email"] == "bob@example.com"


def test_list_events_scoped_to_org(fake_mongo):
    audit_log.record("org-a", entity_type="agent", action="created", actor_email="a@example.com")
    audit_log.record("org-b", entity_type="agent", action="created", actor_email="b@example.com")

    assert len(audit_log.list_events("org-a")) == 1
    assert len(audit_log.list_events("org-b")) == 1


def test_list_events_filters_by_entity_type_and_actor(fake_mongo):
    audit_log.record("org-a", entity_type="agent", action="created", actor_email="a@example.com")
    audit_log.record("org-a", entity_type="campaign", action="created", actor_email="a@example.com")
    audit_log.record("org-a", entity_type="agent", action="deleted", actor_email="c@example.com")

    assert len(audit_log.list_events("org-a", entity_type="campaign")) == 1
    assert len(audit_log.list_events("org-a", actor_email="c@example.com")) == 1


def test_record_never_raises_even_if_insert_fails(fake_mongo, monkeypatch):
    def _boom(*_a: Any, **_kw: Any) -> None:
        raise RuntimeError("db is down")

    monkeypatch.setattr(fake_mongo[audit_log.COLLECTION], "insert_one", _boom)
    result = audit_log.record("org-a", entity_type="agent", action="created", actor_email="a@example.com")
    assert result["entity_type"] == "agent"
    assert audit_log.list_events("org-a") == []


def test_copilot_tool_requires_admin_role(fake_mongo):
    audit_log.record("org-a", entity_type="agent", action="created", actor_email="a@example.com")
    with pytest.raises(CopilotToolError):
        tools.list_recent_activity("org-a", actor_role="member")


def test_copilot_tool_returns_events_for_admin(fake_mongo):
    audit_log.record(
        "org-a",
        entity_type="agent",
        action="created",
        actor_email="a@example.com",
        entity_name="Farmer Support",
    )
    result = tools.list_recent_activity("org-a", actor_role="admin")
    assert result["count"] == 1
    assert result["events"][0]["entity_name"] == "Farmer Support"


def test_route_requires_admin_role(fake_mongo):
    client = _make_client(_member_user)
    response = client.get("/api/v1/audit-log")
    assert response.status_code == 403


def test_route_returns_org_scoped_events_for_admin(fake_mongo):
    audit_log.record("org-a", entity_type="agent", action="created", actor_email="a@example.com")
    audit_log.record("org-b", entity_type="agent", action="created", actor_email="x@example.com")

    client = _make_client(_admin_user)
    response = client.get("/api/v1/audit-log")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["org_id"] == "org-a"
