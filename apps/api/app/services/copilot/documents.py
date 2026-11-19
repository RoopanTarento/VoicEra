"""Text out of the documents people attach to an Agent Builder message.

PDFs go through pypdf (already a dependency). Word, PowerPoint and Excel files
are read straight from their zipped XML, the same way contact lists read
.xlsx, so no new parser is needed. Text is extracted once, at upload, and kept
with the attachment. Each turn then sends the model only the parts that fit
its budget, picked by how well they match the question (build_context).
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree

# Extension -> the content type stored with the attachment. The extension is
# trusted over the browser's own type, which is often blank or generic for
# Office files.
DOCUMENT_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
}
_DOCUMENT_CONTENT_TYPES = set(DOCUMENT_TYPES.values())

MAX_TEXT_CHARS = 400_000  # roughly a 150-page report; anything past this is dropped
_CHUNK_CHARS = 1_200

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

_TERM = re.compile(r"[^\s.,;:!?()\[\]{}\"'“”‘’|/\\<>=*#`~-]{3,}")
_STOP_WORDS = {
    "the", "and", "for", "with", "that", "this", "what", "from", "are", "was", "you", "your",
    "have", "how", "can", "about", "into", "does", "which", "there", "their", "they", "will",
    "would", "should", "please", "tell", "give", "document", "documents", "file", "attached",
    "make", "use", "using", "based", "agent", "create", "build",
}


class DocumentError(ValueError):
    """The file can't be turned into text; the message is safe to show the user."""


def document_type(filename: str) -> str | None:
    """The stored content type for a supported document, or None."""
    name = (filename or "").lower()
    for ext, content_type in DOCUMENT_TYPES.items():
        if name.endswith(ext):
            return content_type
    return None


def is_document(content_type: str | None) -> bool:
    return (content_type or "") in _DOCUMENT_CONTENT_TYPES


def extract_text(filename: str, data: bytes) -> str:
    """All readable text in the file, with [Page n] / [Slide n] markers where
    the format has pages, so the model can say where an answer came from."""
    name = (filename or "").lower()
    try:
        if name.endswith(".pdf"):
            text = _pdf_text(data)
        elif name.endswith(".docx"):
            text = _docx_text(data)
        elif name.endswith(".pptx"):
            text = _pptx_text(data)
        elif name.endswith(".xlsx"):
            text = _xlsx_text(data)
        else:
            text = data.decode("utf-8-sig", errors="replace")
    except DocumentError:
        raise
    except Exception as exc:
        raise DocumentError(f"{filename} couldn't be read. Check it opens normally, or save it as PDF and try again.") from exc

    text = _tidy(text)
    if not text:
        hint = " It looks like a scanned PDF; attach it as an image or a text-based PDF instead." if name.endswith(".pdf") else ""
        raise DocumentError(f"No text found in {filename}.{hint}")
    return text[:MAX_TEXT_CHARS]


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted and not reader.decrypt(""):
        raise DocumentError("That PDF is password-protected. Remove the password and attach it again.")
    pages = []
    for number, page in enumerate(reader.pages, start=1):
        raw = (page.extract_text() or "").strip()
        if raw:
            pages.append(f"[Page {number}]\n{raw}")
    return "\n\n".join(pages)


def _docx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as book:
        root = ElementTree.fromstring(book.read("word/document.xml"))
    paragraphs = ("".join(t.text or "" for t in p.iter(f"{_W}t")) for p in root.iter(f"{_W}p"))
    return "\n\n".join(p for p in paragraphs if p.strip())


def _pptx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as book:
        slide_names = [n for n in book.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
        slide_names.sort(key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)))  # type: ignore[union-attr]
        slides = []
        for number, slide_name in enumerate(slide_names, start=1):
            root = ElementTree.fromstring(book.read(slide_name))
            lines = ("".join(t.text or "" for t in p.iter(f"{_A}t")) for p in root.iter(f"{_A}p"))
            body = "\n".join(line for line in lines if line.strip())
            if body:
                slides.append(f"[Slide {number}]\n{body}")
    return "\n\n".join(slides)


