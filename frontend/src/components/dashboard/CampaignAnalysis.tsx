"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronRight as Crumb, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { CallDetailSheet } from "@/components/dashboard/CallDetailSheet";
import { CampaignResults } from "@/components/dashboard/CampaignResults";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/Card";
import { CallOutcomeBadge } from "@/components/ui/CallOutcomeBadge";
import { Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { listOrgCalls } from "@/lib/api/calls";
import { getCampaignInsights, type CampaignInsights, type PeriodCampaign, type PeriodDay } from "@/lib/api/campaigns";
import { displayToNumber, formatDuration } from "@/lib/format";
import type { CallLogItem, CampaignApiResponse } from "@/lib/api-types";

type Mode = "day" | "month" | "year" | "custom";

const MODES: { id: Mode; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "custom", label: "Custom" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const AXIS = { fontSize: 11, fill: "var(--v-muted)" };
const TOOLTIP = { borderRadius: 8, borderColor: "var(--v-line)", fontSize: 12.5 };
const MAX_CUSTOM_DAYS = 400;
const CALLS_PAGE = 25;

// --- dates (local, India time on the server side) -----------------------------------------

/** "2026-11-11" from a local Date, without the UTC shift toISOString would add. */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIso(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 864e5);
}

function rangeFor(mode: Mode, anchor: Date, custom: { from: string; to: string }): { from: string; to: string } {
  if (mode === "day") return { from: iso(anchor), to: iso(anchor) };
  if (mode === "month") {
    return {
      from: iso(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
      to: iso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    };
  }
  if (mode === "year") return { from: `${anchor.getFullYear()}-01-01`, to: `${anchor.getFullYear()}-12-31` };
  return custom;
}

function shift(mode: Mode, anchor: Date, step: number): Date {
  if (mode === "day") return addDays(anchor, step);
  if (mode === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
  return new Date(anchor.getFullYear() + step, 0, 1);
}

const fmt = {
  // Built by hand: en-IN puts a comma before the year ("1 Nov, 2026").
  day: (d: Date) =>
    `${d.toLocaleDateString("en-IN", { weekday: "short" })}, ${d.getDate()} ${d.toLocaleDateString("en-IN", { month: "short" })} ${d.getFullYear()}`,
  short: (d: Date) => `${d.getDate()} ${d.toLocaleDateString("en-IN", { month: "short" })}`,
  month: (d: Date) => d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
  monthShort: (d: Date) => d.toLocaleDateString("en-IN", { month: "short" }),
  time: (value: string) =>
    new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }),
};

function periodLabel(mode: Mode, anchor: Date, range: { from: string; to: string }): string {
  if (mode === "day") return fmt.day(anchor);
  if (mode === "month") return fmt.month(anchor);
  if (mode === "year") return String(anchor.getFullYear());
  return `${fmt.short(parseIso(range.from))} – ${fmt.day(parseIso(range.to))}`;
}

/** Accent tint for a cell, stronger with more calls (0 = none). */
function heat(calls: number, max: number): string | undefined {
  if (!calls || !max) return undefined;
  const pct = Math.round(10 + 50 * Math.sqrt(calls / max));
  return `color-mix(in oklab, var(--v-accent) ${pct}%, white)`;
}

// --- component -------------------------------------------------------------------------------

/** Campaign analysis by day, month, year or custom range: a calendar of the
 * days campaigns placed calls, then a day's campaigns, then a campaign's calls. */
export function CampaignAnalysis({
  campaigns,
  agentNameById,
  onNotify,
}: {
  campaigns: CampaignApiResponse[];
  agentNameById: Record<string, string>;
  onNotify: (title: string, note: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [custom, setCustom] = useState(() => ({ from: iso(addDays(new Date(), -29)), to: iso(new Date()) }));
  const [campaignFilter, setCampaignFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [data, setData] = useState<CampaignInsights | null>(null);
  // Which request the shown data / error answer, so "loading" is derived rather than set in the effect.
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<{ campaign_id: string; name: string } | null>(null);

  const range = rangeFor(mode, anchor, custom);
  // In day mode the day itself is the selection.
  const selectedDay = mode === "day" ? range.from : pickedDay;
  const setSelectedDay = setPickedDay;
  const requestKey = `${range.from}|${range.to}|${campaignFilter}|${agentFilter}|${version}`;

  /** A new period, filter or mode starts again at its top level. */
  function resetDrill() {
    setPickedDay(null);
    setSelectedCampaign(null);
  }
  const customProblem =
    mode !== "custom"
      ? ""
      : !custom.from || !custom.to
        ? "Pick both dates."
        : daysBetween(custom.from, custom.to) < 0
          ? "The end date is before the start date."
          : daysBetween(custom.from, custom.to) + 1 > MAX_CUSTOM_DAYS
            ? `Pick at most ${MAX_CUSTOM_DAYS} days.`
            : "";

  useEffect(() => {
    if (customProblem) return;
    let cancelled = false;
    getCampaignInsights({ from: range.from, to: range.to, campaignId: campaignFilter || undefined, agentId: agentFilter || undefined })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
          setLoadedKey(requestKey);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError({ key: requestKey, message: err instanceof Error ? err.message : "Couldn't load the analysis." });
          setLoadedKey(requestKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, campaignFilter, agentFilter, customProblem, requestKey]);

  const loading = !customProblem && loadedKey !== requestKey;

  const dayByDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const maxCalls = Math.max(0, ...(data?.days ?? []).map((d) => d.calls));
  const agentIds = useMemo(
    () => [...new Set(campaigns.map((c) => c.agent_id))].sort((a, b) => (agentNameById[a] ?? a).localeCompare(agentNameById[b] ?? b)),
    [campaigns, agentNameById],
  );

  const t = data?.totals;
  const today = iso(new Date());

  function openDay(date: string) {
    setSelectedDay(date);
    setSelectedCampaign(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-v-md border border-v-line bg-white p-3">
        <div role="radiogroup" aria-label="Period" className="flex gap-1 rounded-full bg-v-soft p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => {
                setMode(m.id);
                resetDrill();
              }}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                mode === m.id ? "bg-white text-v-fg shadow-sm" : "text-v-muted-2 hover:text-v-fg"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "custom" ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Input
              type="date"
              aria-label="From"
              className="!h-9 !w-40"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => {
                setCustom((c) => ({ ...c, from: e.target.value }));
                resetDrill();
              }}
            />
            <span className="text-v-muted">to</span>
            <Input
              type="date"
              aria-label="To"
              className="!h-9 !w-40"
              value={custom.to}
              min={custom.from || undefined}
              onChange={(e) => {
                setCustom((c) => ({ ...c, to: e.target.value }));
                resetDrill();
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <IconButton
              aria-label="Previous"
              className="size-[34px]"
              onClick={() => {
                setAnchor((a) => shift(mode, a, -1));
                resetDrill();
              }}
            >
              <ChevronLeft className="size-4" strokeWidth={1.8} />
            </IconButton>
            <span className="min-w-40 text-center text-[14px] font-semibold tabular-nums">
              {periodLabel(mode, anchor, range)}
            </span>
            <IconButton
              aria-label="Next"
              className="size-[34px]"
              onClick={() => {
                setAnchor((a) => shift(mode, a, 1));
                resetDrill();
              }}
            >
              <ChevronRight className="size-4" strokeWidth={1.8} />
            </IconButton>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAnchor(new Date());
                resetDrill();
              }}
            >
              Today
            </Button>
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select size="sm" aria-label="Campaign" className="!h-9 min-w-44" value={campaignFilter} onChange={(e) => {
            setCampaignFilter(e.target.value);
            resetDrill();
          }}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.campaign_id} value={c.campaign_id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Agent" className="!h-9 min-w-36" value={agentFilter} onChange={(e) => {
            setAgentFilter(e.target.value);
            resetDrill();
          }}>
            <option value="">All agents</option>
            {agentIds.map((id) => (
              <option key={id} value={id}>
                {agentNameById[id] ?? id}
              </option>
            ))}
          </Select>
          <IconButton aria-label="Refresh" className="size-[34px]" disabled={loading} onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      {customProblem ? <p className="text-sm text-v-danger">{customProblem}</p> : null}
      {error && error.key === requestKey ? <p className="text-sm text-v-danger">{error.message}</p> : null}
      {data?.truncated ? (
        <p className="flex items-center gap-2 rounded-v-md bg-v-warn-tint px-3.5 py-2.5 text-xs text-v-warn-ink">
          <AlertTriangle className="size-3.5" strokeWidth={2} />
          This period has more calls than can be summarised at once; numbers cover the first 200,000. Pick a shorter period.
        </p>
      ) : null}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Calls made" value={t ? t.calls.toLocaleString() : "–"} note={t ? `${t.days_active} active ${t.days_active === 1 ? "day" : "days"}` : undefined} />
        <StatCard label="Answered" value={t ? `${t.answer_rate}%` : "–"} note={t ? `${t.answered.toLocaleString()} calls` : undefined} />
        <StatCard label="Campaigns" value={t ? String(t.campaigns) : "–"} note="placed calls in this period" />
        <StatCard label="Avg duration" value={t ? formatDuration(t.avg_duration_seconds) : "–"} note={t ? `${t.talk_minutes.toLocaleString()} min talk time` : undefined} />
        <StatCard
          label="Problems reported"
          value={t ? t.issues_reported.toLocaleString() : "–"}
          note={t ? `${t.switched_path.toLocaleString()} calls switched path` : undefined}
        />
      </div>

      {/* Period view */}
      <div className="relative rounded-v-md border border-v-line bg-white p-4">
        {loading ? (
          <span className="absolute right-4 top-4 flex items-center gap-1.5 text-xs text-v-muted">
            <Spinner light={false} /> Updating…
          </span>
        ) : null}
        {mode === "month" ? (
          <MonthGrid month={anchor} dayByDate={dayByDate} maxCalls={maxCalls} today={today} selected={selectedDay} onPick={openDay} />
        ) : mode === "year" ? (
          <YearGrid
            year={anchor.getFullYear()}
            dayByDate={dayByDate}
            maxCalls={maxCalls}
            today={today}
            selected={selectedDay}
            onPick={openDay}
            onOpenMonth={(m) => {
              setAnchor(new Date(anchor.getFullYear(), m, 1));
              setMode("month");
              resetDrill();
            }}
          />
        ) : mode === "day" ? (
          <HoursChart hours={data?.hours ?? []} label={fmt.day(anchor)} />
        ) : (
          <DaysChart from={range.from} to={range.to} dayByDate={dayByDate} onPick={openDay} />
        )}
        {data && data.totals.calls === 0 && !loading ? (
          <p className="mt-3 text-center text-[13px] font-light text-v-muted">No campaign calls in this period.</p>
        ) : null}
      </div>

      {/* Drill-down: period → day → campaign → calls */}
      {selectedDay || selectedCampaign ? (
        <section className="flex flex-col gap-3 rounded-v-md border border-v-accent/40 bg-white p-4">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <button type="button" className="cursor-pointer text-v-muted hover:text-v-accent" onClick={() => {
              setSelectedCampaign(null);
              if (mode !== "day") setSelectedDay(null);
            }}>
              {periodLabel(mode, anchor, range)}
            </button>
            {selectedDay && mode !== "day" ? (
              <>
                <Crumb className="size-3.5 text-v-muted" />
                <button type="button" className="cursor-pointer text-v-muted hover:text-v-accent" onClick={() => setSelectedCampaign(null)}>
                  {fmt.day(parseIso(selectedDay))}
                </button>
              </>
            ) : null}
            {selectedCampaign ? (
              <>
                <Crumb className="size-3.5 text-v-muted" />
                <span className="font-semibold">{selectedCampaign.name}</span>
              </>
            ) : null}
          </nav>
          {selectedCampaign ? (
            <CampaignCalls
              key={`${selectedCampaign.campaign_id}|${selectedDay ?? range.from}|${selectedDay ?? range.to}`}
              campaign={selectedCampaign}
              row={data?.campaigns.find((c) => c.campaign_id === selectedCampaign.campaign_id)}
              dateFrom={selectedDay ?? range.from}
              dateTo={selectedDay ?? range.to}
              onNotify={onNotify}
            />
          ) : selectedDay ? (
            <DayCampaigns day={dayByDate.get(selectedDay)} onPick={setSelectedCampaign} />
          ) : null}
        </section>
      ) : null}

      {/* Outcomes and problems */}
      {data && data.totals.calls > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BarList title="Outcomes" rows={data.outcomes.map((o) => ({ key: o.key, label: o.label, value: o.count }))} empty="No calls analysed yet." />
          <BarList title="Problems reported" rows={data.issues.map((i) => ({ key: i.theme, label: i.theme, value: i.calls }))} empty="No problems reported in this period." tone="warn" />
        </div>
      ) : null}

      {/* Campaigns in the period */}
      {data && data.campaigns.length > 0 ? (
        <CampaignTable rows={data.campaigns} agentNameById={agentNameById} onPick={(c) => setSelectedCampaign({ campaign_id: c.campaign_id, name: c.name })} />
      ) : null}
    </div>
  );
}

