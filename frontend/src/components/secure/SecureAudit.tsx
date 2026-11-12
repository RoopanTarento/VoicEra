"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { usePermissions } from "@/components/PermissionsProvider";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { buildCsvReport, downloadBlob } from "@/lib/report";
import { listAuditEvents, type AuditEvent, type AuditQuery } from "@/lib/api/secure";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  Mono,
  OutcomeBadge,
  SecureHeader,
  ShortId,
  TableShell,
  Td,
  Th,
  errorText,
  formatWhen,
  humanize,
} from "./shared";

const PAGE = 50;

function Detail({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  return (
    <Sheet open={event !== null} onClose={onClose} widthClassName="max-w-lg">
      {event ? (
        <>
          <SheetHeader title={humanize(event.event_type)} subtitle={event.event_id} onClose={onClose} />
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-[13px]">
            {[
              ["Outcome", <OutcomeBadge key="o" outcome={event.outcome} />],
              ["When", new Date(event.created_at).toLocaleString()],
              ["Category", humanize(event.category)],
              ["Action", event.action],
              ["Actor", `${event.actor.id ?? "—"} (${event.actor.type}${event.actor.role ? `, ${event.actor.role}` : ""})`],
              ["Organisation", <Mono key="org">{event.org_id ?? "—"}</Mono>],
              ["Contact", <Mono key="c">{event.contact_id ?? "—"}</Mono>],
              ["Reason", event.reason ?? "—"],
              ["Correlation ID", <Mono key="cid">{event.correlation_id ?? "—"}</Mono>],
              ["Source IP", event.source_ip ?? "—"],
            ].map(([k, v]) => (
              <div key={String(k)} className="grid grid-cols-[130px_1fr] gap-3 border-b border-v-hairline pb-2">
                <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">{k}</span>
                <span className="min-w-0 break-words">{v}</span>
              </div>
            ))}
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">Metadata</span>
            <pre className="overflow-x-auto rounded-v-md bg-v-surface-sunk p-3 font-mono text-[11.5px] leading-relaxed">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
            <span className="text-xs text-v-muted">
              Audit records never contain phone numbers, ciphertext, keys or secrets.
            </span>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

export function SecureAudit() {
  const { session } = useAuth();
  const { can } = usePermissions();
  const isAdmin = can("audit:read");
  const [filters, setFilters] = useState<AuditQuery>({});
  const [draft, setDraft] = useState<AuditQuery>({});
  const [offset, setOffset] = useState(0);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [types, setTypes] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await listAuditEvents({ ...filters, limit: PAGE, offset });
      setError("");
      setEvents(r.events);
      setTotal(r.total);
      setTypes(r.event_types);
      setCategories(r.categories);
      setActors(r.actors);
    } catch (err) {
      setError(errorText(err, "Couldn't load audit events."));
    } finally {
      setLoading(false);
    }
  }, [filters, offset, isAdmin]);

  useEffect(() => {
    // Fetch on mount / filter change; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function set<K extends keyof AuditQuery>(key: K, value: AuditQuery[K]) {
    setDraft((d) => ({ ...d, [key]: value || undefined }));
  }

  function exportCsv() {
    const csv = buildCsvReport(
      { orgName: session?.orgName ?? "", email: session?.email ?? "" },
      ["Event ID", "Time", "Type", "Category", "Outcome", "Actor", "Actor type", "Contact ID", "Reason", "Correlation ID", "Source IP"],
      events.map((e) => [
        e.event_id,
        e.created_at,
        e.event_type,
        e.category,
        e.outcome,
        e.actor.id ?? "",
        e.actor.type,
        e.contact_id ?? "",
        e.reason ?? "",
        e.correlation_id ?? "",
        e.source_ip ?? "",
      ]),
    );
    downloadBlob(csv, "text/csv", `security_audit_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <SecureHeader title="Audit Centre" description="Every upload, resolution, export and denied request, with who did it and from where." />
        <EmptyState
          icon={<ScrollText className="size-8" strokeWidth={1.5} />}
          title="Not available for your role"
          body="The security audit trail is visible to the Super admin and Admins. Ask one of them if you need an event looked up."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Audit Centre"
        description="Every upload, resolution, export and denied request, with who did it and from where. Records contain contact IDs, never numbers."
        actions={
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={events.length === 0}>
            <Download className="size-3.5" strokeWidth={2} />
            Export this page
          </Button>
        }
      />

      <form
        className="grid grid-cols-2 gap-3 rounded-v-md border border-v-line bg-v-panel p-4 md:grid-cols-4 xl:grid-cols-7"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setFilters(draft);
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-from">From</Label>
          <Input id="audit-from" type="date" value={draft.date_from ?? ""} onChange={(e) => set("date_from", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" type="date" value={draft.date_to ?? ""} onChange={(e) => set("date_to", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-type">Event type</Label>
          <Select id="audit-type" value={draft.event_type ?? ""} onChange={(e) => set("event_type", e.target.value)}>
            <option value="">Any type</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-category">Category</Label>
          <Select id="audit-category" value={draft.category ?? ""} onChange={(e) => set("category", e.target.value)}>
            <option value="">Any category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-outcome">Outcome</Label>
          <Select id="audit-outcome" value={draft.outcome ?? ""} onChange={(e) => set("outcome", e.target.value)}>
            <option value="">Any outcome</option>
            <option value="success">Granted / success</option>
            <option value="denied">Denied</option>
            <option value="error">Error</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-actor">Actor</Label>
          <Select id="audit-actor" value={draft.actor ?? ""} onChange={(e) => set("actor", e.target.value)}>
            <option value="">Anyone</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" className="flex-1">
            Apply
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft({});
              setFilters({});
              setOffset(0);
            }}
          >
            Reset
          </Button>
        </div>
      </form>

      {error ? <ErrorBanner message={error} /> : null}

      {loading && events.length === 0 ? (
        <Loading label="Loading audit events" />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-8" strokeWidth={1.5} />}
          title="No events match"
          body="Widen the date range or clear a filter."
        />
      ) : (
        <>
          <TableShell minWidth={960}>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Event</Th>
                <Th>Outcome</Th>
                <Th>Actor</Th>
                <Th>Contact</Th>
                <Th>Reason</Th>
                <Th>Correlation</Th>
                <Th>Source IP</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.event_id} onClick={() => setSelected(e)} className="cursor-pointer hover:bg-v-soft">
                  <Td className="whitespace-nowrap text-v-muted">{formatWhen(e.created_at)}</Td>
                  <Td>
                    <span className="flex flex-col">
                      <span className="font-medium">{humanize(e.event_type)}</span>
                      <span className="text-[11px] text-v-dim">{humanize(e.category)}</span>
                    </span>
                  </Td>
                  <Td>
                    <OutcomeBadge outcome={e.outcome} />
                  </Td>
                  <Td className="text-xs">
                    {e.actor.id ?? <span className="text-v-disabled">anonymous</span>}
                    <span className="block text-[11px] text-v-dim">{e.actor.type}</span>
                  </Td>
                  <Td>
                    <ShortId id={e.contact_id} />
                  </Td>
                  <Td className="max-w-[220px] truncate text-xs text-v-muted">{e.reason ?? "—"}</Td>
                  <Td>
                    <ShortId id={e.correlation_id} />
                  </Td>
                  <Td className="text-xs text-v-muted">{e.source_ip ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <div className="flex items-center justify-between text-xs text-v-muted">
            <span>
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()} events
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
      <Detail event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
