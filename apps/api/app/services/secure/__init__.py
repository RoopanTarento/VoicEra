"""VoicEra Secure — contact tokenisation, encrypted vault, resolution and audit.

Layering mirrors the rest of ``app.services``:

* ``keys`` / ``crypto`` — key management abstraction and AES-256-GCM.
* ``phone`` — E.164 validation and normalisation.
* ``tokenization`` — opaque contact IDs.
* ``vault_repository`` — ContactVault persistence (ciphertext never leaves it
  except through ``resolution``).
* ``contact_ingest`` — CSV validation, dedupe and bulk tokenisation.
* ``service_identity`` / ``resolution`` — authorised, audited decryption.
* ``gateway`` — contact-ID based outbound dialling.
* ``security_audit`` — SecurityAuditEvents.
* ``masking`` — API-boundary masking of call logs and campaign data.
"""
