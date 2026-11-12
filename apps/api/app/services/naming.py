"""Standard names for things people name (campaigns, contact lists) and files.

One set of rules everywhere, so lists and reports stay easy to find and sort:

* **Display names** (:func:`clean_name`): spaces trimmed and collapsed, 3 to 80
  characters, letters and digits in any script plus a few separators
  (space - – — _ . , & ( ) / : ' # +). No emoji, quotes or control characters,
  which break CSV exports and file names. Unique per organisation, ignoring
  case (:func:`ensure_unique`), with a free alternative suggested.
* **Copies** (:func:`copy_name`): "Ward 12 drive (copy)", then "(copy 2)",
  "(copy 3)"; a copy of a copy doesn't stack suffixes.
* **Uploaded files** (:func:`safe_filename`): never trusted as given. The
  stored name is lower-case, hyphen-separated, with its extension kept, e.g.
  "Ward 12 – Wave 1 (final).XLSX" becomes "ward-12-wave-1-final.xlsx".
* **Downloads** (:func:`download_name`): ``voicera_<subject>_<kind>_<YYYY-MM-DD>.<ext>``.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Iterable

NAME_MIN = 3
NAME_MAX = 80
ALLOWED_PUNCTUATION = " -–—_.,&()/:'#+"
ALLOWED_TEXT = "letters, numbers, spaces and - – _ . , & ( ) / : ' # +"
_COPY_SUFFIX = re.compile(r"\s*\(copy(?: (\d+))?\)$", re.IGNORECASE)
_NUMBER_SUFFIX = re.compile(r"\s*\((\d+)\)$")


class NameError_(ValueError):
    """A name that breaks the rules; the message says how to fix it."""

    def __init__(self, message: str, status_code: int = 400, suggestion: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.suggestion = suggestion


def _allowed(ch: str) -> bool:
    if ch in ALLOWED_PUNCTUATION:
        return True
    category = unicodedata.category(ch)
    # Letters (L*), digits (Nd), and combining marks (M*) so Indic scripts work.
    return category[0] in ("L", "M") or category == "Nd"


def clean_name(value: str | None, *, what: str = "campaign") -> str:
    """The name in its standard form, or :class:`NameError_` saying what to change."""
    name = " ".join(unicodedata.normalize("NFC", str(value or "")).split())
    if not name:
        raise NameError_(f"Give the {what} a name.")
    if len(name) < NAME_MIN:
        raise NameError_(f"Use at least {NAME_MIN} characters for the {what} name.")
    if len(name) > NAME_MAX:
        raise NameError_(f"Keep the {what} name to {NAME_MAX} characters (it has {len(name)}).")
    bad = sorted({ch for ch in name if not _allowed(ch)})
    if bad:
        shown = " ".join(bad[:5])
        raise NameError_(f"The {what} name can't contain {shown}. Use {ALLOWED_TEXT}.")
    return name


def _base(name: str) -> str:
    return _COPY_SUFFIX.sub("", _NUMBER_SUFFIX.sub("", name)).strip()


def _fit(base: str, suffix: str) -> str:
    room = NAME_MAX - len(suffix)
    return (base[:room].rstrip() if len(base) > room else base) + suffix


def next_free(name: str, existing: Iterable[str]) -> str:
    """``name`` if free, otherwise "name (2)", "name (3)" … (ignoring case)."""
    taken = {e.casefold() for e in existing}
    if name.casefold() not in taken:
        return name
    base = _base(name)
    n = 2
    while True:
        candidate = _fit(base, f" ({n})")
        if candidate.casefold() not in taken:
            return candidate
        n += 1


def copy_name(name: str, existing: Iterable[str]) -> str:
    """The name for a duplicate: "X (copy)", then "X (copy 2)", "X (copy 3)" …"""
    taken = {e.casefold() for e in existing}
    base = _COPY_SUFFIX.sub("", name).strip() or name
    candidate = _fit(base, " (copy)")
    n = 2
    while candidate.casefold() in taken:
        candidate = _fit(base, f" (copy {n})")
        n += 1
    return candidate


def ensure_unique(name: str, existing: Iterable[str], *, what: str = "campaign") -> str:
    """``name`` if no other has it (ignoring case); otherwise a 409 suggesting a free one."""
    existing = list(existing)
    if name.casefold() in {e.casefold() for e in existing}:
        suggestion = next_free(name, existing)
        raise NameError_(
            f"A {what} called \"{name}\" already exists. Try \"{suggestion}\".", status_code=409, suggestion=suggestion
        )
    return name


def slug(value: str, *, max_len: int = 60) -> str:
    """Lower-case, hyphen-separated slug; letters in any script (with their marks) are kept."""
    text = unicodedata.normalize("NFKC", str(value or "")).casefold()
    text = "".join(ch if ch.isalnum() or unicodedata.category(ch)[0] == "M" else "-" for ch in text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:max_len].rstrip("-")


def safe_filename(original: str | None, *, default_stem: str = "upload") -> str:
    """A standard stored name for an uploaded file: "ward-12-wave-1.xlsx"."""
    name = str(original or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    ext = re.sub(r"[^a-z0-9]", "", ext.casefold())[:8]
    clean = slug(stem, max_len=80) or default_stem
    return f"{clean}.{ext}" if ext else clean


def download_name(subject: str, kind: str, ext: str, *, on: date | None = None) -> str:
    """``voicera_<subject>_<kind>_<YYYY-MM-DD>.<ext>`` for files VoicEra generates."""
    day = (on or date.today()).isoformat()
    return f"voicera_{slug(subject, max_len=50) or 'export'}_{slug(kind, max_len=30)}_{day}.{ext}"
