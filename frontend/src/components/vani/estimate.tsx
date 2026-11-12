"use client";

import { AlertTriangle, ChevronUp, OctagonAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { compact, inr, pct } from "@/lib/vani/format";
import { recommend, type RecommendationResult } from "@/lib/vani/recommend";
import { priceOf } from "@/lib/vani/pricing";
import type { CostResult, PackageRecord } from "@/lib/vani/types";
import { usePackage } from "./workspace";
import { Badge, CountUp, Disclosure, Drawer, InfoTip, Progress, cx } from "./ui";

export function useEstimate(pkg: PackageRecord) {
  return useMemo(() => {
    const r = pkg.requirements;
    const ready = r.languages.length > 0 && !!r.callsPerMonth && !!r.avgMinutes && !!r.peakConcurrent;
    const result: RecommendationResult | null = ready ? recommend(r, pkg.hosting, pkg.reached) : null;
    const top = result?.recommended ?? null;
    const cost: CostResult | null = top ? priceOf(top.eval.selection, top.eval.usage, pkg.hosting, r) : null;
    return { ready, result, top, cost };
  }, [pkg.requirements, pkg.hosting, pkg.reached]);
}

export type BudgetLevel = "none" | "ok" | "near" | "warn" | "over";
export const budgetLevel = (usedPct: number | null): BudgetLevel => (usedPct === null ? "none" : usedPct > 100 ? "over" : usedPct >= 90 ? "warn" : usedPct >= 75 ? "near" : "ok");

export function BudgetMeter({ cost, budget, compactView }: { cost: CostResult; budget: number | null; compactView?: boolean }) {
  const used = cost.budgetUsedPct;
  const level = budgetLevel(used);
  if (budget === null || used === null) return <p className="muted" style={{ fontSize: 13 }}>No budget ceiling set. Add one in Requirements to see how this fits.</p>;
  const colour = level === "over" ? "var(--bad)" : level === "warn" ? "var(--warn)" : "var(--ink)";
  const label = level === "over" ? "Over the budget ceiling" : level === "warn" ? "Close to the ceiling" : level === "near" ? "Approaching the ceiling" : "Within budget";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="ink tnum" style={{ fontWeight: 600 }}><CountUp value={used} format={(n) => pct(n)} /> of {inr(budget)}</span>
        <span className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: level === "over" ? "var(--bad)" : level === "warn" ? "var(--warn)" : "var(--muted)", fontWeight: 500 }}>{level === "over" ? <OctagonAlert size={14} aria-hidden /> : level === "warn" ? <AlertTriangle size={14} aria-hidden /> : null}{label}</span>
      </div>
      <div className="mt-2.5 relative" role="meter" aria-label="Budget used" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={Math.max(100, Math.round(used))} aria-valuetext={`${Math.round(used)} percent of the budget ceiling. ${label}.`} style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "visible" }}>
        <div style={{ position: "absolute", inset: 0, width: `${Math.min(100, used)}%`, background: colour, borderRadius: 999, transition: "width 0.5s cubic-bezier(0.22,1,0.36,1), background 0.3s" }} />
        {used > 100 && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${(100 / used) * 100}%`, width: 2, background: "var(--ink)" }} aria-hidden />}
        {used > 100 && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${(100 / used) * 100}%`, right: 0, background: "repeating-linear-gradient(45deg, var(--bad) 0 3px, transparent 3px 6px)", borderRadius: "0 999px 999px 0", opacity: 0.55 }} aria-hidden />}
      </div>
      {!compactView && level === "over" && <p className="mt-2.5" style={{ fontSize: 12.5, color: "var(--bad)" }}><b>Launch blocked above budget ceiling.</b> Lower the cost, or raise the ceiling in Requirements.</p>}
    </div>
  );
}

