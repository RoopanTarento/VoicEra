import { apiFetch, apiFetchBlob } from "@/lib/api/http";

// VoicEra Secure API client. Every response is masked server-side: the
// dashboard never receives a phone number, ciphertext or key material.

export type ContactStatus = "active" | "inactive" | "deleted";
export type Outcome = "success" | "denied" | "error";
export type CheckStatus = "pass" | "warn" | "fail";

export interface SecureContact {
  contact_id: string;
  display_name?: string | null;
  masked_phone?: string | null;
  masked_email?: string | null;
  country_code?: number | null;
  region?: string | null;
  attributes: Record<string, string>;
  key_version?: string | null;
  status: ContactStatus;
  synthetic: boolean;
  encrypted: boolean;
  encryption_algorithm?: string | null;
  source?: { batch_id?: string; filename?: string; row?: number } | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  last_resolved_at?: string | null;
  resolution_count: number;
}

export type RowStatus = "valid" | "invalid" | "duplicate_in_file" | "duplicate_existing";

export interface UploadRow {
  row: number;
  name?: string | null;
  masked_phone?: string | null;
  status: RowStatus;
  reason?: string | null;
  warning?: string;
  existing_contact_id?: string;
}

export interface UploadSummary {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_in_file: number;
  duplicate_existing: number;
}

export interface UploadReport {
  batch_id: string;
  filename: string;
  status: string;
  synthetic: boolean;
  columns: string[];
  detected: { phone: string; name: string | null; email: string | null; attributes: string[] };
  summary: UploadSummary;
  created_at: string;
  expires_at: string;
  rows: UploadRow[];
  issues: UploadRow[];
  rows_truncated: boolean;
}

export interface TokenizeResult {
  batch_id: string;
  created: number;
  skipped_duplicates: number;
  failed: number;
  contacts: SecureContact[];
}

export interface BatchSummary {
  batch_id: string;
  filename: string;
  status: string;
  synthetic: boolean;
  summary: UploadSummary;
  created_by: string;
  created_at: string;
  tokenized_at: string | null;
  result: { created: number; skipped_duplicates: number; failed: number } | null;
}

