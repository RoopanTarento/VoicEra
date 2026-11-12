"""Log redaction hooks for stdlib ``logging`` (API, workers) and loguru (runtime)."""

from __future__ import annotations

import logging
from typing import Any

from apps.pii.redaction import redact_text, redact_value

_INSTALLED_MARKER = "_voicera_pii_redaction"

# Loggers that keep their own handlers instead of propagating to root.
_EXTRA_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access", "arq", "arq.worker")


class PIIRedactionFilter(logging.Filter):
    """Rewrite each record so its rendered message contains no phone numbers.

    The format string and every string argument are redacted in place, keeping
    ``args`` structured because some formatters (uvicorn's access log) unpack
    them positionally. String arguments are rendered through ``str`` first so
    dicts / lists passed as ``%s`` are covered too. Exception text is redacted.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_text(record.msg)
        else:
            record.msg = redact_text(str(record.msg))
        if isinstance(record.args, tuple):
            record.args = tuple(_redact_arg(a) for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {k: _redact_arg(v) for k, v in record.args.items()}
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact_text(record.exc_text)
        return True


def _redact_arg(value: Any) -> Any:
    """Redact one ``%``-style log argument without changing numeric types."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, (dict, list, tuple, set)) or hasattr(value, "__dict__"):
        rendered = str(value)
        cleaned = redact_text(rendered)
        return cleaned if cleaned != rendered else value
    return value


def _attach(handler: logging.Handler) -> bool:
    if any(isinstance(f, PIIRedactionFilter) for f in handler.filters):
        return False
    handler.addFilter(PIIRedactionFilter())
    return True


def install_logging_redaction() -> int:
    """Attach :class:`PIIRedactionFilter` to every handler on root and known loggers.

    Handler-level filters see records from all child loggers that propagate,
    unlike logger-level filters. Idempotent; returns how many handlers changed.
    """
    attached = 0
    for name in ("", *_EXTRA_LOGGERS):
        logger = logging.getLogger(name)
        for handler in logger.handlers:
            attached += int(_attach(handler))
        setattr(logger, _INSTALLED_MARKER, True)
    return attached


def is_logging_redaction_installed() -> bool:
    """True when every root handler carries the redaction filter."""
    root = logging.getLogger()
    if not root.handlers:
        return False
    return all(
        any(isinstance(f, PIIRedactionFilter) for f in h.filters) for h in root.handlers
    )


def loguru_redaction_patcher(record: dict[str, Any]) -> None:
    """loguru ``patcher``: redact the formatted message and structured extras.

    Tracebacks rendered by ``logger.exception`` are not rewritten; call sites
    must not put raw numbers in exception messages.
    """
    record["message"] = redact_text(record["message"])
    if record.get("extra"):
        record["extra"].update(redact_value(dict(record["extra"])))


def install_loguru_redaction() -> None:
    """Configure the global loguru logger to redact every record."""
    from loguru import logger

    logger.configure(patcher=loguru_redaction_patcher)
