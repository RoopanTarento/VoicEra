"""Run the VoicEra backend locally against a real, persistent MongoDB (no Docker).

Unlike ``run_local_demo.py`` nothing is in memory except the job queue:
accounts, organisations, roles, protected contacts, campaigns and audit
events are stored in the MongoDB configured in ``.env`` (MONGODB_HOST,
MONGODB_PORT, MONGODB_DATABASE) and survive restarts. Encryption keys come
from ``.env`` (SECURE_VAULT_KEYS), so stored numbers stay readable across
restarts too.

Started in one process:

* the API on 127.0.0.1:8000 (the dashboard's dev server proxies /api/v1 here)
* the ARQ campaign worker and the campaign orchestrator
* a Redis-compatible in-process server on 127.0.0.1:6390 for the job queue
  and rate limits (transient by nature; nothing durable lives there)
* the mock telephony provider, so calls can be tested without a carrier
  (pass ``--no-mock`` to leave it off; Plivo / Vobiz work either way)
* when no MinIO answers on MINIO_ENDPOINT, a folder stands in for it
  (~/.voicera/objects), so uploads such as Agent Builder attachments and
  campaign CSVs work; presigned URLs (browser uploads straight to MinIO) don't

Not included: the voice runtime. Use docker compose for that, and for real MinIO.

Usage, from the repository root:

    PYTHONPATH="$PWD:$PWD/apps/api" .venv/bin/python scripts/secure/run_local_backend.py
"""

from __future__ import annotations

import argparse
import asyncio
import os
import socket
import sys
import threading
import time

API_PORT = int(os.getenv("LOCAL_API_PORT", "8000"))
REDIS_PORT = int(os.getenv("LOCAL_REDIS_PORT", "6390"))


def _start_queue_server() -> None:
    from fakeredis import TcpFakeServer

    server = TcpFakeServer(("127.0.0.1", REDIS_PORT), server_type="redis")
    threading.Thread(target=server.serve_forever, daemon=True, name="queue-redis").start()
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", REDIS_PORT), timeout=0.2).close()
            return
        except OSError:
            time.sleep(0.05)
    raise SystemExit(f"Could not start the job-queue server on port {REDIS_PORT}")


def _use_local_object_store() -> str:
    """Point MinIOStorage at a folder when no MinIO is running. Patches the
    class itself, so every module that imported it gets the stand-in."""
    endpoint = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    host, _, port = endpoint.partition(":")
    try:
        socket.create_connection((host or "localhost", int(port or 9000)), timeout=0.5).close()
        return f"MinIO at {endpoint}"
    except OSError:
        pass

    from pathlib import Path

    from app.storage.minio_client import MinIOStorage

    root = Path(os.getenv("VOICERA_HOME", str(Path.home() / ".voicera"))) / "objects"

    def _path(bucket: str, key: str) -> Path:
        target = (root / bucket / key).resolve()
        if root.resolve() not in target.parents:
            raise ValueError(f"Object key escapes the store: {key}")
        return target

    async def get_object_bytes(self, object_key: str, bucket_name: str | None = None) -> bytes:
        return _path(bucket_name or self.default_bucket, object_key).read_bytes()

    async def put_object_bytes(self, object_key, data, *, bucket_name=None, content_type="text/csv") -> None:
        target = _path(bucket_name or self.default_bucket, object_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def object_exists(self, bucket_name: str, object_name: str) -> bool:
        return _path(bucket_name, object_name).is_file()

    MinIOStorage.get_object_bytes = get_object_bytes  # type: ignore[method-assign]
    MinIOStorage.put_object_bytes = put_object_bytes  # type: ignore[method-assign]
    MinIOStorage.object_exists = object_exists  # type: ignore[method-assign]
    return f"folder {root} (no MinIO on {endpoint})"


def _check_database() -> str:
    from app.config import get_settings
    from app.database import connect_to_mongo, get_database

    s = get_settings()
    try:
        connect_to_mongo()
    except Exception as exc:  # noqa: BLE001 - report any connection failure plainly
        raise SystemExit(
            f"MongoDB is not reachable at {s.MONGODB_HOST}:{s.MONGODB_PORT} ({exc}).\n"
            "Start it first, for example:\n"
            "  ~/.voicera/mongodb/bin/mongod --dbpath ~/.voicera/data/db --port "
            f"{s.MONGODB_PORT} --bind_ip 127.0.0.1"
        ) from exc
    if not s.SECURE_VAULT_KEYS:
        raise SystemExit("SECURE_VAULT_KEYS is not set in .env; stored numbers would be unreadable after a restart.")
    return f"{s.MONGODB_HOST}:{s.MONGODB_PORT}/{get_database().name}"


async def _main(mock: bool) -> None:
    import arq.worker
    import redis.asyncio as aioredis
    import uvicorn
    from arq.worker import Worker

    from app.config import settings
    from app.main import app
    from app.services.campaign.campaign_orchestrator import CampaignOrchestrator
    from app.tasks.arq import WorkerSettings

    async def _skip_redis_info(*_args, **_kwargs) -> None:
        """The in-process queue server does not implement INFO (used only for a log line)."""

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
    # Production waits an hour without activity before marking a campaign
    # completed (late callbacks and retries); locally, show results sooner.
    orchestrator.completion_timeout = int(os.getenv("LOCAL_CAMPAIGN_COMPLETION_SECONDS", "120"))

    api_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.1)
    print(
        "\n"
        "  VoicEra backend is running (persistent)\n"
        f"  API:        http://127.0.0.1:{API_PORT}/docs\n"
        f"  Database:   {_DB_LABEL}\n"
        f"  Files:      {_FILES_LABEL}\n"
        f"  Telephony:  {'mock provider enabled; ' if mock else ''}Plivo / Vobiz via Integrations\n"
        "  Dashboard:  http://localhost:3000 (npm --prefix frontend run dev)\n",
        flush=True,
    )
    await asyncio.gather(api_task, worker.async_run(), orchestrator.run())


_DB_LABEL = ""
_FILES_LABEL = ""


def main() -> None:
    global _DB_LABEL, _FILES_LABEL
    parser = argparse.ArgumentParser(description="Run the VoicEra backend against a persistent MongoDB")
    parser.add_argument("--no-mock", action="store_true", help="Don't register the mock telephony provider")
    args = parser.parse_args()

    os.environ["REDIS_URL"] = f"redis://127.0.0.1:{REDIS_PORT}"
    os.environ.setdefault("ENABLE_CAMPAIGN_ORCHESTRATOR", "false")
    if not args.no_mock:
        os.environ["TELEPHONY_MOCK_ENABLED"] = "true"

    _DB_LABEL = _check_database()
    _FILES_LABEL = _use_local_object_store()
    _start_queue_server()
    try:
        asyncio.run(_main(mock=not args.no_mock))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
