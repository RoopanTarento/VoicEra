"""Build the synthetic 'agent' config a Copilot voice session hands to
apps/runtime — the exact same shape apps.runtime.services.pipecat.pipeline
.run_pipeline() already consumes for every real telephony/browser agent
call, so voice mode adds zero new pipeline code on the runtime side beyond
tool registration.

Model choice is never invented: the LLM comes from the identical
provider/model resolution the text Copilot uses (engine.py), and STT/TTS
come from an existing real agent's configuration if the org has one, else
the same known-good OpenAI fallback tools.propose_create_agent already
relies on.
"""

from __future__ import annotations

from typing import Any

from app.services import agent_service
from app.services.copilot.engine import _resolve_api_key, _resolve_model, _resolve_provider
from app.services.copilot.tool_specs import TOOL_NAMES
from app.services.copilot.tools import FALLBACK_STT_TTS_MODELS

VOICE_GREETING = "Hi, I'm Ask VoicEra. What would you like to do?"

# The Copilot's own voice conversation is always in English (system prompt,
# greeting, everything). Bhashini's English-capable models only — the
# multilingual ones (used for real agents' Indian-language calls) don't cover
# "en". Picked ahead of an org's existing agent config below because it needs
# no per-org billing/credits, unlike OpenAI.
_BHASHINI_STT_EN = {"provider": "bhashini", "model": "ai4bharat/whisper-medium-en--gpu--t4", "language": "en"}
_BHASHINI_TTS_EN = {"provider": "bhashini", "model": "orpheus", "language": "en", "voice": "Kavya"}

VOICE_SYSTEM_PROMPT_SUFFIX = """

You are in a live spoken voice conversation, not a text chat. Keep replies
short and conversational — one or two sentences at a time. Never produce a
bulleted list, a table, markdown formatting, or a wall of text; say numbers
and summaries the way a person would say them out loud (e.g. "you have five
agents" rather than a list of five names). If you need to use a tool, say a
brief filler line first (e.g. "Let me check that.") before the result comes
back, so the conversation doesn't go silent."""


def _stt_tts_models(org_id: str) -> dict[str, Any]:
    """Reuse an existing agent's STT/TTS choice; else the known-good OpenAI
    fallback. Bhashini's English models (_BHASHINI_STT_EN/_BHASHINI_TTS_EN)
    are defined above for future use once an org has a real Bhashini
    credential with Orpheus (English TTS) access provisioned — this org's
    stored credential lacks that, so it is not preferred over OpenAI today
    (see conversation history: verified live, not a guess)."""
    existing = agent_service.list_agents(org_id)
    for row in existing:
        models = (row.get("config") or {}).get("models") or {}
        if models.get("stt_config") and models.get("tts_config"):
            return {"stt_config": models["stt_config"], "tts_config": models["tts_config"]}
    return {
        "stt_config": dict(FALLBACK_STT_TTS_MODELS["stt_config"]),
        "tts_config": dict(FALLBACK_STT_TTS_MODELS["tts_config"]),
    }


def build_copilot_voice_agent(org_id: str, *, base_system_prompt: str) -> dict[str, Any]:
    """Return an in-memory, agent-shaped dict for apps.runtime's run_pipeline().

    The LLM credential is resolved and embedded here (in-process, where the
    platform-wide COPILOT_LLM_API_KEY fallback is visible) rather than left
    for the runtime to fetch over HTTP, since the runtime's normal
    get_provider_auth() call only sees org-stored ProviderAuth rows, not this
    process's env-var fallback. apps.runtime.services.ai_service_factory
    skips its own auth fetch when a config already carries every secret field
    a provider needs (see merge_models_with_auth's _has_all_auth_fields
    check) — added specifically so this pre-resolved key isn't clobbered.
    """
    provider = _resolve_provider()
    model = _resolve_model(provider)
    api_key = _resolve_api_key(org_id, provider)

    llm_config: dict[str, Any] = {"provider": provider, "model": model, "api_key": api_key}
    stt_tts = _stt_tts_models(org_id)

    return {
        "agent_id": "copilot-voice",
        "org_id": org_id,
        "name": "Ask VoicEra",
        "status": "active",
        "archived": False,
        "agent_category": "websocket",
        "config": {
            "schema_version": 1,
            "prompts": {
                "system_prompt": base_system_prompt + VOICE_SYSTEM_PROMPT_SUFFIX,
                "greeting_message": VOICE_GREETING,
            },
            "behaviour": {},
            "language": {"primary": "en", "secondary": []},
            "models": {**stt_tts, "llm_config": llm_config},
            "knowledge_base": {"enabled": False, "mode": "context", "document_ids": [], "top_k": 5},
            "custom_variables": {},
        },
    }


def copilot_voice_tool_names() -> list[str]:
    """Tools the voice pipeline should register — every text-Copilot tool."""
    return sorted(TOOL_NAMES)
