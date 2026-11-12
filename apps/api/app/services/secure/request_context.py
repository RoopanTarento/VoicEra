"""Per-request correlation ID and source IP, carried in context variables.

``RequestContextMiddleware`` sets them for HTTP requests; background workers
can call :func:`bind` to give a batch its own correlation ID.
"""

from __future__ import annotations

import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-ID"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")

_correlation_id: ContextVar[str | None] = ContextVar("voicera_correlation_id", default=None)
_source_ip: ContextVar[str | None] = ContextVar("voicera_source_ip", default=None)


def new_correlation_id() -> str:
    return f"req-{uuid.uuid4().hex[:20]}"


def correlation_id() -> str:
    """Current correlation ID, creating one for code running outside a request."""
    value = _correlation_id.get()
    if value is None:
        value = new_correlation_id()
        _correlation_id.set(value)
    return value


def source_ip() -> str | None:
    return _source_ip.get()


@contextmanager
def bind(correlation: str | None = None, ip: str | None = None) -> Iterator[str]:
    cid_token = _correlation_id.set(correlation or new_correlation_id())
    ip_token = _source_ip.set(ip)
    try:
        yield _correlation_id.get() or ""
    finally:
        _correlation_id.reset(cid_token)
        _source_ip.reset(ip_token)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Accept a well-formed inbound X-Request-ID or mint one; echo it back."""

    async def dispatch(self, request: Request, call_next) -> Response:
        inbound = request.headers.get(REQUEST_ID_HEADER, "")
        cid = inbound if _SAFE_REQUEST_ID.match(inbound) else new_correlation_id()
        ip = request.client.host if request.client else None
        with bind(cid, ip):
            response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = cid
        return response