// --- period views ---------------------------------------------------------------------------

function DayCell({
  date,
  inMonth,
  day,
  maxCalls,
  today,
  selected,
  onPick,
}: {
  date: Date;
  inMonth: boolean;
  day?: PeriodDay;
  maxCalls: number;
  today: string;
  selected: boolean;
  onPick: (date: string) => void;
}) {
  const key = iso(date);
  const campaigns = day?.campaigns ?? [];
  return (
    <button
      type="button"
      disabled={!day}
      onClick={() => onPick(key)}
      aria-label={`${fmt.day(date)}: ${day ? `${day.calls} calls` : "no calls"}`}
      style={{ background: heat(day?.calls ?? 0, maxCalls) }}
      className={`flex min-h-[92px] flex-col gap-1 rounded-v-sm border p-1.5 text-left transition-colors sm:p-2 ${
        selected ? "border-v-accent ring-2 ring-v-accent/30" : key === today ? "border-v-fg" : "border-v-line"
      } ${day ? "cursor-pointer hover:border-v-accent" : "cursor-default"} ${inMonth ? "" : "opacity-40"}`}
    >
      <span className="flex items-center justify-between gap-1">
        <span className={`text-[12px] tabular-nums ${key === today ? "font-semibold" : "text-v-muted-2"}`}>{date.getDate()}</span>
        {day ? <span className="font-mono text-[10px] font-semibold tabular-nums text-v-fg">{day.calls}</span> : null}
      </span>
      {day ? (
        <>
          <span className="hidden text-[10.5px] text-v-muted-2 sm:block">{day.answer_rate}% answered</span>
          <span className="hidden flex-col gap-0.5 sm:flex">
            {campaigns.slice(0, 2).map((c) => (
              <span key={c.campaign_id} className="truncate rounded-[4px] bg-white/80 px-1 py-px text-[10.5px] font-medium text-v-fg">
                {c.name}
              </span>
            ))}
            {campaigns.length > 2 ? <span className="text-[10px] text-v-muted-2">+{campaigns.length - 2} more</span> : null}
          </span>
        </>
      ) : null}
    </button>
  );
}

