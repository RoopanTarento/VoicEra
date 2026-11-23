"""Voicera FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_mongo_connection, connect_to_mongo, ping_database
from app.database_init import initialize_database
from app.routers import (
    agents,
    audit_log,
    auth,
    calls,
    campaign,
    configuration,
    contact_lists,
    copilot,
    knowledge,
    languages,
    members,
    organisations,
    phone_numbers,
    platform,
    rag,
    secure,
    try_agent,
    use_cases,
    users,
)
from app.routers import rbac as rbac_router
from app.rbac import authorize
from app.services.secure.request_context import RequestContextMiddleware
from app.services.secure.startup import configure_secure_runtime

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# VoicEra Secure: redact phone numbers / emails in every log line, and
# register the mock telephony provider when TELEPHONY_MOCK_ENABLED is set.
configure_secure_runtime()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Connect to FerretDB and ensure auth collections/indexes on startup."""
    logger.info("Starting up application...")
    try:
        connect_to_mongo()
        initialize_database()
        from app.rbac import migrate_legacy_roles

        migrate_legacy_roles()
        logger.info("Application started successfully")
    except Exception as exc:
        logger.error("Failed to start application: %s", exc)
        raise

    yield

    logger.info("Shutting down application...")
    close_mongo_connection()
    logger.info("Application shut down successfully")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "Voicera Backend API — auth, organisations, agents, "
        "provider catalogs, and credentials"
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# Every router is guarded by central RBAC + adopter checks (app.rbac). Routes
# without an entry in rbac.ROUTE_POLICY are refused.
_guard = [Depends(authorize)]
for _router in (
    users.router,
    members.router,
    organisations.router,
    languages.router,
    configuration.router,
    auth.router,
    agents.router,
    phone_numbers.router,
    calls.router,
    campaign.router,
    contact_lists.router,
    knowledge.router,
    rag.router,
    copilot.router,
    audit_log.router,
    secure.router,
    platform.router,
    rbac_router.router,
    use_cases.router,
    try_agent.router,
):
    app.include_router(_router, prefix=settings.API_V1_PREFIX, dependencies=_guard)

@app.exception_handler(RequestValidationError)
async def _validation_errors(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Standard 422 body, with a plain message for invalid email addresses."""
    errors = []
    for err in exc.errors():
        if err.get("loc") and str(err["loc"][-1]).endswith("email"):
            err = {**err, "msg": "Enter a valid email address (for example name@organisation.gov.in)."}
        errors.append(err)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


@app.get("/")
async def root() -> dict[str, str]:
    """Root welcome endpoint."""
    return {
        "message": f"Welcome to {settings.PROJECT_NAME}",
        "version": settings.VERSION,
        "docs": "/docs",
    }


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness/readiness probe including database ping."""
    db_ok = ping_database()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "up" if db_ok else "down",
    }
