"""Built-in scheme knowledge packs: one per scheme, covering all six intents.

Each pack has quick facts, the six call paths, one section per intent
(awareness, discovery, enrolment, utilisation, support, feedback), what never
to do, and its sources. Packs are written only from the scheme's checked
catalogue fields (``use_cases.SCHEMES`` or an organisation's own scheme) plus,
for some schemes, extra answers checked against official releases
(``EXTRA_ANSWERS``, each with its source).

The packs are built into VoicEra rather than uploaded: nothing needs indexing,
object storage or an embedding key.

* :func:`prompt_knowledge` is the part of a pack that isn't already in the
  agent's scheme facts; ``use_cases.build_preset`` writes it into the agent's
  prompt, so every scheme agent carries its packs.
* :func:`pack_pdf` is the same pack as a PDF to read or share, served by
  ``GET /use-cases/knowledge/{scheme_id}`` and listed on the Knowledge Base page.

The PDF writer is deliberately tiny (built-in Helvetica, A4, text only) so no
PDF library is needed; pypdf reads it back.
"""

from __future__ import annotations

import re
from typing import Any

from app.services import use_cases

_PIB_SENIOR = "PIB release 2082288, 9 Dec 2024 (pib.gov.in)"
_PIB_UPDATE = "PIB release 2116209, 28 Mar 2025 (pib.gov.in)"

# Answers beyond the catalogue fields, each checked against the source given.
EXTRA_ANSWERS: dict[str, list[tuple[str, str, str]]] = {
    "pm-jay": [
        (
            "My father is over 70 and we are not poor. Can he get it?",
            "Yes. Since 29 October 2024 everyone aged 70 or above can get the Ayushman Vay Vandana card, which gives "
            "₹5 lakh free health cover a year whatever the family's income. If the family is already covered by "
            "PM-JAY, he gets an extra top-up of up to ₹5 lakh a year just for himself.",
            _PIB_SENIOR,
        ),
        (
            "He already has CGHS, ECHS or CAPF cover, or private insurance.",
            "People on CGHS, ECHS or Ayushman CAPF have to choose between that scheme and PM-JAY. People with private "
            "health insurance or ESI can still get PM-JAY.",
            _PIB_SENIOR,
        ),
        (
            "Who is in the official list?",
            "Families first identified from the 2011 Socio-Economic Caste Census, widened by many states using other "
            "lists such as NFSA ration cards; ASHA workers, Anganwadi workers and helpers and their families (added "
            "March 2024); and everyone aged 70 or above.",
            _PIB_UPDATE,
        ),
        (
            "Which hospitals accept the card?",
            "Every government hospital with in-patient beds is part of the scheme, plus listed private hospitals. The "
            "Ayushman app and the helpline 14555 can help find one nearby.",
            _PIB_UPDATE,
        ),
        (
            "I have diabetes or a heart condition. Is it covered?",
            "Conditions you already have are covered from the first day, with no waiting period. The scheme covers "
            "around 2,000 procedures; the hospital's Ayushman desk or 14555 can confirm a specific treatment.",
            f"{_PIB_SENIOR}; {_PIB_UPDATE}",
        ),
        (
            "The hospital refused me or asked me to pay.",
            "Listed hospitals can't refuse treatment to eligible patients. Complain on 14555, on the CGRMS grievance "
            "portal, by email, or by letter to the State Health Agency. Complaints are handled at district, state "
            "and national level.",
            _PIB_UPDATE,
        ),
        (
            "Is there a number to learn about the senior citizen card?",
            "Call the free helpline 14555, or give a missed call to 1800110770.",
            _PIB_SENIOR,
        ),
    ],
}


# --- content ----------------------------------------------------------------------------


