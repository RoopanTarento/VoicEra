"""Ensure ``app`` and ``apps`` imports resolve when tests run from the repo root."""

from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
VOICERA_ROOT = Path(__file__).resolve().parents[3]

for path in (str(API_ROOT), str(VOICERA_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

import pytest  # noqa: E402


@pytest.fixture
def vault_env(monkeypatch: pytest.MonkeyPatch):
    """Configure a fresh two-version vault keyring (v1 active) for one test."""
    from app.config import get_settings
    from app.services.secure.keys import generate_key

    keys = {"v1": generate_key(), "v2": generate_key()}
    monkeypatch.setenv("SECURE_VAULT_KEYS", f"v1:{keys['v1']}")
    monkeypatch.setenv("SECURE_VAULT_ACTIVE_KEY_VERSION", "v1")
    monkeypatch.setenv("SECURE_VAULT_INDEX_KEY", generate_key())
    monkeypatch.setenv("SECURE_SERVICE_CREDENTIALS", "")
    get_settings.cache_clear()
    yield keys
    get_settings.cache_clear()


@pytest.fixture
def secure_db(monkeypatch: pytest.MonkeyPatch):
    """In-memory Mongo with the VoicEra Secure collections and indexes."""
    import mongomock

    from app import database as database_module
    from app.services.secure import security_audit, tenant_keys
    from app.services.secure.vault_repository import ensure_indexes

    client = mongomock.MongoClient()
    db = client["voicera_secure_test"]
    monkeypatch.setattr(database_module.mongodb, "database", db)
    monkeypatch.setattr(database_module.mongodb, "client", client)
    ensure_indexes(db)
    security_audit.ensure_indexes(db)
    tenant_keys.ensure_indexes(db)
    tenant_keys.invalidate()
    yield db
    tenant_keys.invalidate()
