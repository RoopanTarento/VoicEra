"""Process start-up hooks shared by the API, the ARQ worker and the orchestrator."""

from __future__ import annotations

import logging
import os

from app.config import get_settings
from apps.pii.log_redaction import install_logging_redaction

logger = logging.getLogger(__name__)


def configure_secure_runtime() -> None:
    """Install log redaction and, when enabled, the mock telephony provider.

    The mock provider's hangup callbacks are applied in-process by default
    (``TELEPHONY_MOCK_CALLBACK_MODE=in_process``) because the mock has no media
    stream for the voice runtime to mark a call answered. Set the mode to
    ``http`` to send them to the runtime's ``/answer`` webhook instead.
    """
    install_logging_redaction()
    if not get_settings().TELEPHONY_MOCK_ENABLED:
        return
    from app.services.secure.gateway import handle_provider_callback
    from apps.telephony.providers.mock import enable_mock_provider, set_callback_sink

    enable_mock_provider()
    mode = os.getenv("TELEPHONY_MOCK_CALLBACK_MODE", "in_process").strip().lower()
    set_callback_sink(None if mode == "http" else handle_provider_callback)
    logger.warning("Mock telephony provider enabled (callbacks: %s). Do not use in production.", mode)
