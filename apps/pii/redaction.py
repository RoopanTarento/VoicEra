"""Phone-number and email masking / redaction primitives.

Two kinds of output:

* ``mask_phone("+919876543210")`` -> ``"+91 ******3210"`` — the stored display
  form (calling code plus last four digits).
* ``redact_text(...)`` rewrites every phone-like or email-like substring of a
  free-text value to its masked form, for logs and error messages.

Redaction deliberately over-matches: any run of 10-15 bare digits is treated
as a phone number (this also masks 10-digit epoch timestamps). UUID segments
and ISO dates are not matched because the patterns require the number not to
touch letters, digits or hyphens.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

# ITU calling codes that are one or two digits long; everything else is three.
_ONE_DIGIT_CODES = frozenset({"1", "7"})
_TWO_DIGIT_CODES = frozenset(
    {
        "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43",
        "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56",
        "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84",
        "86", "90", "91", "92", "93", "94", "95", "98",
    }
)

# Keys whose values are contact numbers wherever they appear in a mapping.
PHONE_LIKE_KEYS = frozenset(
    {
        "phone",
        "phone_number",
        "mobile",
        "mobile_number",
        "msisdn",
        "contact_number",
        "to",
        "from",
        "to_number",
        "from_number",
        "called_number",
        "caller_number",
        "customer_number",
    }
)

_EMAIL_RE = re.compile(r"(?<![\w.+-])([\w.+-]{1,64})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)")
# "+" form, optionally with spaces / dots / hyphens / brackets between groups.
_PLUS_PHONE_RE = re.compile(r"(?<![\w-])(?:\+|%2[Bb])\d(?:[\s.\-()]{0,2}\d){6,16}(?![\w-])")
# Bare digit runs long enough to be a national or international number.
_BARE_PHONE_RE = re.compile(r"(?<![\w.+%-])\d{10,15}(?![\w.-])")


def _digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def _split_calling_code(digits: str) -> tuple[str, str]:
    if digits[:1] in _ONE_DIGIT_CODES:
        return digits[:1], digits[1:]
    if digits[:2] in _TWO_DIGIT_CODES:
        return digits[:2], digits[2:]
    return digits[:3], digits[3:]


def mask_phone(value: Any) -> str:
    """Return the display mask for a phone number, e.g. ``+91 ******3210``.

    Input that is not plausibly a phone number (fewer than 7 digits) is fully
    masked rather than returned as-is — the raw value is never echoed.
    """
    if value is None:
        return ""
    raw = str(value).strip()
    if not raw or raw.lower() == "unknown" or "*" in raw:
        return raw  # empty, placeholder, or already masked (idempotent)
    if raw.startswith("%2B") or raw.startswith("%2b"):
        raw = "+" + raw[3:]
    digits = _digits(raw)
    if len(digits) < 7:
        return "*" * max(len(digits), 4)
    last4 = digits[-4:]
    if raw.startswith("+"):
        code, national = _split_calling_code(digits)
        hidden = max(len(national) - 4, 2)
        return f"+{code} {'*' * hidden}{last4}"
    return f"{'*' * (len(digits) - 4)}{last4}"


def mask_email(value: Any) -> str:
    """Mask an email address, keeping the first character and the domain."""
    if value is None:
        return ""
    raw = str(value).strip()
    local, sep, domain = raw.partition("@")
    if not sep or not local:
        return "***"
    return f"{local[0]}***@{domain}"


def looks_like_phone(value: Any) -> bool:
    """True when ``value`` is a string or int that is a phone number on its own."""
    if isinstance(value, bool) or value is None:
        return False
    if isinstance(value, int):
        value = str(value)
    if not isinstance(value, str):
        return False
    text = value.strip()
    return bool(_PLUS_PHONE_RE.fullmatch(text) or _BARE_PHONE_RE.fullmatch(text))


def redact_text(text: Any) -> Any:
    """Mask every phone-like and email-like substring of ``text``.

    Non-string input is returned unchanged so callers can pass log args through.
    """
    if not isinstance(text, str) or not text:
        return text
    text = _EMAIL_RE.sub(lambda m: mask_email(m.group(0)), text)
    text = _PLUS_PHONE_RE.sub(lambda m: mask_phone(m.group(0)), text)
    return _BARE_PHONE_RE.sub(lambda m: mask_phone(m.group(0)), text)


def redact_value(value: Any) -> Any:
    """Recursively redact strings inside dicts, lists and tuples."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        return {k: redact_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(redact_value(v) for v in value)
    return value


def scrub_mapping(values: Mapping[str, Any] | None) -> dict[str, Any]:
    """Copy of ``values`` with contact numbers masked.

    Keys in :data:`PHONE_LIKE_KEYS` are masked whatever their value; any other
    string value is passed through :func:`redact_text`. Non-PII variables
    (names of products, dates, retry counters) are kept so agent prompts still
    work.
    """
    if not values:
        return {}
    out: dict[str, Any] = {}
    for key, value in values.items():
        if str(key).strip().lower() in PHONE_LIKE_KEYS and value not in (None, ""):
            out[key] = mask_phone(value)
        elif "email" in str(key).lower() and isinstance(value, str) and "@" in value:
            out[key] = mask_email(value)
        else:
            out[key] = redact_value(value)
    return out