def pack_blocks(scheme: dict[str, Any]) -> list[tuple[str, str]]:
    """The pack as (style, text) blocks: title, h2, p, li, q, a, small."""
    kind = use_cases.KINDS.get(scheme.get("kind") or "other", use_cases.KINDS["other"])
    name = scheme["name"]
    checked = str(scheme.get("last_checked") or use_cases.FACTS_CHECKED)[:10]
    contact = use_cases._contact(scheme) or "the office named under How to apply"
    blocks: list[tuple[str, str]] = [
        ("title", f"{name}: knowledge pack"),
        ("small", f"For VoicEra scheme agents. Facts checked {checked}"
                  + (" against the official sources listed at the end." if scheme.get("sources") else ".")),
        ("p", "Use only what is written here. If someone asks something this pack doesn't answer, say you don't have "
              "that detail and give the official website or helpline."),
        ("h2", "Quick facts"),
        ("li", f"What it gives: {scheme['benefit']}"),
        ("li", f"Who can get it: {scheme['eligibility']}"),
    ]
    if scheme.get("documents"):
        blocks.append(("li", f"Documents: {', '.join(scheme['documents'])}."))
    blocks.append(("li", f"How to apply: {scheme['how_to_apply']}"))
    if scheme.get("website"):
        blocks.append(("li", f"Official website: {scheme['website']}"))
    if scheme.get("helpline"):
        blocks.append(("li", f"Helpline: {scheme['helpline']}"))

    blocks.append(("h2", "Which path to follow on a call"))
    blocks.append(("p", "Any agent can switch path when the person's situation is different from what the call was set up for."))
    for intent in use_cases.INTENTS:
        cue, action = use_cases._PATHS[intent["id"]]
        blocks.append(("li", f"{intent['name']}: if {cue}, {action}."))

    blocks += [
        ("h2", "1. Awareness"),
        ("q", f"What is {name}?"),
        ("a", f"{scheme.get('summary') or ''} {scheme['benefit']}".strip()),
        ("h2", "2. Discovery"),
        ("q", "Who can get it?"),
        ("a", scheme["eligibility"]),
    ]
    if scheme.get("questions"):
        blocks.append(("p", "Questions to check if it may fit, one at a time:"))
        blocks += [("li", q) for q in scheme["questions"]]
    blocks.append(("p", "Never say someone is definitely eligible; the office confirms. If it doesn't fit, suggest "
                        "myscheme.gov.in to look for other schemes."))

    blocks += [
        ("h2", "3. Enrolment"),
        ("q", "How do I apply?"),
        ("a", scheme["how_to_apply"]),
    ]
    if scheme.get("documents"):
        blocks += [("q", "What should I bring?"), ("a", f"{', '.join(scheme['documents'])}. Bring them in person; "
                                                       "never read document numbers out on the phone.")]
    blocks += [
        ("q", "Do I have to pay to apply?"),
        ("a", "There is no fee to apply. Any premium or contribution is only what is stated under What it gives. "
              "Never pay anyone or share an OTP to apply."),
        ("h2", "4. Utilisation"),
        ("q", "How do I know if I'm already enrolled?"),
        ("a", f"The agent asks: \"{kind['enrolled_question'].format(name=name)}\""),
        ("q", "I'm enrolled. How do I get the benefit?"),
        ("a", f"Guidance for the agent: {kind['use']}"),
        ("h2", "5. Support"),
        ("p", "Problems people often report:"),
    ]
    blocks += [("li", theme) for theme in use_cases.ISSUE_THEMES]
    blocks += [
        ("q", "I have a problem. What should I do?"),
        ("a", f"Contact {contact}. If that doesn't solve it, file a complaint on the government grievance portal, "
              f"{use_cases.GRIEVANCE_PORTAL}."),
        ("p", "Don't argue about whether the problem is real, don't promise it will be fixed or by when, and don't ask "
              "for any ID, card, account or phone number."),
        ("h2", "6. Feedback"),
        ("p", "Ask for consent first, then these questions in order:"),
    ]
    survey = use_cases.scheme_feedback_survey(scheme)
    blocks += [("li", q["text"]) for q in survey["questions"]]

    extras = EXTRA_ANSWERS.get(scheme["id"]) if not scheme.get("custom") else None
    if extras:
        blocks.append(("h2", "More checked answers"))
        for question, answer, source in extras:
            blocks += [("q", question), ("a", answer), ("small", f"Source: {source}")]

    blocks += [
        ("h2", "Never"),
        ("li", "Say someone is definitely eligible."),
        ("li", "Invent amounts, dates, deadlines or rules."),
        ("li", "Ask for Aadhaar, bank account, card, OTP or PIN numbers, or any payment."),
        ("li", "Keep talking after the person asks to stop."),
    ]
    if scheme.get("sources"):
        blocks.append(("h2", "Sources"))
        blocks += [("small", src) for src in scheme["sources"]]
    elif scheme.get("custom"):
        blocks.append(("small", "Added by your organisation; the facts are as entered there."))
    return blocks


