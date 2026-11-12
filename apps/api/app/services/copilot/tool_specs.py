"""OpenAI function-calling schemas for Copilot tools (see tools.py).

Deliberately excludes ``org_id`` / any identity field from every schema — the
model can never choose which organisation to query; the engine always binds
that from the authenticated request.
"""

from __future__ import annotations

from typing import Any

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_agents",
            "description": (
                "List the voice agents configured in the caller's organisation, "
                "with status, category, language and model. Use this to answer "
                "questions like 'what agents do I have' or before looking up one "
                "agent by name to resolve its agent_id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": ["string", "null"],
                        "description": "Optional filter, e.g. 'active' or 'inactive'.",
                    },
                    "limit": {"type": ["integer", "null"], "minimum": 1, "maximum": 50, "default": 20},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_agent",
            "description": (
                "Fetch full configuration for one agent: system prompt, greeting, "
                "language, STT/TTS/LLM models, and knowledge-base settings."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "The agent's id (from list_agents)."},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_calls",
            "description": (
                "List recent calls for the organisation, optionally filtered by "
                "agent, status, call outcome (call_response), or a recency window "
                "in days. Use this to investigate call volume, failures, or a "
                "specific agent's recent activity."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": ["string", "null"]},
                    "status": {
                        "type": ["string", "null"],
                        "description": "e.g. 'initiated', 'in_progress', 'completed', 'failed'.",
                    },
                    "call_response": {
                        "type": ["string", "null"],
                        "description": "e.g. 'answered', 'no_answer', 'busy', 'failed'.",
                    },
                    "days": {"type": ["integer", "null"], "minimum": 1, "maximum": 365, "description": "Only calls from the last N days."},
                    "limit": {"type": ["integer", "null"], "minimum": 1, "maximum": 100, "default": 20},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_call",
            "description": "Fetch full detail for one call by id, including outcome, duration and error message.",
            "parameters": {
                "type": "object",
                "properties": {"call_id": {"type": "string"}},
                "required": ["call_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_analytics_summary",
            "description": (
                "Org-wide call analytics: calls attempted/connected/failed, "
                "connection rate, average duration, week-over-week trend, "
                "per-agent call volume, and the most-used STT/TTS/LLM models. "
                "Use this for any 'how are we doing' / 'analyse my calls' question."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_campaigns",
            "description": "List outbound calling campaigns, optionally filtered by state.",
            "parameters": {
                "type": "object",
                "properties": {
                    "state": {
                        "type": ["string", "null"],
                        "description": "created, syncing, running, paused, completed, or failed.",
                    },
                    "limit": {"type": ["integer", "null"], "minimum": 1, "maximum": 50, "default": 20},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_knowledge_documents",
            "description": "List the organisation's knowledge-base documents and their ingest status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_available_providers",
            "description": (
                "This org's actually-connected STT/TTS/LLM providers, with real "
                "model names and (for TTS) real voice names per language. Call "
                "before naming any provider/model/voice in propose_create_agent "
                "or in an answer — never guess or recall one from elsewhere."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_recent_activity",
            "description": (
                "Who created/updated/deleted what, most recent first — agents, "
                "campaigns, KB documents, numbers, members, integrations. "
                "Admin/super_admin only; relay a permission error plainly, don't "
                "work around it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entity_type": {
                        "type": ["string", "null"],
                        "enum": [
                            "agent",
                            "campaign",
                            "knowledge_document",
                            "phone_number",
                            "member",
                            "provider_auth",
                            None,
                        ],
                        "description": "Optional: narrow to one kind of entity.",
                    },
                    "actor_email": {
                        "type": ["string", "null"],
                        "description": "Optional: narrow to actions taken by one specific user.",
                    },
                    "limit": {"type": ["integer", "null"], "minimum": 1, "maximum": 100, "default": 20},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_create_agent",
            "description": (
                "Stage an unsaved agent draft for the user to review/confirm in "
                "the UI — never creates a real agent. Call only once name and "
                "purpose are known (ask first if vague). Always 'websocket' "
                "delivery; a phone number is attached later in Numbers, never "
                "from chat. Leave stt/tts/llm fields unset to keep the org's "
                "existing config; set any only with names list_available_"
                "providers actually returned."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Short, human-readable agent name."},
                    "purpose": {
                        "type": "string",
                        "description": "What the agent should help callers do, in one sentence.",
                    },
                    "primary_language": {
                        "type": ["string", "null"],
                        "description": "Canonical language id, e.g. 'en', 'hi', 'kn'. Default 'en'.",
                    },
                    "system_prompt": {
                        "type": "string",
                        "description": (
                            "Full system prompt, written by you: role/tone, concrete tasks, one "
                            "domain-appropriate boundary. Never a generic one-liner."
                        ),
                    },
                    "greeting_message": {
                        "type": "string",
                        "description": "Warm, purpose-specific opening line the agent speaks first.",
                    },
                    "stt_provider": {"type": ["string", "null"], "description": "From list_available_providers['stt']."},
                    "stt_model": {"type": ["string", "null"], "description": "From that provider's 'models'."},
                    "tts_provider": {"type": ["string", "null"], "description": "From list_available_providers['tts']."},
                    "tts_model": {"type": ["string", "null"], "description": "A key in that provider's 'voices_by_model'."},
                    "tts_voice": {
                        "type": ["string", "null"],
                        "description": "From voices_by_model[language] — never guessed.",
                    },
                    "llm_provider": {"type": ["string", "null"], "description": "From list_available_providers['llm']."},
                    "llm_model": {"type": ["string", "null"], "description": "From that provider's 'models'."},
                    "knowledge_base_document_ids": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                        "description": "Real ids from list_knowledge_documents, only if the purpose needs reference material.",
                    },
                    "field_provenance": {
                        "type": ["object", "null"],
                        "description": (
                            "Per-field honesty, keyed by field name (name, purpose, "
                            "primary_language, system_prompt, greeting_message, llm, stt, tts, "
                            "tts_voice, knowledge_base): 'user_selected' (they said it), "
                            "'inferred' (deduced from intent), or 'recommended' (your default). "
                            "Never mislabel an inference/default as user_selected."
                        ),
                    },
                },
                "required": ["name", "purpose", "system_prompt", "greeting_message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_update_agent",
            "description": (
                "Stage an update to a REAL, EXISTING agent as an unsaved draft — "
                "never edits anything until confirmed. Resolve agent_id via "
                "list_agents/get_agent first, never guess it. Pass ONLY fields "
                "actually changing (every field below is 'only if changing it' — "
                "not stated per field to save space); everything else stays as "
                "on the real agent (merged onto current config, not reset). Call "
                "get_agent first if you need a current value (e.g. a threshold)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Real agent_id from list_agents/get_agent."},
                    "name": {"type": ["string", "null"]},
                    "system_prompt": {"type": ["string", "null"], "description": "New full system prompt."},
                    "greeting_message": {"type": ["string", "null"]},
                    "primary_language": {"type": ["string", "null"], "description": "e.g. 'en', 'hi'."},
                    "stt_provider": {"type": ["string", "null"], "description": "From list_available_providers['stt']."},
                    "stt_model": {"type": ["string", "null"]},
                    "tts_provider": {"type": ["string", "null"], "description": "From list_available_providers['tts']."},
                    "tts_model": {"type": ["string", "null"]},
                    "tts_voice": {"type": ["string", "null"], "description": "From voices_by_model — never guessed."},
                    "llm_provider": {"type": ["string", "null"], "description": "From list_available_providers['llm']."},
                    "llm_model": {"type": ["string", "null"]},
                    "knowledge_base_document_ids": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                        "description": "Replaces the attached set entirely — pass all ids that should remain attached.",
                    },
                    "knowledge_base_enabled": {
                        "type": ["boolean", "null"],
                        "description": "On/off without changing attached documents.",
                    },
                    "interruption_min_words": {
                        "type": ["integer", "null"],
                        "description": "Min words before the caller can interrupt.",
                    },
                    "user_silence_hangup_seconds": {
                        "type": ["number", "null"],
                        "description": "Silence-hangup timeout; null disables it.",
                    },
                    "call_timeout_seconds": {"type": ["number", "null"], "description": "Max call duration; null = no limit."},
                    "hold_messages": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                        "description": "Replaces the full hold-message set.",
                    },
                    "hold_message_timeout_seconds": {"type": ["number", "null"], "description": "Seconds between hold messages."},
                    "user_online_detection_enabled": {"type": ["boolean", "null"], "description": '"Still there?" check on/off.'},
                    "user_online_detection_message": {"type": ["string", "null"]},
                    "user_online_detection_seconds": {
                        "type": ["number", "null"],
                        "description": "Silence seconds before the check triggers.",
                    },
                    "user_online_detection_repeats": {"type": ["integer", "null"], "description": "Times to ask before giving up."},
                    "user_online_detection_closing_message": {
                        "type": ["string", "null"],
                        "description": "Said when ending the call after no response.",
                    },
                    "automatic_call_ending_enabled": {
                        "type": ["boolean", "null"],
                        "description": "Agent hangs up on its own when done, on/off.",
                    },
                    "automatic_call_ending_graceful": {
                        "type": ["boolean", "null"],
                        "description": "Say a closing line before auto-hangup.",
                    },
                    "ignore_user_speech_before_greeting": {
                        "type": ["boolean", "null"],
                        "description": "Ignore what the caller says before the greeting finishes.",
                    },
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_create_campaign",
            "description": (
                "Stage an outbound campaign as an unsaved draft — does NOT create a "
                "real one. Needs a real agent_id (list_agents) and a real source_id "
                "from a CSV the user attached in this chat — never invent one; ask "
                "them to attach it first if they haven't."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Short, human-readable campaign name."},
                    "agent_id": {
                        "type": "string",
                        "description": "Id of a real, existing agent in this org to place the calls.",
                    },
                    "source_id": {
                        "type": "string",
                        "description": (
                            "The exact source_id from a CSV the user attached in this "
                            "chat — copy it exactly as given, never guess or invent one."
                        ),
                    },
                    "rate_limit_per_second": {
                        "type": ["integer", "null"],
                        "minimum": 1,
                        "maximum": 20,
                        "default": 1,
                        "description": "Calls dialed per second.",
                    },
                    "max_concurrency": {
                        "type": ["integer", "null"],
                        "minimum": 1,
                        "maximum": 20,
                        "default": 5,
                        "description": "Max simultaneous active calls.",
                    },
                },
                "required": ["name", "agent_id", "source_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": (
                "Semantic search over the organisation's knowledge-base documents. "
                "Use this to answer questions about the org's own uploaded "
                "documents (policies, FAQs, product info) — not for questions "
                "about VoicERA itself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "document_ids": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                        "description": "Optional: restrict to these document ids.",
                    },
                    "top_k": {"type": ["integer", "null"], "minimum": 1, "maximum": 10, "default": 5},
                },
                "required": ["query"],
            },
        },
    },
]

TOOL_NAMES = {spec["function"]["name"] for spec in TOOL_SPECS}
