"""VoicEra Secure: master keyring, per-adopter keys, AES-256-GCM, keyed hash, phone parsing."""

from __future__ import annotations

import pytest

from app.config import get_settings
from app.services.secure import crypto, tenant_keys
from app.services.secure.crypto import VaultDecryptionError, blind_index, decrypt_value, encrypt_value
from app.services.secure.keys import (
    EnvKeyProvider,
    VaultKeyError,
    generate_key,
    get_key_provider,
)
from app.services.secure.phone import InvalidPhoneNumberError, normalize_phone

NUMBER = "+919876543210"


@pytest.fixture(autouse=True)
def _db(secure_db):
    """Adopter keys are stored (wrapped) in the database."""
    yield secure_db


def test_round_trip_with_active_key(vault_env):
    enc = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    assert enc.key_version == "v1"
    assert NUMBER not in enc.ciphertext and "9876543210" not in enc.to_doc().values()
    assert decrypt_value(enc, org_id="org-a", contact_id="CNT-1") == NUMBER


def test_nonce_is_unique_per_encryption(vault_env):
    a = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    b = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    assert a.nonce != b.nonce
    assert a.ciphertext != b.ciphertext


@pytest.mark.parametrize(
    "org_id,contact_id",
    [("org-b", "CNT-1"), ("org-a", "CNT-2")],
    ids=["other-org", "other-contact"],
)
def test_ciphertext_is_bound_to_org_and_contact(vault_env, org_id, contact_id):
    enc = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    with pytest.raises(VaultDecryptionError):
        decrypt_value(enc, org_id=org_id, contact_id=contact_id)


def test_tampered_ciphertext_is_rejected(vault_env):
    doc = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1").to_doc()
    raw = bytearray(crypto._unb64(doc["ciphertext"]))
    raw[0] ^= 0x01
    doc["ciphertext"] = crypto._b64(bytes(raw))
    with pytest.raises(VaultDecryptionError):
        decrypt_value(doc, org_id="org-a", contact_id="CNT-1")


def test_missing_keys_fail_closed(monkeypatch):
    monkeypatch.setenv("SECURE_VAULT_KEYS", "")
    monkeypatch.setenv("SECURE_VAULT_INDEX_KEY", "")
    get_settings.cache_clear()
    try:
        with pytest.raises(VaultKeyError):
            encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize(
    "keys",
    ["v1:not-base64!!", "v1:" + "QUJD", "noversion", "v1:{k},v1:{k}"],
    ids=["bad-base64", "short-key", "no-version", "duplicate-version"],
)
def test_malformed_keyrings_are_rejected(keys):
    key = generate_key()
    with pytest.raises(VaultKeyError):
        EnvKeyProvider(keys.format(k=key), "v1", generate_key())


def test_optional_platform_index_key_must_differ_from_data_keys():
    key = generate_key()
    with pytest.raises(VaultKeyError):
        EnvKeyProvider(f"v1:{key}", "v1", key)


def test_active_version_must_exist():
    with pytest.raises(VaultKeyError):
        EnvKeyProvider(f"v1:{generate_key()}", "v9", generate_key())


def test_each_adopter_gets_its_own_keys(vault_env):
    a = tenant_keys.keyring("org-a")
    b = tenant_keys.keyring("org-b")
    assert a.dek("v1") != b.dek("v1")
    assert a.hmac_key() != b.hmac_key()
    assert a.dek("v1") != a.hmac_key()
    import base64

    assert a.dek("v1").hex() not in repr(a)
    assert base64.b64encode(a.dek("v1")).decode() not in repr(a)


def test_wrapped_keys_are_stored_not_raw(vault_env, secure_db):
    ring = tenant_keys.keyring("org-a")
    doc = secure_db[tenant_keys.COLLECTION].find_one({"org_id": "org-a"})
    stored = str(doc)
    import base64

    assert base64.b64encode(ring.dek("v1")).decode() not in stored
    assert doc["versions"][0]["master_version"] == "v1"


def test_wrapped_key_cannot_be_moved_to_another_adopter(vault_env, secure_db):
    tenant_keys.keyring("org-a")
    tenant_keys.keyring("org-b")
    a = secure_db[tenant_keys.COLLECTION].find_one({"org_id": "org-a"})
    secure_db[tenant_keys.COLLECTION].update_one({"org_id": "org-b"}, {"$set": {"versions": a["versions"]}})
    tenant_keys.invalidate()
    with pytest.raises(tenant_keys.TenantKeyUnavailable):
        tenant_keys.keyring("org-b")


