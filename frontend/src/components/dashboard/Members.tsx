"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mail, Search, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Dialog, DialogHeader } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import { usePermissions } from "@/components/PermissionsProvider";
import { getRoleCatalogue, type PermissionMatrixGroup, type RoleInfo } from "@/lib/api/rbac";
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  type CreatedInvitation,
  type Invitation,
} from "@/lib/api/members";
import { InviteLinkCopy } from "@/components/auth/OrgInviteShare";
import { ROLE_ORDER, ROLE_TAGLINES, RoleAbilities, abilityCount, effectiveRoleId } from "@/components/dashboard/Roles";
import { useAuth } from "@/components/AuthProvider";
import { useMembers } from "@/hooks/useMembers";
import type { MemberListItem } from "@/lib/api-types";
import { formatUserRole, nameFromEmail } from "@/lib/format";

type RoleFilter = string;

/** Highest rank first, so the table reads most-senior-first. Retired roles
 * rank (and filter) as Viewer — see effectiveRoleId. */
const ROLE_RANK: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  campaign_manager: 2,
  member: 3,
};

function rank(role: string): number {
  return ROLE_RANK[effectiveRoleId(role) ?? ""] ?? 99;
}

function roleTone(role: string) {
  const id = effectiveRoleId(role);
  if (id === "super_admin") return "accent" as const;
  if (id === "admin") return "live" as const;
  return "neutral" as const;
}

function roleLabel(role: string, roles: RoleInfo[]): string {
  const id = effectiveRoleId(role) ?? role;
  return roles.find((r) => r.id === id)?.label ?? formatUserRole(id);
}

/** Roles the caller may hand out (same rule as the API): the Super admin can
 * give Admin, Campaign manager or Viewer (never Super admin itself); an Admin
 * only Campaign manager or Viewer. */
function grantableRoleIds(callerIsSuperAdmin: boolean): string[] {
  return ROLE_ORDER.filter((id) => id !== "super_admin" && (callerIsSuperAdmin || id !== "admin"));
}

function grantableRoles(roles: RoleInfo[], callerIsSuperAdmin: boolean): RoleInfo[] {
  return grantableRoleIds(callerIsSuperAdmin)
    .map((id) => roles.find((r) => r.id === id && r.assignable))
    .filter((r): r is RoleInfo => Boolean(r));
}

type Caller = { role: string | null | undefined; canManage: boolean };

/** Whether the caller can change this person's role, and if not, why — the
 * same rules PATCH /members/role enforces. */
function roleAccess(member: MemberListItem, isSelf: boolean, caller: Caller): { editable: boolean; reason?: string } {
  const target = effectiveRoleId(member.role);
  if (!caller.canManage || (caller.role !== "super_admin" && caller.role !== "admin")) {
    return { editable: false };
  }
  if (isSelf) return { editable: false, reason: "You can't change your own role." };
  if (target === "super_admin") return { editable: false, reason: "The Super admin's role can't be changed." };
  if (caller.role === "admin" && target === "admin") {
    return { editable: false, reason: "Only the Super admin can change an Admin's role." };
  }
  return { editable: true };
}

/** Same rule as the API: the Super admin can remove anyone but themselves; an
 * Admin only Campaign managers and Viewers. */
function canRemoveMember(member: MemberListItem, isSelf: boolean, caller: Caller): boolean {
  if (!caller.canManage || isSelf) return false;
  const target = effectiveRoleId(member.role);
  if (caller.role === "super_admin") return true;
  return caller.role === "admin" && target !== "super_admin" && target !== "admin";
}

function initials(email: string): string {
  const parts = nameFromEmail(email).split(" ").filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "");
  return (letters || email[0] || "?").toUpperCase();
}

