"""Opaque contact identifiers.

A contact ID is ``CNT-`` followed by 128 random bits in hex, drawn from the
OS CSPRNG. Nothing in it is derived from the phone number, so it cannot be
reversed; the only link back to the number is the vault record, which holds
ciphertext. Uniqueness is enforced by the vault's unique index, and the
1-in-2^128 collision case is retried by the repository.
"""

from __future__ import annotations

import re
import secrets

CONTACT_ID_PREFIX = "CNT-"
CONTACT_SET_PREFIX = "CSET-"
_CONTACT_ID_RE = re.compile(r"^CNT-[0-9a-f]{32}$")


def generate_contact_id() -> str:
    return f"{CONTACT_ID_PREFIX}{secrets.token_hex(16)}"


def generate_contact_set_id() -> str:
    return f"{CONTACT_SET_PREFIX}{secrets.token_hex(12)}"


def generate_batch_id() -> str:
    return f"BATCH-{secrets.token_hex(12)}"


def is_contact_id(value: str | None) -> bool:
    return bool(value and _CONTACT_ID_RE.match(value))