# --- minimal PDF writer -----------------------------------------------------------------

_PAGE_W, _PAGE_H, _MARGIN = 595, 842, 56
# style -> (font, size, leading, indent, space before)
_STYLES = {
    "title": ("F2", 17.0, 22.0, 0, 0),
    "h2": ("F2", 12.5, 17.0, 0, 10),
    "p": ("F1", 10.0, 14.0, 0, 3),
    "li": ("F1", 10.0, 14.0, 12, 1),
    "q": ("F2", 10.0, 14.0, 0, 5),
    "a": ("F1", 10.0, 14.0, 0, 0),
    "small": ("F1", 8.5, 11.5, 0, 2),
}


def _latin(text: str) -> str:
    """Text the built-in fonts can show (WinAnsi): rupee sign spelled out, the rest replaced."""
    text = text.replace("₹", "Rs. ").replace("‑", "-")
    return text.encode("cp1252", errors="replace").decode("cp1252")


def _wrap(text: str, font: str, size: float, width: float) -> list[str]:
    # Helvetica averages ~0.5 em; a little extra keeps long lines inside the margin.
    per_line = max(20, int(width / (size * (0.56 if font == "F2" else 0.52))))
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if len(candidate) > per_line and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def _escape(text: str) -> bytes:
    raw = _latin(text).encode("cp1252", errors="replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def render_pdf(title: str, blocks: list[tuple[str, str]]) -> bytes:
    """A4, text-only PDF. Deterministic: the same blocks give the same bytes."""
    pages: list[list[bytes]] = [[]]
    y = _PAGE_H - _MARGIN
    for style, text in blocks:
        font, size, leading, indent, before = _STYLES[style]
        width = _PAGE_W - 2 * _MARGIN - indent
        lines = _wrap(text, font, size, width - (10 if style == "li" else 0))
        y -= before
        for n, line in enumerate(lines):
            if y - leading < _MARGIN:
                pages.append([])
                y = _PAGE_H - _MARGIN
            y -= leading
            x = _MARGIN + indent
            if style == "li":
                if n == 0:
                    pages[-1].append(b"BT /F1 10 Tf %d %.1f Td (\x95) Tj ET" % (x, y))
                x += 10
            pages[-1].append(b"BT /%s %.1f Tf %d %.1f Td (%s) Tj ET" % (font.encode(), size, x, y, _escape(line)))

    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",  # pages, filled in below
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Title (%s) /Producer (VoicEra) >>" % _escape(title),
    ]
    kids = []
    for content in pages:
        stream = b"\n".join(content)
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
        content_id = len(objects)
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            b"/Contents %d 0 R >>" % (_PAGE_W, _PAGE_H, content_id)
        )
        kids.append(b"%d 0 R" % len(objects))
    objects[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(kids), len(kids))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info 5 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def pack_pdf(scheme: dict[str, Any]) -> bytes:
    return render_pdf(f"{scheme['name']}: knowledge pack", pack_blocks(scheme))


def pack_filename(scheme: dict[str, Any]) -> str:
    name = re.sub(r"[^A-Za-z0-9 .()-]+", " ", _latin(scheme["name"]).replace("?", " "))
    return f"Knowledge pack - {' '.join(name.split())}.pdf"


# --- prompt ------------------------------------------------------------------------------


def prompt_knowledge(scheme: dict[str, Any]) -> str:
    """The pack's question-and-answer pairs that the scheme facts don't already say."""
    already = {str(scheme.get(k) or "").strip() for k in ("benefit", "eligibility", "how_to_apply")}
    blocks = pack_blocks(scheme)
    pairs: list[str] = []
    for n, (style, text) in enumerate(blocks):
        if style != "q" or n + 1 >= len(blocks) or blocks[n + 1][0] != "a":
            continue
        answer = blocks[n + 1][1]
        if answer.strip() in already or answer.startswith(("The agent asks", "Guidance for the agent")):
            continue
        if answer.endswith(scheme["benefit"]):  # "What is X?" = summary + benefit
            continue
        source = blocks[n + 2][1] if n + 2 < len(blocks) and blocks[n + 2][0] == "small" else ""
        pairs.append(f"Q: {text}\nA: {answer}" + (f" ({source})" if source.startswith("Source:") else ""))
    return "\n".join(pairs)
