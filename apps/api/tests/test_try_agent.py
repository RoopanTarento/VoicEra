"""Public agent preview (/try): server-built agents, fixed-stack test calls, usage caps."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token
from app.config import get_settings, settings
from app.services import auth_service, try_agent, try_stack

KN = {"scheme_ids": ["pm-kisan", "pmfby"], "language": "kn"}
FAKE_MODELS = {
    "stt_config": {"kind": "stt", "provider": "openai", "model": "gpt-4o-transcribe", "language": "kn"},
    "tts_config": {"kind": "tts", "provider": "openai", "model": "gpt-4o-mini-tts", "language": "kn", "voice": "alloy"},
    "llm_config": {"kind": "llm", "provider": "openai", "model": "gpt-4.1-mini"},
}


class _FakeCompletions:
    def __init__(self) -> None:
        self.replies: list[str] = []
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        text = self.replies.pop(0) if self.replies else "ನಮಸ್ಕಾರ"
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch):
    completions = _FakeCompletions()
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setattr(try_agent, "_client", lambda: (client, "openai", "gpt-4.1-mini"))
    return completions


@pytest.fixture
def stack(monkeypatch: pytest.MonkeyPatch):
    seen: list[set] = []

    def build(language, usable, **kw):
        seen.append(set(usable))
        return {k: dict(v, language=language) if k != "llm_config" else dict(v) for k, v in FAKE_MODELS.items()}

    monkeypatch.setattr(try_stack, "build_models", build)
    monkeypatch.setattr(try_stack, "describe", lambda models: {"stt": "OpenAI", "llm": "OpenAI · gpt-4.1-mini", "tts": "OpenAI"})
    return seen


@pytest.fixture
def client(vault_env, secure_db, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PROVIDER_AUTH_ENCRYPTION_KEY", Fernet.generate_key().decode())
    get_settings.cache_clear()
    rbac.invalidate_cache()
    monkeypatch.setattr(try_agent, "_indexes_ready", False)
    import app.main as main_module

    yield TestClient(main_module.app)
    rbac.invalidate_cache()


def _ip(n: int) -> dict[str, str]:
    return {"X-Forwarded-For": f"203.0.113.{n}"}


def test_catalogue_is_public_and_built_in_only(client, secure_db):
    secure_db["CustomSchemes"].insert_one({"org_id": "", "id": "mine", "name": "Mine", "category": "Farmers"})
    body = client.get("/api/v1/try/catalogue").json()
    ids = [s["id"] for s in body["schemes"]]
    assert len(ids) == 16 and "mine" not in ids
    assert "eligibility" not in body["schemes"][0]
    assert [l["code"] for l in body["languages"]][:6] == ["kn", "hi", "en", "mr", "ta", "te"]
    assert body["languages"][0]["native"] == "ಕನ್ನಡ"


def test_agent_returns_greeting_in_language_and_never_the_prompt(client, fake_llm, stack):
    body = client.post("/api/v1/try/agent", json=KN).json()
    assert body["greeting"] == "ನಮಸ್ಕಾರ" and body["english"] == try_agent.PREVIEW_WELCOME
    assert "prompt" not in body and body["stack"]["llm"].startswith("OpenAI")


def test_english_agent_needs_no_model_call(client, fake_llm, stack):
    body = client.post("/api/v1/try/agent", json={"scheme_ids": ["pm-kisan"], "language": "en"}).json()
    assert body["greeting"] == try_agent.PREVIEW_WELCOME and body["english"] is None and not fake_llm.calls


def test_agent_reports_when_no_voice_stack_is_available(client, fake_llm, monkeypatch):
    def none(language, usable, **kw):
        raise try_stack.StackError("No voice provider is available for this language yet.")

    monkeypatch.setattr(try_stack, "build_models", none)
    body = client.post("/api/v1/try/agent", json=KN).json()
    assert body["stack"] is None and "Kannada" in body["stack_error"]


@pytest.mark.parametrize(
    "payload",
    [
        {"scheme_ids": ["not-a-scheme"], "language": "hi"},
        {"scheme_ids": ["pm-kisan"], "language": "xx"},
        {"scheme_ids": [], "language": "hi"},
    ],
)
def test_agent_rejects_unknown_schemes_and_languages(client, fake_llm, stack, payload):
    assert client.post("/api/v1/try/agent", json=payload).status_code in (400, 422)


def test_prepare_creates_a_hidden_short_lived_agent_on_the_fixed_stack(client, secure_db, stack):
    r = client.post("/api/v1/try/prepare", json={**KN, "greeting": "ನಮಸ್ಕಾರ"}, headers=_ip(1))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["org_id"] == try_agent.PREVIEW_ORG_ID and body["preview_token"]
    agent = secure_db["Agents"].find_one({"agent_id": body["agent_id"]})
    assert agent["org_id"] == try_agent.PREVIEW_ORG_ID and agent["agent_category"] == "websocket"
    assert agent["config"]["prompts"]["greeting_message"] == "ನಮಸ್ಕಾರ"
    assert "PM-KISAN" in agent["config"]["prompts"]["system_prompt"]
    assert agent["config"]["language"]["primary"] == "kn"
    assert agent["try_preview"]["token_hash"] != body["preview_token"]  # only a hash is stored
    org = secure_db["Organizations"].find_one({"org_id": try_agent.PREVIEW_ORG_ID})
    assert org["status"] == "active" and not secure_db["Memberships"].find_one({"org_id": try_agent.PREVIEW_ORG_ID})


def test_call_needs_the_preview_token(client, stack):
    prep = client.post("/api/v1/try/prepare", json=KN, headers=_ip(2)).json()
    assert client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": "wrong"}).status_code == 404
    ok = client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": prep["preview_token"]})
    assert ok.status_code == 200 and ok.json()["call_id"]


def test_expired_preview_agents_are_refused_and_swept(client, secure_db, stack):
    prep = client.post("/api/v1/try/prepare", json=KN, headers=_ip(3)).json()
    secure_db["Agents"].update_one({"agent_id": prep["agent_id"]}, {"$set": {"try_preview.expires_at": "2000-01-01T00:00:00+00:00"}})
    assert client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": prep["preview_token"]}).status_code == 404
    client.post("/api/v1/try/prepare", json=KN, headers=_ip(3))
    assert not secure_db["Agents"].find_one({"agent_id": prep["agent_id"]})


def test_calls_are_capped_per_ip(client, stack, monkeypatch):
    monkeypatch.setattr(settings, "TRY_CALLS_PER_IP_HOUR", 2)
    codes = [client.post("/api/v1/try/prepare", json=KN, headers=_ip(4)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert client.post("/api/v1/try/prepare", json=KN, headers=_ip(5)).status_code == 200
    spoofed = client.post("/api/v1/try/prepare", json=KN, headers={"X-Forwarded-For": "1.2.3.4, 203.0.113.4"})
    assert spoofed.status_code == 429


def test_turns_are_capped_per_day(client, fake_llm, stack, monkeypatch):
    monkeypatch.setattr(settings, "TRY_TURNS_PER_DAY", 1)
    assert client.post("/api/v1/try/agent", json=KN, headers=_ip(6)).status_code == 200
    assert client.post("/api/v1/try/agent", json=KN, headers=_ip(7)).status_code == 429


def test_translate_returns_one_english_line_per_text(client, fake_llm):
    fake_llm.replies = ["1. Hello\n2. Yes, two acres"]
    body = client.post("/api/v1/try/translate", json={"language": "kn", "texts": ["ನಮಸ್ಕಾರ", "ಹೌದು", ""]}).json()
    assert body["english"] == ["Hello", "Yes, two acres", None]


def test_summary_keeps_only_known_schemes_and_outcomes(client, fake_llm):
    fake_llm.replies = ['{"fit": ["pm-kisan", "made-up"], "explained": ["pmfby", "pm-kisan"], "outcome": "Shared how to apply"}']
    transcript = [{"role": "agent", "text": "Do you farm?"}, {"role": "user", "text": "Yes, two acres."}]
    body = client.post("/api/v1/try/summary", json={"scheme_ids": KN["scheme_ids"], "transcript": transcript}).json()
    assert body == {"fit": ["pm-kisan"], "explained": ["pmfby"], "outcome": "Shared how to apply"}
    fake_llm.replies = ['{"fit": [], "explained": [], "outcome": "Anything else"}']
    assert client.post("/api/v1/try/summary", json={"scheme_ids": ["pm-kisan"], "transcript": transcript}).json()["outcome"] == "Call ended early"


def test_summary_of_a_call_with_no_caller_speech_needs_no_model(client, fake_llm):
    body = client.post(
        "/api/v1/try/summary", json={"scheme_ids": ["pm-kisan"], "transcript": [{"role": "agent", "text": "Hello?"}]}
    ).json()
    assert body["outcome"] == "Call ended early" and not fake_llm.calls


def test_save_needs_sign_in_and_uses_the_workspace_providers(client, secure_db, stack):
    assert client.post("/api/v1/try/save", json=KN).status_code in (401, 403)
    secure_db["Organizations"].insert_one({"org_id": "ws01", "name": "WS", "status": "active"})
    secure_db["Memberships"].insert_one({"email": "o@ws.example", "org_id": "ws01", "role": "super_admin"})
    auth_service.upsert_provider_auth("ws01", "openai", {"api_key": "sk-test-0000000000000000000000000000000000"})
    token = create_access_token({"sub": "o@ws.example", "org_id": "ws01", "role": "super_admin"})
    r = client.post("/api/v1/try/save", json={**KN, "greeting": "ನಮಸ್ಕಾರ"}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    saved = secure_db["Agents"].find_one({"agent_id": r.json()["agent_id"]})
    assert saved["org_id"] == "ws01" and "try_preview" not in saved
    assert "openai" in stack[-1]


def test_disabled_preview_is_not_found(client, monkeypatch):
    monkeypatch.setattr(settings, "TRY_ENABLED", False)
    assert client.get("/api/v1/try/catalogue").status_code == 404


def test_model_config_matches_the_wizard():
    """Port of the wizard's modelConfigFromSettings: vendor language code and field defaults."""
    from apps.providers.base import Kind

    cfg = try_stack.model_config(Kind.TTS, "openai", "kn")
    assert cfg["provider"] == "openai" and cfg["model"] and cfg["voice"] == "alloy" and "language" in cfg


