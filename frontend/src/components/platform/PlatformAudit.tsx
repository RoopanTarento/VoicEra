"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { usePermissions } from "@/components/PermissionsProvider";
import { Select } from "@/components/ui/Select";
import { listAdopters, platformAudit, type Adopter } from "@/lib/api/platform";
import type { AuditEvent } from "@/lib/api/secure";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  OutcomeBadge,
  SecureHeader,
  ShortId,
  TableShell,
  Td,
  Th,
  errorText,
  formatWhen,
  humanize,
} from "@/components/secure/shared";

export function PlatformAudit() {
  const { can, loaded } = usePermissions();
  const allowed = can("platform:manage");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [adopters, setAdopters] = useState<Adopter[]>([]);
  const [orgId, setOrgId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const rows = await platformAudit({ org_id: orgId || undefined, outcome: outcome || undefined, limit: 200 });
      setEvents(rows);
      setError("");
    } catch (err) {
      setError(errorText(err, "Couldn't load platform events."));
    } finally {
      setLoading(false);
    }
  }, [allowed, orgId, outcome]);

  useEffect(() => {
    // Fetch on mount and filter change; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!allowed) return;
    listAdopters()
      .then(setAdopters)
      .catch(() => setAdopters([]));
  }, [allowed]);

  const names = Object.fromEntries(adopters.map((a) => [a.org_id, a.name]));

  if (loaded && !allowed) {
    return (
      <div className="flex flex-col gap-6">
        <SecureHeader title="Platform audit" description="Security events across adopters." />
        <EmptyState icon={<ScrollText className="size-8" strokeWidth={1.5} />} title="Platform admins only" body="This area is for the VoicEra platform team." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Platform audit"
        description="Security events across every adopter: sign-in and permission denials, key operations, suspensions and data access. Metadata only, never numbers."
      />
      <div className="flex flex-wrap gap-3">
        <div className="w-64">
          <Select id="platform-audit-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">All adopters</option>
            {adopters.map((a) => (
              <option key={a.org_id} value={a.org_id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select id="platform-audit-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any outcome</option>
            <option value="success">Granted / success</option>
            <option value="denied">Denied</option>
            <option value="error">Error</option>
          </Select>
        </div>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {loading && events.length === 0 ? (
        <Loading label="Loading events" />
      ) : events.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-8" strokeWidth={1.5} />} title="No events match" body="Change the adopter or outcome filter." />
      ) : (
        <TableShell minWidth={960}>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Adopter</Th>
              <Th>Event</Th>
              <Th>Outcome</Th>
              <Th>Actor</Th>
              <Th>Contact</Th>
              <Th>Reason</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.event_id}>
                <Td className="whitespace-nowrap text-v-muted">{formatWhen(e.created_at)}</Td>
                <Td className="text-xs">{(e.org_id && names[e.org_id]) || e.org_id || "—"}</Td>
                <Td>
                  <span className="flex flex-col">
                    <span className="font-medium">{humanize(e.action || e.event_type)}</span>
                    <span className="text-[11px] text-v-dim">{humanize(e.event_type)}</span>
                  </span>
                </Td>
                <Td>
                  <OutcomeBadge outcome={e.outcome} />
                </Td>
                <Td className="text-xs">
                  {e.actor.id ?? "anonymous"}
                  <span className="block text-[11px] text-v-dim">{e.actor.role ?? e.actor.type}</span>
                </Td>
                <Td>
                  <ShortId id={e.contact_id} />
                </Td>
                <Td className="max-w-[260px] truncate text-xs text-v-muted">{e.reason ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