function formatJoined(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function absoluteLink(url: string): string {
  if (/^https?:\/\//.test(url) || typeof window === "undefined") return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Invite one person by email with a chosen role. The link it returns is
 * shown once here and never again (the API only keeps a hash of it). */
function InviteDialog({
  roles,
  matrix,
  callerIsSuperAdmin,
  orgName,
  onClose,
  onInvited,
}: {
  roles: RoleInfo[];
  matrix: PermissionMatrixGroup[];
  callerIsSuperAdmin: boolean;
  orgName?: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const options = grantableRoles(roles, callerIsSuperAdmin);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [sendEmail, setSendEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedInvitation | null>(null);

  const chosen = options.find((r) => r.id === role) ?? options[0];
  const validEmail = /\S+@\S+\.\S+/.test(email.trim());

  async function submit() {
    if (!validEmail || !chosen || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await createInvitation(email.trim(), chosen.id, sendEmail);
      setCreated(res);
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <Dialog open onClose={onClose} widthClassName="max-w-lg">
        <DialogHeader title="Invitation ready" subtitle={`${created.email} · ${created.role_label}`} onClose={onClose} />
        <div className="flex flex-col gap-4 p-5 text-left">
          <div className="flex flex-col gap-2">
            <Label>One-time invite link</Label>
            <InviteLinkCopy link={absoluteLink(created.invite_url)} />
            <span className="text-xs font-light leading-relaxed text-v-muted">
              Copy it now: it won&apos;t be shown again. It expires in 7 days and works once, only for{" "}
              <span className="font-medium text-v-fg">{created.email}</span>.
            </span>
          </div>
          {created.email_sent ? (
            <div className="flex items-start gap-2 rounded-v-md border border-v-line bg-v-ok-tint px-3.5 py-2.5 text-[13px] text-v-ok-ink">
              <Mail className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              The invite was also emailed to {created.email}.
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-v-md border border-v-line bg-v-surface-sunk px-3.5 py-2.5 text-[13px] text-v-body">
              <Mail className="mt-0.5 size-4 shrink-0 text-v-muted" strokeWidth={1.75} />
              <span>
                No email was sent{created.email_note ? `: ${created.email_note}` : "."} Share the link with them
                yourself.
              </span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreated(null);
                setEmail("");
              }}
            >
              Invite someone else
            </Button>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-xl">
      <DialogHeader
        title="Invite a member"
        subtitle={`They'll join ${orgName ?? "your organisation"} with the role you pick.`}
        onClose={onClose}
      />
      <form
        className="flex flex-col gap-4 p-5 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@organisation.org"
          />
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5">
            <Label>Role</Label>
          </legend>
          <div className="flex flex-col gap-2">
            {options.map((r) => {
              const selected = r.id === chosen?.id;
              const { granted, total } = abilityCount(r, matrix);
              return (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-v-md border px-3.5 py-3 transition-colors ${
                    selected
                      ? "border-v-accent bg-v-pale/50 ring-1 ring-v-accent"
                      : "border-v-line bg-white hover:border-v-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={r.id}
                    checked={selected}
                    onChange={() => setRole(r.id)}
                    className="size-4 shrink-0 cursor-pointer accent-v-accent"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[14px] font-medium text-v-fg">{r.label}</span>
                    <span className="text-[12.5px] font-light text-v-muted">{ROLE_TAGLINES[r.id] ?? r.description}</span>
                  </span>
                  {total ? (
                    <span className="shrink-0 rounded-full bg-v-track px-2 py-0.5 text-[11px] font-medium text-v-body">
                      {granted} of {total} actions
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          {chosen && matrix.length ? (
            <div className="mt-2 flex flex-col gap-3 rounded-v-md border border-v-line bg-v-surface-sunk p-3.5">
              <span className="text-[13px] font-medium text-v-fg">What a {chosen.label} can do</span>
              <RoleAbilities role={chosen} matrix={matrix} />
            </div>
          ) : null}
        </fieldset>
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-v-body">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="size-4 cursor-pointer accent-v-accent"
          />
          Also send the invite by email
        </label>
        {error ? <span className="text-[12.5px] text-v-danger">{error}</span> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!validEmail || !chosen || submitting}>
            {submitting ? <Spinner /> : <UserPlus className="size-3.5" strokeWidth={1.75} />}
            Create invite
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Invitations nobody has used yet. Withdrawing one kills its link. */
function PendingInvitations({
  invitations,
  busyId,
  onWithdraw,
}: {
  invitations: Invitation[];
  busyId: string | null;
  onWithdraw: (invite: Invitation) => void;
}) {
  if (invitations.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">
        Pending invitations · {invitations.length}
      </h2>
      <div className="divide-y divide-v-line overflow-hidden rounded-v-md border border-v-line bg-white">
        {invitations.map((inv) => (
          <div key={inv.invite_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[14px] font-medium text-v-fg" title={inv.email}>
                {inv.email}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs font-light text-v-muted">
                <Badge tone={roleTone(inv.role)}>{inv.role_label}</Badge>
                {inv.email_sent ? <span>Emailed</span> : <span>Link shared manually</span>}
                {inv.expires_at ? <span>· Expires {new Date(inv.expires_at).toLocaleDateString()}</span> : null}
              </span>
            </div>
            <Button
              size="sm"
              variant="danger-outline"
              disabled={busyId === inv.invite_id}
              onClick={() => onWithdraw(inv)}
            >
              {busyId === inv.invite_id ? <Spinner light={false} /> : null}
              Withdraw
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Role cell: an inline dropdown limited to the roles the caller may
 * grant, or a read-only badge (with the reason on hover) when they can't. */
function RoleCell({
  member,
  roles,
  access,
  callerIsSuperAdmin,
  busy,
  tooltipSide,
  onChange,
}: {
  member: MemberListItem;
  roles: RoleInfo[];
  access: { editable: boolean; reason?: string };
  callerIsSuperAdmin: boolean;
  busy: boolean;
  /** Bottom rows open the hint upwards so it stays inside the table's scroll box. */
  tooltipSide: "top" | "bottom";
  onChange: (roleId: string) => void;
}) {
  const current = effectiveRoleId(member.role) ?? member.role;
  if (!access.editable) {
    const badge = <Badge tone={roleTone(member.role)}>{roleLabel(member.role, roles)}</Badge>;
    return access.reason ? (
      <Tooltip text={access.reason} side={tooltipSide}>
        <span tabIndex={0} aria-label={`${roleLabel(member.role, roles)}. ${access.reason}`} className="cursor-default">
          {badge}
        </span>
      </Tooltip>
    ) : (
      badge
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Select
        size="sm"
        aria-label={`Role for ${member.email}`}
        className="min-w-[168px]"
        value={current}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value !== current) onChange(e.target.value);
        }}
      >
        {grantableRoleIds(callerIsSuperAdmin).map((id) => (
          <option key={id} value={id}>
            {roleLabel(id, roles)}
          </option>
        ))}
      </Select>
      {busy ? <Spinner light={false} /> : null}
    </div>
  );
}

function MembersTable({
  members,
  roles,
  selfEmail,
  caller,
  busyEmail,
  onChangeRole,
  onRequestRemove,
}: {
  members: MemberListItem[];
  roles: RoleInfo[];
  selfEmail?: string;
  caller: Caller;
  busyEmail: string | null;
  onChangeRole: (member: MemberListItem, roleId: string) => void;
  onRequestRemove: (member: MemberListItem) => void;
}) {
  const showActions = caller.canManage;
  const th = "px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[.1em] text-v-muted";
  return (
    <div className="overflow-x-auto rounded-v-md border border-v-line bg-white">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-v-line bg-v-soft/60">
            <th scope="col" className={th}>
              Person
            </th>
            <th scope="col" className={`${th} w-[220px]`}>
              Role
            </th>
            <th scope="col" className={`${th} w-[150px]`}>
              Joined
            </th>
            {showActions ? (
              <th scope="col" className={`${th} w-[64px]`}>
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {members.map((m, index) => {
            const isSelf = m.email === selfEmail;
            const busy = busyEmail === m.email;
            const removable = canRemoveMember(m, isSelf, caller);
            return (
              <tr
                key={m.email}
                className={`border-b border-v-hairline transition-colors last:border-b-0 hover:bg-v-soft/40 ${
                  busy ? "opacity-70" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-v-line bg-v-soft text-[11.5px] font-semibold text-v-muted-2"
                    >
                      {initials(m.email)}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-medium text-v-fg">{nameFromEmail(m.email)}</span>
                        {isSelf ? (
                          <span className="shrink-0 rounded-full bg-v-pale px-2 py-0.5 text-[10.5px] font-semibold text-v-accent">
                            You
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-xs font-light text-v-muted" title={m.email}>
                        {m.email}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <RoleCell
                    member={m}
                    roles={roles}
                    access={roleAccess(m, isSelf, caller)}
                    callerIsSuperAdmin={caller.role === "super_admin"}
                    busy={busy}
                    tooltipSide={index > 0 && index >= members.length - 2 ? "top" : "bottom"}
                    onChange={(roleId) => onChangeRole(m, roleId)}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-[13px] text-v-muted-2">{formatJoined(m.created_at)}</td>
                {showActions ? (
                  <td className="px-4 py-3 text-right">
                    {removable ? (
                      <button
                        type="button"
                        onClick={() => onRequestRemove(m)}
                        disabled={busy}
                        aria-label={`Remove ${m.email}`}
                        title="Remove from organisation"
                        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-v-sm border border-transparent text-v-muted transition-colors hover:border-v-danger-line hover:bg-v-danger-pale hover:text-v-danger disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RemoveMemberDialog({
  member,
  busy,
  onClose,
  onConfirm,
}: {
  member: MemberListItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onClose={onClose} widthClassName="max-w-sm">
      <DialogHeader title="Remove member?" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5 text-left">
        <p className="text-sm font-light text-v-muted">
          <span className="font-medium text-v-fg">{member.email}</span> will lose access to this organisation
          immediately. This can&apos;t be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="danger-outline" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner light={false} /> : <Trash2 className="size-3.5" strokeWidth={1.75} />}
            Remove
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function Members({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const { session } = useAuth();
  const { members, loading, loadError, busyEmail, changeRole, remove } = useMembers(session?.orgId, onNotify);
  const { me, can } = usePermissions();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrixGroup[]>([]);
  const [removeTarget, setRemoveTarget] = useState<MemberListItem | null>(null);

  useEffect(() => {
    getRoleCatalogue()
      .then((c) => {
        setRoles(c.roles);
        setMatrix(c.matrix);
      })
      .catch(() => setRoles([]));
  }, []);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const canManage = can("members:write");
  const callerRole = me?.role ?? session?.role;
  const callerIsSuperAdmin = callerRole === "super_admin";
  const caller: Caller = { role: callerRole, canManage };

  const loadInvitations = useCallback(async () => {
    if (!canManage) return;
    try {
      setInvitations(await listInvitations());
    } catch {
      /* the list is a convenience — inviting still works without it */
    }
  }, [canManage]);

  useEffect(() => {
    // Fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInvitations();
  }, [loadInvitations]);

  async function withdraw(invite: Invitation) {
    setWithdrawingId(invite.invite_id);
    try {
      await revokeInvitation(invite.invite_id);
      onNotify("Invitation withdrawn", `The link for ${invite.email} no longer works.`);
      await loadInvitations();
    } catch (err) {
      onNotify("Couldn't withdraw", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setWithdrawingId(null);
    }
  }

  const counts = useMemo(() => {
    const byRole: Record<string, number> = {};
    for (const m of members) {
      const role = effectiveRoleId(m.role) ?? m.role;
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    return byRole;
  }, [members]);
  const filterChips: [RoleFilter, string][] = [
    ["all", `All · ${members.length}`],
    ...Object.keys(counts)
      .sort((a, b) => rank(a) - rank(b))
      .map((role) => [role, `${roleLabel(role, roles)} · ${counts[role]}`] as [RoleFilter, string]),
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = members.filter((m) => {
      if (roleFilter !== "all" && effectiveRoleId(m.role) !== roleFilter) return false;
      if (!q) return true;
      return m.email.toLowerCase().includes(q) || nameFromEmail(m.email).toLowerCase().includes(q);
    });
    return [...result].sort((a, b) => rank(a.role) - rank(b.role) || a.email.localeCompare(b.email));
  }, [members, query, roleFilter]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-v-line pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
        <p className="max-w-[62ch] text-sm font-light leading-relaxed text-v-muted">
          Everyone in your organisation and their role.{" "}
          {canManage
            ? callerIsSuperAdmin
              ? "Click someone's role to change it; it applies straight away."
              : "Click someone's role to change it; it applies straight away. As an Admin you can give Campaign manager or Viewer; only the Super admin grants Admin."
            : "Only the Super admin and Admins can change roles."}{" "}
          <Link href="/roles" className="font-medium text-v-accent hover:underline">
            See what each role can do
          </Link>
          .
        </p>
      </div>

      {loadError ? (
        <div className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-sm text-v-danger">
          {loadError}
        </div>
      ) : null}

      {!loading ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-v-muted"
                strokeWidth={1.75}
              />
              <input
                type="search"
                placeholder="Search by name or email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search members"
                className="w-full rounded-v-sm border border-v-line bg-v-soft/80 py-2.5 pl-10 pr-3.5 text-[14px] transition-colors placeholder:text-v-muted focus:border-v-accent focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 self-start rounded-full bg-v-soft/70 px-3.5 py-1.5 sm:self-auto">
              <Users className="size-4 text-v-muted" strokeWidth={1.75} />
              <span className="text-sm font-medium text-v-muted-2">
                {filtered.length === members.length
                  ? `${members.length} ${members.length === 1 ? "member" : "members"}`
                  : `${filtered.length} of ${members.length}`}
              </span>
            </div>

            <div className="flex-1" />

            {canManage ? (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" strokeWidth={1.75} />
                Invite member
              </Button>
            ) : null}
          </div>

          <div
            role="group"
            aria-label="Filter by role"
            className="flex max-w-full self-start overflow-x-auto rounded-full border border-v-line bg-white text-xs font-medium"
          >
            {filterChips.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={roleFilter === key}
                onClick={() => setRoleFilter(key)}
                className={`cursor-pointer whitespace-nowrap px-3.5 py-2 transition-colors ${
                  roleFilter === key ? "bg-v-fg text-white" : "text-v-muted-2 hover:bg-v-track"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-v-muted">
          <Spinner light={false} /> Loading members…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-v-md border border-dashed border-v-line bg-white p-12 text-center">
          <div className="rounded-full bg-v-soft p-3">
            <Search className="size-5 text-v-muted" strokeWidth={1.75} />
          </div>
          <span className="text-sm font-semibold">
            {query || roleFilter !== "all" ? "Nothing matches" : "No members yet"}
          </span>
          <span className="text-xs font-light text-v-muted">
            {query || roleFilter !== "all" ? "Try another search or filter." : "Invite someone to get started."}
          </span>
        </div>
      ) : (
        <MembersTable
          members={filtered}
          roles={roles}
          selfEmail={session?.email}
          caller={caller}
          busyEmail={busyEmail}
          onChangeRole={(m, roleId) => void changeRole(m, roleId, roleLabel(roleId, roles))}
          onRequestRemove={setRemoveTarget}
        />
      )}

      {removeTarget ? (
        <RemoveMemberDialog
          member={removeTarget}
          busy={busyEmail === removeTarget.email}
          onClose={() => setRemoveTarget(null)}
          onConfirm={async () => {
            const target = removeTarget;
            setRemoveTarget(null);
            await remove(target);
          }}
        />
      ) : null}

      {canManage && !loading ? (
        <PendingInvitations invitations={invitations} busyId={withdrawingId} onWithdraw={(i) => void withdraw(i)} />
      ) : null}

      {inviteOpen && canManage ? (
        <InviteDialog
          roles={roles}
          matrix={matrix}
          callerIsSuperAdmin={callerIsSuperAdmin}
          orgName={session?.orgName}
          onClose={() => setInviteOpen(false)}
          onInvited={() => void loadInvitations()}
        />
      ) : null}
    </div>
  );
}
