"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Minus, PhoneOff, Users } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { usePermissions } from "@/components/PermissionsProvider";
import { getRoleCatalogue, type PermissionMatrixGroup, type RoleCatalogue, type RoleInfo } from "@/lib/api/rbac";

/** The four roles, most senior first. Anything else the API still knows about
 * (the retired agent_builder/analyst/auditor) acts as Viewer. */
export const ROLE_ORDER = ["super_admin", "admin", "campaign_manager", "member"] as const;

/** Which of the four columns a stored role belongs to. */
export function effectiveRoleId(role: string | null | undefined): string | null {
  if (!role) return null;
  return (ROLE_ORDER as readonly string[]).includes(role) ? role : "member";
}

/** Matrix rows a role has, grouped by area; areas with nothing are dropped. */
export function abilitiesFor(role: RoleInfo, matrix: PermissionMatrixGroup[]): PermissionMatrixGroup[] {
  const granted = new Set(role.permissions);
  return matrix
    .map((g) => ({ area: g.area, rows: g.rows.filter((r) => granted.has(r.permission)) }))
    .filter((g) => g.rows.length > 0);
}

/** How many of the matrix's actions a role has. */
export function abilityCount(role: RoleInfo, matrix: PermissionMatrixGroup[]): { granted: number; total: number } {
  const total = matrix.reduce((n, g) => n + g.rows.length, 0);
  const granted = abilitiesFor(role, matrix).reduce((n, g) => n + g.rows.length, 0);
  return { granted, total };
}

/** Compact "what this role can do", for the invite form: one row per area of
 * the product, its allowed actions as chips, and areas with none marked as such. */
