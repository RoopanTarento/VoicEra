"""Mock telephony provider for local demos and tests (VoicEra Secure).

Not registered on import: ``load_providers()`` only imports ``config`` and
``service`` modules, and this package has neither, so production catalogs and
the existing Plivo / Vobiz registry tests are unaffected. Call
:func:`enable_mock_provider` (the API does when ``TELEPHONY_MOCK_ENABLED`` is
true) to register it under the provider id ``mock``.

The mock behaves like a provider: it receives the real destination number,
returns a call UUID, and later delivers a hangup callback carrying ``From`` /
``To`` / ``CallUUID`` exactly as Plivo would. By default the callback is an
HTTP POST to the call's ``hangup_url`` (the voice runtime's ``/answer``);
an in-process sink can be installed instead with :func:`set_callback_sink`.
"""

from apps.telephony.providers.mock.provider import (
    MockClient,
    MockConfig,
    MockOutcome,
    disable_mock_provider,
    enable_mock_provider,
    is_mock_enabled,
    outcome_for,
    reset_mock_state,
    set_callback_sink,
)

__all__ = [
    "MockClient",
    "MockConfig",
    "MockOutcome",
    "disable_mock_provider",
    "enable_mock_provider",
    "is_mock_enabled",
    "outcome_for",
    "reset_mock_state",
    "set_callback_sink",
]
