"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, StatCard } from "@/components/ui/Card";
import { getOverview, type Overview } from "@/lib/api/secure";
import {
  EmptyState,
  ErrorBanner,
  HealthPanel,
  Loading,
  OutcomeBadge,
  SecureHeader,
  SectionTitle,
  ShortId,
  errorText,
  formatWhen,
  humanize,
} from "./shared";

const AXIS = { fontSize: 11, fill: "var(--v-muted)" };
const TOOLTIP = { borderRadius: 8, borderColor: "var(--v-line)", fontSize: 12.5 };
const WINDOWS = [7, 14, 30];

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function ChartCard({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-5">
      <SectionTitle title={title} note={note} />
      {children}
    </Card>
  );
}

export function SecureOverview() {
  const router = useRouter();
  const [days, setDays] = useState(14);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const overview = await getOverview(days);
      setData(overview);
      setError("");
    } catch (err) {
      setError(errorText(err, "Couldn't load the security overview."));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    // Fetch on mount / filter change; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const t = data?.totals;
  const resolutions = data?.series.resolutions.map((r) => ({ ...r, label: dayLabel(r.day) })) ?? [];
  const protection = data?.series.protection.map((r) => ({ ...r, label: dayLabel(r.day) })) ?? [];
  const categories = data?.series.events_by_category.map((c) => ({ ...c, label: humanize(c.category) })) ?? [];
  const campaignBars = data
    ? [
        { label: "Vault contact sets", value: data.campaign_protection.protected },
        { label: "Plain CSV (legacy)", value: data.campaign_protection.legacy },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Security overview"
        description="How contact numbers are protected across uploads, campaigns and calls. Every figure here is counted from the vault and the security audit trail."
        actions={
          <>
            <div className="flex rounded-v-md border border-v-line bg-v-panel p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setDays(w)}
                  className={`cursor-pointer rounded-v-sm px-3 py-1.5 text-xs font-medium ${
                    days === w ? "bg-v-fg text-white" : "text-v-body hover:bg-v-soft"
                  }`}
                >
                  {w} days
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              disabled={loading}
            >
              <RefreshCw className="size-3.5" strokeWidth={2} />
              Refresh
            </Button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <Loading label="Loading security overview" /> : null}

      {data && t ? (
        <>
          {t.contacts_tokenized === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-8" strokeWidth={1.5} />}
              title="No contacts protected yet"
              body="Upload a contact list to encrypt its numbers and replace them with opaque contact IDs. The charts below fill in as contacts are protected and used."
              action={
                <Button onClick={() => router.push("/secure/contacts")}>
                  <Upload className="size-4" strokeWidth={2} />
                  Upload contacts
                </Button>
              }
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <StatCard
              label="Contacts protected"
              value={t.contacts_protected.toLocaleString()}
              note={`${t.contacts_tokenized.toLocaleString()} tokenised all time · ${t.contacts_deleted} erased`}
            />
            <StatCard
              label="Encrypted records"
              value={t.encrypted_records.toLocaleString()}
              note="AES-256-GCM ciphertext in the vault"
            />
            <StatCard
              label="Resolution requests"
              value={t.resolution_requests.toLocaleString()}
              note={`${t.resolutions_granted} granted · ${t.resolutions_denied} denied (${data.window_days} days)`}
            />
            <StatCard
              label="Exposures prevented"
              value={t.exposures_prevented.toLocaleString()}
              note="Raw numbers withheld from API responses and exports"
            />
          </div>
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <StatCard label="Access granted" value={t.access_granted.toLocaleString()} note={`Data-access events, ${data.window_days} days`} />
            <StatCard label="Access denied" value={t.access_denied.toLocaleString()} note={`${t.suspicious_events} suspicious-pattern alerts`} />
            <StatCard label="Security events" value={t.security_events.toLocaleString()} note={`Audited in the last ${data.window_days} days`} />
            <StatCard label="Callbacks sanitised" value={t.callbacks_sanitized.toLocaleString()} note={`${t.secure_calls} calls placed by contact ID`} />
          </div>

          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <ChartCard title="Contact protection over time" note="Contacts in the vault (cumulative) and added per day">
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={protection} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TOOLTIP} />
                    <Area type="monotone" dataKey="cumulative" name="In vault" stroke="var(--v-accent)" fill="var(--v-pale)" strokeWidth={2} />
                    <Area type="monotone" dataKey="added" name="Added" stroke="var(--v-success)" fill="var(--v-success-pale)" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Contact resolution activity" note="Decryption requests per day, granted vs denied">
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={resolutions} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TOOLTIP} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    <Bar dataKey="granted" name="Granted" stackId="r" fill="var(--v-success)" />
                    <Bar dataKey="denied" name="Denied" stackId="r" fill="var(--v-danger)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Security events by category" note={`All audited events, last ${data.window_days} days`}>
                {categories.length ? (
                  <ResponsiveContainer width="100%" height={Math.max(150, categories.length * 30)}>
                    <BarChart data={categories} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="label" width={96} tick={AXIS} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={TOOLTIP} />
                      <Bar dataKey="count" name="Events" fill="var(--v-accent-mid)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <span className="py-10 text-center text-sm text-v-disabled">No events in this window</span>
                )}
              </ChartCard>
              <ChartCard
                title="Campaign contact protection"
                note={
                  data.campaign_protection.legacy_plaintext_queue_entries
                    ? `${data.campaign_protection.legacy_plaintext_queue_entries} legacy queue entries still hold plaintext numbers`
                    : "No campaign queue holds plaintext numbers"
                }
              >
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={campaignBars} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="label" width={112} tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TOOLTIP} />
                    <Bar dataKey="value" name="Campaigns" fill="var(--v-accent)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <HealthPanel health={data.health} compact />
              <div>
                <Button variant="ghost" size="sm" onClick={() => router.push("/secure/settings")}>
                  View all checks and key settings
                </Button>
              </div>
            </div>
          </div>

          <Card className="flex flex-col gap-3 p-5">
            <SectionTitle
              title="Recent activity"
              note="Latest security events in this organisation"
              actions={
                <Button variant="ghost" size="sm" onClick={() => router.push("/secure/audit")}>
                  Open Audit Centre
                </Button>
              }
            />
            {data.recent_events.length === 0 ? (
              <span className="py-6 text-sm text-v-disabled">No security events yet.</span>
            ) : (
              <ul className="flex flex-col divide-y divide-v-hairline">
                {data.recent_events.map((e) => (
                  <li key={e.event_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-3">
                      <OutcomeBadge outcome={e.outcome} />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[13px] font-medium">{humanize(e.event_type)}</span>
                        <span className="truncate text-xs text-v-muted">
                          {e.actor.id ?? e.actor.type}
                          {e.reason ? ` · ${e.reason}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-xs text-v-muted">
                      <ShortId id={e.contact_id} />
                      {formatWhen(e.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
