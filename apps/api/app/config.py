"""Application settings loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
_ENV_FILE = _ROOT_DIR / ".env"


class Settings(BaseSettings):
    """Runtime configuration for the Voicera API."""

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Mongo-compatible DB (FerretDB wire protocol)
    MONGODB_HOST: str = "localhost"
    MONGODB_PORT: int = 27017
    MONGODB_USER: str = "admin"
    MONGODB_PASSWORD: str = "admin123"
    MONGODB_DATABASE: str = "voicera"
    # FerretDB uses PostgreSQL users (SCRAM-SHA-256). Leave authSource empty.
    MONGODB_AUTH_SOURCE: str = ""
    MONGODB_AUTH_MECHANISM: str = ""

    API_V1_PREFIX: str = "/api/v1"
    PROJECT_NAME: str = "Voicera API"
    VERSION: str = "0.1.0"
    DEBUG: bool = False

    SECRET_KEY: str = Field(
        default="",
        description="JWT signing key; required in production",
    )
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120
    JWT_ALGORITHM: str = "HS256"

    MAILTRAP_API_TOKEN: str = ""
    MAILTRAP_FROM_EMAIL: str = "noreply@voicera.com"
    MAILTRAP_FROM_NAME: str = "Voicera"
    FRONTEND_URL: str = "http://localhost:3000"

    INTERNAL_API_KEY: str = ""
    PROVIDER_AUTH_ENCRYPTION_KEY: str = Field(
        default="",
        description="Fernet key for encrypting ProviderAuth credential blobs",
    )

    # --- VoicEra Secure (contact vault) -----------------------------------
    SECURE_VAULT_KEYS: str = Field(
        default="",
        description=(
            "Comma-separated versioned AES-256 keys for the contact vault, "
            "'v1:<urlsafe-base64 32 bytes>,v2:<...>'. Required for any vault "
            "operation; there is no fallback cipher."
        ),
    )
    SECURE_VAULT_ACTIVE_KEY_VERSION: str = Field(
        default="",
        description="Key version used for new encryptions (must exist in SECURE_VAULT_KEYS)",
    )
    SECURE_VAULT_INDEX_KEY: str = Field(
        default="",
        description=(
            "Separate urlsafe-base64 32-byte HMAC key for the duplicate-detection "
            "blind index. Must differ from every data key."
        ),
    )
    SECURE_SERVICE_CREDENTIALS: str = Field(
        default="",
        description=(
            "Service identities allowed to call the resolve API, comma-separated "
            "'service_id|scope+scope|secret'. Separate from INTERNAL_API_KEY."
        ),
    )
    SECURE_DEFAULT_REGION: str = Field(
        default="IN",
        description="Region used to parse contact numbers written without a '+' prefix",
    )
    SECURE_RESOLVE_RATE_LIMIT_PER_MINUTE: int = Field(
        default=600,
        description="Max contact resolutions per service identity per organisation per minute",
    )
    SECURE_DENIAL_ALERT_THRESHOLD: int = Field(
        default=5,
        description="Denied resolutions by one actor within 5 minutes that raise a suspicious_access event",
    )
    SECURE_CONTACT_RETENTION_DAYS: int = Field(
        default=365,
        description="Days a deleted-or-inactive vault record keeps its ciphertext before purge",
    )
    SECURE_ENFORCE_VAULT_CAMPAIGNS: bool = Field(
        default=False,
        description="When true, new campaigns must use source_type='secure_contacts'",
    )
    PLATFORM_ADMIN_EMAILS: str = Field(
        default="",
        description=(
            "Comma-separated emails of VoicEra platform admins (manage adopters; no "
            "access to an adopter's data unless also a member of it)"
        ),
    )
    TELEPHONY_MOCK_ENABLED: bool = Field(
        default=False,
        description="Register the mock telephony provider (local demos and tests only)",
    )

    CHROMA_BASE_DIR: str = Field(
        default="app/rag/chroma_data",
        description="Root directory for per-org Chroma knowledge stores",
    )
    KB_EMBEDDING_API_KEY: str = Field(
        default="",
        description="OpenAI API key for knowledge-base embeddings (temporary global key)",
    )
    KB_EMBEDDING_MODEL: str = Field(
        default="text-embedding-3-small",
        description="Embedding model for knowledge-base ingest and retrieval",
    )
    KB_MAX_UPLOAD_BYTES: int = Field(
        default=25 * 1024 * 1024,
        description="Maximum PDF upload size for knowledge base",
    )
    MINIO_BUCKET: str = Field(
        default="voicera-calls",
        description="Default MinIO bucket (call artifacts and KB objects)",
    )
    VOICE_SERVER_BASE_URL: str = Field(
        default="",
        description=(
            "Public base URL of the voice server for telephony answer/hangup webhooks "
            "(e.g. https://voice.example.com)"
        ),
    )

    REDIS_URL: str = Field(
        default="redis://localhost:6379",
        description="Redis URL for ARQ job queue and campaign pub/sub",
    )
    DEFAULT_ORG_CONCURRENCY_LIMIT: int = Field(
        default=10,
        description="Default max concurrent calls per organisation",
    )
    CAMPAIGN_BATCH_SIZE: int = Field(
        default=10,
        description="Default queued runs processed per campaign batch",
    )
    CAMPAIGN_MAX_CSV_BYTES: int = Field(
        default=5 * 1024 * 1024,
        description="Maximum campaign CSV upload size",
    )
    ENABLE_CAMPAIGN_ORCHESTRATOR: bool = Field(
        default=True,
        description="When true, API startup can spawn orchestrator (docker uses separate service)",
    )

    COPILOT_LLM_PROVIDER: str = Field(
        default="openai",
        description=(
            "Provider id used for Copilot chat completions. Supported today: "
            "'openai', 'groq' (free tier), 'openrouter' — all OpenAI-compatible "
            "chat-completions APIs. See apps/api/app/services/copilot/engine.py."
        ),
    )
    COPILOT_LLM_MODEL: str = Field(
        default="",
        description=(
            "Chat-completions model used by the Copilot. Leave unset to use "
            "COPILOT_LLM_PROVIDER's own default model from the provider registry "
            "(apps/providers/cloud/<provider>/catalog.py)."
        ),
    )
    COPILOT_LLM_API_KEY: str = Field(
        default="",
        description=(
            "Fallback API key for COPILOT_LLM_PROVIDER when the organisation has no "
            "stored ProviderAuth credential for it. For provider='openai' only, also "
            "falls back to KB_EMBEDDING_API_KEY if unset (both are OpenAI keys in a "
            "typical local setup)."
        ),
    )
    COPILOT_MAX_TOOL_ITERATIONS: int = Field(
        default=4,
        description="Max sequential tool-call rounds per Copilot turn, to bound runaway loops",
    )
    COPILOT_MAX_OUTPUT_TOKENS: int = Field(
        default=512,
        description=(
            "max_tokens passed to every Copilot chat-completions call, bounding "
            "worst-case generation length and cost. Lowered from 1024: on a "
            "provider with a tight TPM cap (this account's real Groq limit is "
            "8000/min, confirmed via its own rate-limit headers), max_tokens is "
            "reserved against that budget whether or not the response uses it "
            "all, so every unclaimed token here is real headroom lost on every "
            "single call. Every real response observed in this chat panel "
            "(compact by design — see the system prompt's formatting guidance) "
            "comfortably fits well under 512. Most of a turn's cost is still "
            "the system prompt + tool schemas (input, not output) — see "
            "SYSTEM_PROMPT_TEMPLATE / TOOL_SPECS for that side of the budget."
        ),
    )
    COPILOT_REASONING_EFFORT: str = Field(
        default="low",
        description=(
            "Reasoning effort for gpt-oss models (low, medium, high; blank = the provider's "
            "default). Their reasoning counts against COPILOT_MAX_OUTPUT_TOKENS, and at the "
            "default effort it can use the whole budget and leave no answer."
        ),
    )
    COPILOT_HISTORY_MESSAGES: int = Field(
        default=16,
        description="Max prior messages (from the stored conversation) replayed as context",
    )
    COPILOT_ATTACHMENT_MAX_BYTES: int = Field(
        default=8 * 1024 * 1024,
        description="Maximum image size a user can attach to a Copilot message",
    )
    COPILOT_DOCUMENT_MAX_BYTES: int = Field(
        default=20 * 1024 * 1024,
        description="Maximum size of a document (PDF, Word, PowerPoint, Excel, text) attached to a Copilot message",
    )
    COPILOT_DOCUMENT_CONTEXT_CHARS: int = Field(
        default=6000,
        description=(
            "How much of the chat's attached documents is sent with each turn, in characters "
            "(about 4 per token in English, fewer in Indic scripts). A longer document is cut "
            "to the parts that best match the question. Kept small for Groq's 8000 tokens/min "
            "cap; raise it on a provider with more headroom."
        ),
    )
    COPILOT_DOCUMENTS_PER_CHAT: int = Field(
        default=5,
        description="How many of a chat's most recent documents stay in context on later turns",
    )
    COPILOT_VISION_MODEL: str = Field(
        default="",
        description=(
            "Model that reads attached images when the Copilot's own model can't. Blank = "
            "a default for COPILOT_LLM_PROVIDER (see _VISION_DEFAULT_MODELS in "
            "apps/api/app/services/copilot/engine.py)."
        ),
    )

    # Platform default providers (see auth_service "platform default providers").
    DEFAULT_PROVIDERS_ORG_ID: str = Field(
        default="",
        description=(
            "Workspace whose Integrations keys are lent to every workspace that hasn't "
            "connected its own. Blank = off."
        ),
    )
    DEFAULT_PROVIDERS: str = Field(
        default="",
        description="Comma-separated AI providers to lend, e.g. openai,sarvam (not telephony).",
    )

    # Public "try an agent" preview (no sign-up). See app/services/try_agent.py.
    TRY_ENABLED: bool = Field(default=True, description="Serve the public /try preview endpoints")
    TRY_LLM_PROVIDER: str = Field(default="openai", description="openai, groq or openrouter")
    TRY_LLM_MODEL: str = Field(default="", description="Blank = gpt-4.1-mini on OpenAI")
    TRY_LLM_API_KEY: str = Field(
        default="",
        description=(
            "Platform key for the preview. Blank = KB_EMBEDDING_API_KEY for OpenAI, or "
            "COPILOT_LLM_API_KEY when TRY_LLM_PROVIDER matches COPILOT_LLM_PROVIDER."
        ),
    )
    TRY_KEY_ORG_ID: str = Field(
        default="",
        description=(
            "Use this organisation's Integrations key for TRY_LLM_PROVIDER when "
            "TRY_LLM_API_KEY is blank (e.g. the platform team's own workspace)."
        ),
    )
    TRY_TURNS_PER_IP_HOUR: int = Field(
        default=60, description="Preview text requests (greeting, transcript lines, summary) per visitor IP per hour"
    )
    TRY_TURNS_PER_DAY: int = Field(default=3000, description="Preview text requests across all visitors per day")
    TRY_CALLS_PER_IP_HOUR: int = Field(default=6, description="Preview test calls per visitor IP per hour")
    TRY_CALLS_PER_DAY: int = Field(default=300, description="Preview test calls across all visitors per day")
    TRY_CALL_MAX_SECONDS: int = Field(default=180, description="The browser ends a preview test call after this long")
    TRY_AGENT_TTL_MINUTES: int = Field(default=30, description="Preview agents are deleted after this long")
    TRY_STT_PROVIDERS: str = Field(
        default="indic_nemotron,sarvam,google,openai",
        description="Speech recognition for preview calls, in order of preference (first available wins)",
    )
    TRY_TTS_PROVIDERS: str = Field(
        default="maya2_native,indic_orpheus,sarvam,google,openai",
        description="Voice for preview calls, in order of preference (first available wins)",
    )
    TRY_TRUSTED_PROXY_HOPS: int = Field(
        default=1,
        description=(
            "Proxies in front of the API that append X-Forwarded-For (the Next.js server is one; "
            "add one for nginx or a load balancer). 0 = use the socket address."
        ),
    )

    @field_validator("DEBUG", "SECURE_ENFORCE_VAULT_CAMPAIGNS", "TELEPHONY_MOCK_ENABLED", mode="before")
    @classmethod
    def coerce_debug(cls, value: Any) -> bool:
        """Accept common truthy strings; treat anything else as False.

        Host shells often export DEBUG=release / production, which must not
        crash settings parsing.
        """
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return False

    @property
    def mongodb_uri(self) -> str:
        """Build Mongo-compatible connection URI (FerretDB or MongoDB).

        Omits the "{user}:{pass}@" segment entirely when both are blank —
        a no-auth local mongod (a common bare-metal local-dev setup) has no
        such user, and newer pymongo versions reject an empty-string
        username outright ("The empty string is not valid username") rather
        than treating it as anonymous, so a literal empty segment is a hard
        connection failure, not just an ignored no-op.
        """
        auth = f"{self.MONGODB_USER}:{self.MONGODB_PASSWORD}@" if self.MONGODB_USER or self.MONGODB_PASSWORD else ""
        uri = f"mongodb://{auth}{self.MONGODB_HOST}:{self.MONGODB_PORT}/{self.MONGODB_DATABASE}"
        params: list[str] = []
        if self.MONGODB_AUTH_SOURCE:
            params.append(f"authSource={self.MONGODB_AUTH_SOURCE}")
        if self.MONGODB_AUTH_MECHANISM:
            params.append(f"authMechanism={self.MONGODB_AUTH_MECHANISM}")
        if params:
            return f"{uri}?{'&'.join(params)}"
        return uri


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
