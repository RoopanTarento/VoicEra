"""VoicEra Secure: CSV ingest, tokenisation, vault storage, resolution and audit."""

from __future__ import annotations

import json
import threading

import pytest

from app.config import get_settings
from app.services.secure import contact_ingest, resolution, security_audit
from app.services.secure import vault_repository as vault
from app.services.secure.resolution import ResolutionDenied, resolve_contact
from app.services.secure.service_identity import (
    SECURE_GATEWAY_IDENTITY,
    ServiceIdentity,
    authenticate_service,
)
from app.services.secure.tokenization import is_contact_id

ORG = "org-a"
OTHER_ORG = "org-b"
USER = "admin@example.com"

CSV_OK = (
    "Name,Phone Number,Email,District\n"
    "Arun,+91 98765 43210,arun@example.com,Pune\n"
    "Priya,+919876543211,,Nashik\n"
    "Rahul,09876543212,not-an-email,Pune\n"
).encode()

RAW_NUMBERS = ("9876543210", "9876543211", "9876543212", "98765 43210")


def _upload(content: bytes = CSV_OK, org: str = ORG) -> dict:
    return contact_ingest.upload(org, filename="contacts.csv", content=content, actor_email=USER)


def _upload_and_tokenize(content: bytes = CSV_OK, org: str = ORG) -> dict:
    report = _upload(content, org)
    return contact_ingest.tokenize(org, report["batch_id"], actor_email=USER)


def _dump(obj) -> str:
    return json.dumps(obj, default=str)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    resolution.rate_limiter.reset()
    yield
    resolution.rate_limiter.reset()


# --- upload and validation --------------------------------------------------------


def test_valid_upload_reports_masked_rows_only(vault_env, secure_db):
    report = _upload()
    assert report["summary"] == {
        "total_rows": 3,
        "valid_rows": 3,
        "invalid_rows": 0,
        "duplicate_in_file": 0,
        "duplicate_existing": 0,
    }
    assert report["detected"]["phone"] == "phone_number"
    assert report["detected"]["name"] == "name"
    assert [r["masked_phone"] for r in report["rows"]] == [
        "+91 ******3210",
        "+91 ******3211",
        "+91 ******3212",
    ]
    assert report["rows"][2]["warning"].startswith("Email address ignored")
    text = _dump(report)
    for n in RAW_NUMBERS:
        assert n not in text


def test_upload_never_stores_plaintext(vault_env, secure_db):
    _upload()
    for name in (vault.STAGING, vault.BATCHES):
        dump = _dump(list(secure_db[name].find()))
        for n in RAW_NUMBERS:
            assert n not in dump, f"plaintext number found in {name}"


@pytest.mark.parametrize(
    "content,message",
    [
        (b"name,email\nArun,a@example.com\n", "Missing required column 'phone_number'"),
        (b"phone_number\n", "at least one contact row"),
        (b"\xff\xfe\x00bad", "not UTF-8"),
    ],
)
def test_invalid_files_are_rejected(vault_env, secure_db, content, message):
    with pytest.raises(contact_ingest.ContactFileError) as exc:
        _upload(content)
    assert message in str(exc.value)


def test_invalid_rows_are_reported_without_echoing_input(vault_env, secure_db):
    content = b"phone_number,name\n12345,Short\n,Empty\n+919876543210,Ok\nabcdefghij,Letters\n"
    report = _upload(content)
    statuses = {r["row"]: r["status"] for r in report["rows"]}
    assert statuses == {2: "invalid", 3: "invalid", 4: "valid", 5: "invalid"}
    assert "12345" not in _dump(report["issues"])
    assert "abcdefghij" not in _dump(report["issues"])


def test_duplicates_in_file_and_in_vault(vault_env, secure_db):
    content = b"phone_number\n+919876543210\n+91 98765 43210\n9876543210\n+919876543211\n"
    report = _upload(content)
    assert report["summary"]["valid_rows"] == 2
    assert report["summary"]["duplicate_in_file"] == 2
    assert report["rows"][1]["reason"] == "Same number as row 2"
    contact_ingest.tokenize(ORG, report["batch_id"], actor_email=USER)

    second = _upload(b"phone_number\n+919876543210\n+919876543299\n")
    assert second["summary"]["duplicate_existing"] == 1
    assert is_contact_id(second["rows"][0]["existing_contact_id"])
    result = contact_ingest.tokenize(ORG, second["batch_id"], actor_email=USER)
    assert result["created"] == 1


def test_same_number_in_two_orgs_is_not_a_duplicate(vault_env, secure_db):
    _upload_and_tokenize(b"phone_number\n+919876543210\n", ORG)
    report = _upload(b"phone_number\n+919876543210\n", OTHER_ORG)
    assert report["summary"]["valid_rows"] == 1


