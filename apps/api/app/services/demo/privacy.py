"""Mask personal details a tester volunteers (spec: "Personal details a tester
volunteers are masked in the transcript before it is shown"; guardrail G-07).

Speech-to-text writes digits in the call's own script (Kannada ೦-೯, Devanagari
०-९, ...), so detection runs on a copy with every digit mapped to ASCII, one
character for one, and the matching spans are masked in the original text.
"""

from __future__ import annotations

import re
import unicodedata

from apps.pii.redaction import redact_text

MASK = "•"

# A run of 7+ digits, allowing spaces or hyphens between them: phone numbers,
# Aadhaar (12), bank accounts and card numbers. Amounts ("₹6,000") and dates
# are shorter and use commas or slashes, so they are left alone.
_LONG_NUMBER = re.compile(r"(?<![\d])\d(?:[ \-]?\d){6,}(?![\d])")
# Short codes right after the words that ask for them.
_CODE_AFTER_WORD = re.compile(r"(?i)\b(?:otp|pin|password|cvv|upi pin)\b\D{0,12}(\d(?:[ \-]?\d){2,7})")


def _ascii_digits(text: str) -> str:
    out = []
    for ch in text:
        if ch.isdigit() and not ("0" <= ch <= "9"):
            try:
                out.append(str(unicodedata.digit(ch)))
                continue
            except (TypeError, ValueError):
                pass
        out.append(ch)
    return "".join(out)


def public_numbers(texts: list[str]) -> frozenset[str]:
    """The digit strings of published numbers (helplines on cards and contacts),
    which are never masked."""
    out = set()
    for text in texts:
        for m in _LONG_NUMBER.finditer(_ascii_digits(text or "")):
            out.add(re.sub(r"\D", "", m.group(0)))
    return frozenset(out)


def mask_personal(text: str | None, keep: frozenset[str] = frozenset()) -> str:
    """``text`` with long numbers, codes after "OTP"/"PIN" and emails masked;
    numbers in ``keep`` (published helplines) stay."""
    if not text:
        return text or ""
    flat = _ascii_digits(text)
    spans = [m.span() for m in _LONG_NUMBER.finditer(flat) if re.sub(r"\D", "", m.group(0)) not in keep]
    spans += [m.span(1) for m in _CODE_AFTER_WORD.finditer(flat)]
    if spans:
        chars = list(text)
        for start, end in spans:
            for i in range(start, end):
                if flat[i].isdigit():
                    chars[i] = MASK
        text = "".join(chars)
    if keep:
        # The shared phone redaction would hide published helplines too.
        return re.sub(r"(?<![\w.+-])([\w.+-]{1,64})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)", lambda m: f"{m.group(1)[0]}***@{m.group(2)}", text)
    masked = redact_text(text)
    return masked if isinstance(masked, str) else text
