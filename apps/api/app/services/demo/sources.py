"""Q2 "Upload documents" and "Paste a link": the builder's own sources as
session-only cards (spec: "their text becomes session-only cards, deleted when
the session ends").

Cards are stored in ``DemoSessionSources`` with a TTL index, so they disappear
on their own after the session; nothing else keeps their text.

Link fetching is locked down, because the server fetches whatever a visitor
pastes: http(s) only on ports 80/443, the host must resolve only to public
addresses, the request connects to the checked address itself (so DNS can't
be switched underneath it), every redirect is checked the same way, and the
response is capped in time and size.
"""

from __future__ import annotations

import asyncio
import html
import ipaddress
import re
import secrets
import socket
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from app.config import settings
from app.database import get_database

COLLECTION = "DemoSessionSources"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
FETCH_TIMEOUT = 8.0
MAX_CARDS_PER_SOURCE = 12
CARD_CHARS = 450
UPLOAD_TYPES = (".pdf", ".docx", ".txt")

_indexes_ready = False


class SourceError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _collection():
    global _indexes_ready
    col = get_database()[COLLECTION]
    if not _indexes_ready:
        col.create_index("source_id", name="source_id_unique", unique=True)
        col.create_index("expires_at", name="expires_ttl", expireAfterSeconds=0)
        _indexes_ready = True
    return col


# --- text → cards ----------------------------------------------------------------------------


def _chunks(text: str) -> list[str]:
    """Paragraph-sized pieces of about CARD_CHARS characters, cut at sentence ends."""
    text = re.sub(r"\[(?:Page|Slide) \d+\]", "\n\n", text)
    paragraphs = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    out: list[str] = []
    buf = ""
    for p in (p for p in paragraphs if len(p) > 20):
        if len(buf) + len(p) + 1 <= CARD_CHARS:
            buf = f"{buf} {p}".strip()
            continue
        if buf:
            out.append(buf)
        while len(p) > CARD_CHARS:
            cut = max(p.rfind(". ", 0, CARD_CHARS), p.rfind("? ", 0, CARD_CHARS))
            cut = cut + 1 if cut > CARD_CHARS // 3 else CARD_CHARS
            out.append(p[:cut].strip())
            p = p[cut:].strip()
        buf = p
        if len(out) >= MAX_CARDS_PER_SOURCE:
            break
    if buf and len(out) < MAX_CARDS_PER_SOURCE:
        out.append(buf)
    return out[:MAX_CARDS_PER_SOURCE]


def _title(chunk: str) -> str:
    first = re.split(r"(?<=[.?!:])\s", chunk, maxsplit=1)[0]
    words = first.split()
    return " ".join(words[:9]) + ("…" if len(words) > 9 else "")


def _store(kind: str, name: str, text: str) -> dict[str, Any]:
    chunks = _chunks(text)
    if not chunks:
        raise SourceError("No readable text found there.")
    source_id = secrets.token_urlsafe(9)
    tag = re.sub(r"[^A-Za-z0-9]", "", source_id)[:4].upper()
    cards = [
        {
            "card_id": f"U-{tag}-{i}",
            "status": "Uploaded",
            "title": _title(chunk),
            "who_its_for": "",
            "answer": chunk,
            "steps": "",
            "documents": "",
            "fee_and_time": "",
            "where_to_go": "",
            "type": "Uploaded",
        }
        for i, chunk in enumerate(chunks, start=1)
    ]
    now = datetime.now(timezone.utc)
    _collection().insert_one(
        {
            "source_id": source_id,
            "kind": kind,
            "name": name[:120],
            "cards": cards,
            "created_at": now,
            "expires_at": now + timedelta(minutes=settings.TRY_AGENT_TTL_MINUTES * 2),
        }
    )
    return {"source_id": source_id, "kind": kind, "name": name[:120], "card_count": len(cards), "titles": [c["title"] for c in cards[:3]]}


