"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Lock, Search, ShieldCheck } from "lucide-react";
import { usePermissions } from "@/components/PermissionsProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { downloadBlob } from "@/lib/report";
import {
  deleteContact,
  exportContacts,
  getContact,
  listContacts,
  setContactStatus,
  type AuditEvent,
  type ContactStatus,
  type SecureContact,
} from "@/lib/api/secure";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  Mono,
  OutcomeBadge,
  SecureHeader,
  TableShell,
  Td,
  Th,
  errorText,
  formatWhen,
  humanize,
} from "./shared";

const PAGE = 25;
const STATUS_TONE: Record<ContactStatus, "live" | "neutral" | "danger"> = {
  active: "live",
  inactive: "neutral",
  deleted: "danger",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">{label}</span>
      <span className="text-[13px]">{children}</span>
    </div>
  );
}

function ContactSheet({
  contactId,
  onClose,
  onChanged,
  onNotify,
  isAdmin,
}: {
  contactId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (title: string, note: string) => void;
  isAdmin: boolean;
}) {
  const [contact, setContact] = useState<SecureContact | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    getContact(contactId)
      .then((r) => {
        setContact(r.contact);
        setEvents(r.events);
      })
      .catch((err) => setError(errorText(err, "Couldn't load this contact.")));
  }, [contactId]);

  async function changeStatus(status: "active" | "inactive") {
    if (!contact) return;
    setBusy(true);
    try {
      setContact(await setContactStatus(contact.contact_id, status));
      onNotify(status === "active" ? "Contact activated" : "Contact deactivated", contact.contact_id);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!contact) return;
    setBusy(true);
    try {
      setContact(await deleteContact(contact.contact_id));
      setConfirmDelete(false);
      onNotify("Contact erased", "The encrypted number was destroyed. A masked record remains for audit.");
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={contactId !== null} onClose={onClose} widthClassName="max-w-lg">
      <SheetHeader
        title={contact?.display_name || "Protected contact"}
        subtitle={contactId ?? undefined}
        icon={<Lock className="size-4" strokeWidth={1.8} />}
        onClose={onClose}
      />
      <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
        {error ? <ErrorBanner message={error} /> : null}
        {!contact && !error ? <Loading label="Loading contact" /> : null}
        {contact ? (
          <>
            <div className="grid grid-cols-2 gap-x-4">
              <Field label="Display number">
                <Mono>{contact.masked_phone ?? "—"}</Mono>
              </Field>
              <Field label="Status">
                <Badge tone={STATUS_TONE[contact.status]}>{contact.status}</Badge>
              </Field>
              <Field label="Email">{contact.masked_email ?? "—"}</Field>
              <Field label="Region">{contact.region ?? "—"}</Field>
              <Field label="Created">{formatWhen(contact.created_at)}</Field>
              <Field label="Last resolved">
                {contact.last_resolved_at ? `${formatWhen(contact.last_resolved_at)} (${contact.resolution_count}×)` : "Never"}
              </Field>
              <Field label="Source">
                {contact.source?.filename ?? "—"}
                {contact.source?.row ? `, row ${contact.source.row}` : ""}
              </Field>
              <Field label="Data">{contact.synthetic ? "Synthetic (mock provider only)" : "Real"}</Field>
            </div>

            <Card className="flex flex-col gap-1 bg-v-surface-sunk p-4">
              <span className="flex items-center gap-2 text-[13px] font-semibold">
                <ShieldCheck className="size-4 text-v-accent" strokeWidth={1.8} />
                Storage
              </span>
              {contact.encrypted ? (
                <span className="text-xs leading-relaxed text-v-body">
                  Number stored as <b>{contact.encryption_algorithm}</b> ciphertext under key version{" "}
                  <Mono>{contact.key_version}</Mono>, bound to this organisation and contact ID. Duplicate detection uses a
                  keyed HMAC index. Neither the ciphertext nor the original number is ever sent to the browser; only the
                  secure gateway can decrypt it, for a dial.
                </span>
              ) : (
                <span className="text-xs text-v-body">
                  Erased {formatWhen(contact.deleted_at)}. The ciphertext and duplicate index were destroyed, so this
                  contact can no longer be resolved or dialled.
                </span>
              )}
            </Card>

            {Object.keys(contact.attributes ?? {}).length ? (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Attributes</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(contact.attributes).map(([k, v]) => (
                    <span key={k} className="rounded-v-sm bg-v-track px-2 py-1 text-[11.5px] text-v-body">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {isAdmin && contact.status !== "deleted" ? (
              <div className="flex flex-wrap gap-2">
                {contact.status === "active" ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void changeStatus("inactive")}>
                    Deactivate
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void changeStatus("active")}>
                    Reactivate
                  </Button>
                )}
                {confirmDelete ? (
                  <span className="flex flex-wrap items-center gap-2 rounded-v-md border border-v-danger-line bg-v-danger-pale px-3 py-2 text-xs text-v-danger">
                    Erase permanently? This cannot be undone.
                    <Button variant="danger-outline" size="sm" disabled={busy} onClick={() => void erase()}>
                      {busy ? <Spinner light={false} /> : null}
                      Erase contact
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button variant="danger-outline" size="sm" onClick={() => setConfirmDelete(true)}>
                    Erase…
                  </Button>
                )}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Security events</span>
              {events.length === 0 ? (
                <span className="text-xs text-v-disabled">No events for this contact.</span>
              ) : (
                <ul className="flex flex-col divide-y divide-v-hairline">
                  {events.map((e) => (
                    <li key={e.event_id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[12.5px] font-medium">{humanize(e.event_type)}</span>
                        <span className="truncate text-[11.5px] text-v-muted">
                          {e.actor.id ?? e.actor.type}
                          {e.reason ? ` · ${e.reason}` : ""}
                        </span>
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

export function SecureVault({
  onNotify,
  initialBatch,
}: {
  onNotify: (title: string, note: string) => void;
  initialBatch?: string | null;
}) {
  const { can } = usePermissions();
  const isAdmin = can("contacts:delete");
  const [contacts, setContacts] = useState<SecureContact[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<"" | ContactStatus>("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [batch, setBatch] = useState<string | null>(initialBatch ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listContacts({
        status: status || undefined,
        search: search || undefined,
        batch_id: batch ?? undefined,
        limit: PAGE,
        offset,
      });
      setContacts(r.contacts);
      setTotal(r.total);
      setError("");
    } catch (err) {
      setError(errorText(err, "Couldn't load the vault."));
    } finally {
      setLoading(false);
    }
  }, [status, search, batch, offset]);

  useEffect(() => {
    // Fetch on mount / filter change; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function doExport() {
    setExporting(true);
    try {
      const blob = await exportContacts();
      downloadBlob(blob, "text/csv", `protected_contacts_${new Date().toISOString().slice(0, 10)}.csv`);
      onNotify("Export ready", "Contact IDs and masked numbers only. The export was recorded in the audit log.");
    } catch (err) {
      onNotify("Export failed", errorText(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Contact Vault"
        description="Every protected contact, by opaque ID and masked number. Original numbers stay encrypted in the vault and are never shown here."
        actions={
          can("contacts:export") ? (
            <Button variant="ghost" size="sm" onClick={() => void doExport()} disabled={exporting || total === 0}>
              {exporting ? <Spinner light={false} /> : <Download className="size-3.5" strokeWidth={2} />}
              Export (masked)
            </Button>
          ) : null
        }
      />

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setSearch(query.trim());
        }}
      >
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-v-dim" strokeWidth={1.8} />
          <Input
            id="vault-search"
            className="pl-9"
            placeholder="Name, contact ID, or last 4 digits"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="ghost" size="sm">
          Search
        </Button>
        <div className="flex rounded-v-md border border-v-line bg-v-panel p-0.5">
          {(["", "active", "inactive", "deleted"] as const).map((s) => (
            <button
              key={s || "all"}
              type="button"
              onClick={() => {
                setOffset(0);
                setStatus(s);
              }}
              className={`cursor-pointer rounded-v-sm px-3 py-1.5 text-xs font-medium ${
                status === s ? "bg-v-fg text-white" : "text-v-body hover:bg-v-soft"
              }`}
            >
              {s ? humanize(s) : "Current"}
            </button>
          ))}
        </div>
        {batch ? (
          <button
            type="button"
            onClick={() => setBatch(null)}
            className="cursor-pointer rounded-v-sm bg-v-pale px-2.5 py-1.5 text-xs text-v-accent"
          >
            Filtered to one upload · clear
          </button>
        ) : null}
      </form>

      {error ? <ErrorBanner message={error} /> : null}

      {loading && contacts.length === 0 ? (
        <Loading label="Loading vault" />
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={<Lock className="size-8" strokeWidth={1.5} />}
          title={search || status || batch ? "No contacts match" : "The vault is empty"}
          body={
            search || status || batch
              ? "Try a different search or status filter."
              : "Upload and tokenise a contact list on the Contacts page to see protected records here."
          }
        />
      ) : (
        <>
          <TableShell minWidth={820}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Contact ID</Th>
                <Th>Display number</Th>
                <Th>Status</Th>
                <Th>Encryption</Th>
                <Th>Created</Th>
                <Th>Resolved</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.contact_id}
                  onClick={() => setSelected(c.contact_id)}
                  className="cursor-pointer transition-colors hover:bg-v-soft"
                >
                  <Td className="whitespace-nowrap font-medium">
                    {c.display_name ?? <span className="text-v-disabled">—</span>}
                    {c.synthetic ? <span className="ml-2 font-mono text-[10px] text-v-dim">SYN</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Mono title={c.contact_id}>{c.contact_id.slice(0, 13)}…</Mono>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Mono>{c.masked_phone ?? "—"}</Mono>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-v-muted">
                    {c.encrypted ? (
                      <span className="flex items-center gap-1.5">
                        <Lock className="size-3 text-v-accent" strokeWidth={2} />
                        AES-256-GCM · {c.key_version}
                      </span>
                    ) : (
                      "Erased"
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-v-muted">{formatWhen(c.created_at)}</Td>
                  <Td className="tabular-nums text-v-muted">{c.resolution_count}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <div className="flex items-center justify-between text-xs text-v-muted">
            <span>
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()} contacts
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Previous
              </Button>
              <Button variant="ghost" size="sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
                Next
              </Button>
            </span>
          </div>
        </>
      )}

      <ContactSheet
        key={selected ?? "closed"}
        contactId={selected}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
        onNotify={onNotify}
        isAdmin={isAdmin}
      />
    </div>
  );
}
