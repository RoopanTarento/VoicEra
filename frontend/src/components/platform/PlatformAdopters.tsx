"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, KeyRound, Pause, Play, Plus, RotateCw, ShieldOff } from "lucide-react";
import { usePermissions } from "@/components/PermissionsProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/Card";
import { Dialog, DialogHeader } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Field";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import {
  createAdopter,
  getAdopter,
  listAdopters,
  revokeAdopterKey,
  rewrapMasterKey,
  rotateAdopterKey,
  setAdopterStatus,
  type Adopter,
} from "@/lib/api/platform";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  Mono,
  OutcomeBadge,
  SecureHeader,
  SectionTitle,
  TableShell,
  Td,
  Th,
  errorText,
  formatWhen,
  humanize,
} from "@/components/secure/shared";

const STATUS_TONE: Record<Adopter["status"], "live" | "warn" | "danger"> = {
  active: "live",
  suspended: "warn",
  offboarded: "danger",
};

function NewAdopterDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (a: Adopter) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (name.trim().length < 2 || !email.includes("@")) {
      setError("Enter the adopter's name and the owner's email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await createAdopter({ name: name.trim(), owner_email: email.trim(), owner_password: password || undefined });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(errorText(err, "The adopter couldn't be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} widthClassName="max-w-lg">
      <DialogHeader
        title="New adopter"
        subtitle="Creates the organisation, its own encryption and hash keys, and an owner account."
        onClose={onClose}
      />
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adopter-name">Adopter name</Label>
          <Input id="adopter-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Karnataka Health Mission" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adopter-owner">Super admin email</Label>
          <Input id="adopter-owner" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lead@adopter.gov.in" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adopter-password">First password for the owner</Label>
          <Input
            id="adopter-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters; leave empty if the owner already has an account"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-v-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            Create adopter
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AdopterSheet({
  orgId,
  onClose,
  onChanged,
  onNotify,
}: {
  orgId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (title: string, note: string) => void;
}) {
  const [adopter, setAdopter] = useState<Adopter | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [reason, setReason] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeName, setRevokeName] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const a = await getAdopter(orgId);
      setAdopter(a);
    } catch (err) {
      setError(errorText(err));
    }
  }, [orgId]);

  useEffect(() => {
    // Fetch when the sheet opens; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setError("");
    try {
      await fn();
      onNotify(done, adopter?.name ?? "");
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <Sheet open={orgId !== null} onClose={onClose} widthClassName="max-w-xl">
      <SheetHeader title={adopter?.name ?? "Adopter"} subtitle={orgId ?? undefined} icon={<Building2 className="size-4" strokeWidth={1.8} />} onClose={onClose} />
      <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
        {error ? <ErrorBanner message={error} /> : null}
        {!adopter && !error ? <Loading label="Loading adopter" /> : null}
        {adopter ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[adopter.status]}>{adopter.status}</Badge>
              {adopter.status_reason ? <span className="text-xs text-v-muted">{adopter.status_reason}</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <span className="text-v-muted">Super admins</span>
              <span>{adopter.owners.join(", ") || "—"}</span>
              <span className="text-v-muted">Members</span>
              <span>
                {adopter.members}{" "}
                <span className="text-v-muted">
                  ({Object.entries(adopter.members_by_role).map(([r, n]) => `${n} ${r === "super_admin" ? "owner" : humanize(r).toLowerCase()}`).join(", ")})
                </span>
              </span>
              <span className="text-v-muted">Protected contacts</span>
              <span className="tabular-nums">{adopter.contacts_protected.toLocaleString()}</span>
              <span className="text-v-muted">Agents · campaigns · calls</span>
              <span className="tabular-nums">
                {adopter.agents} · {adopter.campaigns} · {adopter.calls.toLocaleString()}
              </span>
              <span className="text-v-muted">Created</span>
              <span>{formatWhen(adopter.created_at)}</span>
            </div>

            <div className="flex flex-col gap-2">
              <SectionTitle title="Adopter keys" note="Own AES-256 data key and HMAC hash key, wrapped by the platform master key" />
              <TableShell minWidth={420}>
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Status</Th>
                    <Th>Master key</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {adopter.keys.versions.map((v) => (
                    <tr key={v.version}>
                      <Td>
                        <Mono>{v.version}</Mono>
                      </Td>
                      <Td>
                        <Badge tone={v.status === "active" ? "live" : v.status === "destroyed" ? "danger" : "neutral"}>{v.status}</Badge>
                      </Td>
                      <Td>
                        <Mono>{v.master_version}</Mono>
                      </Td>
                      <Td className="text-v-muted">{formatWhen(v.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>

            {adopter.status !== "offboarded" ? (
              <div className="flex flex-col gap-3 rounded-v-md border border-v-line p-4">
                <span className="text-[13px] font-semibold">Actions</span>
                <div className="flex flex-wrap items-end gap-2">
                  {adopter.status === "active" ? (
                    <>
                      <Input
                        id="suspend-reason"
                        className="max-w-xs"
                        placeholder="Reason (shown to the adopter's admins in the audit log)"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== ""}
                        onClick={() => void act("suspend", () => setAdopterStatus(adopter.org_id, "suspended", reason), "Adopter suspended")}
                      >
                        {busy === "suspend" ? <Spinner light={false} /> : <Pause className="size-3.5" strokeWidth={2} />}
                        Suspend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== ""}
                        onClick={() => void act("rotate", () => rotateAdopterKey(adopter.org_id), "Adopter key rotated")}
                      >
                        {busy === "rotate" ? <Spinner light={false} /> : <RotateCw className="size-3.5" strokeWidth={2} />}
                        Rotate adopter key
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy !== ""}
                      onClick={() => void act("activate", () => setAdopterStatus(adopter.org_id, "active"), "Adopter reactivated")}
                    >
                      {busy === "activate" ? <Spinner /> : <Play className="size-3.5" strokeWidth={2} />}
                      Reactivate
                    </Button>
                  )}
                </div>
                <span className="text-xs text-v-muted">
                  Suspending blocks the adopter&apos;s users and API access, pauses running campaigns, and makes its keys
                  unavailable until reactivated. Other adopters are unaffected.
                </span>

                {adopter.status === "suspended" ? (
                  confirmRevoke ? (
                    <div className="flex flex-col gap-2 rounded-v-md border border-v-danger-line bg-v-danger-pale p-3 text-xs text-v-danger">
                      <span>
                        This destroys the adopter&apos;s keys. Every number it ever uploaded becomes permanently unreadable and
                        its contacts are erased. Type <b>{adopter.name}</b> to confirm.
                      </span>
                      <Input id="revoke-name" value={revokeName} onChange={(e) => setRevokeName(e.target.value)} />
                      <div className="flex gap-2">
                        <Button
                          variant="danger-outline"
                          size="sm"
                          disabled={busy !== "" || revokeName !== adopter.name}
                          onClick={() => void act("revoke", () => revokeAdopterKey(adopter.org_id, revokeName), "Adopter offboarded")}
                        >
                          {busy === "revoke" ? <Spinner light={false} /> : null}
                          Destroy keys and offboard
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Button variant="danger-outline" size="sm" onClick={() => setConfirmRevoke(true)}>
                        <ShieldOff className="size-3.5" strokeWidth={2} />
                        Offboard and destroy keys…
                      </Button>
                    </div>
                  )
                ) : null}
              </div>
            ) : (
              <ErrorBanner message={`Offboarded ${formatWhen(adopter.keys.revoked_at)}. Its keys were destroyed and its data is unreadable.`} />
            )}

            <div className="flex flex-col gap-2">
              <SectionTitle title="Recent security events" />
              {(adopter.recent_security_events ?? []).length === 0 ? (
                <span className="text-xs text-v-disabled">No events.</span>
              ) : (
                <ul className="flex flex-col divide-y divide-v-hairline">
                  {(adopter.recent_security_events ?? []).map((e) => (
                    <li key={e.event_id} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{humanize(e.action || e.event_type)}</span>
                        <span className="truncate text-[11.5px] text-v-muted">{e.actor.id ?? e.actor.type}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-v-muted">
                        <OutcomeBadge outcome={e.outcome} />
                        {formatWhen(e.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

export function PlatformAdopters({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const { can, loaded } = usePermissions();
  const allowed = can("platform:manage");
  const [adopters, setAdopters] = useState<Adopter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [rewrapping, setRewrapping] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const rows = await listAdopters();
      setAdopters(rows);
      setError("");
    } catch (err) {
      setError(errorText(err, "Couldn't load adopters."));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    // Fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const stats = useMemo(
    () => ({
      active: adopters.filter((a) => a.status === "active").length,
      suspended: adopters.filter((a) => a.status === "suspended").length,
      contacts: adopters.reduce((n, a) => n + a.contacts_protected, 0),
      members: adopters.reduce((n, a) => n + a.members, 0),
    }),
    [adopters],
  );

  if (loaded && !allowed) {
    return (
      <div className="flex flex-col gap-6">
        <SecureHeader title="Adopters" description="Platform administration for VoicEra operators." />
        <EmptyState icon={<Building2 className="size-8" strokeWidth={1.5} />} title="Platform admins only" body="This area is for the VoicEra platform team." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Adopters"
        description="Every organisation on this VoicEra platform. Each adopter has its own keys and is isolated from the others. You see counts and key status here, never their contacts or numbers."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={rewrapping}
              title="Re-wrap every adopter's keys under the active master key"
              onClick={async () => {
                setRewrapping(true);
                try {
                  const r = await rewrapMasterKey();
                  onNotify("Master key re-wrap complete", `${r.rewrapped_adopters} adopters re-wrapped under ${r.master_version}.`);
                  void load();
                } catch (err) {
                  onNotify("Re-wrap failed", errorText(err));
                } finally {
                  setRewrapping(false);
                }
              }}
            >
              {rewrapping ? <Spinner light={false} /> : <KeyRound className="size-3.5" strokeWidth={2} />}
              Re-wrap master key
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" strokeWidth={2} />
              New adopter
            </Button>
          </>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard label="Active adopters" value={String(stats.active)} />
        <StatCard label="Suspended" value={String(stats.suspended)} />
        <StatCard label="Members" value={stats.members.toLocaleString()} note="Across all adopters" />
        <StatCard label="Protected contacts" value={stats.contacts.toLocaleString()} note="Encrypted per adopter" />
      </div>

      {loading && adopters.length === 0 ? (
        <Loading label="Loading adopters" />
      ) : adopters.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-8" strokeWidth={1.5} />}
          title="No adopters yet"
          body="Create the first adopter. It gets its own keys and an owner who can invite their team."
          action={<Button onClick={() => setCreating(true)}>New adopter</Button>}
        />
      ) : (
        <TableShell minWidth={900}>
          <thead>
            <tr>
              <Th>Adopter</Th>
              <Th>Status</Th>
              <Th>Super admin</Th>
              <Th>Members</Th>
              <Th>Contacts</Th>
              <Th>Campaigns</Th>
              <Th>Key</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {adopters.map((a) => (
              <tr key={a.org_id} onClick={() => setSelected(a.org_id)} className="cursor-pointer hover:bg-v-soft">
                <Td className="font-medium">
                  {a.name}
                  <span className="block font-mono text-[11px] text-v-dim">{a.org_id}</span>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                </Td>
                <Td className="text-xs text-v-muted">{a.owners[0] ?? "—"}</Td>
                <Td className="tabular-nums">{a.members}</Td>
                <Td className="tabular-nums">{a.contacts_protected.toLocaleString()}</Td>
                <Td className="tabular-nums">{a.campaigns}</Td>
                <Td className="whitespace-nowrap">
                  <Mono>{a.keys.active_version ?? "—"}</Mono>{" "}
                  <span className="text-xs text-v-muted">
                    {a.keys.status === "not_provisioned" ? "created on first use" : a.keys.status}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-v-muted">{formatWhen(a.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <NewAdopterDialog
        key={creating ? "new-adopter-open" : "new-adopter-closed"}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(a) => {
          onNotify("Adopter created", `${a.name} has its own keys. ${a.owners[0]} can sign in as owner.`);
          void load();
        }}
      />
      <AdopterSheet
        key={selected ? `adopter-${selected}` : "adopter-sheet-closed"}
        orgId={selected}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
        onNotify={onNotify}
      />
    </div>
  );
}
