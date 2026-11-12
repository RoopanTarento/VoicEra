"""VoicERA Copilot orchestration: system prompt + tool-calling loop + streaming.

Architecture (Phase 1 + a Phase 2 slice of the Copilot roadmap):

    frontend (SSE)  ->  routers/copilot.py  ->  engine.run_copilot_turn()
                                                     |
                                                     |-- OpenAI chat.completions (streamed, tool-calling)
                                                     |-- tools.py (org-scoped reads: agents/calls/campaigns/KB)
                                                     |-- conversation_store.py (Mongo persistence)

The model never receives ``org_id`` as a tool argument it can set — every
tool call is executed with ``org_id`` bound from the authenticated request
(see ``_execute_tool``). This is what keeps a Copilot answer inside the
caller's own organisation regardless of what the model is prompted to do.

Every tool is read-only except ``propose_create_agent``, which never creates a
real agent by itself — it validates a candidate config and stores it as a
draft (draft_store.py). Turning a draft into a real agent requires a separate,
explicit HTTP call the *user* triggers by clicking "Create" on the
confirmation card (see routers/copilot.py's ``confirm_agent_draft``), which
then calls the exact same ``agent_service.create_agent`` every other
agent-creation path in the product uses. The model can propose; only a human
click executes.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import json
import logging
from datetime import date, datetime, timezone
from typing import Any, AsyncIterator

from openai import APIError, AsyncOpenAI, RateLimitError

from app.config import settings
from app.services import auth_service
from app.services.copilot import attachment_store, conversation_store
from app.services.copilot.tool_specs import TOOL_SPECS
from app.services.copilot.tools import TOOL_FUNCTIONS, CopilotToolError
from app.storage.minio_client import MinIOStorage
from apps.providers.cloud.groq.catalog import DEFAULT_LLM_MODEL as _GROQ_DEFAULT_MODEL
from apps.providers.cloud.openrouter.catalog import BASE_URL as _OPENROUTER_BASE_URL
from apps.providers.cloud.openrouter.catalog import (
    DEFAULT_LLM_MODEL as _OPENROUTER_DEFAULT_MODEL,
)

logger = logging.getLogger(__name__)

# Only OpenAI-compatible chat-completions providers are wired here — Azure
# OpenAI (different client shape), AWS Bedrock, and Google Vertex would need
# their own SDK calls, not just a different base_url, so they're a follow-up,
# not silently unsupported-but-pretending-to-work.
_GROQ_BASE_URL = "https://api.groq.com/openai/v1"
_PROVIDER_BASE_URLS: dict[str, str | None] = {
    "openai": None,  # SDK default: https://api.openai.com/v1
    "groq": _GROQ_BASE_URL,
    "openrouter": _OPENROUTER_BASE_URL,
}
# Model catalogs come from the repo's own provider registry (apps/providers/cloud/*),
# not hand-picked here, so a stale/hallucinated model id can't sneak in.
_PROVIDER_DEFAULT_MODELS: dict[str, str] = {
    "openai": "gpt-4o-mini",
    "groq": _GROQ_DEFAULT_MODEL,
    "openrouter": _OPENROUTER_DEFAULT_MODEL,
}

SYSTEM_PROMPT_TEMPLATE = """You are the VoicERA Agent Builder — never call yourself "Copilot," an
"assistant," or a "chatbot." You turn what someone describes, speaks, or
pastes as a prompt into a real, working VoicERA voice agent, and help shape
one that already exists.

VoicERA orgs build/run voice agents (telephony + browser calls), attach
knowledge bases (RAG), run outbound campaigns, and review call analytics.

Org "{org_id}", role "{role}". Today: {today}.
{page_context}