function Body() {
  const { pkg, ratesAsOf } = usePackage();
  const est = useEstimate(pkg);
  const comp = est.result?.completeness;
  const top = est.top;
  return (
    <div className="grid gap-5">
      <div>
        <div className="flex items-center justify-between"><span className="eyebrow">Estimated cost</span><Badge>Sample rates</Badge></div>
        {est.cost ? (
          <div className="mt-2" aria-live="polite">
            <div className="flex items-baseline gap-1.5"><span className="serif ink tnum" style={{ fontSize: 40, lineHeight: 1.05 }}><CountUp value={est.cost.recurring} format={(n) => inr(Math.round(n))} /></span><span className="muted">/ month</span></div>
            <span className="sr-only">Estimated {inr(est.cost.recurring)} per month.</span>
            <p className="mt-1.5 muted" style={{ fontSize: 13 }}>Setup {inr(est.cost.oneTime)} one time · {inr(est.cost.perMinute, { decimals: 2 })} per minute</p>
          </div>
        ) : <p className="mt-2" style={{ fontSize: 13.5 }}>Add the languages, calls per month, call length and peak to see an estimate.</p>}
      </div>
      {est.cost && <div><div className="eyebrow mb-2">Budget</div><BudgetMeter cost={est.cost} budget={pkg.requirements.monthlyBudget} compactView /></div>}
      <div>
        <div className="flex items-center justify-between"><span className="eyebrow">Inputs complete</span><span className="ink tnum" style={{ fontWeight: 600, fontSize: 13 }}>{comp ? `${comp.done} of ${comp.total}` : "—"}</span></div>
        {comp && <div className="mt-2"><Progress value={(comp.done / comp.total) * 100} label="Inputs complete" /></div>}
        {comp && comp.missing.length > 0 && <Disclosure className="mt-2" summary={<span className="muted" style={{ fontSize: 12.5 }}>{comp.missing.length} still to answer</span>}><ul className="m-0 mt-1.5 pl-4 muted" style={{ fontSize: 12.5 }}>{comp.missing.map((m) => <li key={m}>{m}</li>)}</ul></Disclosure>}
      </div>
      <div>
        <div className="flex items-center justify-between"><span className="eyebrow flex items-center gap-1">Recommendation confidence <InfoTip text="How sure we are that this is the right package. It rises as you answer more questions and clear open items." /></span><span className="ink tnum" style={{ fontWeight: 600, fontSize: 13 }}>{top ? <CountUp value={top.confidence} format={(n) => `${Math.round(n)}%`} /> : "—"}</span></div>
        {top && <p className="mt-1.5 muted" style={{ fontSize: 12.5 }}>Leading: <span className="ink">{top.eval.pkg.name}</span>, {top.eval.fit}% fit.</p>}
        {est.result?.status === "none" && <p className="mt-1.5" style={{ fontSize: 12.5, color: "var(--bad)" }}>No package fits yet. {est.result.suggestions[0]}</p>}
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>Rates as of {ratesAsOf}. Updates as you answer. Sample catalogue, not an offer.</p>
    </div>
  );
}

/** Desktop: a sticky card. Smaller screens: a bar at the bottom that opens a drawer. */
export function LiveEstimate() {
  const { pkg } = usePackage();
  const est = useEstimate(pkg);
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="hidden xl:block va-card va-card--pad va-card--raised sticky" style={{ top: 120 }} aria-label="Live estimate"><Body /></aside>
      <button type="button" onClick={() => setOpen(true)} className={cx("xl:hidden fixed left-3 right-3 lg:left-[260px] z-30 va-card va-card--raised flex items-center justify-between px-4 text-left va-noprint")} style={{ bottom: 88, height: 48, cursor: "pointer", font: "inherit" }} aria-label="Open live estimate">
        <span className="ink tnum" style={{ fontWeight: 600 }}>{est.cost ? `${inr(est.cost.recurring)} / month` : "Live estimate"}</span>
        <span className="muted flex items-center gap-1.5" style={{ fontSize: 12.5 }}>{est.top ? `${est.top.confidence}% confidence` : "Fill in the basics"}<ChevronUp size={15} aria-hidden /></span>
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Live estimate" description="Updates as you answer."><Body /></Drawer>
    </>
  );
}

export { compact };
