"""Public demo builder (/try): server-built agents, fixed-stack test calls, the
runtime's demo tools, usage caps and saving after sign-in."""

from __future__ import annotations

import io
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import rbac
from app.auth import create_access_token
from app.config import get_settings, settings
from app.services import auth_service, try_agent, try_stack
from app.services.demo import calls, sources

ANSWERS = {"template_id": "T-ANSWER", "sector_id": "S-AGRI", "language": "kn"}
KN = {"answers": ANSWERS}
EN = {"answers": {**ANSWERS, "language": "en"}}
FAKE_MODELS = {
    "stt_config": {"kind": "stt", "provider": "openai", "model": "gpt-4o-transcribe", "language": "kn"},
    "tts_config": {"kind": "tts", "provider": "openai", "model": "gpt-4o-mini-tts", "language": "kn", "voice": "alloy"},
    "llm_config": {"kind": "llm", "provider": "openai", "model": "gpt-4.1"},
}
API_KEY = "internal-test-key-0000000000"


class _FakeCompletions:
    def __init__(self) -> None:
        self.replies: list[str] = []
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        text = self.replies.pop(0) if self.replies else "1. ನಮಸ್ಕಾರ\n2. ಇದು ಡೆಮೊ ಕರೆ."
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch):
    completions = _FakeCompletions()
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setattr(try_agent, "_client", lambda: (client, "openai", "gpt-4.1"))
    monkeypatch.setattr(try_agent, "_NOTICES", {"en": try_agent.builder.NOTICE})
    return completions


@pytest.fixture
def stack(monkeypatch: pytest.MonkeyPatch):
    seen: list[set] = []

    def build(language, usable, **kw):
        seen.append(set(usable))
        return {k: dict(v, language=language) if k != "llm_config" else dict(v) for k, v in FAKE_MODELS.items()}

    monkeypatch.setattr(try_stack, "build_models", build)
    monkeypatch.setattr(try_stack, "describe", lambda models: {"stt": "AI4Bharat IndicConformer", "llm": "OpenAI · gpt-4.1", "tts": "Maya 2"})
    return seen


