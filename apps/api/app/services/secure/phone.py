"""Contact phone-number validation and E.164 normalisation (libphonenumber)."""

from __future__ import annotations

from dataclasses import dataclass

import phonenumbers

from app.config import get_settings
from apps.pii import mask_phone


class InvalidPhoneNumberError(ValueError):
    """Raised for unusable input. The message never contains the input."""


@dataclass(frozen=True)
class NormalizedPhone:
    e164: str
    country_code: int
    region: str | None

    @property
    def masked(self) -> str:
        return mask_phone(self.e164)

    def __repr__(self) -> str:  # keep raw numbers out of reprs and logs
        return f"NormalizedPhone(masked={self.masked!r}, region={self.region!r})"

    __str__ = __repr__


def normalize_phone(raw: str | None, *, default_region: str | None = None) -> NormalizedPhone:
    """Parse ``raw`` to E.164. Numbers without ``+`` use ``default_region``."""
    value = (raw or "").strip()
    if not value:
        raise InvalidPhoneNumberError("Phone number is empty")
    region = (default_region or get_settings().SECURE_DEFAULT_REGION or "IN").upper()
    try:
        parsed = phonenumbers.parse(value, None if value.startswith("+") else region)
    except phonenumbers.NumberParseException as exc:
        raise InvalidPhoneNumberError("Phone number could not be parsed") from exc
    if not phonenumbers.is_possible_number(parsed):
        raise InvalidPhoneNumberError("Phone number has the wrong length")
    if not phonenumbers.is_valid_number(parsed):
        raise InvalidPhoneNumberError("Phone number is not a valid number for its region")
    return NormalizedPhone(
        e164=phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164),
        country_code=int(parsed.country_code),
        region=phonenumbers.region_code_for_number(parsed),
    )
