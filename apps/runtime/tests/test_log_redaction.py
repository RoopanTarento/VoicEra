"""Runtime logs never carry raw phone numbers (VoicEra Secure)."""

from __future__ import annotations

import io

from loguru import logger

from apps.pii.log_redaction import loguru_redaction_patcher


def test_loguru_patcher_masks_numbers_in_formatted_messages():
    sink = io.StringIO()
    patched = logger.patch(loguru_redaction_patcher)
    handler_id = logger.add(sink, format="{message}")
    try:
        patched.info("Call context custom_variables={}", {"called_number": "+919876543210"})
        patched.info("caller={} email={}", "9876543211", "arun@example.com")
    finally:
        logger.remove(handler_id)
    output = sink.getvalue()
    assert "9876543210" not in output and "9876543211" not in output
    assert "arun@example.com" not in output
    assert "+91 ******3210" in output


def test_runtime_app_installs_redaction():
    import apps.runtime.app  # noqa: F401  (import installs the global patcher)

    sink = io.StringIO()
    handler_id = logger.add(sink, format="{message}")
    try:
        logger.info("to={}", "+919876543212")
    finally:
        logger.remove(handler_id)
    assert "9876543212" not in sink.getvalue()