@pytest.fixture
def client(vault_env, secure_db, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PROVIDER_AUTH_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", API_KEY)
    get_settings.cache_clear()
    rbac.invalidate_cache()
    monkeypatch.setattr(try_agent, "_indexes_ready", False)
    monkeypatch.setattr(calls, "_indexes_ready", False)
    monkeypatch.setattr(sources, "_indexes_ready", False)
    import app.main as main_module

    yield TestClient(main_module.app)
    rbac.invalidate_cache()


def _ip(n: int) -> dict[str, str]:
    return {"X-Forwarded-For": f"203.0.113.{n}"}


def _prepare(client, body=KN, ip=1):
    r = client.post("/api/v1/try/prepare", json=body, headers=_ip(ip))
    assert r.status_code == 200, r.text
    return r.json()


def _tool(client, prep, call_id, name, **args):
    r = client.post(
        "/api/v1/try/runtime/tool",
        json={"org_id": prep["org_id"], "agent_id": prep["agent_id"], "call_id": call_id, "name": name, "args": args},
        headers={"X-API-Key": API_KEY},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_catalogue_lists_templates_sectors_and_twelve_languages(client):
    body = client.get("/api/v1/try/catalogue").json()
    assert [t["template_id"] for t in body["templates"]] == ["T-ANSWER", "T-COLLECT", "T-GUIDE", "T-INFORM", "T-REMIND", "T-RESOLVE"] or len(body["templates"]) == 6
    assert len(body["sectors"]) == 12 and body["kb_version"]
    codes = [lang["code"] for lang in body["languages"]]
    assert codes[:6] == ["kn", "hi", "en", "mr", "ta", "te"] and len(codes) == 12 and codes[-1] == "as"
    assert body["languages"][-1]["beta"] and body["languages"][0]["native"] == "ಕನ್ನಡ"
    assert "prompt" not in str(body).lower()


def test_sources_show_the_sector_knowledge_and_flows(client):
    body = client.get("/api/v1/try/sources", params={"template_id": "T-ANSWER", "sector_id": "S-AGRI"}).json()
    assert body["cards"]["count"] == 21 and len(body["cards"]["preview"]) == 4
    assert body["cards"]["verified"] + body["cards"]["partly_verified"] == 21
    assert [f["flow_id"] for f in body["flows"]][0] == "F-ANSWER" and len(body["flows"]) == 4
    assert body["role"]["you_are"].startswith("Lakshmi")
    complaints = client.get("/api/v1/try/sources", params={"template_id": "T-RESOLVE", "sector_id": "S-POWER"}).json()["complaints"]
    assert {c["flow_id"] for c in complaints} == {"F-POWE-OUTAGE", "F-POWE-WATER"} and all(c["goes_to"] for c in complaints)
    assert client.get("/api/v1/try/sources", params={"template_id": "T-X", "sector_id": "S-AGRI"}).status_code == 400


def test_agent_returns_the_greeting_in_language_and_never_the_prompt(client, fake_llm, stack):
    fake_llm.replies = ["1. ನಮಸ್ಕಾರ, ನಾನು ಕೃಷಿ ಸಹಾಯವಾಣಿ ಸಹಾಯಕ. ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?\n2. ಇದು ಮಾದರಿ ಮಾಹಿತಿಯೊಂದಿಗೆ AI ಡೆಮೊ ಕರೆ."]
    r = client.post("/api/v1/try/agent", json=KN, headers=_ip(1))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["greeting"].startswith("ನಮಸ್ಕಾರ") and body["greeting_english"].startswith("Hello, I'm the agriculture helpline")
    assert body["notice"] == "ಇದು ಮಾದರಿ ಮಾಹಿತಿಯೊಂದಿಗೆ AI ಡೆಮೊ ಕರೆ." and body["notice"] in body["opening"]
    assert body["cards"] == 21 and body["flows"] == 4 and body["stack"]["llm"] == "OpenAI · gpt-4.1"
    assert "system_prompt" not in str(body) and "# Role" not in str(body)


def test_english_agent_needs_no_model_call(client, fake_llm, stack):
    body = client.post("/api/v1/try/agent", json=EN, headers=_ip(2)).json()
    assert body["greeting_english"] is None and body["opening"].startswith("Hello, I'm the agriculture helpline assistant. This is an AI demo call")
    assert not fake_llm.calls


def test_agent_reports_when_no_voice_stack_is_available(client, fake_llm, monkeypatch):
    def none(language, usable, **kw):
        raise try_stack.StackError("No voice provider is available for this language yet.")

    monkeypatch.setattr(try_stack, "build_models", none)
    body = client.post("/api/v1/try/agent", json=EN).json()
    assert body["stack"] is None and "aren't available yet" in body["stack_error"]


@pytest.mark.parametrize(
    "answers",
    [
        {**ANSWERS, "template_id": "T-NOPE"},
        {**ANSWERS, "sector_id": "S-NOPE"},
        {**ANSWERS, "language": "xx"},
        {**ANSWERS, "template_id": "T-INFORM", "sector_id": "S-AGRI"},  # no sample announcement for agriculture
    ],
)
def test_agent_rejects_unknown_ids_and_missing_inputs(client, fake_llm, stack, answers):
    assert client.post("/api/v1/try/agent", json={"answers": answers}).status_code in (400, 422)


def test_prepare_creates_a_hidden_short_lived_demo_agent(client, secure_db, fake_llm, stack):
    prep = _prepare(client, EN)
    assert prep["org_id"] == try_agent.PREVIEW_ORG_ID and prep["preview_token"]
    agent = secure_db["Agents"].find_one({"agent_id": prep["agent_id"]})
    config = agent["config"]
    assert config["demo"]["preview"] and config["demo"]["template_id"] == "T-ANSWER" and len(config["demo"]["card_ids"]) == 21
    assert config["prompts"]["greeting_message"] == prep["opening"] and try_agent.builder.NOTICE in prep["opening"]
    prompt = config["prompts"]["system_prompt"]
    assert "K-AGRI-02 · Verified · Why didn't my PM-KISAN instalment come?" in prompt and "<state>" in prompt
    assert config["behaviour"]["automatic_call_ending"]["enabled"] is False
    assert agent["try_preview"]["token_hash"] != prep["preview_token"]  # only a hash is stored
    org = secure_db["Organizations"].find_one({"org_id": try_agent.PREVIEW_ORG_ID})
    assert org["status"] == "active" and not secure_db["Memberships"].find_one({"org_id": try_agent.PREVIEW_ORG_ID})


def test_an_edited_greeting_still_carries_the_ai_and_demo_notice(client, secure_db, fake_llm, stack):
    prep = _prepare(client, {**EN, "greeting": "Hi, farmers' helpline here. What do you need?"})
    assert prep["opening"] == "Hi, farmers' helpline here. This is an AI demo call with sample information. What do you need?"


def test_visitors_with_the_same_picks_get_separate_agents(client, secure_db, fake_llm, stack):
    ids = [_prepare(client, EN, ip=9)["agent_id"] for _ in range(2)]
    assert len({secure_db["Agents"].find_one({"agent_id": i})["name"] for i in ids}) == 2


def test_call_needs_the_preview_token_and_opens_call_state(client, secure_db, fake_llm, stack):
    prep = _prepare(client, EN, ip=2)
    assert client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": "wrong"}).status_code == 404
    ok = client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": prep["preview_token"]})
    assert ok.status_code == 200
    state = secure_db["DemoCalls"].find_one({"call_id": ok.json()["call_id"]})
    assert state["preview"] and state["state"]["active_flow"] == "F-ANSWER"


def test_expired_preview_agents_are_refused_and_swept_with_their_calls(client, secure_db, fake_llm, stack):
    prep = _prepare(client, EN, ip=3)
    call_id = client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": prep["preview_token"]}).json()["call_id"]
    secure_db["Agents"].update_one({"agent_id": prep["agent_id"]}, {"$set": {"try_preview.expires_at": "2000-01-01T00:00:00+00:00"}})
    assert client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": prep["preview_token"]}).status_code == 404
    _prepare(client, EN, ip=3)
    assert not secure_db["Agents"].find_one({"agent_id": prep["agent_id"]})
    assert not secure_db["DemoCalls"].find_one({"call_id": call_id}) and not secure_db["CallLogs"].find_one({"call_id": call_id})


def test_runtime_tools_drive_the_flow_on_the_server(client, secure_db, fake_llm, stack):
    prep = _prepare(client, EN, ip=4)
    call_id = client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": prep["preview_token"]}).json()["call_id"]
    bad = client.post("/api/v1/try/runtime/tool", json={"org_id": prep["org_id"], "agent_id": prep["agent_id"], "call_id": call_id, "name": "get_card"})
    assert bad.status_code == 401

    found = _tool(client, prep, call_id, "search_cards", query="PM-KISAN instalment stopped")
    assert found["cards"][0]["card_id"] == "K-AGRI-02" and "Active flow: F-ANSWER" in found["state_block"]
    started = _tool(client, prep, call_id, "start_flow", flow_id="F-AGRI-PMKISAN-STOP")
    assert started["step"]["question"] == "Have you completed eKYC?"
    nxt = _tool(client, prep, call_id, "record_slot", asks_for="ekyc_done", value="yes", branch_matched=False)
    assert nxt["next"]["asks_for"] == "aadhaar_bank"
    done = _tool(client, prep, call_id, "record_slot", asks_for="aadhaar_bank", value="no", branch_matched=True)
    assert "link it at the bank" in done["say"] and done["back_in"] == "F-ANSWER"
    assert _tool(client, prep, call_id, "start_flow", flow_id="F-HEAL-TB")["error"].startswith("F-HEAL-TB isn't one of this agent's flows")
    assert _tool(client, prep, call_id, "get_card", card_id="K-HEAL-01")["error"]
    _tool(client, prep, call_id, "log_gap", caller_text="Tomato price in Belagavi? My number is 9845012345")
    gap = secure_db["DemoGaps"].find_one({"sector_id": "S-AGRI"})
    assert gap and "9845012345" not in gap["text"]
    ended = _tool(client, prep, call_id, "end_call", records={"topic_asked": ["PM-KISAN stopped", "tomato price"], "answered": "partly", "referred_to": ["bank"], "extra": "x"})
    assert ended["ok"]

    ref = {"agent_id": prep["agent_id"], "preview_token": prep["preview_token"], "call_id": call_id}
    summary = client.post("/api/v1/try/summary", json={**ref, "transcript": []}).json()
    fields = {f["key"]: f["value"] for f in summary["fields"]}
    assert fields == {"topic_asked": ["PM-KISAN stopped", "tomato price"], "answered": "partly", "referred_to": ["bank"]}
    assert summary["recorded_by_agent"] and summary["flows"][0]["flow_id"] == "F-AGRI-PMKISAN-STOP"
    assert {c["card_id"] for c in summary["cards"]} == {"K-AGRI-02"} and summary["gaps"]
    assert not fake_llm.calls
    progress = client.post("/api/v1/try/progress", json=ref).json()
    assert progress["turns"] and progress["turns"][1]["flow_id"] == "F-AGRI-PMKISAN-STOP"


def test_summary_is_read_from_the_transcript_when_the_caller_hung_up(client, fake_llm, stack):
    prep = _prepare(client, EN, ip=5)
    call_id = client.post("/api/v1/try/call", json={"agent_id": prep["agent_id"], "preview_token": prep["preview_token"]}).json()["call_id"]
    ref = {"agent_id": prep["agent_id"], "preview_token": prep["preview_token"], "call_id": call_id}
    silent = client.post("/api/v1/try/summary", json={**ref, "transcript": [{"role": "agent", "text": "Hello?"}]}).json()
    assert all(f["value"] is None for f in silent["fields"]) and not fake_llm.calls
    fake_llm.replies = ['{"topic_asked": ["crop loss"], "answered": "yes", "referred_to": "Call 9845012345", "made_up": 1}']
    transcript = [{"role": "agent", "text": "How can I help?"}, {"role": "user", "text": "My crop was damaged."}]
    body = client.post("/api/v1/try/summary", json={**ref, "transcript": transcript}).json()
    fields = {f["key"]: f["value"] for f in body["fields"]}
    assert fields["topic_asked"] == ["crop loss"] and fields["answered"] == "yes" and "9845012345" not in fields["referred_to"]
    assert not body["recorded_by_agent"] and set(fields) == {"topic_asked", "answered", "referred_to"}


def test_summary_needs_the_preview_token(client, fake_llm, stack):
    prep = _prepare(client, EN, ip=6)
    r = client.post("/api/v1/try/summary", json={"agent_id": prep["agent_id"], "preview_token": "nope", "call_id": "c1"})
    assert r.status_code == 404


def test_calls_are_capped_per_ip(client, fake_llm, stack, monkeypatch):
    monkeypatch.setattr(settings, "TRY_CALLS_PER_IP_HOUR", 2)
    codes = [client.post("/api/v1/try/prepare", json=EN, headers=_ip(14)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert client.post("/api/v1/try/prepare", json=EN, headers=_ip(15)).status_code == 200
    spoofed = client.post("/api/v1/try/prepare", json=EN, headers={"X-Forwarded-For": "1.2.3.4, 203.0.113.14"})
    assert spoofed.status_code == 429


def test_turns_are_capped_per_day(client, fake_llm, stack, monkeypatch):
    monkeypatch.setattr(settings, "TRY_TURNS_PER_DAY", 1)
    assert client.post("/api/v1/try/agent", json=KN, headers=_ip(16)).status_code == 200
    assert client.post("/api/v1/try/agent", json=KN, headers=_ip(17)).status_code == 429


def test_translate_returns_one_english_line_per_text(client, fake_llm):
    fake_llm.replies = ["1. Hello\n2. Yes, two acres"]
    body = client.post("/api/v1/try/translate", json={"language": "kn", "texts": ["ನಮಸ್ಕಾರ", "ಹೌದು", ""]}).json()
    assert body["english"] == ["Hello", "Yes, two acres", None]


def test_route_uses_the_router_prompt_and_only_known_ids(client, fake_llm):
    fake_llm.replies = ['{"template_id": "T-REMIND", "sector_id": "S-HEALTH", "topic": "vaccines", "language": "kn", "confidence": 0.9, "ask_next": "q2", "reason": "ok"}']
    body = client.post("/api/v1/try/route", json={"text": "Remind mothers about vaccines in Kannada"}).json()
    assert body["template_id"] == "T-REMIND" and body["sector_id"] == "S-HEALTH" and body["ask_next"] == "q2" and body["source"] == "model"
    assert "Remind mothers about vaccines in Kannada" in fake_llm.calls[0]["messages"][0]["content"]


def test_uploaded_document_becomes_session_cards(client, secure_db, fake_llm, stack):
    text = ("Crop insurance claims for paddy must be filed within seventy two hours of the damage. " * 4 + "\n\n") * 3
    r = client.post("/api/v1/try/sources/upload", files={"file": ("circular.txt", io.BytesIO(text.encode()), "text/plain")})
    assert r.status_code == 200, r.text
    source = r.json()
    assert source["card_count"] >= 1 and secure_db["DemoSessionSources"].find_one({"source_id": source["source_id"]})
    body = client.post("/api/v1/try/agent", json={"answers": {**EN["answers"], "source_ids": [source["source_id"]]}}).json()
    assert body["cards"] == 21 + source["card_count"] and body["session_cards"] == source["card_count"]
    only = client.post("/api/v1/try/agent", json={"answers": {**EN["answers"], "sample_knowledge": False, "source_ids": [source["source_id"]]}}).json()
    assert only["cards"] == source["card_count"]
    bad = client.post("/api/v1/try/sources/upload", files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")})
    assert bad.status_code == 400


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "https://user:pw@example.com/", "http://example.com:8080/"],
)
def test_links_to_private_or_odd_addresses_are_refused(client, url):
    r = client.post("/api/v1/try/sources/link", json={"url": url})
    assert r.status_code == 400


def test_save_needs_sign_in_and_uses_the_workspace_providers(client, secure_db, fake_llm, stack):
    assert client.post("/api/v1/try/save", json=EN).status_code in (401, 403)
    secure_db["Organizations"].insert_one({"org_id": "ws01", "name": "WS", "status": "active"})
    secure_db["Memberships"].insert_one({"email": "o@ws.example", "org_id": "ws01", "role": "super_admin"})
    auth_service.upsert_provider_auth("ws01", "openai", {"api_key": "sk-test-0000000000000000000000000000000000"})
    token = create_access_token({"sub": "o@ws.example", "org_id": "ws01", "role": "super_admin"})
    r = client.post("/api/v1/try/save", json={**EN, "greeting": "Hello farmers. How can I help?"}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    saved = secure_db["Agents"].find_one({"agent_id": r.json()["agent_id"]})
    assert saved["org_id"] == "ws01" and "try_preview" not in saved
    assert saved["config"]["demo"]["preview"] is False and saved["config"]["demo"]["kb_version"]
    assert saved["config"]["prompts"]["greeting_message"] == "Hello farmers. This is an AI demo call with sample information. How can I help?"
    assert "openai" in stack[-1]
    again = client.post("/api/v1/try/save", json=EN, headers={"Authorization": f"Bearer {token}"})
    assert again.status_code == 200 and again.json()["agent_id"] != r.json()["agent_id"]


def test_disabled_preview_is_not_found(client, monkeypatch):
    monkeypatch.setattr(settings, "TRY_ENABLED", False)
    assert client.get("/api/v1/try/catalogue").status_code == 404


def test_model_config_matches_the_wizard():
    """Port of the wizard's modelConfigFromSettings: vendor language code and field defaults."""
    from apps.providers.base import Kind

    cfg = try_stack.model_config(Kind.TTS, "openai", "kn")
    assert cfg["provider"] == "openai" and cfg["model"] and cfg["voice"] == "alloy" and "language" in cfg


def test_stack_never_guesses_an_unconfirmed_provider(monkeypatch):
    """A provider nobody confirmed gives a call that connects and stays silent, so it's refused."""
    monkeypatch.setattr(settings, "TRY_STT_PROVIDERS", "openai")
    monkeypatch.setattr(settings, "TRY_TTS_PROVIDERS", "openai")
    monkeypatch.setattr(settings, "TRY_LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "TRY_LLM_MODEL", "")
    with pytest.raises(try_stack.StackError):
        try_stack.build_models("en", set())
    models = try_stack.build_models("en", {"openai"})
    assert {m["provider"] for m in models.values()} == {"openai"}
    # The call uses the preview's model, not the provider catalog's default.
    assert models["llm_config"]["model"] == try_stack.PREVIEW_LLM_MODELS["openai"]


def test_an_openai_key_alone_covers_english_and_hindi_calls(monkeypatch):
    """OpenAI has no Kannada voice: Kannada needs another provider."""
    monkeypatch.setattr(settings, "TRY_LLM_MODEL", "")
    assert try_stack.build_models("hi", {"openai"})["tts_config"]["provider"] == "openai"
    with pytest.raises(try_stack.StackError):
        try_stack.build_models("kn", {"openai"})
    assert try_stack.build_models("kn", {"openai", "sarvam"})["tts_config"]["provider"] == "sarvam"


def test_catalogue_marks_which_languages_can_be_called(client, monkeypatch):
    monkeypatch.setattr(try_agent.auth_service, "available_providers", lambda org_id: ["openai"])
    langs = {lang["code"]: lang["call_ready"] for lang in client.get("/api/v1/try/catalogue").json()["languages"]}
    assert langs["en"] and langs["hi"] and not langs["kn"]


def test_connected_providers_come_first(monkeypatch):
    monkeypatch.setattr(settings, "TRY_LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "TRY_LLM_MODEL", "")
    models = try_stack.build_models("en", {"groq", "openai"})
    assert models["llm_config"]["provider"] == "openai"
    models = try_stack.build_models("en", {"groq", "sarvam"})
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
    monkeypatch.setattr(try_agent, "_NOTICES", {"en": try_agent.builder.NOTICE})
    r = client.post("/api/v1/try/agent", json=KN)
    assert r.status_code == 503 and "AI model" in r.json()["detail"]