def _xlsx_text(data: bytes) -> str:
    # Same reader contact lists use: first worksheet, cells as text.
    from app.services.secure.contact_lists import _read_xlsx

    return "\n".join(" | ".join(cell for cell in row) for row in _read_xlsx(data))


def _tidy(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _chunks(text: str) -> list[str]:
    """Paragraph-aligned pieces of about _CHUNK_CHARS each."""
    chunks: list[str] = []
    current = ""
    for paragraph in text.split("\n\n"):
        while len(paragraph) > _CHUNK_CHARS:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(paragraph[:_CHUNK_CHARS])
            paragraph = paragraph[_CHUNK_CHARS:]
        if current and len(current) + len(paragraph) + 2 > _CHUNK_CHARS:
            chunks.append(current)
            current = ""
        current = f"{current}\n\n{paragraph}" if current else paragraph
    if current:
        chunks.append(current)
    return chunks


def _terms(text: str) -> set[str]:
    return {t for t in (m.lower() for m in _TERM.findall(text or "")) if t not in _STOP_WORDS}


def build_context(documents: list[tuple[str, str]], question: str, budget_chars: int) -> str:
    """The text of the user's documents, cut to ``budget_chars``.

    ``documents`` is (filename, text), the most relevant document first. When
    everything fits it is sent whole; otherwise each document's opening plus
    the chunks sharing the most words with the question, kept in their
    original order with "[…]" where text was skipped.
    """
    documents = [(name, text) for name, text in documents if text]
    if not documents or budget_chars <= 0:
        return ""

    total = sum(len(text) for _, text in documents)
    picked: dict[int, list[tuple[int, str]]] = {}
    if total <= budget_chars:
        picked = {i: [(0, text)] for i, (_, text) in enumerate(documents)}
    else:
        terms = _terms(question)
        candidates = []
        for doc_index, (name, text) in enumerate(documents):
            named = 1.0 if terms & _terms(name.rsplit(".", 1)[0].replace("_", " ")) else 0.0
            for chunk_index, chunk in enumerate(_chunks(text)):
                lowered = chunk.lower()
                score = sum(lowered.count(term) for term in terms) + named + (0.5 if chunk_index == 0 else 0.0)
                candidates.append((score, -doc_index, -chunk_index, doc_index, chunk_index, chunk))
        candidates.sort(reverse=True)
        used = 0
        for _score, _d, _c, doc_index, chunk_index, chunk in candidates:
            if used + len(chunk) > budget_chars:
                continue
            picked.setdefault(doc_index, []).append((chunk_index, chunk))
            used += len(chunk)

    sections = []
    for doc_index, (name, text) in enumerate(documents):
        parts = sorted(picked.get(doc_index, []))
        if not parts:
            sections.append(f'=== "{name}" ===\n(Not included this turn; ask about it by name to bring it in.)')
            continue
        whole = len(parts) == 1 and parts[0][1] == text
        body = ""
        previous = -1
        for chunk_index, chunk in parts:
            if previous >= 0 and chunk_index != previous + 1:
                body += "\n\n[…]\n\n"
            elif previous >= 0:
                body += "\n\n"
            body += chunk
            previous = chunk_index
        label = "full text" if whole else f"excerpts; the full document is {len(text):,} characters"
        sections.append(f'=== "{name}" ({label}) ===\n{body}')

    return (
        "Documents the user attached in this chat are below. Answer from them when the "
        "question is about them, and say which page or slide you used when it's marked. "
        "If the answer isn't in the text shown, say so plainly rather than guessing. "
        "When the user wants an agent built from a document, use its real content for "
        "the agent's prompt and facts.\n\n" + "\n\n".join(sections)
    )
