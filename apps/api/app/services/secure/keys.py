"""Platform master-key management (the key-encryption keys).

The master keyring wraps every adopter's own keys (see ``tenant_keys``); it
never encrypts phone numbers directly. ``EnvKeyProvider`` reads a versioned
keyring from environment settings and is what the PoC uses. A production deployment swaps in a KMS-backed provider
(envelope encryption: a per-record data key wrapped by a KMS master key)
behind the same interface; callers never see where keys come from.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
from abc import ABC, abstractmethod
from functools import lru_cache

from app.config import get_settings

KEY_BYTES = 32


class VaultKeyError(RuntimeError):
    """Raised when vault keys are missing or malformed. Vault operations fail closed."""


class KeyProvider(ABC):
    """Source of data-encryption keys and the blind-index key."""

    name: str = "abstract"

    @property
    @abstractmethod
    def active_version(self) -> str:
        """Key version used for new encryptions."""

    @abstractmethod
    def versions(self) -> list[str]:
        """All key versions that can still decrypt."""

    @abstractmethod
    def data_key(self, version: str) -> bytes:
        """32-byte AES-256 key for ``version``; raises VaultKeyError if unknown."""

    @abstractmethod
    def index_key(self) -> bytes:
        """32-byte HMAC key for the duplicate-detection blind index."""

    def fingerprint(self, version: str) -> str:
        """Short non-reversible identifier for a key version (safe to display)."""
        return hashlib.sha256(b"voicera-key-fp" + self.data_key(version)).hexdigest()[:12]


def _decode_key(raw: str, *, label: str) -> bytes:
    value = (raw or "").strip()
    if not value:
        raise VaultKeyError(f"{label} is empty")
    padded = value + "=" * (-len(value) % 4)
    try:
        key = base64.urlsafe_b64decode(padded.encode("ascii"))
    except (binascii.Error, ValueError, UnicodeEncodeError) as exc:
        raise VaultKeyError(f"{label} is not valid urlsafe base64") from exc
    if len(key) != KEY_BYTES:
        raise VaultKeyError(f"{label} must decode to {KEY_BYTES} bytes, got {len(key)}")
    return key


def parse_keyring(raw: str) -> dict[str, bytes]:
    """Parse ``'v1:<b64>,v2:<b64>'`` into ``{"v1": key, ...}``."""
    keyring: dict[str, bytes] = {}
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        version, sep, encoded = part.partition(":")
        version = version.strip()
        if not sep or not version:
            raise VaultKeyError("SECURE_VAULT_KEYS entries must look like 'v1:<base64>'")
        if version in keyring:
            raise VaultKeyError(f"Duplicate vault key version: {version}")
        keyring[version] = _decode_key(encoded, label=f"Vault key {version}")
    if not keyring:
        raise VaultKeyError("SECURE_VAULT_KEYS is not configured")
    return keyring


class EnvKeyProvider(KeyProvider):
    """Versioned keyring from ``SECURE_VAULT_KEYS`` / ``SECURE_VAULT_ACTIVE_KEY_VERSION``."""

    name = "environment"

    def __init__(self, keys: str, active_version: str, index_key: str) -> None:
        self._keyring = parse_keyring(keys)
        active = (active_version or "").strip() or sorted(self._keyring)[-1]
        if active not in self._keyring:
            raise VaultKeyError(
                f"SECURE_VAULT_ACTIVE_KEY_VERSION '{active}' is not in SECURE_VAULT_KEYS"
            )
        self._active = active
        # Hash keys are per adopter now (tenant_keys); a platform-wide index key
        # is accepted for backward compatibility but no longer required.
        self._index_key = _decode_key(index_key, label="SECURE_VAULT_INDEX_KEY") if index_key else None
        if self._index_key is not None and self._index_key in self._keyring.values():
            raise VaultKeyError("SECURE_VAULT_INDEX_KEY must differ from every data key")

    @property
    def active_version(self) -> str:
        return self._active

    def versions(self) -> list[str]:
        return sorted(self._keyring)

    def data_key(self, version: str) -> bytes:
        try:
            return self._keyring[version]
        except KeyError as exc:
            raise VaultKeyError(f"Unknown vault key version: {version}") from exc

    def index_key(self) -> bytes:
        if self._index_key is None:
            raise VaultKeyError("SECURE_VAULT_INDEX_KEY is not configured")
        return self._index_key


@lru_cache(maxsize=4)
def _env_provider(keys: str, active: str, index_key: str) -> EnvKeyProvider:
    return EnvKeyProvider(keys, active, index_key)


def get_key_provider() -> KeyProvider:
    """Return the configured key provider (raises VaultKeyError when unusable)."""
    s = get_settings()
    return _env_provider(
        s.SECURE_VAULT_KEYS,
        s.SECURE_VAULT_ACTIVE_KEY_VERSION,
        s.SECURE_VAULT_INDEX_KEY,
    )


def generate_key() -> str:
    """Return a new urlsafe-base64 32-byte key (for setup scripts and tests)."""
    import secrets

    return base64.urlsafe_b64encode(secrets.token_bytes(KEY_BYTES)).decode("ascii")
