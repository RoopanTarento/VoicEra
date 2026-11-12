import { apiFetch } from "@/lib/api/http";
import type { LoginResponse, MemberListResponse } from "@/lib/api-types";

/** Creates the account directly in the caller's active org — there is no separate
 * accept-invite step; the admin/super_admin sets the new member's password here. */
export async function inviteMember(email: string, password: string): Promise<{ status: string }> {
  return apiFetch("/members/invite", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** Accept an invitation (token from the invite link). Returns a JWT. */
export async function joinOrganisation(
  email: string,
  password: string,
  inviteToken: string,
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>(
    "/members/join",
    {
      method: "POST",
      body: JSON.stringify({ email, password, invite_token: inviteToken }),
    },
    false,
  );
}

export interface Invitation {
  invite_id: string;
  email: string;
  role: string;
  role_label: string;
  created_by?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  email_sent: boolean;
}

export interface CreatedInvitation extends Invitation {
  /** One-time link; shown only now, never again. */
  invite_url: string;
  /** Why the email wasn't sent, when it wasn't. */
  email_note?: string | null;
}

export interface InvitationLookup extends Invitation {
  org_id: string;
  org_name: string;
}

export async function createInvitation(email: string, role: string, sendEmail: boolean): Promise<CreatedInvitation> {
  return apiFetch<CreatedInvitation>("/members/invitations", {
    method: "POST",
    body: JSON.stringify({ email, role, send_email: sendEmail }),
  });
}

export async function listInvitations(): Promise<Invitation[]> {
  return apiFetch<Invitation[]>("/members/invitations");
}

export async function revokeInvitation(inviteId: string): Promise<{ status: string }> {
  return apiFetch(`/members/invitations/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

/** Public: what the join page shows for an invite link. */
export async function lookupInvitation(token: string): Promise<InvitationLookup> {
  return apiFetch<InvitationLookup>(`/members/invitations/lookup/${encodeURIComponent(token)}`, {}, false);
}

export async function listMembers(orgId: string): Promise<MemberListResponse> {
  return apiFetch<MemberListResponse>(`/members/${encodeURIComponent(orgId)}`);
}

/** Promote a member to admin in the caller's active org (super_admin only). */
export async function assignAdmin(email: string): Promise<{ status: string }> {
  return apiFetch("/members/assign-admin", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Remove a member from the caller's active org (super_admin only). */
export async function removeMember(email: string): Promise<{ status: string }> {
  return apiFetch("/members/remove", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}