def test_adopter_rotation_keeps_old_records_readable(vault_env):
    old = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    other = encrypt_value(NUMBER, org_id="org-b", contact_id="CNT-1")
    assert tenant_keys.add_version("org-a") == "v2"
    assert decrypt_value(old, org_id="org-a", contact_id="CNT-1") == NUMBER
    rotated = crypto.reencrypt_value(old, org_id="org-a", contact_id="CNT-1")
    assert rotated.key_version == "v2"
    assert tenant_keys.keyring("org-b").active_version == "v1"  # other adopters untouched
    assert decrypt_value(other, org_id="org-b", contact_id="CNT-1") == NUMBER


def test_destroyed_version_cannot_decrypt(vault_env):
    old = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    tenant_keys.add_version("org-a")
    assert tenant_keys.destroy_unused_versions("org-a", in_use={"v2"}) == ["v1"]
    with pytest.raises(VaultKeyError):
        decrypt_value(old, org_id="org-a", contact_id="CNT-1")


def test_master_rotation_rewraps_without_touching_data(vault_env, monkeypatch):
    enc = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    monkeypatch.setenv("SECURE_VAULT_KEYS", f"v1:{vault_env['v1']},v2:{vault_env['v2']}")
    monkeypatch.setenv("SECURE_VAULT_ACTIVE_KEY_VERSION", "v2")
    get_settings.cache_clear()
    result = tenant_keys.rewrap_all()
    assert result["rewrapped_adopters"] == 1 and result["master_version"] == "v2"
    # The old master key can now be retired.
    monkeypatch.setenv("SECURE_VAULT_KEYS", f"v2:{vault_env['v2']}")
    get_settings.cache_clear()
    tenant_keys.invalidate()
    assert decrypt_value(enc, org_id="org-a", contact_id="CNT-1") == NUMBER


def test_retiring_master_key_without_rewrap_fails_closed(vault_env, monkeypatch):
    enc = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    monkeypatch.setenv("SECURE_VAULT_KEYS", f"v2:{vault_env['v2']}")
    monkeypatch.setenv("SECURE_VAULT_ACTIVE_KEY_VERSION", "v2")
    get_settings.cache_clear()
    tenant_keys.invalidate()
    with pytest.raises(VaultKeyError):
        decrypt_value(enc, org_id="org-a", contact_id="CNT-1")


def test_suspended_adopter_keys_are_unavailable_until_reactivated(vault_env):
    enc = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    tenant_keys.set_status("org-a", "suspended")
    with pytest.raises(tenant_keys.TenantKeyUnavailable) as exc:
        decrypt_value(enc, org_id="org-a", contact_id="CNT-1")
    assert exc.value.reason == "suspended"
    tenant_keys.set_status("org-a", "active")
    assert decrypt_value(enc, org_id="org-a", contact_id="CNT-1") == NUMBER


def test_revoked_adopter_data_is_unreadable_forever(vault_env):
    enc = encrypt_value(NUMBER, org_id="org-a", contact_id="CNT-1")
    tenant_keys.revoke("org-a")
    with pytest.raises(tenant_keys.TenantKeyUnavailable):
        decrypt_value(enc, org_id="org-a", contact_id="CNT-1")
    with pytest.raises(tenant_keys.TenantKeyUnavailable):
        tenant_keys.set_status("org-a", "active")


def test_blind_index_is_keyed_and_adopter_scoped(vault_env):
    a = blind_index("org-a", NUMBER)
    assert a == blind_index("org-a", NUMBER)
    assert a != blind_index("org-b", NUMBER)
    assert crypto.blind_indexes("org-a", NUMBER) == [a]
    import hashlib

    assert a != hashlib.sha256(NUMBER.encode()).hexdigest()
    assert "9876543210" not in a


@pytest.mark.parametrize(
    "raw",
    ["+91 98765 43210", "+919876543210", "09876543210", "98765-43210", "(+91) 98765 43210"],
)
def test_normalize_phone_formats(vault_env, raw):
    assert normalize_phone(raw).e164 == NUMBER


@pytest.mark.parametrize("raw", ["", "abc", "+9198765", "12345", "+447700900123"])
def test_invalid_phone_errors_never_echo_input(vault_env, raw):
    with pytest.raises(InvalidPhoneNumberError) as exc:
        normalize_phone(raw)
    if raw:
        assert raw not in str(exc.value)


def test_normalized_phone_repr_is_masked(vault_env):
    phone = normalize_phone(NUMBER)
    assert NUMBER not in repr(phone)
    assert phone.masked == "+91 ******3210"
