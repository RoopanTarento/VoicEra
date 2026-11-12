"""Shared PII masking and log redaction (apps.pii)."""

from __future__ import annotations

import io
import logging

import pytest

from apps.pii import looks_like_phone, mask_email, mask_phone, redact_text, scrub_mapping
from apps.pii.log_redaction import (
    PIIRedactionFilter,
    install_logging_redaction,
    is_logging_redaction_installed,
    loguru_redaction_patcher,
)


@pytest.mark.parametrize(
    "raw,masked",
    [
        ("+919876543210", "+91 ******3210"),
        ("+14155550132", "+1 ******0132"),
        ("+447911123456", "+44 ******3456"),
        ("9876543210", "******3210"),
        ("%2B919876543210", "+91 ******3210"),
        ("12", "****"),
        ("unknown", "unknown"),
    ],
)
def test_mask_phone(raw, masked):
    assert mask_phone(raw) == masked


def test_mask_email():
    assert mask_email("arun.kumar@example.gov.in") == "a***@example.gov.in"
    assert mask_email("not-an-email") == "***"


@pytest.mark.parametrize(
    "text",
    [
        "Plivo outbound call initiated: +918065480893 → +919876543210",
        "dial 9876543210 now",
        "spaced +91 98765 43210 number",
        "bracketed +1 (415) 555-0132 number",
        "urlencoded To=%2B919876543210&x=1",
        "email arun@example.com",
    ],
)
def test_redact_text_removes_numbers_and_emails(text):
    out = redact_text(text)
    for secret in ("9876543210", "98765 43210", "5550132", "555-0132", "8065480893", "arun@"):
        assert secret not in out


@pytest.mark.parametrize(
    "text",
    [
        "call_id=550e8400-e29b-41d4-a716-446655440000",
        "at 2026-11-09T15:32:19.690+00:00 port 8000",
        "contact CNT-a8f72c1e9b3d4f5a6b7c8d9e0f1a2b3c",
        "duration=12.5 retries=2",
    ],
)
def test_redact_text_leaves_ids_and_timestamps(text):
    assert redact_text(text) == text


def test_looks_like_phone():
    assert looks_like_phone("+919876543210")
    assert looks_like_phone(9876543210)
    assert not looks_like_phone("Arun")
    assert not looks_like_phone(True)


def test_scrub_mapping_masks_phone_keys_and_keeps_other_variables():
    out = scrub_mapping(
        {
            "phone_number": "+919876543210",
            "called_number": "+919876543210",
            "name": "Arun",
            "email": "arun@example.com",
            "note": "alt 9876543211",
            "is_retry": True,
        }
    )
    assert out["phone_number"] == "+91 ******3210"
    assert out["called_number"] == "+91 ******3210"
    assert out["name"] == "Arun"
    assert out["email"] == "a***@example.com"
    assert "9876543211" not in out["note"]
    assert out["is_retry"] is True


def test_stdlib_filter_redacts_args_and_exceptions():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(PIIRedactionFilter())
    logger = logging.getLogger("voicera.test.redaction")
    logger.addHandler(handler)
    logger.propagate = False
    try:
        logger.warning("to=%s cv=%s", "+919876543210", {"called_number": "+919876543211"})
        try:
            raise ValueError("bad number +919876543212")
        except ValueError:
            logger.exception("failed")
    finally:
        logger.removeHandler(handler)
    output = stream.getvalue()
    for n in ("9876543210", "9876543211", "9876543212"):
        assert n not in output
    assert "+91 ******3210" in output


def test_install_logging_redaction_is_idempotent():
    root = logging.getLogger()
    handler = logging.StreamHandler(io.StringIO())
    root.addHandler(handler)
    try:
        install_logging_redaction()
        install_logging_redaction()
        assert sum(isinstance(f, PIIRedactionFilter) for f in handler.filters) == 1
        assert is_logging_redaction_installed()
    finally:
        root.removeHandler(handler)


def test_loguru_patcher():
    record = {"message": "custom_variables={'called_number': '+919876543210'}", "extra": {"to": "+919876543211"}}
    loguru_redaction_patcher(record)
    assert "9876543210" not in record["message"]
    assert "9876543211" not in str(record["extra"])


def test_filter_keeps_structured_args_for_uvicorn_access_log():
    from uvicorn.logging import AccessFormatter

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False))
    handler.addFilter(PIIRedactionFilter())
    logger = logging.getLogger("voicera.test.access")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False
    try:
        logger.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET", "/calls?to=+919876543210", "1.1", 200)
    finally:
        logger.removeHandler(handler)
    output = stream.getvalue()
    assert "127.0.0.1:5000" in output and "200" in output
    assert "9876543210" not in output
