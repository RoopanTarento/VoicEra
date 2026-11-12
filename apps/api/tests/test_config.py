"""Tests for app.config.Settings — currently just mongodb_uri's credential handling."""

from __future__ import annotations

from app.config import Settings


def _settings(**overrides) -> Settings:
    base = {
        "MONGODB_HOST": "localhost",
        "MONGODB_PORT": 27017,
        "MONGODB_USER": "",
        "MONGODB_PASSWORD": "",
        "MONGODB_DATABASE": "voicera",
        "MONGODB_AUTH_SOURCE": "",
        "MONGODB_AUTH_MECHANISM": "",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def test_mongodb_uri_omits_credentials_when_both_blank():
    """A no-auth local mongod has no such user — the URI must not contain a
    literal empty "{}:{}\" segment, which newer pymongo rejects outright as
    an invalid username rather than treating it as anonymous."""
    uri = _settings().mongodb_uri
    assert uri == "mongodb://localhost:27017/voicera"
    assert "@" not in uri


def test_mongodb_uri_includes_credentials_when_user_set():
    uri = _settings(MONGODB_USER="admin", MONGODB_PASSWORD="admin123").mongodb_uri
    assert uri == "mongodb://admin:admin123@localhost:27017/voicera"


def test_mongodb_uri_includes_credentials_when_only_password_set():
    """An edge case (password without a username) still needs the auth
    segment present — only "both blank" should omit it."""
    uri = _settings(MONGODB_USER="", MONGODB_PASSWORD="secret").mongodb_uri
    assert uri == "mongodb://:secret@localhost:27017/voicera"


def test_mongodb_uri_appends_auth_source_and_mechanism():
    uri = _settings(
        MONGODB_USER="admin",
        MONGODB_PASSWORD="admin123",
        MONGODB_AUTH_SOURCE="admin",
        MONGODB_AUTH_MECHANISM="SCRAM-SHA-256",
    ).mongodb_uri
    assert uri == (
        "mongodb://admin:admin123@localhost:27017/voicera"
        "?authSource=admin&authMechanism=SCRAM-SHA-256"
    )
