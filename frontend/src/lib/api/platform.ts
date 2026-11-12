import { apiFetch } from "@/lib/api/http";
import type { AuditEvent } from "@/lib/api/secure";

// Platform (VoicEra operator) API. Aggregates and metadata only: no numbers.

export interface AdopterKeyVersion {
  version: string;
  status: string;
  master_version: string;
  created_at: string;
  retired_at: string | null;
}

export interface Adopter {
  org_id: string;
  name: string;
  status: "active" | "suspended" | "offboarded";
  status_reason?: string | null;
  created_at: string | null;
  created_by_email?: string | null;
  owners: string[];
  members: number;
  members_by_role: Record<string, number>;
  agents: number;
  campaigns: number;
  calls: number;
  contacts_protected: number;
  encrypted_records: number;
  keys: {
    status: string;
    active_version: string | null;
    versions: AdopterKeyVersion[];
    created_at: string | null;
    revoked_at: string | null;
  };
  recent_security_events?: AuditEvent[];
}

export function listAdopters(): Promise<Adopter[]> {
  return apiFetch<Adopter[]>("/platform/adopters");
}

export function getAdopter(orgId: string): Promise<Adopter> {
  return apiFetch<Adopter>(`/platform/adopters/${encodeURIComponent(orgId)}`);
}

export function createAdopter(payload: { name: string; owner_email: string; owner_password?: string }): Promise<Adopter> {
  return apiFetch<Adopter>("/platform/adopters", { method: "POST", body: JSON.stringify(payload) });
}

export function setAdopterStatus(orgId: string, status: "active" | "suspended", reason?: string): Promise<Adopter> {
  return apiFetch<Adopter>(`/platform/adopters/${encodeURIComponent(orgId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status, reason: reason || null }),
  });
}

export function rotateAdopterKey(orgId: string): Promise<{
  previous_version: string;
  active_version: string;
  rotated: number;
  failed: number;
  destroyed_versions: string[];
}> {
  return apiFetch(`/platform/adopters/${encodeURIComponent(orgId)}/rotate-key`, { method: "POST" });
}

export function revokeAdopterKey(orgId: string, confirmName: string): Promise<Adopter> {
  return apiFetch<Adopter>(`/platform/adopters/${encodeURIComponent(orgId)}/revoke-key`, {
    method: "POST",
    body: JSON.stringify({ confirm_name: confirmName }),
  });
}

export function rewrapMasterKey(): Promise<{ rewrapped_adopters: number; already_current: number; master_version: string }> {
  return apiFetch("/platform/master-key/rewrap", { method: "POST" });
}

export function platformAudit(params: { event_type?: string; outcome?: string; org_id?: string; limit?: number }): Promise<AuditEvent[]> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, String(v));
  const q = search.toString();
  return apiFetch<AuditEvent[]>(`/platform/audit${q ? `?${q}` : ""}`);
}
