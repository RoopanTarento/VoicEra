# VoicEra Secure API

Base path `/api/v1/secure`. All routes except `resolve` take the dashboard's `Authorization: Bearer <JWT>` and act on the organisation in the token. Interactive documentation: `http://localhost:8000/docs` (tag **secure**).

No route returns a phone number, ciphertext, nonce, blind index or key, except `POST /contacts/{id}/resolve` to an authenticated service identity. Every response carries `X-Request-ID`; the same value is the `correlation_id` on any audit event the request produced.

Errors use VoicEra's existing shape: `{"detail": "<message>"}`.

## Contacts

| Method and path | Role | Description |
|---|---|---|
| `POST /contacts/upload` | member | Multipart `file` (.csv, ≤ `CAMPAIGN_MAX_CSV_BYTES`) and optional `synthetic` (bool). Validates every row and stages valid ones encrypted for 24 h. Returns `batch_id`, `summary`, `detected` columns, `rows` (first 200, masked) and `issues`. 422 for an unusable file; 503 if vault keys are not configured. |
| `POST /contacts/tokenize` | member | Body `{"batch_id": "BATCH-…"}`. Encrypts staged rows under new contact IDs. Returns `created`, `skipped_duplicates`, `failed`, `contacts`. 404 unknown batch (or another organisation's); 409 already tokenised or expired. |
| `GET /contacts/batches` | member | Recent uploads with summaries and results. |
| `GET /contacts` | member | Query: `status` (active / inactive / deleted; default excludes deleted), `search` (name, `CNT-` prefix, or last 1–4 digits), `batch_id`, `limit` ≤ 500, `offset`. |
| `GET /contacts/export` | member | CSV: contact_id, name, masked_phone, masked_email, status, key_version, created_at. Formula-safe. Audited as `contact.export`. |
| `GET /contacts/{contact_id}` | member | `{contact, events}`; contact is the safe view, events are its last 20 security events. Audited as `contact.view`. |
| `POST /contacts/{contact_id}/status` | admin | Body `{"status": "active" \| "inactive"}`. Inactive contacts cannot be resolved. |
| `DELETE /contacts/{contact_id}` | admin | Erase: destroys ciphertext and blind index, keeps a masked tombstone. The number can be uploaded again later as a new contact. |
| `POST /contacts/retention/purge` | admin | Erases inactive contacts older than the organisation's retention and clears expired staging rows. |

Safe view fields: `contact_id, display_name, masked_phone, masked_email, country_code, region, attributes, key_version, status, synthetic, encrypted, encryption_algorithm, source, created_by, created_at, updated_at, deleted_at, last_resolved_at, resolution_count`.

## Resolution (service to service)

`POST /contacts/{contact_id}/resolve`

Headers: `X-Service-Id`, `X-Service-Key` for an entry in `SECURE_SERVICE_CREDENTIALS`. Body: `{"org_id": "<owning org>", "purpose": "dial"}`.

| Outcome | Status | Audit event |
|---|---|---|
| Authorised | 200 `{"contact_id", "phone_number", "masked_phone"}` | `contact.resolve` success |
| Service key unknown or wrong | 401 | `auth.failed` |
| No credentials | 401 | `auth.failed` |
| User JWT presented | 403 | `contact.resolve` denied, reason `unauthenticated` |
| Scope does not cover purpose | 403 | `contact.resolve` denied |
| Contact missing or in another organisation | 404 (identical message) | `contact.resolve` denied, `contact_not_found` |
| Contact inactive / deleted | 403 | `contact_inactive` / `contact_deleted` |
| Rate limit exceeded | 429 | `rate_limited` |
| Ciphertext fails authentication | 403 | `integrity_failure` |

The dashboard and campaigns never use this route. The secure gateway resolves in-process under its own identity (`secure-telephony-gateway`, scope `contacts:resolve:dial`).

## Contact sets and campaigns

`POST /contact-sets` (member). Body `{"name", "contact_ids": [...]}` or `{"name", "batch_id"}` or `{"name", "all_active": true}`. Only active contacts of the caller's organisation are included; `skipped` counts the rest. Returns `set_id`.

Create the campaign with the existing endpoint:

```http
POST /api/v1/campaign/create
{"name": "Wave 1", "agent_id": "…", "source_type": "secure_contacts", "source_id": "CSET-…"}
```

Start, pause, resume and redial work unchanged. Queued runs hold `contact_id`, `name` and attributes only.

`GET /campaigns` (member). Each campaign's protection status: `protected`, `source_type`, `contact_set`, progress, `plaintext_queue_entries`, `calls`, `calls_tokenised`; plus `contact_sets` and the organisation `policy`.

## Gateway

| Method and path | Role | Description |
|---|---|---|
| `POST /gateway/calls` | member | Body `{"agent_id", "contact_id", "from_number"?, "custom_variables"?}`. Resolves and dials through the agent's provider. Returns the CallLog summary with `to_number` masked. 403 when the contact cannot be resolved or a synthetic contact meets a real provider; 404 unknown contact or agent. |
| `GET /gateway/activity` | member | Registered providers, whether the mock is enabled, and recent `gateway.call`, `contact.resolve` and `callback.sanitized` events. |

## Overview, audit and settings

| Method and path | Role | Description |
|---|---|---|
| `GET /overview?days=14` | member | Totals, daily series (protection, resolutions), events by category, campaign protection summary, recent events and health checks. `days` 7–90. |
| `GET /audit` | admin | Filters: `event_type`, `category`, `outcome` (success / denied / error), `actor`, `contact_id`, `date_from`, `date_to` (ISO; a bare date for `date_to` covers the whole day), `limit` ≤ 500, `offset`. Returns `events`, `total`, and the distinct `event_types`, `categories`, `actors` for filter menus. |
| `GET /settings` | admin | Keyring (versions, fingerprints, record counts; never key material), organisation policy, resolution controls, mock status, health checks. |
| `PATCH /settings` | admin | Body `{"require_vault_campaigns"?: bool, "retention_days"?: 1–3650}`. Audited as `config.change` with before and after values. |
| `POST /settings/rotate-keys` | admin | Re-encrypts records not on the active key. Returns `rotated`, `failed`, `from_versions`. Audited as `key.rotation`. |

Viewers calling an admin route get 403 and an `auth.failed` event with action `insufficient_role`.

## Audit event types

| Event | Category |
|---|---|
| `contact.upload`, `contact.tokenize`, `contact_set.create` | ingest |
| `contact.view`, `contact.export` | data_access |
| `contact.resolve`, `contact.bulk_resolve` | resolution |
| `contact.status_change`, `contact.delete`, `contact.purge` | lifecycle |
| `gateway.call`, `callback.sanitized` | telephony |
| `key.rotation` | key_management |
| `config.change` | configuration |
| `auth.failed` | authentication |
| `access.suspicious` | threat |


## Changes to existing endpoints

| Endpoint | Change |
|---|---|
| `POST /campaign/upload` | The CSV is validated in memory; every number is hashed and encrypted under the adopter's keys and the file is not stored. Returns `source_id` (a `CSET-…` contact set), `source_type: "secure_contacts"`, `contact_rows`, `new_contacts`, `protected: true`. 503 if no master key is configured. |
| `POST /campaign/create` | Accepts `source_type: "secure_contacts"`; `"csv"` with a `CSET-` source is treated the same. |
| `POST /calls/outbound` | The destination is hashed and encrypted; the call log stores `contact_id` and the masked number. |
| `POST /members/invite` | Optional `role` (admin only by the Super admin). |
| Every route | Checked against `app.rbac.ROUTE_POLICY`; 401 without a valid token, 403 with `detail` naming the missing permission, a suspended adopter, or a removed membership. |

## Roles

| Method and path | Access | Description |
|---|---|---|
| `GET /rbac/me` | signed in | Caller's role in the active adopter, its permissions, `platform_admin`, `adopter_status` |
| `GET /rbac/roles` | signed in | Role catalogue with permissions and descriptions |
| `PATCH /members/role` | members:write | Body `{"email", "role"}`. Super admin: any role but Super admin. Admin: Campaign manager or Viewer (`member`), never another Admin or the Super admin. Nobody changes their own role. |

## Platform (VoicEra operators)

All require platform admin. Responses contain counts and key metadata, never contacts or numbers.

| Method and path | Description |
|---|---|
| `GET /platform/adopters` | Every adopter with status, owners, members by role, agents, campaigns, calls, protected contacts, key status |
| `POST /platform/adopters` | Body `{"name", "owner_email", "owner_password"?}`. Creates the adopter, its keys and owner membership. 409 if the name exists. |
| `GET /platform/adopters/{org_id}` | One adopter plus its last 20 security events |
| `POST /platform/adopters/{org_id}/status` | Body `{"status": "active" \| "suspended", "reason"?}`. Suspension pauses running campaigns and makes the adopter's keys unavailable. |
| `POST /platform/adopters/{org_id}/rotate-key` | New adopter key version; re-encrypts and re-hashes that adopter's records |
| `POST /platform/adopters/{org_id}/revoke-key` | Body `{"confirm_name"}`. Adopter must be suspended. Destroys its keys and erases contacts. Irreversible. |
| `POST /platform/master-key/rewrap` | Re-wraps every adopter's keys under the active master key version |
| `GET /platform/audit` | Security events across adopters; filters `event_type`, `outcome`, `org_id`, `limit` |