function MonthGrid({
  month,
  dayByDate,
  maxCalls,
  today,
  selected,
  onPick,
}: {
  month: Date;
  dayByDate: Map<string, PeriodDay>;
  maxCalls: number;
  today: string;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i - lead));
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <span key={w} className="px-1 font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d) => (
          <DayCell
            key={iso(d)}
            date={d}
            inMonth={d.getMonth() === month.getMonth()}
            day={dayByDate.get(iso(d))}
            maxCalls={maxCalls}
            today={today}
            selected={selected === iso(d)}
            onPick={onPick}
          />
        ))}
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <span className="flex items-center gap-2 self-end text-[11px] text-v-muted">
      Fewer calls
      {[0.05, 0.25, 0.6, 1].map((r) => (
        <span key={r} className="size-3 rounded-[3px] border border-v-line" style={{ background: heat(r * 100, 100) }} />
      ))}
      More
    </span>
  );
}

function YearGrid({
  year,
  dayByDate,
  maxCalls,
  today,
  selected,
  onPick,
  onOpenMonth,
}: {
  year: number;
  dayByDate: Map<string, PeriodDay>;
  maxCalls: number;
  today: string;
  selected: string | null;
  onPick: (date: string) => void;
  onOpenMonth: (month: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, m) => {
          const first = new Date(year, m, 1);
          const lead = (first.getDay() + 6) % 7;
          const count = new Date(year, m + 1, 0).getDate();
          let calls = 0;
          let answered = 0;
          for (let d = 1; d <= count; d += 1) {
            const day = dayByDate.get(iso(new Date(year, m, d)));
            calls += day?.calls ?? 0;
            answered += day?.answered ?? 0;
          }
          return (
            <div key={m} className="flex flex-col gap-2 rounded-v-md border border-v-line p-3">
              <button
                type="button"
                onClick={() => onOpenMonth(m)}
                className="flex cursor-pointer items-baseline justify-between gap-2 text-left hover:text-v-accent"
              >
                <span className="text-[13px] font-semibold">{fmt.monthShort(first)}</span>
                <span className="font-mono text-[10.5px] text-v-muted">
                  {calls ? `${calls.toLocaleString()} calls · ${Math.round((100 * answered) / calls)}%` : "no calls"}
                </span>
              </button>
              <div className="grid grid-cols-7 gap-[3px]">
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead-${i}`} />
                ))}
                {Array.from({ length: count }, (_, i) => {
                  const date = new Date(year, m, i + 1);
                  const key = iso(date);
                  const day = dayByDate.get(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!day}
                      title={`${fmt.day(date)}: ${day ? `${day.calls} calls` : "no calls"}`}
                      aria-label={`${fmt.day(date)}: ${day ? `${day.calls} calls` : "no calls"}`}
                      onClick={() => onPick(key)}
                      style={{ background: heat(day?.calls ?? 0, maxCalls) ?? "var(--v-soft)" }}
                      className={`aspect-square rounded-[3px] ${day ? "cursor-pointer hover:ring-2 hover:ring-v-accent/40" : ""} ${
                        selected === key ? "ring-2 ring-v-accent" : key === today ? "ring-1 ring-v-fg" : ""
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

function HoursChart({ hours, label }: { hours: CampaignInsights["hours"]; label: string }) {
  const rows = hours.map((h) => ({ ...h, label: `${h.hour}:00`, missed: h.calls - h.answered }));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Calls by hour · {label}</span>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={2} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <ChartTooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--v-soft)" }} />
          <Bar dataKey="answered" name="Answered" stackId="c" fill="var(--v-accent)" />
          <Bar dataKey="missed" name="Not answered" stackId="c" fill="var(--v-line-strong)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DaysChart({
  from,
  to,
  dayByDate,
  onPick,
}: {
  from: string;
  to: string;
  dayByDate: Map<string, PeriodDay>;
  onPick: (date: string) => void;
}) {
  const rows = useMemo(() => {
    const out = [];
    for (let d = parseIso(from); iso(d) <= to; d = addDays(d, 1)) {
      const day = dayByDate.get(iso(d));
      out.push({ date: iso(d), label: fmt.short(d), answered: day?.answered ?? 0, missed: (day?.calls ?? 0) - (day?.answered ?? 0) });
    }
    return out;
  }, [from, to, dayByDate]);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Calls per day · click a day for its campaigns</span>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={rows}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          onClick={(state) => {
            const label = (state as { activeLabel?: string } | null)?.activeLabel;
            const row = rows.find((r) => r.label === label);
            if (row && dayByDate.has(row.date)) onPick(row.date);
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <ChartTooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--v-soft)" }} />
          <Bar dataKey="answered" name="Answered" stackId="c" fill="var(--v-accent)" className="cursor-pointer" />
          <Bar dataKey="missed" name="Not answered" stackId="c" fill="var(--v-line-strong)" radius={[3, 3, 0, 0]} className="cursor-pointer" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- drill-down -----------------------------------------------------------------------------

function DayCampaigns({ day, onPick }: { day?: PeriodDay; onPick: (c: { campaign_id: string; name: string }) => void }) {
  if (!day) return <p className="text-[13px] font-light text-v-muted">No campaign calls on this day.</p>;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-v-muted">
        {day.calls.toLocaleString()} calls · {day.answer_rate}% answered · {day.campaigns.length}{" "}
        {day.campaigns.length === 1 ? "campaign" : "campaigns"}. Pick a campaign to see its calls.
      </span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {day.campaigns.map((c) => (
          <button
            key={c.campaign_id}
            type="button"
            onClick={() => onPick(c)}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-v-sm border border-v-line bg-white px-3 py-2.5 text-left transition-colors hover:border-v-accent"
          >
            <span className="min-w-0 truncate text-[13px] font-medium">{c.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-v-muted">
              {c.calls.toLocaleString()} {c.calls === 1 ? "call" : "calls"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CampaignCalls({
  campaign,
  row,
  dateFrom,
  dateTo,
  onNotify,
}: {
  campaign: { campaign_id: string; name: string };
  row?: PeriodCampaign;
  dateFrom: string;
  dateTo: string;
  onNotify: (title: string, note: string) => void;
}) {
  const { session } = useAuth();
  const orgId = session?.orgId;
  const [calls, setCalls] = useState<CallLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<CallLogItem | null>(null);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    // Remounted (keyed) for each campaign and period, so loading starts true.
    if (!orgId) return;
    let cancelled = false;
    listOrgCalls(orgId, { campaignId: campaign.campaign_id, dateFrom, dateTo, limit: CALLS_PAGE })
      .then((res) => {
        if (!cancelled) {
          setCalls(res.calls);
          setTotal(res.total);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load calls.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, campaign.campaign_id, dateFrom, dateTo]);

  async function loadMore() {
    if (!orgId) return;
    try {
      const res = await listOrgCalls(orgId, { campaignId: campaign.campaign_id, dateFrom, dateTo, limit: CALLS_PAGE, offset: calls.length });
      setCalls((prev) => [...prev, ...res.calls]);
      setTotal(res.total);
    } catch (err) {
      onNotify("Couldn't load more calls", err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const sameDay = dateFrom === dateTo;
  return (
    <div className="flex flex-col gap-3">
      {row ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-v-muted-2">
          <span>
            <strong className="font-semibold text-v-fg">{row.calls.toLocaleString()}</strong> calls in the period
          </span>
          <span>
            <strong className="font-semibold text-v-fg">{row.answer_rate}%</strong> answered
          </span>
          <span>
            Avg <strong className="font-semibold text-v-fg">{formatDuration(row.avg_duration_seconds)}</strong>
          </span>
          {row.top_outcome ? (
            <span>
              Most common: <strong className="font-semibold text-v-fg">{row.top_outcome.label}</strong>
            </span>
          ) : null}
          {row.issues_reported ? (
            <span>
              <strong className="font-semibold text-v-fg">{row.issues_reported}</strong> problems reported
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">
          Calls {sameDay ? `on ${fmt.day(parseIso(dateFrom))}` : `from ${fmt.short(parseIso(dateFrom))} to ${fmt.day(parseIso(dateTo))}`}
          <span className="ml-2 font-mono text-[11px] font-normal text-v-muted">{total.toLocaleString()}</span>
        </span>
        <Button variant="outline" size="sm" onClick={() => setShowResults((v) => !v)}>
          {showResults ? "Hide campaign results" : "Campaign results (all time)"}
        </Button>
      </div>

      {showResults ? <CampaignResults campaignId={campaign.campaign_id} /> : null}

      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-v-muted">
          <Spinner light={false} /> Loading calls…
        </p>
      ) : error ? (
        <p className="text-[13px] text-v-danger">{error}</p>
      ) : calls.length === 0 ? (
        <p className="text-[13px] font-light text-v-muted">No calls in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-v-sm border border-v-line">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-v-soft text-left">
                {["Time", "To", "Outcome", "Duration", "Status"].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[.1em] text-v-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr
                  key={c.call_id}
                  tabIndex={0}
                  onClick={() => setOpen(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setOpen(c);
                  }}
                  className="cursor-pointer border-t border-v-line transition-colors hover:bg-v-pale focus:bg-v-pale focus:outline-none"
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {sameDay ? "" : `${fmt.short(new Date(c.created_at ?? ""))}, `}
                    {c.created_at ? fmt.time(c.created_at) : "–"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{displayToNumber(c)}</td>
                  <td className="px-3 py-2">
                    <CallOutcomeBadge analysis={c.analysis} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatDuration(c.duration)}</td>
                  <td className="px-3 py-2 capitalize text-v-muted-2">{String(c.call_response ?? c.status ?? "").replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {calls.length < total && !loading ? (
        <Button variant="ghost" size="sm" className="self-center" onClick={() => void loadMore()}>
          Show more calls ({(total - calls.length).toLocaleString()} left)
        </Button>
      ) : null}

      {open ? (
        <CallDetailSheet
          call={open}
          onClose={() => setOpen(null)}
          onCallUpdated={(updated) => setCalls((prev) => prev.map((c) => (c.call_id === updated.call_id ? updated : c)))}
        />
      ) : null}
    </div>
  );
}

// --- summaries ------------------------------------------------------------------------------

function BarList({
  title,
  rows,
  empty,
  tone = "accent",
}: {
  title: string;
  rows: { key: string; label: string; value: number }[];
  empty: string;
  tone?: "accent" | "warn";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-3 rounded-v-md border border-v-line bg-white p-4">
      <span className="text-xs font-semibold uppercase tracking-[.08em] text-v-muted">{title}</span>
      {rows.length === 0 ? (
        <p className="text-sm font-light text-v-muted">{empty}</p>
      ) : (
        <ul className="m-0 flex flex-col gap-2 p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-3 text-[13px]">
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-v-muted">{r.value.toLocaleString()}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-v-track">
                <span
                  className={`block h-full rounded-full ${tone === "warn" ? "bg-v-warn" : "bg-v-accent"}`}
                  style={{ width: `${(100 * r.value) / max}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignTable({
  rows,
  agentNameById,
  onPick,
}: {
  rows: PeriodCampaign[];
  agentNameById: Record<string, string>;
  onPick: (c: PeriodCampaign) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[.08em] text-v-muted">Campaigns in this period</span>
      <div className="overflow-x-auto rounded-v-md border border-v-line bg-white">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left">
              {["Campaign", "Calls", "Answered", "Avg duration", "Most common outcome", "Problems", "Active days", "Last call"].map((h) => (
                <th key={h} className="border-b border-v-line px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[.1em] text-v-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.campaign_id}
                tabIndex={0}
                onClick={() => onPick(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onPick(r);
                }}
                className="cursor-pointer border-b border-v-line last:border-0 transition-colors hover:bg-v-pale focus:bg-v-pale focus:outline-none"
              >
                <td className="px-3.5 py-2.5">
                  <span className="flex flex-col">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-v-muted">{r.agent_id ? (agentNameById[r.agent_id] ?? r.agent_id) : "–"}</span>
                  </span>
                </td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.calls.toLocaleString()}</td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.answer_rate}%</td>
                <td className="px-3.5 py-2.5 tabular-nums">{formatDuration(r.avg_duration_seconds)}</td>
                <td className="px-3.5 py-2.5">{r.top_outcome ? r.top_outcome.label : "–"}</td>
                <td className="px-3.5 py-2.5 tabular-nums">
                  {r.issues_reported ? <Badge tone="warn">{r.issues_reported}</Badge> : <span className="text-v-muted">0</span>}
                </td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.days_active}</td>
                <td className="whitespace-nowrap px-3.5 py-2.5 tabular-nums text-v-muted-2">
                  {fmt.short(new Date(r.last_call))}, {fmt.time(r.last_call)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
