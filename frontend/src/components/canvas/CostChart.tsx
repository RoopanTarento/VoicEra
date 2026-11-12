"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { breakdownParts, monthlySeries, type BreakdownPart, type Canvas, type CanvasCost } from "@/lib/adopt/advisor/canvas";
import { inr } from "@/lib/adopt/advisor/cost";

const COLOUR: Record<BreakdownPart["id"], string> = {
  setup: "var(--v-fg)",
  numbers: "var(--v-muted)",
  calls: "var(--v-accent)",
  yours: "var(--v-warning)",
};

const short = (n: number) => (n >= 10000000 ? `₹${+(n / 10000000).toFixed(1)}Cr` : n >= 100000 ? `₹${+(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`);

/** Round tick values, about four steps, that always cover the data and the budget. */
function niceTicks(max: number): number[] {
  const raw = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const TOOLTIP = { borderRadius: 8, border: "1px solid var(--v-line)", fontSize: 12, boxShadow: "none" } as const;

export function SplitView({ c, cost }: { c: Canvas; cost: CanvasCost }) {
  const { parts, total, callsUnknown } = breakdownParts(c, cost);

  return (
    <div>
        <div className="grid items-center gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="relative mx-auto h-[200px] w-[200px]" role="img" aria-label={`Cost breakdown: ${parts.map((p) => `${p.label} ${inr(p.amount)}`).join(", ")}. Total ${inr(total)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={parts} dataKey="amount" nameKey="label" innerRadius={62} outerRadius={92} paddingAngle={parts.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
                  {parts.map((p) => <Cell key={p.id} fill={COLOUR[p.id]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP} formatter={(v) => inr(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] text-v-muted">Known so far</span>
              <span className="text-[17px] font-semibold tabular-nums">{inr(total)}</span>
            </div>
          </div>
          <ul className="flex flex-col gap-2.5 text-[14px]">
            {parts.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="size-3 shrink-0 rounded-[3px]" style={{ background: COLOUR[p.id] }} aria-hidden />
                <span className="min-w-0 flex-1">{p.label}</span>
                <span className="tabular-nums">{inr(p.amount)}</span>
                <span className="w-10 text-right text-[12.5px] tabular-nums text-v-muted">{p.amount / total < 0.01 ? "<1" : Math.round((p.amount / total) * 100)}%</span>
              </li>
            ))}
            {callsUnknown ? (
              <li className="flex items-center gap-3 text-v-muted">
                <span className="size-3 shrink-0 rounded-[3px] border border-dashed border-v-line-strong" aria-hidden />
                <span className="flex-1">Calls: not known yet</span>
              </li>
            ) : null}
          </ul>
        </div>
        {callsUnknown ? <p className="mt-4 text-[13px] leading-relaxed text-v-muted">Choose open-source models and add calls a month and minutes a call, and calls appear here.</p> : null}
    </div>
  );
}

export function MonthView({ c, cost }: { c: Canvas; cost: CanvasCost }) {
  const series = monthlySeries(c, cost);
  const ticks = series ? niceTicks(Math.max(c.budget ?? 0, series.points[series.points.length - 1].cumulative)) : [];
  return (
    <div>
        {series ? (
          <>
            <p className="mt-1 text-[13.5px] leading-relaxed text-v-body">
              {series.runsOutMonth !== null
                ? <span className="text-v-danger">The budget runs out in month {series.runsOutMonth}.</span>
                : c.budget !== null ? <>Stays within the budget for all {c.months} month{c.months === 1 ? "" : "s"}.</> : "Add a budget to compare."}
              <span className="text-v-muted"> Calls are assumed to be spread evenly.</span>
            </p>
            <div className="mt-4 h-[220px]" role="img" aria-label={`Cumulative cost by month, from ${inr(series.points[0].cumulative)} to ${inr(series.points[series.points.length - 1].cumulative)}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series.points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--v-line)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={(m) => (m === 0 ? "Start" : `M${m}`)} tick={{ fontSize: 11, fill: "var(--v-muted)" }} tickLine={false} axisLine={{ stroke: "var(--v-line)" }} />
                  <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "var(--v-muted)" }} tickLine={false} axisLine={false} width={52} ticks={ticks} domain={[0, ticks[ticks.length - 1] ?? "auto"]} />
                  <Tooltip contentStyle={TOOLTIP} formatter={(v) => [inr(Number(v)), "Total so far"]} labelFormatter={(m) => (Number(m) === 0 ? "At the start" : `End of month ${m}`)} />
                  {c.budget !== null ? <ReferenceLine y={c.budget} stroke="var(--v-danger)" strokeDasharray="5 4" label={{ value: "Budget", position: "insideTopRight", fontSize: 11, fill: "var(--v-danger)" }} /> : null}
                  <Area type="monotone" dataKey="cumulative" stroke="var(--v-accent)" strokeWidth={2} fill="var(--v-accent)" fillOpacity={0.12} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <p className="mt-1 text-[13.5px] leading-relaxed text-v-muted">Needs open-source models, calls a month and minutes a call. Proprietary models are not priced in the package document, so they cannot be charted.</p>
        )}
    </div>
  );
}
