"""AES-256-GCM field encryption and the keyed hash, under each adopter's own keys.

Keys come from :mod:`tenant_keys`: every adopter (organisation) has its own
data-encryption key and HMAC key, wrapped by the platform master key. Each
value gets a fresh 96-bit nonce, and the associated data binds the ciphertext
to its organisation and contact ID, so a ciphertext copied onto another record
or into another adopter fails authentication instead of decrypting.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.services.secure import tenant_keys

ALGORITHM = "AES-256-GCM"
_NONCE_BYTES = 12
_AAD_PREFIX = "voicera-secure:v1"


class VaultDecryptionError(RuntimeError):
    """Ciphertext failed authentication (tampered, wrong record, or wrong key)."""


@dataclass(frozen=True)
class EncryptedField:
    """Stored form of one encrypted value. Never returned by any API."""

    key_version: str
    nonce: str
    ciphertext: str

    def to_doc(self) -> dict[str, str]:
        return {
            "alg": ALGORITHM,
            "key_version": self.key_version,
            "nonce": self.nonce,
            "ciphertext": self.ciphertext,
        }

    @classmethod
    def from_doc(cls, doc: dict[str, Any]) -> "EncryptedField":
        try:
            return cls(
                key_version=str(doc["key_version"]),
                nonce=str(doc["nonce"]),
                ciphertext=str(doc["ciphertext"]),
            )
        except (KeyError, TypeError) as exc:
            raise VaultDecryptionError("Malformed encrypted field") from exc


def _aad(org_id: str, contact_id: str, field: str) -> bytes:
    return f"{_AAD_PREFIX}:{org_id}:{contact_id}:{field}".encode("utf-8")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.b64decode(data.encode("ascii"), validate=True)


def encrypt_value(
    plaintext: str,
    *,
    org_id: str,
    contact_id: str,
    field: str = "phone",
) -> EncryptedField:
    """Encrypt ``plaintext`` with the adopter's active key version."""
    ring = tenant_keys.keyring(org_id)
    version = ring.active_version
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(ring.dek(version)).encrypt(
        nonce, plaintext.encode("utf-8"), _aad(org_id, contact_id, field)
    )
    return EncryptedField(key_version=version, nonce=_b64(nonce), ciphertext=_b64(ciphertext))


def decrypt_value(
    encrypted: EncryptedField | dict[str, Any],
    *,
    org_id: str,
    contact_id: str,
    field: str = "phone",
) -> str:
    """Decrypt a value encrypted for exactly this adopter, contact and field."""
    ring = tenant_keys.keyring(org_id)
    if isinstance(encrypted, dict):
        encrypted = EncryptedField.from_doc(encrypted)
    try:
        plaintext = AESGCM(ring.dek(encrypted.key_version)).decrypt(
            _unb64(encrypted.nonce),
            _unb64(encrypted.ciphertext),
            _aad(org_id, contact_id, field),
        )
    except (InvalidTag, ValueError) as exc:
        raise VaultDecryptionError("Contact ciphertext failed authentication") from exc
    return plaintext.decode("utf-8")


def reencrypt_value(
    encrypted: EncryptedField | dict[str, Any],
    *,
    org_id: str,
    contact_id: str,
    field: str = "phone",
) -> EncryptedField:
    """Decrypt with the record's key version and re-encrypt with the active one."""
    plaintext = decrypt_value(encrypted, org_id=org_id, contact_id=contact_id, field=field)
    return encrypt_value(plaintext, org_id=org_id, contact_id=contact_id, field=field)


def blind_index(org_id: str, normalized_value: str, *, version: str | None = None) -> str:
    """Keyed hash (HMAC-SHA256) of a number under the adopter's own HMAC key.

    This is the "hash and store" value: it lets VoicEra match and de-duplicate
    numbers without decrypting anything. A plain hash is not used because the
    phone-number space is small enough to brute-force; without the adopter's
    key the hash cannot be reversed or recomputed, and the same number hashes
    differently for every adopter.
    """
    ring = tenant_keys.keyring(org_id)
    message = f"{org_id}\x1f{normalized_value}".encode("utf-8")
    return hmac.new(ring.hmac_key(version), message, hashlib.sha256).hexdigest()


def blind_indexes(org_id: str, normalized_value: str) -> list[str]:
    """The hash under every usable key version (matches records not yet rotated)."""
    ring = tenant_keys.keyring(org_id)
    return [blind_index(org_id, normalized_value, version=v) for v in ring.versions()]
