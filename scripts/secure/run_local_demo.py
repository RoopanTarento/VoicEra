"""Run the VoicEra Secure demo locally without Docker.

Starts the real VoicEra API (all routers, including /api/v1/secure) in one
process, backed by in-memory stand-ins:

* FerretDB/MongoDB -> mongomock (data is lost when the process stops)
* Redis            -> fakeredis TCP server on 127.0.0.1:6390, shared by the API,
                      the ARQ campaign worker and the campaign orchestrator
* Telephony        -> the mock provider (never places real calls)
* MinIO            -> not available; legacy CSV campaign uploads will fail

It then seeds a demo adopter whose owner is also a platform admin, one user
per role (admin, campaign manager, member), a second adopter,
mock telephony credentials, a telephony agent and an attached caller ID, so
the whole demo runs from the dashboard with no manual database work.

Usage (from the repository root, with the API requirements and
apps/api/requirements-test.txt installed):

    PYTHONPATH="$PWD:$PWD/apps/api" python scripts/secure/run_local_demo.py

Then start the dashboard (``cd frontend && npm run dev``) and sign in with
the credentials printed at start-up. Set DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD
to choose them yourself.

For a real deployment use docker compose with real keys; this launcher is for
demonstrations only.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import socket
import sys
import threading
import time

API_PORT = int(os.getenv("DEMO_API_PORT", "8000"))
REDIS_PORT = int(os.getenv("DEMO_REDIS_PORT", "6390"))


def _key() -> str:
    import base64

    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()


def _configure_env() -> dict[str, str]:
    """Demo-only settings. Ephemeral keys are generated unless provided."""
    admin_email = os.getenv("DEMO_ADMIN_EMAIL", "admin@voicera-secure.demo")
    os.environ["DEMO_ADMIN_EMAIL"] = admin_email
    demo = {
        "PLATFORM_ADMIN_EMAILS": os.getenv("PLATFORM_ADMIN_EMAILS", admin_email),
        "MONGODB_HOST": "mongomock",
        "REDIS_URL": f"redis://127.0.0.1:{REDIS_PORT}",
        "TELEPHONY_MOCK_ENABLED": "true",
        "TELEPHONY_MOCK_CALLBACK_DELAY_SECONDS": os.getenv("TELEPHONY_MOCK_CALLBACK_DELAY_SECONDS", "3"),
        "VOICE_SERVER_BASE_URL": os.getenv("VOICE_SERVER_BASE_URL", "http://127.0.0.1:7860"),
        "SECRET_KEY": os.getenv("DEMO_SECRET_KEY", secrets.token_urlsafe(32)),
        "INTERNAL_API_KEY": os.getenv("DEMO_INTERNAL_API_KEY", secrets.token_urlsafe(32)),
        "PROVIDER_AUTH_ENCRYPTION_KEY": os.getenv("DEMO_PROVIDER_AUTH_KEY", ""),
        "ENABLE_CAMPAIGN_ORCHESTRATOR": "false",
    }
    if not demo["PROVIDER_AUTH_ENCRYPTION_KEY"]:
        from cryptography.fernet import Fernet

        demo["PROVIDER_AUTH_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
    if not os.getenv("SECURE_VAULT_KEYS"):
        demo["SECURE_VAULT_KEYS"] = f"v1:{_key()}"
        demo["SECURE_VAULT_ACTIVE_KEY_VERSION"] = "v1"
        demo["SECURE_VAULT_INDEX_KEY"] = _key()
    os.environ.update(demo)
    return demo


def _start_fake_redis() -> None:
    from fakeredis import TcpFakeServer

    server = TcpFakeServer(("127.0.0.1", REDIS_PORT), server_type="redis")
    threading.Thread(target=server.serve_forever, daemon=True, name="fakeredis").start()
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", REDIS_PORT), timeout=0.2).close()
            return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("fakeredis server did not start")


def _patch_database() -> None:
    import mongomock

    from app import database

    client = mongomock.MongoClient()

    def connect_to_mongo() -> None:
        database.mongodb.client = client
        database.mongodb.database = client["voicera"]

    database.connect_to_mongo = connect_to_mongo  # type: ignore[assignment]
    database.ping_database = lambda: True  # type: ignore[assignment]
    import app.main as main_module

    main_module.connect_to_mongo = connect_to_mongo  # type: ignore[attr-defined]
    main_module.ping_database = lambda: True  # type: ignore[attr-defined]
    connect_to_mongo()


async def _seed(base: str) -> dict[str, str]:
    import httpx

    from app.models.schemas import AgentCreateRequest

    email = os.getenv("DEMO_ADMIN_EMAIL", "admin@voicera-secure.demo")
    password = os.getenv("DEMO_ADMIN_PASSWORD", secrets.token_urlsafe(12))
    async with httpx.AsyncClient(base_url=base, timeout=30) as client:
        r = await client.post(
            "/users/signup",
            json={"email": email, "password": password, "organisation_name": "District Health Mission (demo)"},
        )
        r.raise_for_status()
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        r = await client.post(
            "/auth",
            headers=headers,
            json={"provider": "mock", "auth": {"auth_id": "mock-account", "auth_token": "mock-token"}},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Storing mock credentials failed: {r.text}")
        example = AgentCreateRequest.model_config["json_schema_extra"]["examples"][0]  # type: ignore[index]
        agent_body = {
            **example,
            "name": "Scheme awareness agent",
            "agent_category": "telephony",
            "telephony_provider": "mock",
        }
        r = await client.post("/agents", headers=headers, json=agent_body)
        if r.status_code >= 400:
            raise RuntimeError(f"Creating the demo agent failed: {r.text}")
        agent_id = r.json()["agent_id"]
        r = await client.post(
            "/phone-numbers/attach",
            headers=headers,
            json={"phone_number": "+918000000101", "provider": "mock", "agent_id": agent_id},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Attaching the demo caller ID failed: {r.text}")

        # One user per role in the first adopter (same demo password).
        team = {}
        for role in ("admin", "campaign_manager", "member"):
            member_email = f"{role.replace('_', '.')}@voicera-secure.demo"
            r = await client.post(
                "/members/invite", headers=headers, json={"email": member_email, "password": password, "role": role}
            )
            if r.status_code >= 400:
                raise RuntimeError(f"Inviting {role} failed: {r.text}")
            team[role] = member_email

        # A second adopter, created the way the platform team would.
        r = await client.post(
            "/platform/adopters",
            headers=headers,
            json={"name": "Rural Livelihoods Board (demo)", "owner_email": "owner@adopter-b.demo", "owner_password": password},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Creating the second adopter failed: {r.text}")
        # The demo owner is also an Analyst in the second adopter, to show switching.
        r = await client.post("/users/login", json={"email": "owner@adopter-b.demo", "password": password})
        r.raise_for_status()
        r = await client.post(
            "/members/invite",
            headers={"Authorization": f"Bearer {r.json()['access_token']}"},
            json={"email": email, "password": password, "role": "campaign_manager"},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Adding the demo owner to the second adopter failed: {r.text}")
    return {"email": email, "password": password, "agent_id": agent_id, "team": team}


async def _main() -> None:
    import uvicorn
    from arq.worker import Worker

    from app.config import settings
    from app.main import app
    from app.services.campaign.campaign_orchestrator import CampaignOrchestrator
    from app.tasks.arq import WorkerSettings

    import arq.worker
    import redis.asyncio as aioredis

    async def _skip_redis_info(*_args, **_kwargs) -> None:
        """fakeredis does not implement INFO, which ARQ only uses for a log line."""

    arq.worker.log_redis_info = _skip_redis_info  # type: ignore[assignment]

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=API_PORT, log_level="info"))
    worker = Worker(
        functions=WorkerSettings.functions,
        redis_settings=WorkerSettings.redis_settings,
        max_jobs=WorkerSettings.max_jobs,
        on_startup=WorkerSettings.on_startup,
        handle_signals=False,
    )
    orchestrator = CampaignOrchestrator(await aioredis.from_url(settings.REDIS_URL, decode_responses=True))
    orchestrator.completion_check_interval = 15

    api_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.1)
    seeded = await _seed(f"http://127.0.0.1:{API_PORT}{settings.API_V1_PREFIX}")
    print(
        "\n"
        "  VoicEra Secure local demo is running\n"
        f"  API:        http://127.0.0.1:{API_PORT}/docs\n"
        "  Dashboard:  cd frontend && npm run dev, then open http://localhost:3000\n"
        f"  Sign in:    {seeded['email']} / {seeded['password']}  (owner of adopter A + platform admin)\n"
        f"  Same password for: {', '.join(seeded['team'].values())}, owner@adopter-b.demo\n"
        "  Agent:      'Scheme awareness agent' on the mock provider\n"
        "  Data is in memory and disappears when this process stops.\n",
        flush=True,
    )
    await asyncio.gather(api_task, worker.async_run(), orchestrator.run())


def main() -> None:
    _configure_env()
    _start_fake_redis()
    _patch_database()
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