def cards_for(source_ids: list[str]) -> list[dict[str, Any]]:
    """The session cards of these sources (unknown or expired ones raise)."""
    ids = [s for s in dict.fromkeys(source_ids or []) if isinstance(s, str)][:3]
    if not ids:
        return []
    now = datetime.now(timezone.utc)
    docs = {d["source_id"]: d for d in _collection().find({"source_id": {"$in": ids}}, {"_id": 0})}
    out: list[dict[str, Any]] = []
    for sid in ids:
        doc = docs.get(sid)
        expires = doc.get("expires_at") if doc else None
        if expires and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if not doc or (expires and expires < now):
            raise SourceError("An added document has expired. Add it again.", status_code=404)
        out.extend(doc["cards"])
    return out


# --- uploads ---------------------------------------------------------------------------------


def from_upload(filename: str, data: bytes) -> dict[str, Any]:
    from app.services.copilot.documents import DocumentError, extract_text

    name = (filename or "document").strip()
    if not name.lower().endswith(UPLOAD_TYPES):
        raise SourceError("Upload a PDF, Word (.docx) or text file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise SourceError("Keep the file under 5 MB.")
    try:
        text = extract_text(name, data)
    except DocumentError as exc:
        raise SourceError(str(exc)) from exc
    return _store("upload", name, text)


# --- links -----------------------------------------------------------------------------------


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "nav", "footer", "header", "svg", "form", "aside"}
    BLOCK = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "tr", "section", "article", "td"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in self.SKIP:
            self.skip += 1
        if tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.parts.append("\n\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.parts.append(data)


def _public_address(host: str, port: int) -> str:
    """One public IP for ``host``; refuses if any address it resolves to isn't public."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SourceError("That link's address couldn't be found.") from exc
    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise SourceError("That link's address couldn't be found.")
    for a in addresses:
        ip = ipaddress.ip_address(a.split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise SourceError("That link points to a private address. Paste a public web page.")
    return sorted(addresses)[0]


def _checked(url: str) -> tuple[str, str, int, str]:
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise SourceError("Paste a full web address starting with https://")
    if parts.username or parts.password:
        raise SourceError("Paste the page's address without a login in it.")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if port not in (80, 443):
        raise SourceError("Paste a normal web page address.")
    return parts.scheme, parts.hostname, port, url.strip()


async def _fetch(url: str) -> tuple[str, str, bytes]:
    """(final url, content type, body) fetched by checked IP, following checked redirects."""
    for _ in range(MAX_REDIRECTS + 1):
        scheme, host, port, url = _checked(url)
        ip = await asyncio.to_thread(_public_address, host, port)
        parts = urlsplit(url)
        netloc = f"[{ip}]" if ":" in ip else ip
        target = parts._replace(netloc=f"{netloc}:{port}").geturl()
        extensions = {"sni_hostname": host} if scheme == "https" else {}
        headers = {"Host": host if port in (80, 443) else f"{host}:{port}", "User-Agent": "VoicEra-demo/1.0", "Accept": "text/html,text/plain,application/pdf"}
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=False, trust_env=False) as client:
            async with client.stream("GET", target, headers=headers, extensions=extensions) as resp:
                if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                    url = urljoin(url, resp.headers["location"])
                    continue
                if resp.status_code >= 400:
                    raise SourceError(f"That page answered with an error ({resp.status_code}).")
                body = b""
                async for chunk in resp.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_PAGE_BYTES:
                        raise SourceError("That page is too large to read. Upload the document instead.")
                return url, resp.headers.get("content-type", "").lower(), body
    raise SourceError("That link redirects too many times.")


async def from_link(url: str) -> dict[str, Any]:
    try:
        final, kind, body = await _fetch(url)
    except SourceError:
        raise
    except httpx.HTTPError as exc:
        raise SourceError("That page couldn't be reached. Check the link, or upload the document.") from exc
    if "pdf" in kind or final.lower().endswith(".pdf"):
        return from_upload("linked-document.pdf", body) | {"kind": "link", "name": final[:120]}
    if not any(t in kind for t in ("text/html", "text/plain", "application/xhtml")):
        raise SourceError("That link isn't a web page or PDF.")
    text = body.decode("utf-8", errors="replace")
    if "html" in kind or "<html" in text[:500].lower():
        parser = _Text()
        parser.feed(text)
        name = html.unescape(parser.title.strip()) or final
        text = "".join(parser.parts)
    else:
        name = final
    return _store("link", name, text)