# --- tokenisation and storage -----------------------------------------------------------


def test_tokenize_creates_unique_opaque_ids(vault_env, secure_db):
    result = _upload_and_tokenize()
    assert result["created"] == 3
    ids = [c["contact_id"] for c in result["contacts"]]
    assert len(set(ids)) == 3
    assert all(is_contact_id(i) for i in ids)
    for i in ids:
        for n in RAW_NUMBERS:
            assert n not in i
    assert secure_db[vault.STAGING].count_documents({}) == 0


def test_numbers_are_encrypted_at_rest(vault_env, secure_db):
    _upload_and_tokenize()
    docs = list(secure_db[vault.CONTACTS].find())
    assert len(docs) == 3
    for doc in docs:
        assert doc["phone"]["alg"] == "AES-256-GCM"
        assert doc["key_version"] == "v1"
        assert len(doc["phone_index"]) == 64
    dump = _dump(docs)
    for n in RAW_NUMBERS + ("arun@example.com",):
        assert n not in dump


def test_safe_views_never_include_ciphertext(vault_env, secure_db):
    result = _upload_and_tokenize()
    cid = result["contacts"][0]["contact_id"]
    view = vault.get_contact(ORG, cid)
    listed, total = vault.list_contacts(ORG)
    assert total == 3
    for obj in (view, listed, result):
        text = _dump(obj)
        assert "ciphertext" not in text and "nonce" not in text and "phone_index" not in text
    assert view["encrypted"] is True


def test_tokenize_twice_is_rejected(vault_env, secure_db):
    report = _upload()
    contact_ingest.tokenize(ORG, report["batch_id"], actor_email=USER)
    with pytest.raises(contact_ingest.BatchStateError):
        contact_ingest.tokenize(ORG, report["batch_id"], actor_email=USER)


def test_batch_is_org_scoped(vault_env, secure_db):
    report = _upload()
    with pytest.raises(contact_ingest.BatchNotFoundError):
        contact_ingest.tokenize(OTHER_ORG, report["batch_id"], actor_email=USER)


def test_list_search_by_name_last_digits_and_id(vault_env, secure_db):
    result = _upload_and_tokenize()
    assert vault.list_contacts(ORG, search="pri")[1] == 1
    assert vault.list_contacts(ORG, search="3212")[1] == 1
    cid = result["contacts"][0]["contact_id"]
    assert vault.list_contacts(ORG, search=cid[:12])[1] == 1
    assert vault.list_contacts(OTHER_ORG)[1] == 0


# --- resolution -----------------------------------------------------------------------------


def _first_contact(**kwargs) -> str:
    return _upload_and_tokenize(**kwargs)["contacts"][0]["contact_id"]


def test_authorised_resolution_returns_masked_wrapper(vault_env, secure_db):
    cid = _first_contact()
    resolved = resolve_contact(org_id=ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY)
    assert resolved.reveal() == "+919876543210"
    assert "9876543210" not in repr(resolved) and "9876543210" not in f"{resolved}"
    event = secure_db[security_audit.COLLECTION].find_one({"event_type": "contact.resolve", "outcome": "success"})
    assert event["contact_id"] == cid
    assert event["actor"]["id"] == "secure-telephony-gateway"
    assert "9876543210" not in _dump(event)
    assert vault.get_contact(ORG, cid)["resolution_count"] == 1


@pytest.mark.parametrize(
    "identity,reason",
    [
        (None, "unauthenticated"),
        (ServiceIdentity("analytics", frozenset()), "scope_not_granted"),
    ],
    ids=["no-identity", "no-scope"],
)
def test_unauthorised_resolution_is_denied_and_audited(vault_env, secure_db, identity, reason):
    cid = _first_contact()
    with pytest.raises(ResolutionDenied) as exc:
        resolve_contact(org_id=ORG, contact_id=cid, identity=identity)
    assert exc.value.reason == reason
    event = secure_db[security_audit.COLLECTION].find_one({"outcome": "denied"})
    assert event["reason"] == reason


def test_cross_org_resolution_looks_like_not_found(vault_env, secure_db):
    cid = _first_contact()
    with pytest.raises(ResolutionDenied) as cross:
        resolve_contact(org_id=OTHER_ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY)
    with pytest.raises(ResolutionDenied) as missing:
        resolve_contact(org_id=ORG, contact_id="CNT-" + "0" * 32, identity=SECURE_GATEWAY_IDENTITY)
    assert cross.value.reason == missing.value.reason == "contact_not_found"
    assert cross.value.message == missing.value.message


