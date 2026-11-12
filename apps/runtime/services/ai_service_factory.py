"""Build Pipecat STT / TTS / LLM services from API agent + ProviderAuth."""

from __future__ import annotations

from typing import Any

from loguru import logger

from apps.providers import (
    AgentConfig,
    create_llm_service,
    create_stt_service,
    create_tts_service,
)
from apps.providers.schema import provider_level_auth
from apps.runtime.services.backend import BackendClient, backend_client
from apps.runtime.services.language_switch.pool import (
    build_language_switchers,
    merge_stack_with_auth,
    resolve_language_stacks,
)
from apps.runtime.services.language_switch.switcher import (
    ModelLLMSwitcher,
    ModelServiceSwitcher,
)


class ServiceBuildError(RuntimeError):
    """Raised when agent models or auth cannot be turned into services."""


def _provider_id(model_cfg: dict[str, Any] | None) -> str:
    if not isinstance(model_cfg, dict):
        return ""
    return str(model_cfg.get("provider") or "").strip()


def _requires_stored_auth(provider: str) -> bool:
    """False for local / no-secret providers (e.g. indic_nemotron)."""
    catalog = provider_level_auth(provider)
    if catalog is None:
        return True
    return bool(catalog.get("secrets"))


def _has_all_auth_fields(provider: str, blob: dict[str, Any]) -> bool:
    """True if ``blob`` already carries every secret field this provider needs.

    Real stored Agents documents never contain secrets (agent_config_validation
    forbids it), so this is always False for them — existing behavior is
    unchanged. It only matters for a caller that pre-resolves credentials
    in-process (e.g. the Copilot voice session bundle, which can see a
    platform-wide fallback key apps/runtime has no other way to learn about)
    and embeds them directly, so the redundant HTTP fetch below is skipped
    instead of overwriting/failing on a provider with no *stored* ProviderAuth.
    """
    catalog = provider_level_auth(provider)
    secrets = set((catalog or {}).get("secrets") or [])
    if not secrets:
        return False
    return all(blob.get(name) not in (None, "") for name in secrets)


def _pre_resolved_auth(stacks: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Return ``{provider: secrets}`` for blobs that already carry every secret."""
    found: dict[str, dict[str, Any]] = {}
    for stack in stacks.values():
        for kind in ("stt_config", "tts_config", "llm_config"):
            blob = stack.get(kind)
            if not isinstance(blob, dict):
                continue
            provider = _provider_id(blob)
            if not provider or provider in found:
                continue
            if _requires_stored_auth(provider) and _has_all_auth_fields(provider, blob):
                secrets = (provider_level_auth(provider) or {}).get("secrets") or []
                found[provider] = {name: blob[name] for name in secrets}
    return found


class _PreResolvedAuthClient:
    """BackendClient proxy that skips the HTTP auth fetch for pre-resolved providers.

    The language-switch pool (``merge_stack_with_auth``) always fetches stored
    ProviderAuth for providers that need secrets. For a caller that embedded
    the credentials in-process (Copilot voice — see ``_has_all_auth_fields``)
    this proxy answers with the embedded secrets instead, so nothing is
    overwritten and no fetch is made for a provider with no *stored* auth.
    Every other provider / method is delegated to the real client.
    """

    def __init__(self, client: BackendClient, resolved: dict[str, dict[str, Any]]):
        self._client = client
        self._resolved = resolved

    async def get_provider_auth(self, provider: str, org_id: str) -> dict[str, Any]:
        if provider in self._resolved:
            logger.info("Using pre-resolved auth for provider={} (no fetch)", provider)
            return dict(self._resolved[provider])
        return await self._client.get_provider_auth(provider, org_id)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


def _with_pre_resolved_auth(
    stacks: dict[str, dict[str, Any]],
    client: BackendClient | None,
) -> Any:
    client = client or backend_client
    resolved = _pre_resolved_auth(stacks)
    if not resolved:
        return client
    return _PreResolvedAuthClient(client, resolved)


async def merge_models_with_auth(
    agent: dict[str, Any],
    client: BackendClient | None = None,
) -> dict[str, Any]:
    """Return primary-language ``{stt_config, tts_config, llm_config}`` with secrets merged."""
    client = client or backend_client
    try:
        stacks = resolve_language_stacks(agent)
    except ValueError as exc:
        raise ServiceBuildError(str(exc)) from exc

    org_id = str(agent.get("org_id") or "").strip()
    if not org_id:
        raise ServiceBuildError("agent.org_id is required")

    language = (agent.get("config") or {}).get("language") or {}
    primary = str(language.get("primary") or "").strip()
    if not primary:
        primary = next(iter(stacks.keys()), "")
    if not primary or primary not in stacks:
        raise ServiceBuildError("agent.config.language.primary is required")

    try:
        return await merge_stack_with_auth(
            stacks[primary],
            org_id=org_id,
            client=_with_pre_resolved_auth(stacks, client),
        )
    except ValueError as exc:
        raise ServiceBuildError(str(exc)) from exc


async def build_ai_services(
    agent: dict[str, Any],
    client: BackendClient | None = None,
) -> tuple[ModelServiceSwitcher, ModelServiceSwitcher, ModelLLMSwitcher]:
    """Return ``(stt_switcher, tts_switcher, llm_switcher)`` for the agent."""
    try:
        stacks = resolve_language_stacks(agent)
        return await build_language_switchers(
            agent,
            client=_with_pre_resolved_auth(stacks, client),
        )
    except ValueError as exc:
        raise ServiceBuildError(str(exc)) from exc


async def build_legacy_ai_services(
    agent: dict[str, Any],
    client: BackendClient | None = None,
) -> tuple[Any, Any, Any]:
    """Return bare ``(stt, tts, llm)`` for the agent primary language stack."""
    models = await merge_models_with_auth(agent, client=client)
    try:
        agent_ai = AgentConfig.model_validate(models)
    except Exception as exc:
        raise ServiceBuildError(f"Invalid AgentConfig: {exc}") from exc

    try:
        stt = create_stt_service(agent_ai)
        tts = create_tts_service(agent_ai)
        llm = create_llm_service(agent_ai)
    except Exception as exc:
        raise ServiceBuildError(f"Failed to create AI services: {exc}") from exc

    logger.info(
        "Created services stt={} tts={} llm={}",
        type(stt).__name__,
        type(tts).__name__,
        type(llm).__name__,
    )
    return stt, tts, llm
