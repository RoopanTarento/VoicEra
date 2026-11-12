"""VoicEra Secure end to end: mock provider, secure gateway, bulk campaigns,
retries, callback sanitisation, API routes, and masking of existing endpoints.

Runs entirely in memory (mongomock + fakeredis + the mock provider).
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import re
from typing import Any

import fakeredis.aioredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import create_access_token, get_current_user
from app.config import get_settings
from app.routers import calls as calls_router
from app.routers import campaign as campaign_router
from app.routers import secure as secure_router
from app.services import agent_service, outbound_call_service, phone_number_service
from app.services.agent_service import AgentNotFoundError
from app.services.call_concurrency import rate_limiter as redis_rate_limiter
from app.services.campaign import campaign_event_publisher
from app.services.campaign import campaign_repository as repo
from app.services.campaign.campaign_call_dispatcher import CampaignCallDispatcher
from app.services.campaign.campaign_event_protocol import RetryNeededEvent
from app.services.campaign.campaign_orchestrator import CampaignOrchestrator
from app.services.campaign.circuit_breaker import circuit_breaker
from app.services.campaign.sources.secure_contacts import SecureContactsSyncService
from app.services.copilot import tools as copilot_tools
from app.services.secure import contact_ingest, resolution, security_audit, synthetic
from app.services.secure import gateway as secure_gateway
from app.services.secure import vault_repository as vault
from apps.telephony import registered_providers, sanitize_webhook_payload
from apps.telephony.providers.mock import (
    disable_mock_provider,
    enable_mock_provider,
    outcome_for,
    set_callback_sink,
)

ORG = "org-a"
OTHER_ORG = "org-b"
AGENT = {
    "agent_id": "agent-1",
    "org_id": ORG,
    "name": "Scheme survey",
    "agent_category": "telephony",
    "telephony": {"provider": "mock"},
    "linked_phone_number": "+918000000101",
}
# Standalone numbers only: digit runs inside IDs (CNT-<hex>, UUIDs, ObjectIds) are not numbers.
RAW_PHONE = re.compile(r"(?<![\w*-])\+?91\d{10}(?![\w-])|(?<![\w*+-])[6-9]\d{9}(?![\w-])")


def _raw_numbers(text: str) -> list[str]:
    """Unmasked Indian mobile numbers in ``text`` (the org DID +918000000101 is allowed)."""
    return [m for m in RAW_PHONE.findall(text) if "8000000101" not in m]


def _dump(obj: Any) -> str:
    return json.dumps(obj, default=str)


@pytest.fixture
def stack(vault_env, secure_db, monkeypatch):
    agents = {"agent-1": dict(AGENT)}

    def get_agent(org_id: str, agent_id: str) -> dict[str, Any]:
        agent = agents.get(agent_id)
        if not agent or agent["org_id"] != org_id:
            raise AgentNotFoundError(agent_id)
        return agent

    monkeypatch.setattr(agent_service, "get_agent", get_agent)
    monkeypatch.setattr(phone_number_service, "list_by_org", lambda org_id: [])
    monkeypatch.setattr(
        outbound_call_service,
        "build_answer_urls",
        lambda org_id, agent_id, call_id=None: (
            f"https://voice.test/answer?agent_id={agent_id}&org_id={org_id}&call_id={call_id}",
        )
        * 2,
    )
    monkeypatch.setattr(
        outbound_call_service,
        "get_provider_dial_credentials",
        lambda org_id, provider: {"auth_id": "mock", "auth_token": "mock", "base_url": "mock://local"},
    )
    monkeypatch.setenv("TELEPHONY_MOCK_CALLBACK_DELAY_SECONDS", "0")
    fake = fakeredis.aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    monkeypatch.setattr(redis_rate_limiter, "redis_client", fake)
    monkeypatch.setattr(circuit_breaker, "redis_client", fake)
    monkeypatch.setattr(
        campaign_event_publisher, "_campaign_publisher", campaign_event_publisher.CampaignEventPublisher(fake)
    )
    resolution.rate_limiter.reset()
    enable_mock_provider()
    set_callback_sink(secure_gateway.handle_provider_callback)
    yield {"agents": agents, "redis": fake, "db": secure_db}
    disable_mock_provider()
    resolution.rate_limiter.reset()


def _protect(content: bytes, org: str = ORG, synthetic_flag: bool = True) -> dict:
    report = contact_ingest.upload(
        org, filename="contacts.csv", content=content, actor_email="ops@example.com", synthetic=synthetic_flag
    )
    return contact_ingest.tokenize(org, report["batch_id"], actor_email="ops@example.com")


async def _drain() -> None:
    for _ in range(20):
        await asyncio.sleep(0)
    await asyncio.sleep(0.05)


# --- mock provider -------------------------------------------------------------------


def test_mock_provider_is_opt_in():
    disable_mock_provider()
    assert "mock" not in registered_providers()
    enable_mock_provider()
    try:
        assert "mock" in registered_providers()
    finally:
        disable_mock_provider()
    assert registered_providers() >= {"plivo", "vobiz"}


def test_mock_outcomes_are_deterministic():
    assert outcome_for("+919876543217", 1).call_status == "busy"
    assert outcome_for("+919876543217", 2).answered
    assert outcome_for("+919876543218", 3).call_status == "no-answer"
    assert outcome_for("+919876543219", 1).call_status == "failed"
    assert outcome_for("+919876543210", 1).answered


def test_sanitize_webhook_payload_masks_numbers():
    clean = sanitize_webhook_payload(
        {"From": "+918000000101", "To": "+919876543210", "CallUUID": "abc", "Event": "Hangup", "Note": "cb 9876543211"}
    )
    assert clean["To"] == "+91 ******3210"
    assert clean["From"] == "+91 ******0101"
    assert clean["CallUUID"] == "abc"
    assert "9876543211" not in clean["Note"]


# --- gateway -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gateway_call_resolves_dials_and_sanitises_callback(stack, caplog):
    caplog.set_level(logging.DEBUG)
    cid = _protect(b"name,phone_number\nArun,+919876543210\n")["contacts"][0]["contact_id"]
    result = await secure_gateway.dial_contact(ORG, "agent-1", cid, initiated_by="user:ops@example.com")
    assert result["to_number"] == "+91 ******3210"
    assert result["contact_id"] == cid
    await _drain()

    db = stack["db"]
    call = db["CallLogs"].find_one({"call_id": result["call_id"]})
    assert call["contact_id"] == cid
    assert call["to_number"] == "+91 ******3210"
    assert call["custom_variables"]["called_number"] == "+91 ******3210"
    assert call["call_response"] == "answered"
    assert call["status"] == "completed"

    types = [e["event_type"] for e in db[security_audit.COLLECTION].find({}, {"event_type": 1})]
    for expected in ("contact.resolve", "gateway.call", "callback.sanitized"):
        assert expected in types
    assert not _raw_numbers(_dump(list(db["CallLogs"].find())))
    assert not _raw_numbers(_dump(list(db[security_audit.COLLECTION].find())))
    # Raw numbers are not logged at source (before any redaction filter).
    assert not _raw_numbers("\n".join(r.getMessage() for r in caplog.records))


@pytest.mark.asyncio
async def test_gateway_refuses_synthetic_contacts_on_real_provider(stack):
    stack["agents"]["agent-1"]["telephony"] = {"provider": "plivo"}
    cid = _protect(b"phone_number\n+919876543210\n")["contacts"][0]["contact_id"]
    with pytest.raises(secure_gateway.GatewayError) as exc:
        await secure_gateway.dial_contact(ORG, "agent-1", cid, initiated_by="test")
    assert exc.value.status_code == 403
    assert stack["db"]["CallLogs"].count_documents({}) == 0
    assert stack["db"][security_audit.COLLECTION].count_documents(
        {"event_type": "contact.resolve", "outcome": "success"}
    ) == 0


@pytest.mark.asyncio
async def test_gateway_cannot_dial_deleted_or_foreign_contacts(stack):
    cid = _protect(b"phone_number\n+919876543210\n")["contacts"][0]["contact_id"]
    foreign = _protect(b"phone_number\n+919876543211\n", org=OTHER_ORG)["contacts"][0]["contact_id"]
    vault.erase_contact(ORG, cid)
    with pytest.raises(secure_gateway.GatewayError) as deleted:
        await secure_gateway.dial_contact(ORG, "agent-1", cid, initiated_by="test")
    with pytest.raises(secure_gateway.GatewayError) as cross:
        await secure_gateway.dial_contact(ORG, "agent-1", foreign, initiated_by="test")
    assert deleted.value.reason == "contact_deleted"
    assert cross.value.reason == "contact_not_found"
    assert stack["db"]["CallLogs"].count_documents({}) == 0


# --- bulk campaign ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_campaign_of_100_synthetic_contacts(stack):
    db = stack["db"]
    upload = contact_ingest.upload(
        ORG,
        filename="sample.csv",
        content=synthetic.generate_csv(100).encode(),
        actor_email="ops@example.com",
        synthetic=True,
    )
    assert upload["summary"]["total_rows"] == 100
    assert upload["summary"]["duplicate_in_file"] == 4
    assert upload["summary"]["invalid_rows"] == 3
    tokenized = contact_ingest.tokenize(ORG, upload["batch_id"], actor_email="ops@example.com")
    assert tokenized["created"] == 93

    ids = vault.all_active_contact_ids(ORG)
    vault.create_contact_set(
        {"set_id": "CSET-test", "org_id": ORG, "name": "All", "contact_ids": ids, "created_at": "2026-11-09"}
    )
    campaign = repo.create_campaign(
        {
            "org_id": ORG,
            "name": "Scheme awareness",
            "agent_id": "agent-1",
            "source_type": "secure_contacts",
            "source_id": "CSET-test",
            "rate_limit_per_second": 20,
            "retry_config": {
                "enabled": True,
                "max_retries": 2,
                "retry_delay_seconds": 0,
                "retry_on_busy": True,
                "retry_on_no_answer": False,
                "retry_on_voicemail": False,
            },
            "orchestrator_metadata": {"max_concurrency": 20},
        }
    )
    campaign_id = campaign["campaign_id"]
    assert await SecureContactsSyncService().sync_source_data(campaign_id) == 93
    repo.update_campaign(campaign_id, state="running")

    # Queue holds contact IDs only.
    queue_dump = _dump(list(db["QueuedRuns"].find()))
    assert "phone_number" not in queue_dump
    assert not _raw_numbers(queue_dump)

    retries: list[RetryNeededEvent] = []

    async def capture_retry(**kwargs):
        retries.append(RetryNeededEvent(**kwargs))

    publisher = await campaign_event_publisher.get_campaign_event_publisher()
    publisher.publish_retry_needed = capture_retry  # type: ignore[method-assign]

    dispatcher = CampaignCallDispatcher()
    total = 0
    while True:
        processed = await dispatcher.process_batch(campaign_id, batch_size=25)
        await _drain()
        if processed == 0:
            break
        total += processed
    assert total == 93

    calls = list(db["CallLogs"].find({"campaign_id": campaign_id}))
    assert len(calls) == 93
    assert all(c["contact_id"] for c in calls)
    assert all(c["call_response"] != "pending" for c in calls)
    busy = [c for c in calls if c["call_response"] == "busy"]
    assert busy, "sample should contain numbers that are busy on the first attempt"
    # Existing status processor retries 'failed' as well as enabled reasons.
    retryable = [c for c in calls if c["call_response"] in ("busy", "failed")]
    assert len(retries) == len(retryable)

    orchestrator = CampaignOrchestrator(stack["redis"])
    for event in retries:
        await orchestrator._handle_retry_event(event)
    retry_runs = list(db["QueuedRuns"].find({"retry_count": 1}))
    assert len(retry_runs) == len(retryable)
    assert all("contact_id" in r["context_variables"] and "phone_number" not in r["context_variables"] for r in retry_runs)

    while await dispatcher.process_batch(campaign_id, batch_size=25):
        await _drain()
    busy_contacts = {c["contact_id"] for c in busy}
    retried = list(db["CallLogs"].find({"campaign_id": campaign_id, "custom_variables.is_retry": True}))
    assert len(retried) == len(retryable)
    assert {c["call_response"] for c in retried if c["contact_id"] in busy_contacts} == {"answered"}
    assert {c["call_response"] for c in retried if c["contact_id"] not in busy_contacts} == {"failed"}

    bulk_events = db[security_audit.COLLECTION].count_documents({"event_type": "contact.bulk_resolve"})
    assert bulk_events >= 4
    for name in ("QueuedRuns", "CallLogs", "Campaigns", security_audit.COLLECTION, vault.CONTACTS):
        assert not _raw_numbers(_dump(list(db[name].find()))), f"raw number in {name}"


# --- HTTP API ----------------------------------------------------------------------------------


def _client(user: dict[str, Any]) -> TestClient:
    app = FastAPI()
    for r in (secure_router.router, campaign_router.router, calls_router.router):
        app.include_router(r, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


ADMIN = {"email": "admin@example.com", "org_id": ORG, "role": "admin"}
OWNER = {"email": "owner@example.com", "org_id": ORG, "role": "super_admin"}
MEMBER = {"email": "member@example.com", "org_id": ORG, "role": "member"}


def _upload_via_api(client: TestClient, content: bytes) -> dict:
    r = client.post(
        "/api/v1/secure/contacts/upload",
        files={"file": ("contacts.csv", content, "text/csv")},
        data={"synthetic": "true"},
    )
    assert r.status_code == 201, r.text
    t = client.post("/api/v1/secure/contacts/tokenize", json={"batch_id": r.json()["batch_id"]})
    assert t.status_code == 200, t.text
    return t.json()


def test_api_contact_journey_never_returns_numbers(stack):
    client = _client(OWNER)
    result = _upload_via_api(client, b"name,phone_number,email\nArun,+919876543210,arun@example.com\nPriya,+919876543211,\n")
    cid = result["contacts"][0]["contact_id"]
    bodies = [
        client.get("/api/v1/secure/contacts").text,
        client.get(f"/api/v1/secure/contacts/{cid}").text,
        client.get("/api/v1/secure/contacts/export").text,
        client.get("/api/v1/secure/overview").text,
        client.get("/api/v1/secure/audit").text,
        client.get("/api/v1/secure/settings").text,
        client.get("/api/v1/secure/campaigns").text,
    ]
    for body in bodies:
        assert not _raw_numbers(body)
        assert "arun@example.com" not in body
        assert "ciphertext" not in body
    export = list(csv.reader(io.StringIO(bodies[2])))
    assert export[0][:3] == ["contact_id", "name", "masked_phone"]
    assert export[1][2].startswith("'+91 ******")  # formula-safe and masked


def test_api_resolve_denies_users_and_bad_service_keys(stack, monkeypatch):
    secret = "s" * 40
    monkeypatch.setenv("SECURE_SERVICE_CREDENTIALS", f"dialler|contacts:resolve:dial|{secret}")
    get_settings.cache_clear()
    client = _client(OWNER)
    cid = _upload_via_api(client, b"phone_number\n+919876543210\n")["contacts"][0]["contact_id"]
    url = f"/api/v1/secure/contacts/{cid}/resolve"
    token = create_access_token({"sub": "admin@example.com", "org_id": ORG, "role": "admin"})

    as_user = client.post(url, json={"org_id": ORG}, headers={"Authorization": f"Bearer {token}"})
    bad_key = client.post(url, json={"org_id": ORG}, headers={"X-Service-Id": "dialler", "X-Service-Key": "x" * 40})
    anonymous = client.post(url, json={"org_id": ORG})
    cross_org = client.post(url, json={"org_id": OTHER_ORG}, headers={"X-Service-Id": "dialler", "X-Service-Key": secret})
    ok = client.post(url, json={"org_id": ORG}, headers={"X-Service-Id": "dialler", "X-Service-Key": secret})

    assert as_user.status_code == 403
    assert bad_key.status_code == 401
    assert anonymous.status_code == 401
    assert cross_org.status_code == 404
    assert ok.status_code == 200 and ok.json()["phone_number"] == "+919876543210"
    for denied in (as_user, bad_key, anonymous, cross_org):
        assert "9876543210" not in denied.text

    audit = client.get("/api/v1/secure/audit", params={"outcome": "denied"}).json()
    reasons = {e["reason"] for e in audit["events"]}
    assert {"unauthenticated", "Unknown service or wrong key", "No service credentials presented"} <= reasons
    assert all(e["correlation_id"] for e in audit["events"])


def test_api_member_cannot_read_audit_or_delete(stack):
    owner = _client(OWNER)
    cid = _upload_via_api(owner, b"phone_number\n+919876543210\n")["contacts"][0]["contact_id"]
    member = _client(MEMBER)
    assert member.get("/api/v1/secure/audit").status_code == 403
    assert member.delete(f"/api/v1/secure/contacts/{cid}").status_code == 403
    assert _client(ADMIN).delete(f"/api/v1/secure/contacts/{cid}").status_code == 403  # erasure is Owner only
    assert owner.delete(f"/api/v1/secure/contacts/{cid}").status_code == 200
    assert owner.get(f"/api/v1/secure/contacts/{cid}").json()["contact"]["status"] == "deleted"


def test_api_campaign_from_contact_set_and_policy(stack):
    client = _client(OWNER)
    _upload_via_api(client, b"phone_number\n+919876543210\n+919876543211\n")
    cset = client.post("/api/v1/secure/contact-sets", json={"name": "Wave 1", "all_active": True})
    assert cset.status_code == 201 and cset.json()["size"] == 2
    created = client.post(
        "/api/v1/campaign/create",
        json={"name": "Wave 1", "agent_id": "agent-1", "source_type": "secure_contacts", "source_id": cset.json()["set_id"]},
    )
    assert created.status_code == 201, created.text

    foreign_csv = client.post(
        "/api/v1/campaign/create",
        json={"name": "Steal", "agent_id": "agent-1", "source_type": "csv", "source_id": "campaigns/org-b/x.csv"},
    )
    assert foreign_csv.status_code == 404

    client.patch("/api/v1/secure/settings", json={"require_vault_campaigns": True})
    blocked = client.post(
        "/api/v1/campaign/create",
        json={"name": "Legacy", "agent_id": "agent-1", "source_type": "csv", "source_id": f"campaigns/{ORG}/x.csv"},
    )
    assert blocked.status_code == 422
    rows = client.get("/api/v1/secure/campaigns").json()["campaigns"]
    assert rows[0]["protected"] is True
    assert stack["db"][security_audit.COLLECTION].count_documents({"event_type": "config.change"}) == 1


def test_api_gateway_call(stack):
    client = _client(OWNER)
    cid = _upload_via_api(client, b"phone_number\n+919876543210\n")["contacts"][0]["contact_id"]
    with client:
        r = client.post("/api/v1/secure/gateway/calls", json={"agent_id": "agent-1", "contact_id": cid})
        assert r.status_code == 201, r.text
        assert not _raw_numbers(r.text)
        activity = client.get("/api/v1/secure/gateway/activity").json()
    assert activity["mock_enabled"] is True
    assert activity["calls"][0]["contact_id"] == cid


def test_adopter_key_rotation_endpoint(stack):
    client = _client(OWNER)
    cid = _upload_via_api(client, b"phone_number\n+919876543210\n")["contacts"][0]["contact_id"]
    db = stack["db"]
    old_index = db[vault.CONTACTS].find_one({"contact_id": cid})["phone_index"]
    result = client.post("/api/v1/secure/settings/rotate-keys").json()
    assert result["previous_version"] == "v1" and result["active_version"] == "v2"
    assert result["rotated"] == 1 and result["failed"] == 0
    assert result["destroyed_versions"] == ["v1"]
    record = db[vault.CONTACTS].find_one({"contact_id": cid})
    assert record["key_version"] == "v2" and record["phone"]["key_version"] == "v2"
    assert record["phone_index"] != old_index  # re-hashed under the new hash key
    from app.services.secure.service_identity import SECURE_GATEWAY_IDENTITY

    assert resolution.resolve_contact(org_id=ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY).reveal() == "+919876543210"
    # Duplicate detection still works after rotation.
    again = client.post(
        "/api/v1/secure/contacts/upload", files={"file": ("c.csv", b"phone_number\n+919876543210\n", "text/csv")}
    ).json()
    assert again["summary"]["duplicate_existing"] == 1
    checks = {c["id"]: c["status"] for c in client.get("/api/v1/secure/settings").json()["health"]["checks"]}
    assert checks["key_coverage"] == "pass" and checks["adopter_keys"] == "pass"


# --- existing endpoints mask legacy data ---------------------------------------------------------


def test_existing_call_endpoints_mask_legacy_plaintext(stack):
    db = stack["db"]
    legacy = {
        "call_id": "legacy-1",
        "org_id": ORG,
        "agent_id": "agent-1",
        "call_type": "outbound",
        "status": "completed",
        "call_response": "answered",
        "from_number": "+918000000101",
        "to_number": "+919876543210",
        "custom_variables": {"called_number": "+919876543210", "name": "Arun"},
        "campaign_id": "c-legacy",
        "created_at": "2026-11-01T00:00:00+00:00",
        "error_message": "Plivo API error: invalid to +919876543210",
    }
    db["CallLogs"].insert_one(dict(legacy))
    db["Organizations"].insert_one({"org_id": ORG, "name": "Org A"})
    repo.get_database()["Campaigns"].insert_one({"campaign_id": "c-legacy", "org_id": ORG, "name": "Old", "agent_id": "agent-1", "source_id": "x"})
    client = _client(ADMIN)
    single = client.get("/api/v1/calls/legacy-1").json()
    listing = client.get(f"/api/v1/calls/org/{ORG}").json()
    runs = client.get("/api/v1/campaign/c-legacy/runs").json()
    report = client.get("/api/v1/campaign/c-legacy/report").text
    copilot = copilot_tools.list_calls(ORG)
    one = copilot_tools.get_call(ORG, call_id="legacy-1")
    for obj in (single, listing, runs, report, copilot, one):
        assert not _raw_numbers(_dump(obj))
    assert single["to_number"] == "+91 ******3210"
    assert single["from_number"] == "+918000000101"  # the org's own caller ID stays visible
    assert single["custom_variables"]["name"] == "Arun"
    assert "'+91 ******3210" in report or "+91 ******3210" in report


# --- legacy migration ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_legacy_migration_protects_queued_runs_and_masks_call_logs(stack):
    from app.services.secure import migration

    db = stack["db"]
    db["Campaigns"].insert_one({"campaign_id": "legacy-c", "org_id": ORG, "name": "Old", "agent_id": "agent-1", "source_type": "csv", "source_id": f"campaigns/{ORG}/old.csv", "state": "running", "rate_limit_per_second": 5, "orchestrator_metadata": {"max_concurrency": 5}})
    db["QueuedRuns"].insert_one({"queued_run_id": "q-old", "campaign_id": "legacy-c", "source_uuid": "csv_1", "retry_count": 0, "state": "queued", "context_variables": {"phone_number": "+919876543210", "name": "Arun"}})
    db["CallLogs"].insert_one({"call_id": "old-call", "org_id": ORG, "call_type": "outbound", "to_number": "+919876543211", "from_number": "+918000000101", "custom_variables": {"called_number": "+919876543211"}})

    dry = migration.run(apply=False)
    assert dry["queued_runs"]["protected"] == 1 and dry["call_logs"]["call_logs_masked"] == 1
    assert db["QueuedRuns"].find_one({"queued_run_id": "q-old"})["context_variables"]["phone_number"] == "+919876543210"
    assert dry["legacy_csv_objects"] == [{"campaign_id": "legacy-c", "org_id": ORG, "object": f"campaigns/{ORG}/old.csv"}]

    applied = migration.run(apply=True)
    assert applied["queued_runs"]["protected"] == 1 and applied["call_logs"]["outbound_linked"] == 1
    run = db["QueuedRuns"].find_one({"queued_run_id": "q-old"})
    assert "phone_number" not in run["context_variables"] and run["context_variables"]["name"] == "Arun"
    call = db["CallLogs"].find_one({"call_id": "old-call"})
    assert call["to_number"] == "+91 ******3211" and call["contact_id"]
    assert not _raw_numbers(_dump(list(db["QueuedRuns"].find())) + _dump(list(db["CallLogs"].find())))

    # The migrated run dials through the gateway like any vault contact.
    campaign = db["Campaigns"].find_one({"campaign_id": "legacy-c"})
    assert await CampaignCallDispatcher().process_batch("legacy-c", batch_size=5) == 1
    await _drain()
    dialled = db["CallLogs"].find_one({"campaign_id": "legacy-c"})
    assert dialled["contact_id"] == run["context_variables"]["contact_id"]
    assert campaign["org_id"] == ORG
    assert migration.run(apply=True)["queued_runs"]["queued_runs_with_numbers"] == 0
