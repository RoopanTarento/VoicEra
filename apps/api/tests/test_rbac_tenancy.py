"""RBAC, multi-tenancy (adopters) and the platform admin tier, through the real app.

Uses ``app.main.app`` so the central ``authorize`` dependency runs exactly as
in production, with mongomock in place of FerretDB.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token, get_password_hash
from app.config import get_settings
from app.services.secure import contact_ingest, resolution, security_audit, tenant_keys
from app.services.secure import vault_repository as vault
from app.services.secure.resolution import ResolutionDenied, resolve_contact
from app.services.secure.service_identity import SECURE_GATEWAY_IDENTITY

ORG_A = "orga01"
ORG_B = "orgb02"
PLATFORM = "ops@voicera.example"
_PASSWORD_HASH = get_password_hash("Passw0rd!")  # bcrypt is slow; hash once


@pytest.fixture
def app_client(vault_env, secure_db, monkeypatch):
    monkeypatch.setenv("PLATFORM_ADMIN_EMAILS", PLATFORM)
    get_settings.cache_clear()
    rbac.invalidate_cache()
    resolution.rate_limiter.reset()
    import app.main as main_module

    db = secure_db
    for org_id, name in ((ORG_A, "Adopter A"), (ORG_B, "Adopter B")):
        db["Organizations"].insert_one({"org_id": org_id, "name": name, "status": "active"})
    for email, org_id, role in [
        ("owner@a.example", ORG_A, "super_admin"),
        ("admin@a.example", ORG_A, "admin"),
        ("cm@a.example", ORG_A, "campaign_manager"),
        ("builder@a.example", ORG_A, "agent_builder"),
        ("analyst@a.example", ORG_A, "analyst"),
        ("auditor@a.example", ORG_A, "auditor"),
        ("member@a.example", ORG_A, "member"),
        ("owner@b.example", ORG_B, "super_admin"),
    ]:
        db["Memberships"].insert_one({"email": email, "org_id": org_id, "role": role})
        db["Users"].update_one(
            {"email": email}, {"$set": {"email": email, "password": _PASSWORD_HASH, "default_org_id": org_id}}, upsert=True
        )
    client = TestClient(main_module.app)
    yield client
    rbac.invalidate_cache()
    get_settings.cache_clear()


def _h(email: str, org_id: str, role: str = "member") -> dict[str, str]:
    token = create_access_token({"sub": email, "email": email, "org_id": org_id, "role": role})
    return {"Authorization": f"Bearer {token}"}


def _contact(org_id: str = ORG_A, number: str = "+919876543210") -> str:
    report = contact_ingest.upload(org_id, filename="c.csv", content=f"phone_number\n{number}\n".encode(), actor_email="x")
    return contact_ingest.tokenize(org_id, report["batch_id"], actor_email="x")["contacts"][0]["contact_id"]


# --- policy coverage ---------------------------------------------------------------------


def test_every_api_route_has_an_access_policy():
    import app.main as main_module

    spec = main_module.app.openapi()
    routes = {(m.upper(), p) for p, ops in spec["paths"].items() for m in ops if p.startswith("/api/v1")}
    assert routes - set(rbac.ROUTE_POLICY) == set()
    assert set(rbac.ROUTE_POLICY) - routes == set()
    assert all(v in rbac.PERMISSIONS or v in (rbac.PUBLIC, rbac.SERVICE, rbac.AUTHENTICATED) for v in rbac.ROUTE_POLICY.values())


def test_role_catalogue_is_consistent():
    assert rbac.permissions_for("super_admin") >= rbac.permissions_for("admin")
    assert "org:delete" not in rbac.permissions_for("admin")
    assert not any(p.startswith("platform:") for r in rbac.ROLES.values() for p in r.permissions)
    assert set(rbac.ROLES) == {"super_admin", "admin", "campaign_manager", "member"}
    owner_only = {"contacts:write", "contacts:delete", "contacts:export", "campaigns:write", "calls:dial", "org:delete"}
    for role in ("admin", "campaign_manager", "member"):
        assert rbac.permissions_for(role) & owner_only == set(), role
    assert rbac.permissions_for("campaign_manager") >= {"campaigns:run", "lists:read", "recordings:read"}
    assert rbac.permissions_for("member") == {
        "agents:read", "knowledge:read", "numbers:read", "campaigns:read", "calls:read", "analytics:read", "members:read"
    }
    assert "super_admin" not in rbac.ASSIGNABLE_ROLES
    shown = {perm for group in rbac.PERMISSION_MATRIX for _, perm in group["rows"]}
    assert set(rbac.PERMISSIONS) - shown <= {"calls:update", "platform:manage"}


# --- role matrix ---------------------------------------------------------------------------------

MATRIX = [
    # (method, path, json, permission)
    ("GET", "/api/v1/secure/contacts", None, "contacts:read"),
    ("GET", "/api/v1/secure/audit", None, "audit:read"),
    ("GET", "/api/v1/audit-log", None, "audit:read"),
    ("GET", "/api/v1/secure/settings", None, "security:read"),
    ("PATCH", "/api/v1/secure/settings", {"retention_days": 30}, "security:write"),
    ("DELETE", "/api/v1/campaign/missing-campaign", None, "campaigns:write"),
    ("POST", "/api/v1/campaign/create", {}, "campaigns:write"),
    ("POST", "/api/v1/campaign/missing-campaign/start", None, "campaigns:run"),
    ("POST", "/api/v1/secure/contact-sets", {"name": "s", "all_active": True}, "contacts:write"),
    ("GET", "/api/v1/secure/contacts/export", None, "contacts:export"),
    ("GET", "/api/v1/contact-lists", None, "lists:read"),
    ("POST", "/api/v1/contact-lists", None, "contacts:write"),
    ("DELETE", "/api/v1/contact-lists/CSET-missing", None, "contacts:write"),
    ("GET", "/api/v1/secure/overview", None, "security:read"),
    ("GET", "/api/v1/secure/gateway/activity", None, "gateway:read"),
    ("POST", "/api/v1/calls/outbound", {}, "calls:dial"),
    ("POST", "/api/v1/calls/web", {}, "calls:test"),
    ("GET", "/api/v1/auth/configured", None, "integrations:read"),
    ("POST", "/api/v1/agents", {}, "agents:write"),
    ("POST", "/api/v1/members/invitations", {"email": "new@a.example", "role": "member"}, "members:write"),
    ("POST", "/api/v1/copilot/conversations/x/truncate", {}, "copilot:use"),
    ("GET", "/api/v1/calls/missing-call/metrics", None, "telemetry:read"),
    ("GET", "/api/v1/calls/missing-call/transcript", None, "recordings:read"),
]
ROLE_EMAILS = {
    "super_admin": "owner@a.example",
    "admin": "admin@a.example",
    "campaign_manager": "cm@a.example",
    "member": "member@a.example",
}


@pytest.mark.parametrize("role", list(ROLE_EMAILS))
@pytest.mark.parametrize("method,path,body,permission", MATRIX, ids=[f"{m} {p}" for m, p, _, _ in MATRIX])
def test_role_permission_matrix(app_client, role, method, path, body, permission):
    response = app_client.request(method, path, json=body, headers=_h(ROLE_EMAILS[role], ORG_A, role))
    allowed = rbac.has_permission(role, permission)
    if allowed:
        assert response.status_code != 403, response.text
    else:
        assert response.status_code == 403, response.text
        assert "does not allow" in response.json()["detail"]


def test_denials_are_audited(app_client, secure_db):
    app_client.get("/api/v1/secure/audit", headers=_h("analyst@a.example", ORG_A, "analyst"))
    event = secure_db[security_audit.COLLECTION].find_one({"action": "permission_denied"})
    assert event["actor"]["id"] == "analyst@a.example"
    assert event["metadata"]["permission"] == "audit:read"


def test_unauthenticated_and_bad_tokens_are_rejected(app_client):
    assert app_client.get("/api/v1/secure/contacts").status_code == 401
    assert app_client.get("/api/v1/secure/contacts", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert app_client.get("/health").status_code == 200


def test_role_is_read_from_membership_not_trusted_from_token(app_client, secure_db):
    # Token claims admin, but the membership says analyst.
    headers = _h("analyst@a.example", ORG_A, "admin")
    assert app_client.patch("/api/v1/secure/settings", json={"retention_days": 9}, headers=headers).status_code == 403


def test_removed_member_loses_access_immediately_after_cache(app_client, secure_db):
    headers = _h("cm@a.example", ORG_A, "campaign_manager")
    assert app_client.get("/api/v1/contact-lists", headers=headers).status_code == 200
    secure_db["Memberships"].delete_one({"email": "cm@a.example", "org_id": ORG_A})
    rbac.invalidate_cache()
    response = app_client.get("/api/v1/contact-lists", headers=headers)
    assert response.status_code == 403
    assert "no longer a member" in response.json()["detail"]


def test_token_for_another_adopter_is_refused(app_client):
    # owner@a has no membership in adopter B.
    assert app_client.get("/api/v1/secure/contacts", headers=_h("owner@a.example", ORG_B, "super_admin")).status_code == 403


def test_contacts_are_isolated_between_adopters(app_client):
    cid_b = _contact(ORG_B)
    a = _h("owner@a.example", ORG_A, "super_admin")
    assert app_client.get(f"/api/v1/secure/contacts/{cid_b}", headers=a).status_code == 404
    assert app_client.get("/api/v1/secure/contacts", headers=a).json()["total"] == 0
    with pytest.raises(ResolutionDenied):
        resolve_contact(org_id=ORG_A, contact_id=cid_b, identity=SECURE_GATEWAY_IDENTITY)


def test_rbac_me_reports_role_and_permissions(app_client):
    body = app_client.get("/api/v1/rbac/me", headers=_h("cm@a.example", ORG_A, "campaign_manager")).json()
    assert body["role"] == "campaign_manager" and body["role_label"] == "Campaign manager"
    assert "campaigns:run" in body["permissions"] and "campaigns:write" not in body["permissions"]
    assert body["platform_admin"] is False and body["adopter_status"] == "active"
    roles = app_client.get("/api/v1/rbac/roles", headers=_h("member@a.example", ORG_A)).json()
    assert [r["id"] for r in roles["roles"]] == ["super_admin", "admin", "campaign_manager", "member"]
    # Display names only; the stored ids stay the same.
    assert [r["label"] for r in roles["roles"]] == ["Super admin", "Admin", "Campaign manager", "Viewer"]
    assert [g["area"] for g in roles["matrix"]][0] == "Build"
    assert all(row["permission"] in roles["permissions"] for g in roles["matrix"] for row in g["rows"])


def test_bot_service_token_keeps_working(app_client):
    headers = _h(rbac.BOT_SERVICE_EMAIL, ORG_A, "admin")
    assert app_client.get("/api/v1/secure/contacts", headers=headers).status_code == 200


# --- member roles ----------------------------------------------------------------------------------


def test_owner_changes_roles_and_change_applies(app_client):
    owner = _h("owner@a.example", ORG_A, "super_admin")
    r = app_client.patch("/api/v1/members/role", json={"email": "member@a.example", "role": "campaign_manager"}, headers=owner)
    assert r.status_code == 200 and r.json()["previous_role"] == "member"
    after = _h("member@a.example", ORG_A, "member")
    assert app_client.post("/api/v1/secure/contact-sets", json={"name": "x", "all_active": True}, headers=after).status_code == 403


@pytest.mark.parametrize(
    "caller,target,role,expected",
    [
        ("admin@a.example", "cm@a.example", "admin", "Only the Super admin"),
        ("admin@a.example", "owner@a.example", "member", "Super admin's role"),
        ("owner@a.example", "owner@a.example", "member", "your own role"),
        ("owner@a.example", "cm@a.example", "analyst", "Unknown role"),
        ("owner@a.example", "cm@a.example", "super_admin", "Unknown role"),
        ("admin@a.example", "cm@a.example", "wizard", "Unknown role"),
    ],
)
def test_role_change_rules(app_client, caller, target, role, expected):
    caller_role = "admin" if caller.startswith("admin") else "super_admin"
    r = app_client.patch("/api/v1/members/role", json={"email": target, "role": role}, headers=_h(caller, ORG_A, caller_role))
    assert r.status_code == 400
    assert expected in r.json()["detail"]


def test_campaign_manager_cannot_manage_members(app_client):
    r = app_client.patch(
        "/api/v1/members/role", json={"email": "member@a.example", "role": "admin"}, headers=_h("cm@a.example", ORG_A, "campaign_manager")
    )
    assert r.status_code == 403


# --- platform tier and adopter lifecycle ----------------------------------------------------------


def test_only_platform_admins_reach_platform_routes(app_client):
    assert app_client.get("/api/v1/platform/adopters", headers=_h("owner@a.example", ORG_A, "super_admin")).status_code == 403
    rows = app_client.get("/api/v1/platform/adopters", headers=_h(PLATFORM, ORG_A)).json()
    assert {r["org_id"] for r in rows} == {ORG_A, ORG_B}


def test_platform_admin_gets_no_tenant_data_without_membership(app_client):
    _contact(ORG_A)
    assert app_client.get("/api/v1/secure/contacts", headers=_h(PLATFORM, ORG_A, "super_admin")).status_code == 403
    rows = app_client.get("/api/v1/platform/adopters", headers=_h(PLATFORM, ORG_A)).json()
    text = str(rows)
    assert "9876543210" not in text and "******" not in text  # counts only, no numbers at all


def test_platform_creates_adopter_with_own_keys_and_owner(app_client, secure_db):
    r = app_client.post(
        "/api/v1/platform/adopters",
        json={"name": "District Health C", "owner_email": "lead@c.example", "owner_password": "Str0ngPass!"},
        headers=_h(PLATFORM, ORG_A),
    )
    assert r.status_code == 201, r.text
    org_c = r.json()["org_id"]
    assert r.json()["keys"]["status"] == "active" and r.json()["keys"]["active_version"] == "v1"
    assert r.json()["owners"] == ["lead@c.example"]
    login = app_client.post("/api/v1/users/login", json={"email": "lead@c.example", "password": "Str0ngPass!"})
    assert login.status_code == 200
    me = app_client.get("/api/v1/rbac/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"}).json()
    assert me["org_id"] == org_c and me["role"] == "super_admin"
    assert tenant_keys.keyring(org_c).dek("v1") != tenant_keys.keyring(ORG_A).dek("v1")
    dup = app_client.post(
        "/api/v1/platform/adopters", json={"name": "District Health C", "owner_email": "x@c.example", "owner_password": "Str0ngPass!"},
        headers=_h(PLATFORM, ORG_A),
    )
    assert dup.status_code == 409


def test_suspending_an_adopter_blocks_users_keys_and_campaigns(app_client, secure_db):
    cid = _contact(ORG_A)
    secure_db["Campaigns"].insert_one({"campaign_id": "c1", "org_id": ORG_A, "state": "running", "name": "c"})
    platform = _h(PLATFORM, ORG_A)
    r = app_client.post(f"/api/v1/platform/adopters/{ORG_A}/status", json={"status": "suspended", "reason": "contract paused"}, headers=platform)
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    owner = _h("owner@a.example", ORG_A, "super_admin")
    blocked = app_client.get("/api/v1/secure/contacts", headers=owner)
    assert blocked.status_code == 403 and "suspended" in blocked.json()["detail"]
    assert secure_db["Campaigns"].find_one({"campaign_id": "c1"})["state"] == "paused"
    with pytest.raises(ResolutionDenied) as exc:
        resolve_contact(org_id=ORG_A, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY)
    assert exc.value.reason == "vault_unavailable"
    # Adopter B is unaffected.
    assert app_client.get("/api/v1/secure/contacts", headers=_h("owner@b.example", ORG_B, "super_admin")).status_code == 200
    app_client.post(f"/api/v1/platform/adopters/{ORG_A}/status", json={"status": "active"}, headers=platform)
    assert app_client.get("/api/v1/secure/contacts", headers=owner).status_code == 200
    assert resolve_contact(org_id=ORG_A, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY).reveal() == "+919876543210"


def test_platform_rotates_one_adopters_key_only(app_client):
    cid = _contact(ORG_A)
    _contact(ORG_B, "+919876543211")
    r = app_client.post(f"/api/v1/platform/adopters/{ORG_A}/rotate-key", headers=_h(PLATFORM, ORG_A))
    assert r.status_code == 200 and r.json()["active_version"] == "v2" and r.json()["rotated"] == 1
    assert tenant_keys.keyring(ORG_B).active_version == "v1"
    assert resolve_contact(org_id=ORG_A, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY).reveal() == "+919876543210"


def test_revoking_keys_requires_suspension_and_name_then_shreds(app_client, secure_db):
    cid = _contact(ORG_A)
    platform = _h(PLATFORM, ORG_A)
    url = f"/api/v1/platform/adopters/{ORG_A}/revoke-key"
    assert app_client.post(url, json={"confirm_name": "Adopter A"}, headers=platform).status_code == 409
    app_client.post(f"/api/v1/platform/adopters/{ORG_A}/status", json={"status": "suspended"}, headers=platform)
    assert app_client.post(url, json={"confirm_name": "adopter a"}, headers=platform).status_code == 400
    r = app_client.post(url, json={"confirm_name": "Adopter A"}, headers=platform)
    assert r.status_code == 200 and r.json()["status"] == "offboarded"
    record = secure_db[vault.CONTACTS].find_one({"contact_id": cid})
    assert "phone" not in record and record["status"] == "deleted"
    with pytest.raises(tenant_keys.TenantKeyUnavailable):
        tenant_keys.keyring(ORG_A)
    reactivate = app_client.post(f"/api/v1/platform/adopters/{ORG_A}/status", json={"status": "active"}, headers=platform)
    assert reactivate.status_code == 409


def test_platform_audit_lists_events_across_adopters_without_numbers(app_client):
    _contact(ORG_A)
    _contact(ORG_B, "+919876543211")
    events = app_client.get("/api/v1/platform/audit", headers=_h(PLATFORM, ORG_A)).json()
    assert {e["org_id"] for e in events} >= {ORG_A, ORG_B}
    assert "9876543210" not in str(events) and "9876543211" not in str(events)


def test_response_models_accept_every_role():
    from typing import get_args

    from app.database_init import VALID_ROLES
    from app.models.schemas import Role

    assert set(get_args(Role)) == set(rbac.ROLES) == set(VALID_ROLES)


@pytest.mark.parametrize(
    "email,expected",
    [
        ("admin@a.example", "admin"),
        ("cm@a.example", "campaign_manager"),
        ("member@a.example", "member"),
        # retired roles sign in as Member
        ("builder@a.example", "member"),
        ("analyst@a.example", "member"),
        ("auditor@a.example", "member"),
    ],
)
def test_users_sign_in_with_their_role(app_client, email, expected):
    r = app_client.post("/api/v1/users/login", json={"email": email, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == expected


def test_retired_roles_act_as_member_and_are_migrated(app_client, secure_db):
    headers = _h("auditor@a.example", ORG_A, "auditor")
    assert app_client.get("/api/v1/secure/audit", headers=headers).status_code == 403
    assert app_client.get("/api/v1/campaign/", headers=headers).status_code == 200
    assert rbac.migrate_legacy_roles() == 3
    roles = {m["email"]: m["role"] for m in secure_db["Memberships"].find({"org_id": ORG_A})}
    assert roles["builder@a.example"] == roles["analyst@a.example"] == roles["auditor@a.example"] == "member"
    assert roles["cm@a.example"] == "campaign_manager"
