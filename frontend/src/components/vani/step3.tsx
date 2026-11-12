"use client";

import { Award, Check, CheckCircle2, Coins, HelpCircle, Scale, Zap, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/vani/api";
import { COMPONENT_BY_ID, LANGUAGE_BY_ID, PROFILE_BY_ID, compLabel, type Asr, type Tts } from "@/lib/vani/catalog";
import { dateLong, inr, inrDelta, num, pct } from "@/lib/vani/format";
import { isStale } from "@/lib/vani/packages";
import { priceOf } from "@/lib/vani/pricing";
import { WEIGHTS, confidenceOf, explainEval, inputHash, recommend, type Evaluation } from "@/lib/vani/recommend";
import type { Selection } from "@/lib/vani/types";
import { ErrorState } from "./page";
import { PolicyList, PolicySummary, usePolicy } from "./policy-ui";
import { useVani } from "./provider";
import { Alert, Badge, Button, CountUp, Disclosure, InfoTip, Spinner, cx } from "./ui";
import { ReadOnlyNotice, StepFooter, Stepper, WorkspaceHeader, useContinue, usePackage } from "./workspace";

/* ------------------------------------------------------------------ analysis loader */

const ANALYSIS = ["Reading your requirements", "Applying hosting and data rules", "Excluding packages that can't qualify", "Checking language coverage", "Pricing each package from your usage", "Scoring and ranking what is left"];

function AnalysisLoader({ name }: { name: string }) {
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((x) => Math.min(ANALYSIS.length - 1, x + 1)), 430); return () => clearInterval(t); }, []);
  return (
    <div className="mx-auto va-fade" style={{ maxWidth: 520, padding: "56px 0" }} role="status" aria-live="polite">
      <p className="eyebrow mb-3">Analysing</p>
      <h2 className="serif" style={{ fontSize: 30, lineHeight: 1.15, color: "var(--ink)" }}>Finding the right package for {name || "your service"}.</h2>
      <ol className="m-0 mt-8 p-0 list-none grid gap-3.5">
        {ANALYSIS.map((a, i) => (
          <li key={a} className="flex items-center gap-3" style={{ opacity: i <= n ? 1 : 0.35, transition: "opacity 0.3s" }}>
            <span className="grid place-content-center flex-none" style={{ width: 20, height: 20, borderRadius: "50%", background: i < n ? "var(--solid)" : "transparent", border: i < n ? 0 : "1.5px solid var(--line-strong)", color: "var(--on-solid)" }}>{i < n ? <Check size={12} strokeWidth={3} aria-hidden /> : i === n ? <Spinner size={12} /> : null}</span>
            <span className={i === n ? "ink" : ""} style={{ fontWeight: i === n ? 500 : 400 }}>{a}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ stack tiles */

const LAYERS: { key: keyof Selection; label: string; line: "asr" | "llm" | "tts" | "telephony" | "language" | "hosting" }[] = [
  { key: "asr", label: "Speech recognition", line: "asr" }, { key: "llm", label: "Language model", line: "llm" }, { key: "tts", label: "Voice", line: "tts" },
  { key: "telephony", label: "Telephony", line: "telephony" }, { key: "adapter", label: "Language adapter", line: "language" }, { key: "hostingProfile", label: "Hosting", line: "hosting" },
];

function StackTile({ layer, sel, cost }: { layer: (typeof LAYERS)[number]; sel: Selection; cost: ReturnType<typeof priceOf> }) {
  const { pkg } = usePackage();
  const id = sel[layer.key];
  const comp = layer.key === "hostingProfile" ? null : COMPONENT_BY_ID[id];
  const prof = layer.key === "hostingProfile" ? PROFILE_BY_ID[id] : null;
  const line = cost.lines.find((l) => l.id === layer.line);
  const langs = pkg.requirements.languages;
  const lang = comp && (comp.layer === "asr" || comp.layer === "tts") ? (comp as Asr | Tts).langs : null;
  const testedAll = lang ? langs.every((l) => lang[l] === "tested") : null;
  const title = comp ? (comp.layer === "adapter" && comp.provider === "None" ? "No language adapter" : comp.model) : prof?.name ?? id;
  const provider = comp ? (comp.provider === "None" ? "—" : comp.provider) : prof ? prof.kind : "";
  const summary = lang ? (testedAll ? `Tested for ${langs.length === 1 ? LANGUAGE_BY_ID[langs[0]]?.name : "all your languages"}` : "Not tested for every language") : comp?.layer === "llm" ? `Tier ${(comp as { tier: number }).tier} model` : prof ? `Up to ${prof.capacity} calls at once` : comp?.layer === "telephony" ? "Carries your channel" : "Helps with mixed-language speech";
  return (
    <div className="va-card p-4">
      <Disclosure summary={
        <div>
          <div className="eyebrow">{layer.label}</div>
          <div className="ink mt-1" style={{ fontWeight: 600 }}>{title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ fontSize: 12.5 }}><span className="muted">{provider}</span>{testedAll !== null && (testedAll ? <Badge tone="pass" icon={<CheckCircle2 size={11} aria-hidden />}>Tested</Badge> : <Badge tone="warn">Check</Badge>)}</div>
          <div className="mt-1.5 muted" style={{ fontSize: 12.5 }}>{summary}</div>
        </div>}>
        <dl className="m-0 mt-3 pt-3 grid gap-2" style={{ borderTop: "1px solid var(--line)", fontSize: 12.5 }}>
          {([
            ["Provider", provider],
            ["Model", comp ? comp.model : prof?.name ?? ""],
            ["Runs on", comp ? comp.hosting.map((k) => (k === "govcloud" ? "Government cloud" : k === "onprem" ? "On-prem" : "Approved cloud")).join(", ") : prof?.note ?? ""],
            ["Data location", comp ? (comp.inCountry ? "In India" : "Outside India") : "Where you host it"],
            ["Benchmarked", comp?.benchmarkDate ? dateLong(comp.benchmarkDate) : "No benchmark recorded"],
            ["Speed", comp ? `${comp.latencyMs} ms typical` : "Not applicable"],
            ["Cost", line ? `${line.monthly === null ? "Not included" : inr(line.monthly)} a month. ${line.unitRate}` : ""],
          ] as [string, string][]).filter(([, v]) => v).map(([k, v]) => <div key={k} className="grid grid-cols-[96px_1fr] gap-2"><dt className="muted">{k}</dt><dd className="m-0 ink">{v}</dd></div>)}
        </dl>
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------------ comparison */

function Compare({ evals, selectedId, all }: { evals: Evaluation[]; selectedId: string; all: Evaluation[] }) {
  const { pkg } = usePackage();
  const [ids, setIds] = useState<string[]>(() => evals.slice(0, 4).map((e) => e.pkg.id));
  const chosen = ids.map((id) => all.find((e) => e.pkg.id === id)).filter(Boolean) as Evaluation[];
  const r = pkg.requirements;
  const rows: { label: string; get: (e: Evaluation) => number; show: (e: Evaluation) => string; better: "high" | "low"; bar?: number }[] = [
    { label: "Fit for your needs", get: (e) => e.fit, show: (e) => `${e.fit}%`, better: "high", bar: 100 },
    { label: "Cost per month", get: (e) => e.cost.recurring, show: (e) => inr(e.cost.recurring), better: "low" },
    { label: "One-time setup", get: (e) => e.cost.oneTime, show: (e) => inr(e.cost.oneTime), better: "low" },
    { label: "Reply speed", get: (e) => e.latencyS, show: (e) => `${e.latencyS.toFixed(1)} s`, better: "low" },
    { label: "Task completion", get: (e) => e.pkg.metrics.taskCompletion, show: (e) => `${e.pkg.metrics.taskCompletion}%`, better: "high", bar: 100 },
    { label: "Voice quality", get: (e) => e.pkg.metrics.voiceQuality, show: (e) => `${e.pkg.metrics.voiceQuality} / 5`, better: "high", bar: 5 },
    { label: "Tested for your languages", get: (e) => e.langs.filter((l) => l.level === "tested").length, show: (e) => `${e.langs.filter((l) => l.level === "tested").length} of ${e.langs.length}`, better: "high" },
    { label: "Tested up to", get: (e) => e.pkg.metrics.maxPeak, show: (e) => `${e.pkg.metrics.maxPeak} calls`, better: "high" },
  ];
  return (
    <div>
      <fieldset className="m-0 p-0 border-0 mb-4"><legend className="va-label">Choose up to four to compare</legend>
        <div className="flex flex-wrap gap-2">
          {all.filter((e) => !e.excluded.length).map((e) => {
            const on = ids.includes(e.pkg.id);
            return <button key={e.pkg.id} type="button" className="va-chip va-chip--toggle" aria-pressed={on} disabled={!on && ids.length >= 4} onClick={() => setIds((x) => (on ? x.filter((y) => y !== e.pkg.id) : [...x, e.pkg.id]))} style={!on && ids.length >= 4 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>{on && <Check size={12} aria-hidden />}{e.pkg.name}</button>;
          })}
        </div>
      </fieldset>
      {chosen.length < 2 ? <Alert tone="info">Choose at least two to compare.</Alert> : (
        <div className="va-tablewrap">
          <table className="va-table" style={{ minWidth: 520 + chosen.length * 40 }}>
            <caption className="sr-only">Side-by-side comparison of packages</caption>
            <thead><tr><th scope="col" style={{ position: "sticky", left: 0, background: "var(--sunken)", minWidth: 150 }}>&nbsp;</th>{chosen.map((e) => <th scope="col" key={e.pkg.id} style={{ minWidth: 140 }}><span className="ink" style={{ textTransform: "none", fontSize: 13.5, letterSpacing: 0 }}>{e.pkg.name}</span>{e.pkg.id === selectedId && <div><Badge tone="solid">Selected</Badge></div>}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => {
                const vals = chosen.map(row.get);
                const best = row.better === "high" ? Math.max(...vals) : Math.min(...vals);
                const tie = vals.every((v) => v === vals[0]);
                return (
                  <tr key={row.label}>
                    <th scope="row" style={{ position: "sticky", left: 0, background: "var(--surface)", textTransform: "none", letterSpacing: 0, fontSize: 13, fontWeight: 500, color: "var(--body)" }}>{row.label}</th>
                    {chosen.map((e, i) => {
                      const isBest = !tie && vals[i] === best;
                      return (
                        <td key={e.pkg.id}>
                          <span className="inline-flex items-center gap-1.5 tnum" style={{ fontWeight: isBest ? 700 : 400, color: isBest ? "var(--ink)" : undefined }}>{row.show(e)}{isBest && <span className="inline-flex items-center gap-0.5" style={{ fontSize: 10.5, color: "var(--pass)", fontWeight: 600 }}><Check size={11} strokeWidth={3} aria-hidden />Best</span>}</span>
                          {row.bar && <div className="mt-1.5" style={{ height: 3, borderRadius: 2, background: "var(--line)" }}><div style={{ width: `${(vals[i] / row.bar) * 100}%`, height: "100%", borderRadius: 2, background: isBest ? "var(--ink)" : "var(--muted)", transition: "width 0.4s" }} /></div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr><th scope="row" style={{ position: "sticky", left: 0, background: "var(--surface)", textTransform: "none", letterSpacing: 0, fontSize: 13, fontWeight: 500, color: "var(--body)" }}>Against your budget</th>{chosen.map((e) => <td key={e.pkg.id}>{r.monthlyBudget ? (e.cost.overBudget ? <Badge tone="bad">{pct(e.cost.budgetUsedPct ?? 0)} Over</Badge> : <Badge tone="pass">{pct(e.cost.budgetUsedPct ?? 0)} Within</Badge>) : <span className="muted">No ceiling</span>}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the step */

const VARIANT: Record<string, { label: string; icon: typeof Coins }> = { cost: { label: "Cost optimised", icon: Coins }, quality: { label: "Quality optimised", icon: Award }, latency: { label: "Latency optimised", icon: Zap } };

export function RecommendationStep() {
  const { pkg, apply, flush, simulation, readOnly, setRequirements, go, refreshSim } = usePackage();
  const { fail, toast } = useVani();
  const [phase, setPhase] = useState<"idle" | "running" | "error">(pkg.selection ? "idle" : "running");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const started = useRef(false);
  const r = pkg.requirements, h = pkg.hosting;
  const { checks, summary } = usePolicy();

  const run = async () => {
    setPhase("running"); setErr(null);
    try {
      if (!(await flush())) { setPhase("idle"); return; }
      const [res] = await Promise.all([api.runRecommendation(pkg.id), new Promise((x) => setTimeout(x, 2700))]);
      apply(res.pkg); setPhase("idle");
    } catch (e) { setErr(e); setPhase("error"); fail(e); }
  };
  useEffect(() => {
    refreshSim();
    if (!pkg.selection && !started.current && !readOnly) { started.current = true; void run(); }
    // run once on arrival when nothing has been recommended yet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = useMemo(() => recommend(r, h, pkg.reached, undefined, simulation.unavailableProviders), [r, h, pkg.reached, simulation.unavailableProviders]);
  const selected: Evaluation | null = result.set.candidates.find((e) => e.pkg.id === pkg.recommendation?.baseId) ?? result.recommended?.eval ?? null;
  const stale = isStale(pkg);
  const explain = selected ? explainEval(selected, result.set, r, h) : null;
  const cost = selected && pkg.selection && pkg.usage ? priceOf(pkg.selection, pkg.usage, h, r) : selected ? selected.cost : null;
  const conf = selected ? confidenceOf(selected.fit, result.completeness, explain?.unresolved.length ?? 0) : 0;
  const isRec = selected && result.recommended?.eval.pkg.id === selected.pkg.id;
  const customised = !!(selected && pkg.selection && (Object.keys(selected.selection) as (keyof Selection)[]).some((k) => selected.selection[k] !== pkg.selection![k]));

  useContinue(() => { if (pkg.selection) return true; toast("Wait for the recommendation first.", "info"); return false; });

  const choose = async (variant: "recommended" | "cost" | "quality" | "latency", name: string) => {
    const prev = pkg.recommendation?.variant ?? "recommended";
    setBusy(variant);
    try {
      const next = await api.chooseVariant(pkg.id, variant); apply(next);
      toast(`Switched to ${name}. Cost, checks and the quote now follow it.`, "pass", { label: "Undo", run: () => { void api.chooseVariant(pkg.id, prev).then(apply).catch(fail); } });
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)]"><WorkspaceHeader /><Stepper /></div>
      <div className="mt-8 min-w-0">
        <ReadOnlyNotice />
        {phase === "running" ? <AnalysisLoader name={pkg.name} /> : phase === "error" ? (
          <ErrorState error={err} onRetry={() => void run()} title="We couldn't build your recommendation" />
        ) : !selected && result.status === "none" ? (
          <div className="mx-auto" style={{ maxWidth: 620 }}>
            <p className="eyebrow mb-2">Step 3 of 5</p>
            <h2 className="serif" style={{ fontSize: 30, lineHeight: 1.12, color: "var(--ink)" }}>No package fits yet.</h2>
            <p className="mt-2">Every package breaks at least one of your rules. Here is what is blocking each, and what to change.</p>
            <ul className="m-0 mt-5 pl-5 grid gap-1.5">{result.suggestions.map((s) => <li key={s} className="ink">{s}</li>)}</ul>
            <div className="mt-6 flex gap-2"><Button variant="primary" onClick={() => void go("requirements")}>Change requirements</Button><Button onClick={() => void go("hosting")}>Change hosting</Button></div>
            <div className="mt-8"><ExcludedList result={result} /></div>
          </div>
        ) : !selected ? (
          <Alert tone="info" title="Nothing recommended yet">{readOnly ? "A person who can edit this package needs to run the recommendation first." : "Run the recommendation to continue."}</Alert>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
            {stale && !readOnly && <Alert tone="warn" title="Your requirements changed since this was worked out" action={<Button size="sm" onClick={() => void run()}>Refresh recommendation</Button>}>Refreshing replaces the selection with the new best fit. Your saved versions are kept.</Alert>}
            {result.budgetNotice && (
              <Alert tone="warn" title="Every package that qualifies is over your budget" action={!readOnly ? <><Button size="sm" onClick={() => { setRequirements((x) => ({ ...x, monthlyBudget: Math.ceil((result.budgetNotice!.closest.cost.recurring * 1.02) / 1000) * 1000 })); toast("Budget ceiling raised to fit the closest option.", "pass"); }}>Raise ceiling to {inr(Math.ceil((result.budgetNotice.closest.cost.recurring * 1.02) / 1000) * 1000)}</Button><Button size="sm" onClick={() => void go("requirements")}>Change requirements</Button></> : undefined}>The closest is {result.budgetNotice.closest.pkg.name} at {inr(result.budgetNotice.closest.cost.recurring)} a month, {result.budgetNotice.overByPct}% above your ceiling. You can raise the ceiling, lower the volume or relax a requirement.</Alert>
            )}

            <section aria-labelledby="rec-hero">
              <p className="eyebrow mb-3">Step 3 of 5 · {isRec ? "Recommended for you" : "Your selection"}</p>
              <div className="va-card va-card--raised" style={{ overflow: "hidden" }}>
                <div className="grid lg:grid-cols-[1.2fr_1fr]">
                  <div className="p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0"><h2 id="rec-hero" className="serif" style={{ fontSize: "clamp(28px,3.4vw,40px)", lineHeight: 1.08, color: "var(--ink)" }}>{selected.pkg.name}</h2><p className="mt-2">{selected.pkg.tagline}</p></div>
                    </div>
                    <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-4">
                      <div><div className="serif ink tnum" style={{ fontSize: 64, lineHeight: 1 }}><CountUp value={selected.fit} format={(n) => `${Math.round(n)}%`} /></div><div className="muted mt-1.5 flex items-center gap-1" style={{ fontSize: 12.5 }}>fit for your needs <InfoTip text="How well this package matches what you asked for, weighted by what you said matters most. The parts are below." /></div></div>
                      <div><div className="serif ink tnum" style={{ fontSize: 34, lineHeight: 1 }}><CountUp value={conf} format={(n) => `${Math.round(n)}%`} /></div><div className="muted mt-1.5 flex items-center gap-1" style={{ fontSize: 12.5 }}>confidence <InfoTip text={`Based on ${result.completeness.done} of ${result.completeness.total} answers. It rises as you answer more and clear open items.`} /></div></div>
                    </div>
                    <p className="mt-5 muted" style={{ fontSize: 12.5 }}>Based on {result.completeness.done} of {result.completeness.total} answers{result.completeness.missing.length ? `. Still open: ${result.completeness.missing.join(", ")}` : ""}.</p>
                    {!isRec && result.recommended && <p className="mt-3" style={{ fontSize: 13 }}>You switched from <b className="ink">{result.recommended.eval.pkg.name}</b>. {!readOnly && <button className="va-link" onClick={() => void choose("recommended", result.recommended!.eval.pkg.name)}>Go back to the recommendation</button>}</p>}
                    {customised && <p className="mt-3" style={{ fontSize: 13 }}>You have customised the stack in Configure. The tiles below show your current choices.</p>}
                  </div>
                  <div className="p-6 sm:p-8" style={{ background: "var(--sunken)", borderLeft: "1px solid var(--line)" }}>
                    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-6">
                      {([["Per month", cost ? inr(cost.recurring) : "—"], ["Setup, once", cost ? inr(cost.oneTime) : "—"], ["Reply speed", `${selected.latencyS.toFixed(1)} s`], ["Task completion", `${selected.pkg.metrics.taskCompletion}%`]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="muted" style={{ fontSize: 12 }}>{k}</dt><dd className="m-0 serif ink tnum" style={{ fontSize: 26 }}>{v}</dd></div>)}
                    </dl>
                    <p className="mt-6 muted" style={{ fontSize: 12 }}>Measured on {selected.pkg.metrics.testCalls} test calls, {dateLong(selected.pkg.metrics.testDate)}. Sample catalogue.</p>
                    {cost && r.monthlyBudget && <p className="mt-3" style={{ fontSize: 13, color: cost.overBudget ? "var(--bad)" : undefined }}><b className="ink" style={{ color: cost.overBudget ? "var(--bad)" : undefined }}>{pct(cost.budgetUsedPct ?? 0)}</b> of your {inr(r.monthlyBudget)} budget{cost.overBudget ? ". Launch is blocked above the ceiling." : "."}</p>}
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-6 p-6 sm:p-8" style={{ borderTop: "1px solid var(--line)" }}>
                  {([["Why it fits", Check, explain?.why ?? [], "var(--pass)"], ["Trade-offs", Scale, explain?.tradeoffs ?? [], "var(--warn)"], ["Unresolved", HelpCircle, explain?.unresolved ?? [], "var(--muted)"]] as [string, typeof Check, string[], string][]).map(([t, I, items, c]) => (
                    <div key={t}><h3 className="flex items-center gap-2 eyebrow" style={{ color: "var(--ink)" }}><I size={14} style={{ color: c }} aria-hidden />{t}</h3>
                      {items.length ? <ul className="m-0 mt-3 p-0 list-none grid gap-2" style={{ fontSize: 13.5 }}>{items.map((x) => <li key={x} className="flex gap-2.5"><span className="flex-none mt-2" style={{ width: 4, height: 4, borderRadius: "50%", background: c }} aria-hidden />{x}</li>)}</ul> : <p className="mt-3 muted" style={{ fontSize: 13 }}>{t === "Unresolved" ? "Nothing is waiting on you." : "None worth noting."}</p>}
                    </div>))}
                </div>
                <div className="px-6 sm:px-8 pb-6">
                  <Disclosure summary={<span className="va-link" style={{ fontSize: 13 }}>How the fit is worked out</span>}>
                    <div className="mt-4 grid gap-2.5" style={{ maxWidth: 560 }}>
                      {(Object.keys(WEIGHTS[r.priority]) as (keyof Evaluation["parts"])[]).map((k) => (
                        <div key={k} className="grid grid-cols-[120px_1fr_70px] items-center gap-3" style={{ fontSize: 12.5 }}>
                          <span>{({ lang: "Language fit", latency: "Reply speed", budget: "Budget", cost: "Low cost", quality: "Quality", tier: "Task depth", hosting: "Hosting fit" } as const)[k]}</span>
                          <div style={{ height: 6, borderRadius: 3, background: "var(--line)" }} role="img" aria-label={`${Math.round(selected.parts[k] * 100)} percent`}><div style={{ width: `${selected.parts[k] * 100}%`, height: "100%", borderRadius: 3, background: "var(--ink)" }} /></div>
                          <span className="muted tnum text-right">{Math.round(selected.parts[k] * 100)}% · {Math.round(WEIGHTS[r.priority][k] * 100)}% wt</span>
                        </div>))}
                    </div>
                  </Disclosure>
                </div>
              </div>
            </section>

            <section aria-labelledby="rec-stack">
              <h2 id="rec-stack" style={{ fontSize: 20 }}>What it is made of</h2><p className="mt-1.5 mb-5">Open any part to see the provider, how it was tested and what it costs.</p>
              {pkg.selection && cost && <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{LAYERS.map((l) => <StackTile key={l.key} layer={l} sel={pkg.selection as Selection} cost={cost} />)}</div>}
            </section>

            <section aria-labelledby="rec-alt">
              <h2 id="rec-alt" style={{ fontSize: 20 }}>Other ways to go</h2><p className="mt-1.5 mb-5">Each trades something for something else. Choose one and everything updates.</p>
              <div className="grid lg:grid-cols-3 gap-4">
                {result.alternatives.map((a) => {
                  const V = VARIANT[a.variant]; const Icon = V.icon; const on = selected.pkg.id === a.eval.pkg.id;
                  const delta = a.eval.cost.recurring - (cost?.recurring ?? selected.cost.recurring);
                  return (
                    <div key={a.variant} className="va-card p-5 flex flex-col" style={on ? { borderColor: "var(--ink)", boxShadow: "0 0 0 1px var(--ink)" } : undefined}>
                      <div className="flex items-center justify-between"><span className="flex items-center gap-2 eyebrow" style={{ color: "var(--ink)" }}><Icon size={14} aria-hidden />{V.label}</span>{on && <Badge tone="solid">Selected</Badge>}</div>
                      <h3 className="mt-3" style={{ fontSize: 18 }}>{a.eval.pkg.name}</h3>
                      <p className="mt-1 ink" style={{ fontWeight: 500, fontSize: 13.5 }}>{a.advantage}</p>
                      <div className="mt-4 flex items-baseline gap-2"><span className="serif ink tnum" style={{ fontSize: 24 }}>{inr(a.eval.cost.recurring)}</span><span className="muted" style={{ fontSize: 12.5 }}>a month · {delta === 0 ? "same" : inrDelta(delta)}</span></div>
                      <ul className="m-0 mt-4 pl-4 grid gap-1.5 flex-1" style={{ fontSize: 13 }}>{a.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>
                      <Button className="mt-5" variant={on ? "secondary" : "primary"} disabled={on || readOnly || !!busy} loading={busy === a.variant} onClick={() => void choose(a.variant, a.eval.pkg.name)}>{on ? "Selected" : "Select this instead"}</Button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="rec-cmp">
              <h2 id="rec-cmp" style={{ fontSize: 20 }}>Compare side by side</h2><p className="mt-1.5 mb-5">The best value in each row is marked.</p>
              <Compare key={result.candidates.length} evals={[selected, ...result.alternatives.map((a) => a.eval), ...(result.recommended && result.recommended.eval.pkg.id !== selected.pkg.id ? [result.recommended.eval] : [])].filter((e, i, arr) => arr.findIndex((x) => x.pkg.id === e.pkg.id) === i)} selectedId={selected.pkg.id} all={result.set.all} />
            </section>

            {result.excluded.length > 0 && <section aria-labelledby="rec-ex"><ExcludedList result={result} /></section>}

            <section aria-labelledby="rec-pol">
              <h2 id="rec-pol" style={{ fontSize: 20 }}>Checks before you can submit</h2><p className="mt-1.5 mb-4">Clear these here or in Hosting and data.</p>
              <div className="mb-3"><PolicySummary summary={summary} /></div>
              <PolicyList checks={checks} onlyOpen />
              {summary.check + summary.open === 0 && <Alert tone="pass">Everything is clear.</Alert>}
            </section>
          </div>
        )}
      </div>
      <StepFooter stepId="recommendation" nextLabel="Continue to configure & price" hideNext={phase === "running" || !selected} />
    </>
  );
}

function ExcludedList({ result }: { result: ReturnType<typeof recommend> }) {
  return (
    <div className="va-card p-5">
      <Disclosure summary={<span className="flex items-center gap-2"><h3 id="rec-ex" style={{ fontSize: 15 }}>{result.excluded.length} package{result.excluded.length === 1 ? "" : "s"} excluded</h3><span className="muted" style={{ fontSize: 13 }}>and why</span></span>}>
        <ul className="m-0 mt-4 p-0 list-none grid gap-4">{result.excluded.map((e) => <li key={e.pkg.id}><div className="flex items-center gap-2"><X size={14} className="muted" aria-hidden /><span className="ink" style={{ fontWeight: 600 }}>{e.pkg.name}</span></div><ul className="m-0 mt-1.5 pl-7 grid gap-1" style={{ fontSize: 13 }}>{e.excluded.map((x) => <li key={x}>{x}</li>)}</ul></li>)}</ul>
      </Disclosure>
    </div>
  );
}

export { compLabel, inputHash, num, cx };