def test_fixed_stack_uses_preferred_providers_even_when_not_confirmed(monkeypatch):
    """The preview's fixed stack doesn't fail just because no provider reports as connected."""
    monkeypatch.setattr(settings, "TRY_STT_PROVIDERS", "openai")
    monkeypatch.setattr(settings, "TRY_TTS_PROVIDERS", "openai")
    monkeypatch.setattr(settings, "TRY_LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "TRY_LLM_MODEL", "")
    with pytest.raises(try_stack.StackError):
        try_stack.build_models("en", set())
    models = try_stack.build_models("en", set(), fixed=True)
    assert {m["provider"] for m in models.values()} == {"openai"}
    # The call uses the preview's model, not the provider catalog's default.
    assert models["llm_config"]["model"] == try_stack.PREVIEW_LLM_MODELS["openai"]


def test_connected_providers_come_first(monkeypatch):
    monkeypatch.setattr(settings, "TRY_LLM_PROVIDER", "openai")
    models = try_stack.build_models("en", {"groq"}, fixed=True)
    assert models["llm_config"]["provider"] == "groq"
    assert models["llm_config"]["model"] != try_stack.PREVIEW_LLM_MODELS["openai"]


def test_text_model_falls_back_to_a_lent_provider(client, secure_db, monkeypatch):
    """No TRY key, but the platform lends Groq: the preview uses Groq with its preview model."""
    import app.config as config_module

    def put(name, value):
        # Other test modules may have swapped app.config.settings; set both copies.
        for target in {id(try_agent.settings): try_agent.settings, id(config_module.settings): config_module.settings}.values():
            monkeypatch.setattr(target, name, value)

    for name, value in {
        "TRY_LLM_PROVIDER": "openai", "TRY_LLM_API_KEY": "", "TRY_KEY_ORG_ID": "", "KB_EMBEDDING_API_KEY": "",
        "COPILOT_LLM_PROVIDER": "openai", "COPILOT_LLM_API_KEY": "", "DEFAULT_PROVIDERS_ORG_ID": "",
    }.items():
        put(name, value)
    assert try_agent.resolve_text_model() is None
    put("DEFAULT_PROVIDERS_ORG_ID", "lender01")
    put("DEFAULT_PROVIDERS", "groq")
    auth_service.upsert_provider_auth("lender01", "groq", {"api_key": "gsk_test_000000000000000000000000000000000000"})
    provider, model, key, source = try_agent.resolve_text_model()
    assert (provider, model) == ("groq", "openai/gpt-oss-120b") and key.startswith("gsk_test") and "DEFAULT_PROVIDERS" in source


def test_missing_text_model_says_so(client, monkeypatch):
    monkeypatch.setattr(try_agent, "resolve_text_model", lambda: None)
    r = client.post("/api/v1/try/agent", json=KN)
    assert r.status_code == 503 and "AI model" in r.json()["detail"]