export interface AuditEvent {
  event_id: string;
  org_id: string | null;
  event_type: string;
  category: string;
  action: string;
  actor: { type: string; id: string | null; role?: string | null };
  contact_id: string | null;
  outcome: Outcome;
  reason: string | null;
  correlation_id: string | null;
  source_ip: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface Health {
  status: CheckStatus;
  label: string;
  checks: HealthCheck[];
  checked_at: string;
}

export interface Overview {
  window_days: number;
  totals: {
    contacts_protected: number;
    contacts_tokenized: number;
    contacts_deleted: number;
    encrypted_records: number;
    resolution_requests: number;
    resolutions_granted: number;
    resolutions_denied: number;
    access_granted: number;
    access_denied: number;
    security_events: number;
    suspicious_events: number;
    exposures_prevented: number;
    callbacks_sanitized: number;
    secure_calls: number;
  };
  series: {
    protection: { day: string; added: number; cumulative: number }[];
    resolutions: { day: string; granted: number; denied: number }[];
    events_by_category: { category: string; count: number }[];
  };
  campaign_protection: { protected: number; legacy: number; legacy_plaintext_queue_entries: number };
  recent_events: AuditEvent[];
  health: Health;
}

export interface CampaignProtectionRow {
  campaign_id: string;
  name: string;
  state: string;
  agent_id: string;
  source_type: string;
  protected: boolean;
  contact_set: { set_id: string; name: string; size: number } | null;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  queued_runs: number;
  plaintext_queue_entries: number;
  calls: number;
  calls_tokenised: number;
  created_at: string;
}

export interface ContactSet {
  set_id: string;
  name: string;
  size: number;
  created_by?: string;
  created_at: string;
}

export interface OrgPolicy {
  require_vault_campaigns: boolean;
  require_vault_campaigns_env: boolean;
  retention_days: number;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface SecureSettings {
  keyring: {
    configured: boolean;
    error?: string;
    provider?: string;
    algorithm?: string;
    active_version?: string;
    versions?: { version: string; fingerprint: string; active: boolean; records: number }[];
    blind_index?: string;
  };
  policy: OrgPolicy;
  resolution: {
    rate_limit_per_minute: number;
    denial_alert_threshold: number;
    in_process_identity: string;
    external_services: { service_id: string; scopes: string[] }[];
  };
  default_region: string;
  mock_provider_enabled: boolean;
  health: Health;
}

export interface GatewayCallResult {
  call_id: string;
  status: string;
  provider_call_sid?: string | null;
  from_number: string;
  to_number: string;
  contact_id: string;
  agent_id: string;
}

export interface GatewayActivity {
  providers: string[];
  mock_enabled: boolean;
  calls: AuditEvent[];
  resolutions: AuditEvent[];
  callbacks: AuditEvent[];
}

export interface AuditQuery {
  event_type?: string;
  category?: string;
  outcome?: string;
  actor?: string;
  contact_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function getOverview(days = 14): Promise<Overview> {
  return apiFetch<Overview>(`/secure/overview${qs({ days })}`);
}

export function uploadContacts(file: File, synthetic: boolean): Promise<UploadReport> {
  const form = new FormData();
  form.append("file", file);
  form.append("synthetic", synthetic ? "true" : "false");
  return apiFetch<UploadReport>("/secure/contacts/upload", { method: "POST", body: form });
}

export function tokenizeBatch(batchId: string): Promise<TokenizeResult> {
  return apiFetch<TokenizeResult>("/secure/contacts/tokenize", {
    method: "POST",
    body: JSON.stringify({ batch_id: batchId }),
  });
}

export function listBatches(): Promise<BatchSummary[]> {
  return apiFetch<BatchSummary[]>("/secure/contacts/batches");
}

export function listContacts(params: {
  status?: string;
  search?: string;
  batch_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ contacts: SecureContact[]; total: number; limit: number; offset: number }> {
  return apiFetch(`/secure/contacts${qs(params)}`);
}

export function getContact(contactId: string): Promise<{ contact: SecureContact; events: AuditEvent[] }> {
  return apiFetch(`/secure/contacts/${encodeURIComponent(contactId)}`);
}

export function setContactStatus(contactId: string, status: "active" | "inactive"): Promise<SecureContact> {
  return apiFetch(`/secure/contacts/${encodeURIComponent(contactId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function deleteContact(contactId: string): Promise<SecureContact> {
  return apiFetch(`/secure/contacts/${encodeURIComponent(contactId)}`, { method: "DELETE" });
}

export function exportContacts(): Promise<Blob> {
  return apiFetchBlob("/secure/contacts/export");
}

export function purgeRetention(): Promise<{ purged_contacts: number; expired_staging_rows: number; retention_days: number }> {
  return apiFetch("/secure/contacts/retention/purge", { method: "POST" });
}

/** Attempt a resolution with the signed-in user's session. Always refused by design. */
export function resolveAsUser(contactId: string, orgId: string): Promise<unknown> {
  return apiFetch(`/secure/contacts/${encodeURIComponent(contactId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ org_id: orgId, purpose: "dial" }),
  });
}

/** Attempt a resolution presenting service credentials that are not valid. */
export function resolveWithServiceKey(
  contactId: string,
  orgId: string,
  serviceId: string,
  serviceKey: string,
): Promise<unknown> {
  return apiFetch(
    `/secure/contacts/${encodeURIComponent(contactId)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify({ org_id: orgId, purpose: "dial" }),
      headers: { "X-Service-Id": serviceId, "X-Service-Key": serviceKey },
    },
    false,
  );
}

export function createContactSet(payload: {
  name: string;
  contact_ids?: string[];
  batch_id?: string;
  all_active?: boolean;
}): Promise<ContactSet & { skipped: number }> {
  return apiFetch("/secure/contact-sets", { method: "POST", body: JSON.stringify(payload) });
}

export function getCampaignProtection(): Promise<{
  campaigns: CampaignProtectionRow[];
  contact_sets: ContactSet[];
  policy: OrgPolicy;
}> {
  return apiFetch("/secure/campaigns");
}

export function placeSecureCall(payload: { agent_id: string; contact_id: string; from_number?: string }): Promise<GatewayCallResult> {
  return apiFetch("/secure/gateway/calls", { method: "POST", body: JSON.stringify(payload) });
}

export function getGatewayActivity(): Promise<GatewayActivity> {
  return apiFetch("/secure/gateway/activity");
}

export function listAuditEvents(query: AuditQuery): Promise<{
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
  event_types: string[];
  categories: string[];
  actors: string[];
}> {
  return apiFetch(`/secure/audit${qs({ ...query })}`);
}

export function getSecureSettings(): Promise<SecureSettings> {
  return apiFetch("/secure/settings");
}

export function updatePolicy(patch: { require_vault_campaigns?: boolean; retention_days?: number }): Promise<OrgPolicy> {
  return apiFetch("/secure/settings", { method: "PATCH", body: JSON.stringify(patch) });
}

export function rotateKeys(): Promise<{ active_version: string; rotated: number; failed: number; from_versions: Record<string, number> }> {
  return apiFetch("/secure/settings/rotate-keys", { method: "POST" });
}