export function RoleAbilities({ role, matrix }: { role: RoleInfo; matrix: PermissionMatrixGroup[] }) {
  const granted = new Set(role.permissions);
  if (matrix.length === 0) return null;
  return (
    <dl className="flex flex-col divide-y divide-v-line">
      {matrix.map((g) => {
        const rows = g.rows.filter((r) => granted.has(r.permission));
        return (
          <div key={g.area} className="grid grid-cols-[110px_1fr] gap-3 py-2.5 first:pt-0 last:pb-0">
            <dt className="pt-0.5 text-[12px] font-medium leading-snug text-v-fg">
              {g.area}
              <span className="block text-[11px] font-light text-v-muted">
                {rows.length} of {g.rows.length}
              </span>
            </dt>
            <dd className="flex flex-wrap content-start gap-1.5">
              {rows.length === 0 ? (
                <span className="inline-flex items-center gap-1 pt-0.5 text-[12px] font-light text-v-dim">
                  <Minus className="size-3" strokeWidth={2} aria-hidden /> No access
                </span>
              ) : (
                rows.map((r) => (
                  <span
                    key={r.permission}
                    className="inline-flex items-center gap-1 rounded-full border border-v-line bg-white px-2 py-0.5 text-[12px] leading-snug text-v-body"
                  >
                    <Check className="size-3 shrink-0 text-v-ok" strokeWidth={2.5} aria-hidden />
                    {r.label}
                  </span>
                ))
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** One line per column header; the full description from the API is the
 * header's tooltip. */
export const ROLE_TAGLINES: Record<string, string> = {
  super_admin: "Full control. The only role that handles phone numbers.",
  admin: "Runs people, agents, numbers and campaigns.",
  campaign_manager: "Runs campaigns and reviews calls.",
  member: "View only. Can't change anything.",
};

function Mark({ yes }: { yes: boolean }) {
  return yes ? (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-v-ok-tint text-v-ok-ink" title="Allowed">
      <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
      <span className="sr-only">Allowed</span>
    </span>
  ) : (
    <span className="inline-flex size-6 items-center justify-center text-v-dim" title="Not allowed">
      <Minus className="size-3.5" strokeWidth={2} aria-hidden />
      <span className="sr-only">Not allowed</span>
    </span>
  );
}

/** Read-only: what each of the four roles can do. Roles are changed on the
 * Members page, never here. */
export function Roles() {
  const { me } = usePermissions();
  const [catalogue, setCatalogue] = useState<RoleCatalogue | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getRoleCatalogue()
      .then((c) => {
        if (!cancelled) setCatalogue(c);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load roles.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = ROLE_ORDER.map((id) => catalogue?.roles.find((r) => r.id === id)).filter(
    (r): r is RoleInfo => Boolean(r),
  );
  const myColumn = effectiveRoleId(me?.role);
  const granted = new Map(columns.map((r) => [r.id, new Set(r.permissions)]));
  const youCell = (id: string) => (id === myColumn ? "bg-v-pale/50" : "");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-v-line pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Roles &amp; Permissions</h1>
        <p className="max-w-[70ch] text-sm font-light leading-relaxed text-v-muted">
          What each of the four roles in your organisation can do. Roles are fixed; this page is for reference.
          {me?.role_label ? ` You're signed in as ${me.role_label}.` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-start gap-2.5 rounded-v-md border border-v-line bg-v-surface-sunk px-4 py-3 text-[13px] text-v-body">
          <Users className="mt-0.5 size-4 shrink-0 text-v-muted" strokeWidth={1.75} />
          <span>
            To change someone&apos;s role, open{" "}
            <Link href="/members" className="font-medium text-v-accent hover:underline">
              Members
            </Link>{" "}
            and click their role. The Super admin can grant any role; Admins can grant Campaign manager or Viewer.
          </span>
        </div>
        <div className="flex items-start gap-2.5 rounded-v-md border border-v-line bg-v-surface-sunk px-4 py-3 text-[13px] text-v-body">
          <PhoneOff className="mt-0.5 size-4 shrink-0 text-v-muted" strokeWidth={1.75} />
          <span>Nobody in VoicEra sees a full phone number; only the Super admin uploads numbers.</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-sm text-v-danger">
          {error}
        </div>
      ) : !catalogue ? (
        <div className="flex items-center gap-2 text-sm text-v-muted">
          <Spinner light={false} /> Loading roles…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4 text-xs text-v-muted" aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <Mark yes /> Allowed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Mark yes={false} /> Not allowed
            </span>
          </div>
          {/* Scrolls on its own (both ways) so the header row and the first
              column stay put; the page itself never scrolls sideways. */}
          <div className="max-h-[max(24rem,calc(100vh-14rem))] overflow-auto overscroll-contain rounded-v-md border border-v-line bg-white">
            <table className="w-full min-w-[780px] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Permissions by role</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-30 min-w-[240px] border-b border-v-line bg-white px-4 py-3.5 text-left align-bottom font-mono text-[10px] font-medium uppercase tracking-[.1em] text-v-muted"
                  >
                    Permission
                  </th>
                  {columns.map((r) => (
                    <th
                      key={r.id}
                      scope="col"
                      title={r.description}
                      className={`sticky top-0 z-20 w-[17%] min-w-[150px] border-b border-v-line px-3 py-3.5 text-left align-bottom font-normal ${
                        r.id === myColumn ? "bg-v-pale shadow-[inset_0_2px_0_var(--v-accent)]" : "bg-white"
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13.5px] font-semibold text-v-fg">{r.label}</span>
                        {r.id === myColumn ? (
                          <span className="rounded-full bg-v-accent px-2 py-0.5 text-[10.5px] font-semibold text-white">
                            You
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[11.5px] font-light leading-snug text-v-muted">
                        {ROLE_TAGLINES[r.id] ?? r.description}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalogue.matrix.map((group) => (
                  <Fragment key={group.area}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={columns.length + 1}
                        className="border-b border-v-line bg-v-soft px-0 py-2 text-left"
                      >
                        <span className="sticky left-0 inline-block px-4 font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
                          {group.area}
                        </span>
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={`${group.area}-${row.permission}-${row.label}`} className="group">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 border-b border-v-hairline bg-white px-4 py-3 text-left text-[13px] font-normal leading-snug text-v-body group-hover:bg-v-surface-sunk"
                        >
                          {row.label}
                        </th>
                        {columns.map((r) => (
                          <td
                            key={r.id}
                            className={`border-b border-v-hairline px-3 py-3 ${youCell(r.id) || "group-hover:bg-v-surface-sunk"}`}
                          >
                            <Mark yes={Boolean(granted.get(r.id)?.has(row.permission))} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
