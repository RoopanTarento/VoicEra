"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice, Panel } from "@/components/adopt/ui";
import { useWorkspace } from "@/lib/adopt/use-workspace";
import { alertsFor, buildOpsData } from "@/lib/adopt/demo-data";
import { validateConfig, isBlank } from "@/lib/adopt/config-schema";
import type { PackageId } from "@/lib/adopt/types";

const PKG_RANK: Record<PackageId, number> = { deploy: 0, connect: 1, orchestrate: 2 };

function fmtDuration(s: number) {
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function OperationsPage() {
  const { app, ws } = useWorkspace();
  const [preview, setPreview] = useState(false);

  const languages = useMemo(
    () => (Array.isArray(ws.config.languages) ? (ws.config.languages as string[]) : []),
    [ws.config.languages],
  );
  const data = useMemo(() => (app ? buildOpsData(app, languages) : null), [app, languages]);

  if (!app || !data) return null;
  const pkg = (ws.packageId ?? app.recommendedPackage) as PackageId;
  const show = ws.deploy.stage === "done" || preview;

  if (!show) {
    return (
      <div className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold tracking-tight">Operations</h2>
        <EmptyState
          title="Nothing to monitor yet"
          action={
            <div className="flex flex-wrap gap-3">
              <Link href="/adopt/workspace/deploy" className="inline-flex items-center rounded-v-md bg-v-accent px-[17px] py-[11px] text-[13px] font-semibold text-white shadow-[var(--v-shadow-primary)] hover:bg-v-accent-deep">
                Run the deployment rehearsal
              </Link>
              <Button variant="outline" onClick={() => setPreview(true)}>Preview with demonstration data</Button>
            </div>
          }
        >
          Once an agent is running, this screen would show calls, outcomes, languages and alerts. Nothing is running
          here, so there is nothing to show. Run the rehearsal to unlock a sample view, or preview it now.
        </EmptyState>
      </div>
    );
  }

  const v = validateConfig(app, ws.config);
  const needed = PKG_RANK[pkg] >= 1 ? app.integrations.filter((i) => i.need === "required") : [];
  const alerts = alertsFor({
    handoffMissing: isBlank(ws.config.handoffNumber),
    outboundUnsure: app.id === "surveys" && ws.config.consentBasis === "unsure",
    sampleContent: v.warnings.some((w) => /Sample entries/.test(w.message)),
    integrationsMissing: needed.filter((i) => !ws.integrations[i.id] || ws.integrations[i.id].status === "not-started").map((i) => i.name),
  });
  const t = data.totals;
  const pct = (n: number) => `${Math.round((n / Math.max(1, t.calls)) * 100)}%`;
  const maxOutcome = Math.max(...data.outcomes.map((o) => o.value), 1);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Operations and monitoring</h2>
        <Notice tone="demo" title="Demonstration data, not from a live deployment">
          Every figure here is generated locally to show what this screen would look like. No calls were made.
          {ws.deploy.stage !== "done" ? " You are previewing; run the rehearsal to keep this view." : ""} Real call
          history and analytics are in the console under{" "}
          <Link href="/history" className="font-semibold underline">Call history</Link> and{" "}
          <Link href="/analytics" className="font-semibold underline">Analytics</Link>.
        </Notice>
      </div>

      <section aria-label="Key figures">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Calls, last 14 days", t.calls.toLocaleString("en-IN")],
            ["Completed", pct(t.completed)],
            ["Handed to a person", pct(t.handoffs)],
            ["Average length", fmtDuration(t.avgSeconds)],
          ].map(([k, val]) => (
            <Panel key={k} className="!p-4">
              <dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">{k}</dt>
              <dd className="mt-1.5 text-[26px] font-semibold tabular-nums tracking-tight">{val}</dd>
            </Panel>
          ))}
        </dl>
      </section>

      <section aria-labelledby="vol-head" className="flex flex-col gap-3">
        <h3 id="vol-head" className="text-base font-semibold">Calls per day</h3>
        <Panel className="!p-4">
          <div className="h-[260px] w-full" role="img" aria-label="Line chart of calls and completed calls per day over the last 14 days. The figures are listed in the table below.">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.days} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--v-line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--v-muted)" }} tickLine={false} axisLine={{ stroke: "var(--v-line-strong)" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "var(--v-muted)" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--v-line)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="calls" name="Calls" stroke="var(--v-accent)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="completed" name="Completed" stroke="var(--v-fg)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3 text-[12.5px]">
            <summary className="cursor-pointer font-medium text-v-accent">Show the numbers</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left">
                <caption className="sr-only">Calls per day, demonstration data</caption>
                <thead>
                  <tr className="text-v-muted">
                    <th scope="col" className="py-1 pr-4 font-medium">Day</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Calls</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Completed</th>
                    <th scope="col" className="py-1 font-medium">Handoffs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d) => (
                    <tr key={d.label} className="border-t border-v-hairline">
                      <th scope="row" className="py-1 pr-4 text-left font-normal">{d.label}</th>
                      <td className="py-1 pr-4 tabular-nums">{d.calls}</td>
                      <td className="py-1 pr-4 tabular-nums">{d.completed}</td>
                      <td className="py-1 tabular-nums">{d.handoffs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="out-head" className="flex flex-col gap-3">
          <h3 id="out-head" className="text-base font-semibold">How calls ended</h3>
          <Panel className="!p-4">
            <ul className="flex flex-col gap-3">
              {data.outcomes.map((o) => (
                <li key={o.name}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span>{o.name}</span>
                    <span className="tabular-nums text-v-muted">{o.value.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-v-track" aria-hidden>
                    <div className="h-full rounded-full bg-v-accent" style={{ width: `${(o.value / maxOutcome) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
        <section aria-labelledby="lang-head" className="flex flex-col gap-3">
          <h3 id="lang-head" className="text-base font-semibold">Language of the call</h3>
          <Panel className="!p-4">
            <ul className="flex flex-col gap-3">
              {data.languages.map((l) => (
                <li key={l.name}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span>{l.name}</span>
                    <span className="tabular-nums text-v-muted">{pct(l.value)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-v-track" aria-hidden>
                    <div className="h-full rounded-full bg-v-fg" style={{ width: pct(l.value) }} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      </div>

      <section aria-labelledby="m-head" className="flex flex-col gap-3">
        <h3 id="m-head" className="text-base font-semibold">Measures for {app.name}</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.measures.map((m) => (
            <li key={m.name} className="rounded-v-lg border border-v-line bg-v-panel px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[14px] font-semibold">{m.name}</p>
                <p className="text-[18px] font-semibold tabular-nums">{m.value}</p>
              </div>
              <p className="text-[12.5px] text-v-muted">{m.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="rc-head" className="flex flex-col gap-3">
        <h3 id="rc-head" className="text-base font-semibold">Recent calls</h3>
        <div className="overflow-x-auto rounded-v-xl border border-v-line bg-v-panel">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <caption className="sr-only">Recent calls, demonstration data</caption>
            <thead>
              <tr className="border-b border-v-line bg-v-surface-sunk font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">Reference</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Time</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Language</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Length</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((c) => (
                <tr key={c.id} className="border-b border-v-hairline last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-mono text-[12px] font-normal">{c.id}</th>
                  <td className="px-4 py-2.5 tabular-nums">{c.when}</td>
                  <td className="px-4 py-2.5">{c.language}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmtDuration(c.seconds)}</td>
                  <td className="px-4 py-2.5">{c.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="al-head" className="flex flex-col gap-3">
        <h3 id="al-head" className="text-base font-semibold">Alerts from your own setup</h3>
        <p className="text-[13px] text-v-muted">These come from your real configuration, not from the demonstration numbers.</p>
        {alerts.length === 0 ? (
          <p className="text-[13.5px] text-v-body">Nothing flagged.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {alerts.map((a, i) => (
              <Notice key={i} tone={a.level === "warning" ? "warning" : "info"}>{a.text}</Notice>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