BUSINESS INTENT FIRST. Your #1 rule. A plain business goal (e.g. "an agent
for crop advisory schemes in India") never gets a technical question back
(LLM/STT/TTS/voice/telephony) unless it's genuinely blocking — those get a
default or recommendation instead. Understand who it serves and what it
should do first; ask one or two high-value business questions at a time,
never a checklist. A vague ask gets progressive discovery; a fully-specified
expert ask (e.g. "outbound Kannada EMI reminder agent using Cartesia and
Plivo") gets zero clarifying questions — extract everything stated and draft
immediately, asking only about what's genuinely missing.

Field honesty: when calling propose_create_agent, pass field_provenance
labeling each field 'user_selected' / 'inferred' / 'recommended' (see that
tool's own param description). Never show an inference or default as if the
user chose it — the confirmation card must be honest about this.

RAG recognition: if the ask implies answering from the org's own documents,
policies, or a named scheme only they'd have written about, call
list_knowledge_documents once, early — recommend a relevant-looking match or
say plainly none exists yet ([Knowledge base](/knowledge-base) to add one).
Never invent document contents. Skip this for generic topics answerable from
ordinary conversation.

Agent vs. campaign: an agent is what it says/does in one conversation; a
campaign is who gets called, how often, on what schedule — always outbound.
"Call customers whose EMI is due next week" needs both. Don't build a
campaign just because an agent could dial outbound — only when contacting a
list is actually described. Explain the distinction if it's not obvious.

Prompt-to-agent: if someone pastes a full instruction block (not a short
description), don't save it verbatim — read it for purpose, persona, tone,
responsibilities, boundaries, and language, and use those to fill purpose,
system_prompt (refined but intent preserved), greeting_message, and
primary_language. Say what you extracted before proposing.

Real pages (link only when concrete, exact path, never a guessed one):
/dashboard (agents), /numbers, /knowledge-base, /batches (campaigns),
/history, /analytics, /telemetry, /members, /integrations, /account,
/agents/{{agent_id}}/edit (only a real agent_id a tool returned).

Ground every factual claim about this org's data in a tool call — never
invent numbers, outcomes, config, or document contents; say so plainly if no
tool can answer. For "who did X" (created/edited/deleted anything), use
list_recent_activity, not a guess from other tools — it only covers activity
since that log existed, and it's admin-only (relay a permission error
plainly, don't route around it). General VoicERA questions not about this
org's data can be answered from your own knowledge, no tool needed.

The only things you can create are draft proposals (propose_create_agent /
propose_create_campaign) — neither creates anything real; each stages a
draft behind a confirmation card, and only the user's "Create" click saves
it. Know the agent's name and purpose before proposing — ask first if vague,
but don't gate an ordinary clear request behind unneeded questions; the card
itself is where the user reviews and adjusts. Never claim you already
created something.

Always write a real, complete system_prompt (never a generic one-liner):
who the agent is and its tone, its concrete tasks, at least one
domain-appropriate boundary (e.g. an EMI agent never gives financial/legal
advice and offers a human handoff on disputes; a crop-advisory agent admits
uncertainty rather than guessing at agronomy), and how it closes the call.
Match the greeting's warmth to that. Tell the user to review and confirm.

Voice/KB/delivery — only from real data, never guessed: name a specific
voice/provider only if asked or offered, after calling
list_available_providers and using only names it returned (otherwise the
draft copies the org's existing config); knowledge base per the RAG rule
above; delivery is always websocket (browser test) from chat — no telephony
number here, point to [Numbers](/numbers) after confirming.

Campaigns need a real agent_id (list_agents — agent must already have a
phone number) and a real source_id from a CSV the user attached in this
chat (never invented) — ask them to attach one first if they haven't.

To change an EXISTING agent (prompt, greeting, language, voice, knowledge
base, any behaviour setting), use propose_update_agent — same
propose/preview/confirm pattern, nothing changes until "Update" is clicked.
If "The user is currently viewing" already states an agent_id, use it
directly for "it"/"this agent" — don't re-look it up. Otherwise resolve via
list_agents/get_agent, never guess; confirm if ambiguous. Pass only the
fields actually changing — everything else stays as on the real agent. To
answer "what's X currently set to," call get_agent and read its real
behaviour block, never assume a default.

Everything else (editing a campaign, KB documents, phone numbers) needs the
product UI — say so, don't claim a capability you don't have.

Be concise. When you used a tool, explain what the data shows and why it
matters, not just raw numbers.

When a request could mean "explain" or "do it for me," say so briefly, then
end with: {{quick_replies: ["Walk me through it", "Create one with me"]}} —
only for a genuine fork, never after every message or a plain factual answer.

Formatting: real markdown, plain well-structured prose. One fact = one short
sentence, never a table; tables only for genuinely multi-row data (3+);
bold only the one term/number that matters. Skip headings on short answers.
Never wrap an answer in a blockquote or code block.

Diagrams: a genuinely helpful flow can be a fenced ```mermaid block (don't
also restate it in prose) — only real pages/tools/provider names a tool
actually returned, never invented vendor names (label the stage instead,
e.g. "Speech-to-text"). Quote any node label containing anything beyond
letters/numbers/spaces — e.g. B["Agents Page (/dashboard)"] — or the diagram
fails to render."""


class CopilotConfigurationError(Exception):
    """Raised when the Copilot has no usable LLM credential."""


_PROVIDER_DISPLAY_NAMES = {"openai": "OpenAI", "groq": "Groq", "openrouter": "OpenRouter"}


def _display_name(provider: str) -> str:
    return _PROVIDER_DISPLAY_NAMES.get(provider, provider)


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


_HEARTBEAT_INTERVAL_S = 12.0


async def _stream_with_heartbeats(
    coro: Any,
) -> AsyncIterator[str | Any]:
    """Await ``coro`` (a chat-completions call), yielding an SSE comment
    line (ignored by the frontend's parser — see streamCopilotChat, which
    only acts on lines starting with "data:") roughly every
    ``_HEARTBEAT_INTERVAL_S`` seconds it's still pending, then yielding its
    result once resolved. Keeps a genuinely slow-to-start request looking
    alive instead of silent."""
    task = asyncio.ensure_future(coro)
    while True:
        try:
            result = await asyncio.wait_for(asyncio.shield(task), timeout=_HEARTBEAT_INTERVAL_S)
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"
            continue
        yield result
        return


# Groq's TPM limit is a rolling 60-second window, so no real wait it ever
# reports should exceed that — 65s gives a safety margin while still
# covering virtually every real wait this account sees (observed: as long
# as ~52s). Reliability matters more than speed here: agent creation alone
# can cost most of the account's entire 8000-token budget in one call, so
# a short cutoff meant routinely giving up on waits that would have
# actually cleared. The user sees real "retrying in Xs…" status the whole
# time (see retry_wait below), so a longer-but-visible wait beats a fast
# failure that just means trying the whole thing again anyway.
_MAX_AUTO_RETRY_WAIT_S = 65.0


def _rate_limit_wait_seconds(exc: RateLimitError) -> float | None:
    """The provider's own stated wait time for this 429, from the same
    header the SDK's default retry logic reads (see max_retries=0 above,
    which hands that decision to us instead of a silent internal sleep)."""
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers is None:
        return None
    for key, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
        raw = headers.get(key)
        if raw is None:
            continue
        try:
            return float(raw) * scale
        except ValueError:
            continue
    return None


_MAX_AUTO_RETRY_ATTEMPTS = 3  # up to 3 automatic retries (4 attempts total)

# Groq's own backend sometimes aborts a stream mid-generation when the model
# (openai/gpt-oss-20b, a small tool-calling model) emits malformed JSON for a
# tool call's arguments — more likely for a long string field like
# propose_create_agent's system_prompt. Observed verbatim: "Failed to parse
# tool call arguments as JSON". This is generation flakiness, not a real
# problem with the request, so simply regenerating usually succeeds — no
# wait needed, just a moment so a genuinely repeating failure doesn't spin.
_TRANSIENT_TOOL_CALL_ERROR_MARKERS = ("tool call", "json")
_TOOL_CALL_ERROR_RETRY_DELAY_S = 1.0


def _is_transient_tool_call_error(exc: APIError) -> bool:
    text = str(exc).lower()
    return all(marker in text for marker in _TRANSIENT_TOOL_CALL_ERROR_MARKERS)


# Distinct from a 429 RateLimitError: Groq's 413 means *this one request's*
# prompt + max_tokens already exceeds the account's whole per-minute budget
# (observed verbatim: "Request too large ... Limit 8000, Requested 8404 ...
# please reduce your message size"). Waiting cannot fix it — resending the
# same messages/max_tokens produces the same size every time. It shows up
# specifically on the *follow-up* completion after a tool call whose result
# (e.g. a full agent config) got appended to the conversation, pushing the
# next request over the top. The one thing still under our control at that
# point is our own max_tokens request, so a single retry with a much smaller
# completion budget is a real fix, not a blind repeat.
def _is_request_too_large_error(exc: APIError) -> bool:
    if getattr(exc, "status_code", None) == 413:
        return True
    text = str(exc).lower()
    return "request too large" in text and "reduce your message size" in text


_SHRUNK_MAX_TOKENS = 256


async def _sleep_with_heartbeats(seconds: float) -> AsyncIterator[str]:
    """Wait out ``seconds``, yielding an SSE keep-alive comment roughly every
    _HEARTBEAT_INTERVAL_S along the way. A retry wait can now run up to
    _MAX_AUTO_RETRY_WAIT_S (~65s) — a single raw ``asyncio.sleep`` for that
    long sends zero bytes on the stream the whole time, which is exactly
    the original "network error" bug (the browser/an intermediary treating
    a quiet connection as dead), just at a longer timescale. This is the
    same fix _stream_with_heartbeats applies to a slow-to-start call,
    applied here to a deliberate wait instead."""
    remaining = seconds
    while remaining > 0:
        chunk = min(remaining, _HEARTBEAT_INTERVAL_S)
        await asyncio.sleep(chunk)
        remaining -= chunk
        if remaining > 0:
            yield ": keep-alive\n\n"


async def _create_completion_with_recovery(
    make_coro: Any, shrink_coro: Any | None = None
) -> AsyncIterator[Any]:
    """Run one chat-completions call with layers of visible recovery instead
    of silence or an immediate failure:

    1. Heartbeats (_stream_with_heartbeats) while it's just slow to start.
    2. Up to _MAX_AUTO_RETRY_ATTEMPTS automatic retries, with real status
       shown in between (a "retry_wait" event, not the SDK's own silent
       internal sleep), for two distinct real failure modes:
       - A rate limit whose provider-stated wait is short enough to be
         worth it (see _MAX_AUTO_RETRY_WAIT_S — up to Groq's full ~60s
         rolling window). Real observed waits on this account's small
         per-minute budget range from under a second to ~52s — more than
         one attempt matters: a retry landing moments before the window
         rolls over can still get hit again, this time with a much
         shorter wait.
       - A transient "failed to parse tool call arguments" abort from the
         provider (see _is_transient_tool_call_error) — regenerating the
         same request usually just works on the next attempt.
    3. One retry with a smaller completion budget (see
       _is_request_too_large_error) when the caller supplies ``shrink_coro``
       — the request's *size*, not the passage of time, is the problem, so
       this is the only one of these three recoveries that changes what's
       actually sent rather than just waiting and repeating it.

    ``make_coro``/``shrink_coro`` are zero-arg callables (not the coroutines
    themselves) because a coroutine object can only be awaited once — each
    retry needs a fresh one.
    """
    for attempt in range(_MAX_AUTO_RETRY_ATTEMPTS + 1):
        try:
            async for item in _stream_with_heartbeats(make_coro()):
                yield item
            return
        except RateLimitError as exc:
            wait_s = _rate_limit_wait_seconds(exc)
            if attempt < _MAX_AUTO_RETRY_ATTEMPTS and wait_s is not None and wait_s <= _MAX_AUTO_RETRY_WAIT_S:
                yield _sse(
                    {
                        "type": "retry_wait",
                        "seconds": round(wait_s, 1),
                        "message": (
                            f"The model provider is rate-limiting requests — "
                            f"retrying automatically in {max(1, round(wait_s))}s…"
                        ),
                    }
                )
                async for heartbeat in _sleep_with_heartbeats(wait_s):
                    yield heartbeat
                continue
            raise
        except APIError as exc:
            if attempt < _MAX_AUTO_RETRY_ATTEMPTS and _is_transient_tool_call_error(exc):
                yield _sse(
                    {
                        "type": "retry_wait",
                        "seconds": _TOOL_CALL_ERROR_RETRY_DELAY_S,
                        "message": "The model provider had a brief generation error — retrying automatically…",
                    }
                )
                async for heartbeat in _sleep_with_heartbeats(_TOOL_CALL_ERROR_RETRY_DELAY_S):
                    yield heartbeat
                continue
            if shrink_coro is not None and _is_request_too_large_error(exc):
                yield _sse(
                    {
                        "type": "retry_wait",
                        "seconds": 0,
                        "message": "That response would have been too large for the model provider's "
                        "per-minute limit — retrying with a shorter reply…",
                    }
                )
                async for item in _stream_with_heartbeats(shrink_coro()):
                    yield item
                return
            raise


def _resolve_provider() -> str:
    provider = (settings.COPILOT_LLM_PROVIDER or "openai").strip().lower()
    if provider not in _PROVIDER_BASE_URLS:
        raise CopilotConfigurationError(
            f"COPILOT_LLM_PROVIDER='{provider}' is not supported for Copilot chat "
            f"(supported: {', '.join(sorted(_PROVIDER_BASE_URLS))}). Azure OpenAI, "
            "Bedrock, and Vertex use a different SDK shape and aren't wired yet."
        )
    return provider


def _resolve_model(provider: str) -> str:
    return (settings.COPILOT_LLM_MODEL or "").strip() or _PROVIDER_DEFAULT_MODELS[provider]


# Vision-capable OpenAI chat-completions models, as of their model catalog
# (apps/providers/cloud/openai/catalog.py). None of Groq's or OpenRouter's
# models in this app's catalogs are known vision-capable via their
# chat-completions endpoints, so any other provider is treated as text-only.
_VISION_MODEL_PREFIXES = ("gpt-4.1", "gpt-4o", "gpt-5")


def _model_supports_vision(provider: str, model: str) -> bool:
    return provider == "openai" and model.startswith(_VISION_MODEL_PREFIXES)


def _resolve_api_key(org_id: str, provider: str) -> str:
    """Prefer the org's own stored credential for ``provider``; fall back to platform keys."""
    try:
        stored = auth_service.get_provider_auth(org_id, provider, mask_secrets=False)
    except Exception:  # pragma: no cover - defensive; auth store issues shouldn't crash chat
        stored = None
    if stored:
        raw = (stored.get("auth") or {}).get("api_key")
        if isinstance(raw, list) and raw:
            return str(raw[0])
        if isinstance(raw, str) and raw.strip():
            return raw.strip()

    fallback = settings.COPILOT_LLM_API_KEY.strip()
    if not fallback and provider == "openai":
        fallback = settings.KB_EMBEDDING_API_KEY.strip()  # both OpenAI keys in a typical local setup
    if fallback:
        return fallback

    name = _display_name(provider)
    raise CopilotConfigurationError(
        f"No {name} credential configured for the Copilot. Connect a {name} key in "
        "Integrations, or set COPILOT_LLM_API_KEY on the API service."
    )


_IMPROVE_PROMPT_SYSTEM = (
    "Fix spelling, grammar, and awkward phrasing in the text a user is about "
    "to send to an AI agent builder. Preserve its exact meaning, intent, "
    "language, and tone — do not add requirements they didn't state or "
    "answer the request yourself. Reply with ONLY the corrected text: no "
    "preamble, no quotation marks, no explanation."
)


async def improve_prompt_text(org_id: str, text: str) -> str:
    """One-shot, non-streaming text correction for the "improve my prompt"
    button — a real LLM call, but a tiny, dedicated one (no tool schemas, no
    Agent Builder system prompt) so a user who knows they type with typos
    can clean up a message before sending it without paying anywhere close
    to a full turn's token cost on this account's tight TPM budget.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("Nothing to improve — the message is empty.")

    provider = _resolve_provider()
    api_key = _resolve_api_key(org_id, provider)
    model = _resolve_model(provider)
    base_url = _PROVIDER_BASE_URLS[provider]
    client_kwargs: dict[str, Any] = {"api_key": api_key, "max_retries": 0}
    if base_url:
        client_kwargs["base_url"] = base_url
    client = AsyncOpenAI(**client_kwargs)

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _IMPROVE_PROMPT_SYSTEM},
            {"role": "user", "content": text},
        ],
        max_tokens=400,
        stream=False,
    )
    improved = (response.choices[0].message.content or "").strip()
    return improved or text


def _page_context_line(context: dict[str, Any] | None) -> str:
    if not context:
        return ""
    parts = []
    if context.get("route"):
        parts.append(f"route {context['route']}")
    if context.get("agent_id"):
        parts.append(f"agent_id {context['agent_id']}")
    if context.get("call_id"):
        parts.append(f"call_id {context['call_id']}")
    if context.get("campaign_id"):
        parts.append(f"campaign_id {context['campaign_id']}")
    if not parts:
        return ""
    return "The user is currently viewing: " + ", ".join(parts) + "."


def _history_to_messages(conversation: dict[str, Any], max_messages: int) -> list[dict[str, str]]:
    stored = conversation.get("messages") or []
    trimmed = stored[-max_messages:] if max_messages > 0 else []
    return [{"role": m["role"], "content": m["content"]} for m in trimmed if m.get("content")]


def _describe_csv_attachment(filename: str, storage_key: str, data: bytes) -> str:
    """Validates a CSV attachment with the exact same parser campaigns use,
    so the source_id/row-count the model is told about is real, not guessed."""
    import csv as csv_module
    import io

    try:
        text = data.decode("utf-8-sig")
        rows = list(csv_module.reader(io.StringIO(text)))
    except Exception as exc:
        return f'The user attached a CSV "{filename}" but it could not be parsed: {exc}.'
    if len(rows) < 2:
        return (
            f'The user attached a CSV "{filename}", but it has no data rows — '
            "it can't be used for a campaign as-is."
        )
    headers = [h.strip().lower() for h in rows[0]]
    contact_rows = sum(1 for r in rows[1:] if any(cell.strip() for cell in r))
    has_phone = "phone_number" in headers
    return (
        f'The user attached a CSV "{filename}" with columns [{", ".join(headers)}] and '
        f"{contact_rows} contact row(s). "
        + (
            f"Its source_id for propose_create_campaign is exactly '{storage_key}' — "
            "copy it exactly, never invent your own."
            if has_phone
            else "It has no 'phone_number' column, so it can't be used for a campaign "
            "until the user fixes that."
        )
    )


async def _resolve_attachments(
    org_id: str, attachment_ids: list[str]
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    """Look up each attachment (org-scoped) and split it into vision content
    (images, as base64 data URIs) or a plain-text context note (CSVs — real
    validation, not guessed at). Skips (and logs) any id that's missing or
    belongs to another org, rather than failing the whole turn over one bad id."""
    if not attachment_ids:
        return [], [], []

    storage = MinIOStorage()
    refs: list[dict[str, Any]] = []
    data_uris: list[str] = []
    notes: list[str] = []
    for attachment_id in attachment_ids:
        try:
            record = attachment_store.get_attachment(org_id, attachment_id)
            data = await storage.get_object_bytes(record["storage_key"])
        except Exception:
            logger.warning("Copilot attachment %s unavailable for org=%s", attachment_id, org_id)
            continue
        refs.append(
            {
                "attachment_id": record["attachment_id"],
                "content_type": record["content_type"],
                "original_filename": record["original_filename"],
            }
        )
        if record["content_type"] == "text/csv":
            notes.append(_describe_csv_attachment(record["original_filename"], record["storage_key"], data))
        else:
            encoded = base64.b64encode(data).decode("ascii")
            data_uris.append(f"data:{record['content_type']};base64,{encoded}")
    return refs, data_uris, notes


def _execute_tool(
    org_id: str,
    name: str,
    arguments: dict[str, Any],
    *,
    user_email: str,
    user_role: str,
    conversation_id: str | None,
) -> tuple[dict[str, Any], bool]:
    fn = TOOL_FUNCTIONS.get(name)
    if fn is None:
        return {"error": f"Unknown tool '{name}'."}, False
    # Bound server-side, same as org_id — the model never sees or sets these.
    if name in ("propose_create_agent", "propose_update_agent", "propose_create_campaign"):
        extra: dict[str, Any] = {"created_by": user_email, "conversation_id": conversation_id}
    elif name == "list_recent_activity":
        extra = {"actor_role": user_role}
    else:
        extra = {}
    # Smaller/local models occasionally emit a spurious key (e.g. {"": ""})
    # for a tool that takes no arguments, instead of a clean {} — drop
    # anything the tool's own signature doesn't accept rather than failing
    # the whole call and burning a retry (and its tokens) on it.
    accepted_params = set(inspect.signature(fn).parameters) - {"org_id"}
    arguments = {k: v for k, v in arguments.items() if k in accepted_params}
    try:
        result = fn(org_id, **extra, **arguments)
        return result, True
    except CopilotToolError as exc:
        return {"error": str(exc)}, False
    except TypeError as exc:
        logger.warning("Copilot tool %s called with bad arguments %s: %s", name, arguments, exc)
        return {"error": "Invalid arguments for this tool."}, False
    except Exception:
        logger.exception("Copilot tool %s failed", name)
        return {"error": "This lookup failed unexpectedly. The rest of the platform is unaffected."}, False


async def run_copilot_turn(
    *,
    org_id: str,
    user_email: str,
    role: str,
    message: str,
    conversation_id: str | None,
    context: dict[str, Any] | None,
    ephemeral: bool = False,
    history: list[dict[str, str]] | None = None,
    attachment_ids: list[str] | None = None,
) -> AsyncIterator[str]:
    """Run one Copilot turn, yielding Server-Sent-Event lines as they're produced.

    When ``ephemeral`` is set, this turn is never written to CopilotConversations
    — there's nothing to fetch a conversation_id for, so the caller supplies
    its own already-known ``history`` instead of it being read back from storage.
    """
    conversation: dict[str, Any] | None = None
    if not ephemeral:
        try:
            if conversation_id:
                conversation = conversation_store.get_conversation(org_id, user_email, conversation_id)
            else:
                conversation = conversation_store.create_conversation(org_id, user_email, message)
                conversation_id = conversation["conversation_id"]
        except conversation_store.CopilotConversationNotFoundError:
            yield _sse({"type": "error", "message": "Conversation not found."})
            return

    yield _sse({"type": "start", "conversation_id": conversation_id})

    try:
        provider = _resolve_provider()
        api_key = _resolve_api_key(org_id, provider)
        model = _resolve_model(provider)
    except CopilotConfigurationError as exc:
        yield _sse({"type": "error", "message": str(exc)})
        return

    base_url = _PROVIDER_BASE_URLS[provider]
    # max_retries=0: the SDK's default (2 retries) honors a provider's
    # Retry-After header exactly, which for a rate-limited request can mean
    # sleeping tens of seconds *inside* this one call with no bytes sent on
    # the SSE stream in the meantime — long enough that the browser or an
    # intermediary treats the connection as dead ("network error") well
    # before the retry would have paid off anyway. Failing on the first 429
    # instead surfaces the real, honest "rate limited" error in ~1 request's
    # latency instead of a silent multi-minute hang.
    client_kwargs: dict[str, Any] = {"api_key": api_key, "max_retries": 0}
    if base_url:
        client_kwargs["base_url"] = base_url
    client = AsyncOpenAI(**client_kwargs)
    logger.info("Copilot turn org=%s provider=%s model=%s", org_id, provider, model)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        org_id=org_id,
        role=role,
        today=date.today().isoformat(),
        page_context=_page_context_line(context),
    )
    history_messages = (
        [m for m in (history or []) if m.get("content")][-settings.COPILOT_HISTORY_MESSAGES :]
        if ephemeral
        else _history_to_messages(conversation, settings.COPILOT_HISTORY_MESSAGES)
    )

    attachment_refs, image_data_uris, attachment_notes = await _resolve_attachments(
        org_id, attachment_ids or []
    )
    vision_ok = _model_supports_vision(provider, model)
    if image_data_uris and not vision_ok:
        system_prompt += (
            f"\n\nThe user attached {len(image_data_uris)} image(s) with this message, but "
            f"the model currently configured for Ask VoicEra ({model}) cannot see or analyse "
            "images. Tell them that plainly — don't guess at what the image shows, and "
            "mention that an admin can switch to a vision-capable OpenAI model (gpt-4.1 or "
            "gpt-5) in Integrations to enable this."
        )
    for note in attachment_notes:
        system_prompt += f"\n\n{note}"

    if image_data_uris and vision_ok:
        user_content: Any = [{"type": "text", "text": message}]
        for uri in image_data_uris:
            user_content.append({"type": "image_url", "image_url": {"url": uri}})
    else:
        user_content = message

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *history_messages,
        {"role": "user", "content": user_content},
    ]

    tool_records: list[dict[str, Any]] = []
    final_content = ""

    try:
        for _ in range(max(1, settings.COPILOT_MAX_TOOL_ITERATIONS)):
            stream = None
            async for item in _create_completion_with_recovery(
                lambda: client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=TOOL_SPECS,
                    tool_choice="auto",
                    stream=True,
                    max_tokens=settings.COPILOT_MAX_OUTPUT_TOKENS,
                ),
                shrink_coro=lambda: client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=TOOL_SPECS,
                    tool_choice="auto",
                    stream=True,
                    max_tokens=min(_SHRUNK_MAX_TOKENS, settings.COPILOT_MAX_OUTPUT_TOKENS),
                ),
            ):
                if isinstance(item, str):
                    yield item
                else:
                    stream = item

            accumulated = ""
            tool_calls_acc: dict[int, dict[str, Any]] = {}
            finish_reason: str | None = None

            async for chunk in stream:
                choice = chunk.choices[0]
                if choice.finish_reason:
                    finish_reason = choice.finish_reason
                delta = choice.delta
                if delta and delta.content:
                    accumulated += delta.content
                    yield _sse({"type": "token", "text": delta.content})
                if delta and delta.tool_calls:
                    for tc in delta.tool_calls:
                        entry = tool_calls_acc.setdefault(tc.index, {"id": None, "name": "", "arguments": ""})
                        if tc.id:
                            entry["id"] = tc.id
                        if tc.function and tc.function.name:
                            entry["name"] += tc.function.name
                        if tc.function and tc.function.arguments:
                            entry["arguments"] += tc.function.arguments

            if finish_reason == "tool_calls" and tool_calls_acc:
                ordered = [tool_calls_acc[i] for i in sorted(tool_calls_acc)]
                messages.append(
                    {
                        "role": "assistant",
                        "content": accumulated or None,
                        "tool_calls": [
                            {
                                "id": entry["id"],
                                "type": "function",
                                "function": {"name": entry["name"], "arguments": entry["arguments"]},
                            }
                            for entry in ordered
                        ],
                    }
                )
                for entry in ordered:
                    name = entry["name"]
                    try:
                        arguments = json.loads(entry["arguments"] or "{}")
                    except json.JSONDecodeError:
                        arguments = {}
                    yield _sse({"type": "tool_call", "tool": name, "arguments": arguments})
                    result, ok = _execute_tool(
                        org_id,
                        name,
                        arguments,
                        user_email=user_email,
                        user_role=role,
                        conversation_id=conversation_id,
                    )
                    yield _sse({"type": "tool_result", "tool": name, "ok": ok, "data": result})
                    tool_records.append(
                        {
                            "tool": name,
                            "arguments": arguments,
                            "ok": ok,
                            "summary": _trim_summary(result),
                        }
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": entry["id"] or name,
                            # Only what the MODEL sees in its own context — the
                            # frontend's tool_result event above already got the
                            # full, untruncated result for real rendering. This
                            # cap is deliberately tight (not the old 8000): on
                            # this account's real 8000 TPM ceiling, a multi-tool
                            # turn compounds one full-size result per round, and
                            # a 413 on the *second or third* round was observed
                            # live even with a shrunk completion budget — the
                            # prompt itself, not just max_tokens, was the
                            # problem. The model only needs enough to reason
                            # about what happened, not the full payload back.
                            "content": json.dumps(result, default=str)[:3000],
                        }
                    )
                continue

            final_content = accumulated
            break
        else:
            final_content = (
                "I had to stop after several tool lookups without reaching a clear answer. "
                "Try narrowing your question (e.g. a specific agent or time range)."
            )
    except CopilotConfigurationError as exc:
        yield _sse({"type": "error", "message": str(exc)})
        return
    except Exception as exc:  # OpenAI/network errors, etc.
        logger.exception("Copilot turn failed org=%s", org_id)
        yield _sse(
            {
                "type": "error",
                "message": f"The Copilot couldn't complete that request ({_friendly_llm_error(exc)}). "
                "Nothing in VoicERA was changed — try again.",
            }
        )
        return

    if not ephemeral:
        now = datetime.now(timezone.utc).isoformat()
        try:
            conversation_store.append_messages(
                org_id,
                user_email,
                conversation_id,
                [
                    {
                        "role": "user",
                        "content": message,
                        "created_at": now,
                        "tool_calls": [],
                        "attachments": attachment_refs,
                    },
                    {
                        "role": "assistant",
                        "content": final_content,
                        "created_at": now,
                        "tool_calls": tool_records,
                    },
                ],
            )
        except conversation_store.CopilotConversationNotFoundError:
            logger.warning("Copilot conversation vanished mid-turn org=%s conv=%s", org_id, conversation_id)

    yield _sse({"type": "done", "conversation_id": conversation_id, "text": final_content})


def _trim_summary(result: dict[str, Any]) -> str:
    if "error" in result:
        return f"error: {result['error']}"[:200]
    if "count" in result:
        return f"{result['count']} result(s)"
    return "ok"


def _friendly_llm_error(exc: Exception) -> str:
    message = str(exc).lower()
    if "rate limit" in message or "429" in message:
        return "the model provider is rate-limiting requests"
    if "authentication" in message or "401" in message or "invalid api key" in message:
        return "the configured OpenAI credential is invalid"
    if "timeout" in message:
        return "the model provider timed out"
    return "an unexpected model provider error"
