"""Pick and configure the speech, AI and voice providers for an agent on the server.

Used for the public preview (/try) and for saving the tried agent into a
workspace after sign-in. The per-model config is a port of the wizard's
``modelConfigFromSettings`` (frontend/src/lib/catalog-utils.ts): the
provider's own catalog supplies the vendor language code and every field's
default (voice, speed, ...), so these agents match what the wizard creates.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings
from apps.providers.availability import is_authenticated
from apps.providers.base import Kind
from apps.providers.schema import list_providers, provider_settings

logger = logging.getLogger(__name__)

_NON_FIELD_KEYS = {"model", "language"}

# Default AI model for the preview on each provider (TRY_LLM_MODEL overrides).
PREVIEW_LLM_MODELS = {"openai": "gpt-4.1-mini", "groq": "openai/gpt-oss-120b", "openrouter": "openai/gpt-4.1-mini"}


class StackError(Exception):
    """No usable provider for one part of the stack."""


def _prefs(raw: str) -> list[str]:
    return [p.strip().lower() for p in (raw or "").split(",") if p.strip()]


def _default_model(catalog: dict[str, Any]) -> str:
    field = (catalog.get("fields") or {}).get("model") or {}
    if field.get("default") not in (None, ""):
        return str(field["default"])
    examples = field.get("examples") or []
    return str(examples[0]) if examples else ""


def _vendor_language(catalog: dict[str, Any], model: str, language: str) -> str:
    fields = catalog.get("fields") or {}
    from_field = (((fields.get("language") or {}).get("language_codes") or {}).get(model) or {}).get(language)
    if from_field:
        return str(from_field)
    from_caps = (((catalog.get("capabilities") or {}).get(model) or {}).get("languages") or {}).get(language)
    return str(from_caps) if from_caps else language


def _resolved_fields(catalog: dict[str, Any], model: str, language: str) -> list[tuple[str, dict[str, Any]]]:
    base = catalog.get("fields") or {}
    by_lang = (((catalog.get("capabilities") or {}).get(model) or {}).get("settings")) or {}
    lang = language if language in by_lang else next(iter(by_lang), None)
    overlay = by_lang.get(lang, {}) if lang else {}
    if overlay:
        out = []
        for key, leaf in overlay.items():
            field = base.get(key)
            if key in _NON_FIELD_KEYS or not field or field.get("secret"):
                continue
            merged = dict(field)
            if isinstance(leaf, dict):
                if leaf.get("default") is not None:
                    merged["default"] = leaf["default"]
                if leaf.get("options") is not None:
                    merged["examples"] = leaf["options"]
            out.append((key, merged))
        return out
    return [(k, f) for k, f in base.items() if k not in _NON_FIELD_KEYS and not f.get("secret")]


def model_config(kind: Kind, provider: str, language: str | None, model: str | None = None) -> dict[str, Any]:
    """``{provider, model, language?, ...defaults}`` exactly as the wizard builds it."""
    catalog = provider_settings(kind, provider, language) if language else provider_settings(kind, provider)
    model_id = model or _default_model(catalog)
    out: dict[str, Any] = {"provider": provider, "model": model_id}
    lang = language
    if not lang:
        default_lang = ((catalog.get("fields") or {}).get("language") or {}).get("default")
        lang = str(default_lang) if default_lang is not None else None
    if lang:
        out["language"] = _vendor_language(catalog, model_id, lang)
    for key, field in _resolved_fields(catalog, model_id, lang or ""):
        if field.get("default") is not None:
            out[key] = field["default"]
        elif field.get("examples"):
            out[key] = field["examples"][0]
    return out


def _pick(kind: Kind, language: str | None, preferred: list[str], usable: set[str], label: str, *, fixed: bool) -> str:
    """The first connected provider in preference order. With ``fixed`` (the
    preview's fixed stack) and none reported as connected, the first preferred
    provider that supports the language is used anyway: the deployment's
    model server or lent keys serve it at call time."""
    offered = list(list_providers(kind, language) if language else list_providers(kind))
    for provider in preferred + offered:
        if provider in offered and is_authenticated(provider, usable):
            return provider
    if fixed:
        for provider in preferred:
            if provider in offered:
                logger.warning("Fixed stack uses %s for %s without a confirmed connection", provider, label)
                return provider
    raise StackError(f"No {label} provider is available for this language yet.")


def build_models(language: str, usable: set[str], *, fixed: bool = False) -> dict[str, dict[str, Any]]:
    """Speech, AI and voice configs for ``language`` from the providers in ``usable``
    (plus self-hosted ones the model server is running), in the preference
    order set by TRY_STT_PROVIDERS / TRY_TTS_PROVIDERS / TRY_LLM_PROVIDER."""
    stt = _pick(Kind.STT, language, _prefs(settings.TRY_STT_PROVIDERS), usable, "speech recognition", fixed=fixed)
    tts = _pick(Kind.TTS, language, _prefs(settings.TRY_TTS_PROVIDERS), usable, "voice", fixed=fixed)
    llm_pref = _prefs(settings.TRY_LLM_PROVIDER)
    llm = _pick(Kind.LLM, None, llm_pref, usable, "AI model", fixed=fixed)
    # Same model as the preview's own text (greeting, translations), never the
    # provider catalog's default, which a key may not have.
    llm_model = ((settings.TRY_LLM_MODEL or "").strip() or PREVIEW_LLM_MODELS.get(llm, "")) if llm_pref and llm == llm_pref[0] else ""
    return {
        "stt_config": {"kind": "stt", **model_config(Kind.STT, stt, language)},
        "tts_config": {"kind": "tts", **model_config(Kind.TTS, tts, language)},
        "llm_config": {"kind": "llm", **model_config(Kind.LLM, llm, None, llm_model or None)},
    }


def describe(models: dict[str, dict[str, Any]]) -> dict[str, str]:
    """Display names for the three parts, e.g. {"stt": "Indic Nemotron", ...}."""
    out: dict[str, str] = {}
    for key, kind, cfg in (
        ("stt", Kind.STT, models["stt_config"]),
        ("llm", Kind.LLM, models["llm_config"]),
        ("tts", Kind.TTS, models["tts_config"]),
    ):
        try:
            name = str(provider_settings(kind, cfg["provider"]).get("name") or cfg["provider"])
        except Exception:
            name = str(cfg["provider"])
        out[key] = f"{name} · {cfg['model']}" if key == "llm" and cfg.get("model") else name
    return out
