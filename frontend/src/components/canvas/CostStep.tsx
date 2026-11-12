"use client";

import { Notice } from "@/components/adopt/ui";
import { RATES, modelCategory, periodMinutes, volumeTable, type Canvas, type CanvasCost } from "@/lib/adopt/advisor/canvas";
import { inr } from "@/lib/adopt/advisor/cost";
import { useCanvas } from "@/lib/adopt/advisor/canvas-store";
import { CostViews } from "./CostViews";
import { BudgetMeter, Fold, NumField, rupees } from "./parts";

const EXPLORER = [1000, 5000, 10000, 25000, 50000, 100000];

export function CostStep({ c, cost, signedOff }: { c: Canvas; cost: CanvasCost; signedOff: boolean }) {
  const { actions } = useCanvas();
  const f = cost.fit;
  const cat = modelCategory(c);
  const mins = periodMinutes(c);
  const rows = volumeTable(c, EXPLORER);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-8 px-5 py-8 md:py-10">
      <header>
        <p className="text-[13px] text-v-muted">{cost.grandIsComplete ? "Indicative total" : "Known so far. This is not the full cost."}</p>
        <p className="text-[44px] font-semibold leading-tight tracking-tight tabular-nums md:text-[52px]" aria-live="polite">{inr(cost.grand)}</p>
        <div className="mt-3"><BudgetMeter c={c} cost={cost} /></div>
        <p className={`mt-3 text-[15px] leading-relaxed ${f.state === "short" ? "text-v-danger" : "text-v-body"}`} aria-live="polite">
          {f.state === "none" ? "Add your budget below to see how it fits." : f.state === "short" ? f.note || "Over budget." : f.state === "fits" ? <>Within your budget of <span className="font-semibold text-v-fg">{inr(c.budget)}</span>.</> : f.note}
        </p>
      </header>

      <section aria-label="Your numbers" className="grid gap-4 sm:grid-cols-3">
        <NumField id="cb-budget" label="Budget" prefix="₹" value={c.budget} step={1000} onChange={(v) => actions.patch({ budget: v })} />
        <NumField id="cb-calls" label="Calls a month" value={c.callsPerMonth} onChange={(v) => actions.patch({ callsPerMonth: v })} />
        <NumField id="cb-avg" label="Minutes a call" value={c.avgMinutes} step={0.5} onChange={(v) => actions.patch({ avgMinutes: v })} />
      </section>
      <p className="-mt-4 text-[13px] leading-relaxed text-v-muted">
        {mins === null ? "Add calls a month and minutes a call to see the cost of calls. Calls over 3 minutes are not recommended." : `That is ${mins.toLocaleString("en-IN")} minutes over ${c.months} month${c.months === 1 ? "" : "s"}. These are your planning figures.`}
      </p>

      {cat === "open" && f.affordableMinutes !== null ? (
        <section aria-label="What the budget buys" className="rounded-v-xl bg-v-pale px-5 py-4 text-[15px] leading-relaxed text-v-accent-deep">
          After {rupees(f.fixed)} of one-time charges, your budget pays for about <span className="font-semibold">{f.affordableMinutes.toLocaleString("en-IN")} minutes</span> of calls
          {f.affordableCallsPerMonth !== null ? <>, around <span className="font-semibold">{f.affordableCallsPerMonth.toLocaleString("en-IN")} calls a month</span> over {c.months} months</> : null}.
        </section>
      ) : null}

      <CostViews c={c} cost={cost} />

      {cost.unpriced.length ? (
        <Notice tone="warning" title={`${cost.unpriced.length} thing${cost.unpriced.length === 1 ? "" : "s"} need${cost.unpriced.length === 1 ? "s" : ""} a quote`}>
          The package document gives no price for {cost.unpriced.length === 1 ? "it" : "them"}, so {cost.unpriced.length === 1 ? "it is" : "they are"} not in the total. Details are below.
        </Notice>
      ) : null}

      <div className="flex flex-col gap-3">
        <Fold title="How it adds up">
          <ul className="flex flex-col gap-3 text-[14px]">
            {cost.core.lines.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-4">
                <span><span className="font-medium">{l.label}</span><span className="block text-[12.5px] text-v-muted">{l.basis.replace(/Rs\. /g, "₹")}</span></span>
                <span className="tabular-nums">{l.amount === null ? <span className="text-v-muted">Open</span> : inr(l.amount)}</span>
              </li>
            ))}
            {cost.unpriced.filter((u) => u.figure !== null).map((u) => (
              <li key={u.id} className="flex items-baseline justify-between gap-4">
                <span><span className="font-medium">{u.label}</span><span className="block text-[12.5px] text-v-warn-ink">Your own figure, not VoicERA&apos;s</span></span>
                <span className="tabular-nums">{inr(u.figure)}</span>
              </li>
            ))}
          </ul>
        </Fold>

        {cost.unpriced.length ? (
          <Fold title="Needs a quote" summary="Type your own figure if you have one. It stays labelled as yours.">
            <ul className="flex flex-col gap-4">
              {cost.unpriced.map((u) => (
                <li key={u.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-end">
                  <div><p className="text-[14px] font-medium">{u.label}</p><p className="text-[12.5px] text-v-muted">{u.why}</p></div>
                  <NumField id={`fig-${u.id}`} label="Your figure" prefix="₹" value={u.figure} step={1000} onChange={(v) => actions.figure(u.id, v)} />
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}

        <Fold title="What other volumes would cost" summary="Open-source models only, the one documented per-minute rate.">
          <table className="w-full text-[14px]">
            <thead><tr className="text-left font-mono text-[10px] uppercase tracking-[.12em] text-v-muted"><th className="pb-2 font-normal">Minutes</th><th className="pb-2 text-right font-normal">Total</th><th className="pb-2 text-right font-normal">Budget</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.minutes} className="border-t border-v-line">
                  <td className="py-2 tabular-nums">{r.minutes.toLocaleString("en-IN")}</td>
                  <td className="py-2 text-right tabular-nums">{inr(r.total)}</td>
                  <td className={`py-2 text-right text-[13px] ${r.withinBudget === null ? "text-v-muted" : r.withinBudget ? "text-v-ok-ink" : "text-v-danger"}`}>{r.withinBudget === null ? "No budget" : r.withinBudget ? "Within" : "Over"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fold>

        <Fold title="What this assumes">
          <div className="mb-4 max-w-[200px]">
            <NumField id="cb-months" label="Months the budget must last" value={c.months} min={1} max={60} onChange={(v) => actions.patch({ months: Math.max(1, Math.round(v ?? 1)) })} />
          </div>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-v-body">
            {cost.core.assumptions.map((a) => <li key={a}>{a}</li>)}
            <li>The months and volumes are your planning figures, not package terms.</li>
            <li>Whether the number charge repeats is not stated, so it is counted once.</li>
            <li>Rates: {rupees(RATES.setup)} setup, {rupees(RATES.perNumber)} a number, {rupees(RATES.perMinuteOpen)} a minute for open-source models.</li>
          </ul>
        </Fold>
      </div>

      <label className="flex items-start gap-3 rounded-v-xl border border-v-line bg-white px-5 py-4 text-[14px] leading-snug">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--v-accent)]" checked={signedOff} onChange={(e) => actions.set({ signedOff: e.target.checked })} />
        <span>I have reviewed this cost. I know anything that needs a quote is not in it.</span>
      </label>
    </div>
  );
}
