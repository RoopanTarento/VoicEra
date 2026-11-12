"""Shared PII masking and log redaction (VoicEra Secure).

Standard library only, so the API, the voice runtime and ``apps.telephony``
can all import it without extra dependencies::

    from apps.pii import mask_phone, redact_text

Masking is for display (keeps calling code and last four digits). Redaction
is for free text such as log lines, error messages and provider responses.
"""

from apps.pii.redaction import (
    PHONE_LIKE_KEYS,
    looks_like_phone,
    mask_email,
    mask_phone,
    redact_text,
    redact_value,
    scrub_mapping,
)

__all__ = [
    "PHONE_LIKE_KEYS",
    "looks_like_phone",
    "mask_email",
    "mask_phone",
    "redact_text",
    "redact_value",
    "scrub_mapping",
]