def test_deleted_and_inactive_contacts_cannot_be_resolved(vault_env, secure_db):
    result = _upload_and_tokenize()
    deleted, inactive = (c["contact_id"] for c in result["contacts"][:2])
    vault.erase_contact(ORG, deleted)
    vault.set_status(ORG, inactive, "inactive")
    raw = secure_db[vault.CONTACTS].find_one({"contact_id": deleted})
    assert "phone" not in raw and raw["status"] == "deleted"
    with pytest.raises(ResolutionDenied) as d:
        resolve_contact(org_id=ORG, contact_id=deleted, identity=SECURE_GATEWAY_IDENTITY)
    with pytest.raises(ResolutionDenied) as i:
        resolve_contact(org_id=ORG, contact_id=inactive, identity=SECURE_GATEWAY_IDENTITY)
    assert d.value.reason == "contact_deleted"
    assert i.value.reason == "contact_inactive"
    # A deleted number can be uploaded again as a new contact.
    again = _upload(b"phone_number\n+919876543210\n")
    assert again["summary"]["valid_rows"] == 1


def test_tampered_record_fails_integrity(vault_env, secure_db):
    cid = _first_contact()
    other = secure_db[vault.CONTACTS].find_one({"contact_id": {"$ne": cid}})
    secure_db[vault.CONTACTS].update_one({"contact_id": cid}, {"$set": {"phone": other["phone"]}})
    with pytest.raises(ResolutionDenied) as exc:
        resolve_contact(org_id=ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY)
    assert exc.value.reason == "integrity_failure"


def test_rate_limit(vault_env, secure_db, monkeypatch):
    monkeypatch.setenv("SECURE_RESOLVE_RATE_LIMIT_PER_MINUTE", "2")
    get_settings.cache_clear()
    cid = _first_contact()
    resolve_contact(org_id=ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY)
    resolve_contact(org_id=ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY)
    with pytest.raises(ResolutionDenied) as exc:
        resolve_contact(org_id=ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY)
    assert exc.value.reason == "rate_limited"


def test_concurrent_resolutions(vault_env, secure_db):
    result = _upload_and_tokenize()
    ids = [c["contact_id"] for c in result["contacts"]] * 10
    outcomes: list[str] = []
    lock = threading.Lock()

    def work(cid: str) -> None:
        value = resolve_contact(org_id=ORG, contact_id=cid, identity=SECURE_GATEWAY_IDENTITY).reveal()
        with lock:
            outcomes.append(value)

    threads = [threading.Thread(target=work, args=(c,)) for c in ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(outcomes) == 30
    assert set(outcomes) == {"+919876543210", "+919876543211", "+919876543212"}
    assert secure_db[security_audit.COLLECTION].count_documents(
        {"event_type": "contact.resolve", "outcome": "success"}
    ) == 30


def test_repeated_denials_raise_one_suspicious_event(vault_env, secure_db, monkeypatch):
    monkeypatch.setenv("SECURE_DENIAL_ALERT_THRESHOLD", "3")
    get_settings.cache_clear()
    cid = _first_contact()
    for _ in range(5):
        with pytest.raises(ResolutionDenied):
            resolve_contact(org_id=ORG, contact_id=cid, identity=ServiceIdentity("probe", frozenset()))
    assert secure_db[security_audit.COLLECTION].count_documents({"event_type": "access.suspicious"}) == 1


# --- service credentials ----------------------------------------------------------------


@pytest.fixture
def dialler_secret(monkeypatch):
    secret = "k" * 40
    monkeypatch.setenv(
        "SECURE_SERVICE_CREDENTIALS",
        f"dialler|contacts:resolve:dial|{secret},reporting|contacts:resolve|{'r' * 40}",
    )
    get_settings.cache_clear()
    yield secret
    get_settings.cache_clear()


def test_service_credentials_authenticate(dialler_secret):
    identity = authenticate_service("dialler", dialler_secret)
    assert identity is not None and identity.allows("dial")
    assert not identity.in_process


@pytest.mark.parametrize(
    "service_id,secret",
    [("dialler", "wrong" * 8), ("unknown", "k" * 40), ("dialler", ""), (None, "k" * 40)],
)
def test_service_credentials_reject_bad_pairs(dialler_secret, service_id, secret):
    assert authenticate_service(service_id, secret) is None


@pytest.mark.parametrize(
    "raw",
    ["dialler|contacts:resolve:dial|short", "dialler|admin|" + "k" * 40, "missing-parts"],
    ids=["short-secret", "unknown-scope", "malformed"],
)
def test_malformed_service_credentials_authenticate_nobody(monkeypatch, raw):
    monkeypatch.setenv("SECURE_SERVICE_CREDENTIALS", raw)
    get_settings.cache_clear()
    try:
        assert authenticate_service("dialler", "k" * 40) is None
    finally:
        get_settings.cache_clear()
