"use client";

import { AlertTriangle, ArrowRight, Check, CheckCircle2, History, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/vani/api";
import { COMPONENT_BY_ID, PROFILE_BY_ID, compLabel } from "@/lib/vani/catalog";
import { LAYER_LABEL, LAYER_ORDER, layerStatus, optionsFor, type LayerKey } from "@/lib/vani/configure";
import { usageFrom } from "@/lib/vani/defaults";
import { ago, compact, dateLong, inr, inrDelta, num, pct } from "@/lib/vani/format";
import { diffConfig, hasUnsavedConfig } from "@/lib/vani/packages";
import { priceOf, turnLatencyFor } from "@/lib/vani/pricing";
import type { CostResult, Selection, Usage, VersionSnapshot } from "@/lib/vani/types";
import { BudgetMeter } from "./estimate";
import { useVani } from "./provider";
import { Alert, Badge, Button, Dialog, Drawer, Field, InfoTip, NumberInput, Spinner, Textarea, Tooltip, CountUp } from "./ui";
import { ReadOnlyNotice, StepFooter, Stepper, WorkspaceHeader, useContinue, usePackage } from "./workspace";

const SEG = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];

/* ------------------------------------------------------------------ composition */

function Composition({ cost }: { cost: CostResult }) {
  const [focus, setFocus] = useState<string | null>(null);
  const total = cost.recurring || 1;
  const lines = cost.lines.filter((l) => (l.monthly ?? 0) > 0);
  const f = cost.lines.find((l) => l.id === focus) ?? null;
  return (
    <div>
      <div className="flex rounded-lg overflow-hidden" style={{ height: 38, background: "var(--line)", gap: 2 }} role="group" aria-label="Where the monthly cost goes">
        {lines.map((l) => {
          const i = cost.lines.findIndex((x) => x.id === l.id);
          const share = ((l.monthly ?? 0) / total) * 100;
          const on = focus === l.id;
          return (
            <button key={l.id} type="button" aria-pressed={on} aria-label={`${l.label}: ${inr(l.monthly)}, ${share.toFixed(0)} percent`} onClick={() => setFocus(on ? null : l.id)} onMouseEnter={() => setFocus(l.id)} onFocus={() => setFocus(l.id)}
              style={{ flex: `${share} 1 0`, minWidth: 6, background: SEG[i], border: 0, padding: 0, cursor: "pointer", opacity: focus && !on ? 0.4 : 1, transition: "opacity 0.15s, flex-grow 0.5s cubic-bezier(0.22,1,0.36,1)", position: "relative" }}>
              {share > 12 && <span style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", fontSize: 11, fontWeight: 700, color: "var(--bg)", mixBlendMode: "normal" }}>{share.toFixed(0)}%</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-3 min-h-[44px]" aria-live="polite">
        {f ? <p style={{ fontSize: 13.5 }}><b className="ink">{f.label}</b>: {inr(f.monthly)} ({(((f.monthly ?? 0) / total) * 100).toFixed(0)}% of the month). {f.usage} at {f.unitRate}.{f.note ? ` ${f.note}.` : ""}</p> : <p className="muted" style={{ fontSize: 13 }}>Hover or select a segment to see what it is.</p>}
      </div>
      <ul className="m-0 mt-2 p-0 list-none flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Legend">
        {cost.lines.map((l, i) => <li key={l.id} className="flex items-center gap-2" style={{ fontSize: 12.5, opacity: (l.monthly ?? 0) > 0 ? 1 : 0.5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: SEG[i] }} aria-hidden />{l.label}</li>)}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ layer picker */

function Pill({ tone, children }: { tone: "pass" | "warn" | "bad" | "neutral"; children: React.ReactNode }) {
  return <Badge tone={tone === "neutral" ? "neutral" : tone} icon={tone === "pass" ? <CheckCircle2 size={11} aria-hidden /> : tone === "warn" ? <AlertTriangle size={11} aria-hidden /> : tone === "bad" ? <X size={11} aria-hidden /> : undefined}>{children}</Badge>;
}

function OptionPicker({ layer, sel, usage, onPick, open, onClose }: { layer: LayerKey; sel: Selection; usage: Usage; onPick: (id: string) => void; open: boolean; onClose: () => void }) {
  const { pkg, simulation } = usePackage();
  const opts = useMemo(() => optionsFor(layer, sel, usage, pkg.requirements, pkg.hosting, simulation.unavailableProviders), [layer, sel, usage, pkg.requirements, pkg.hosting, simulation.unavailableProviders]);
  return (
    <Drawer open={open} onClose={onClose} title={`Change ${LAYER_LABEL[layer].toLowerCase()}`} description="Options that don't work with your hosting or data rules are greyed out, with the reason.">
      <ul role="radiogroup" aria-label={LAYER_LABEL[layer]} className="m-0 p-0 list-none grid gap-3">
        {opts.map((o) => {
          const blocked = o.blockers.length > 0;
          return (
            <li key={o.id}>
              <button type="button" role="radio" aria-checked={o.current} disabled={blocked} onClick={() => { onPick(o.id); onClose(); }} className="va-selectcard" style={{ paddingRight: 16 }}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0"><span className="ink block" style={{ fontWeight: 600 }}>{o.title}</span><span className="muted block" style={{ fontSize: 12.5 }}>{o.rateText}{o.latencyMs ? ` · ${o.latencyMs} ms` : ""}</span></span>
                  <span className="flex-none text-right tnum" style={{ fontSize: 13, fontWeight: 600, color: o.monthlyDelta > 0 ? "var(--ink)" : o.monthlyDelta < 0 ? "var(--pass)" : "var(--muted)" }}>{o.current ? "Current" : inrDelta(o.monthlyDelta)}{!o.current && o.monthlyDelta !== 0 && <span className="muted block" style={{ fontWeight: 400, fontSize: 11 }}>a month</span>}</span>
                </span>
                <span className="flex flex-wrap gap-1.5 mt-2.5">
                  {blocked ? <Pill tone="bad">Not compatible</Pill> : <Pill tone="pass">Compatible</Pill>}
                  {o.benchmark === "tested" && <Pill tone="pass">Tested for your languages</Pill>}
                  {o.benchmark === "partial" && <Pill tone="warn">Partly tested</Pill>}
                  {o.benchmark === "none" && <Pill tone="bad">Not supported</Pill>}
                </span>
                {[...o.blockers, ...o.warnings].length > 0 && <span className="block mt-2" style={{ fontSize: 12.5, color: blocked ? "var(--bad)" : "var(--body)" }}>{[...o.blockers, ...o.warnings].join(" ")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ versions */

function DiffView({ a, b, labelA, labelB }: { a: { selection: Selection; usage: Usage }; b: { selection: Selection; usage: Usage }; labelA: string; labelB: string }) {
  const { pkg } = usePackage();
  const changes = diffConfig(a, b);
  const ca = priceOf(a.selection, a.usage, pkg.hosting, pkg.requirements), cb = priceOf(b.selection, b.usage, pkg.hosting, pkg.requirements);
  const base = pkg.recommendation?.baseId ?? "";
  return changes.length === 0 ? <p className="muted">No differences. {labelA} and {labelB} are the same.</p> : (
    <div>
      <div className="va-tablewrap"><table className="va-table"><thead><tr><th scope="col">What</th><th scope="col">{labelA}</th><th scope="col">{labelB}</th></tr></thead><tbody>{changes.map((c) => <tr key={c.layer}><td className="ink">{c.layer}</td><td>{c.from}</td><td className="ink">{c.to}</td></tr>)}</tbody></table></div>
      <dl className="m-0 mt-4 grid grid-cols-3 gap-4">
        {([["Per month", inrDelta(cb.recurring - ca.recurring)], ["Setup", inrDelta(cb.oneTime - ca.oneTime)], ["Reply speed", `${(turnLatencyFor(base, b.selection) - turnLatencyFor(base, a.selection)) >= 0 ? "+" : "−"}${Math.abs(turnLatencyFor(base, b.selection) - turnLatencyFor(base, a.selection)).toFixed(1)} s`]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="muted" style={{ fontSize: 12 }}>{k}</dt><dd className="m-0 ink tnum serif" style={{ fontSize: 22 }}>{v}</dd></div>)}
      </dl>
    </div>
  );
}

function Versions({ current, onRestored }: { current: { selection: Selection; usage: Usage }; onRestored: () => void }) {
  const { pkg, apply, readOnly } = usePackage();
  const { fail, toast, confirm } = useVani();
  const [cmp, setCmp] = useState<VersionSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const versions = [...pkg.versions].reverse();
  const restore = async (v: VersionSnapshot) => {
    if (!(await confirm({ title: `Restore ${v.label}?`, body: "Your current configuration becomes a new version first, so nothing is lost.", confirmLabel: "Restore" }))) return;
    setBusy(v.id);
    try { apply(await api.restoreVersion(pkg.id, v.id)); toast(`Restored ${v.label} as a new version.`, "pass"); onRestored(); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  if (versions.length === 0) return <p className="muted">No versions yet. Save one to keep a snapshot you can compare or restore.</p>;
  return (
    <>
      <ul className="m-0 p-0 list-none va-card overflow-hidden">
        {versions.map((v, i) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5" style={{ borderTop: i ? "1px solid var(--line)" : 0 }}>
            <div className="min-w-0"><div className="flex items-center gap-2"><span className="ink mono" style={{ fontWeight: 600 }}>{v.label}</span>{i === 0 && <Badge tone="info">Latest</Badge>}</div><div className="muted truncate" style={{ fontSize: 12.5 }}>{v.note} · {ago(v.createdAt)} by {v.createdBy}</div></div>
            <div className="flex items-center gap-4"><span className="tnum" style={{ fontSize: 13 }}>{inr(v.monthly)}<span className="muted"> /mo</span></span>
              <Button size="sm" onClick={() => setCmp(v)}>Compare</Button>
              <Button size="sm" disabled={readOnly || i === 0 && !hasUnsavedConfig(pkg)} loading={busy === v.id} icon={<RotateCcw size={13} />} onClick={() => void restore(v)}>Restore</Button></div>
          </li>))}
      </ul>
      <Dialog wide open={!!cmp} onClose={() => setCmp(null)} title={cmp ? `${cmp.label} compared with now` : ""} description={cmp?.note} footer={<Button onClick={() => setCmp(null)}>Close</Button>}>
        {cmp && <DiffView a={{ selection: cmp.selection, usage: cmp.usage }} b={current} labelA={cmp.label} labelB="Now" />}
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ the step */

interface Change { title: string; costBefore: number; costAfter: number; latBefore: number; latAfter: number; prevSel: Selection; prevUsage: Usage }

export function ConfigureStep() {
  const { pkg, apply, readOnly, simulation, flush, ratesAsOf, refreshSim } = usePackage();
  const { fail, toast } = useVani();
  const r = pkg.requirements, h = pkg.hosting;
  const base = pkg.recommendation?.baseId ?? "";
  const [local, setLocal] = useState<{ base: unknown; selection: Selection; usage: Usage } | null>(null);
  const view = useMemo(() => (pkg.selection && pkg.usage ? (local && local.base === pkg.selection ? local : { base: pkg.selection, selection: pkg.selection, usage: pkg.usage }) : null), [pkg.selection, pkg.usage, local]);
  const [picker, setPicker] = useState<LayerKey | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [saveErr, setSaveErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [vDialog, setVDialog] = useState<"save" | "diff" | null>(null);
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ selection: Selection; usage: Usage } | null>(null);

  useEffect(() => { refreshSim(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [refreshSim]);
  const cost = useMemo(() => (view ? priceOf(view.selection, view.usage, h, r) : null), [view, h, r]);
  const latency = view ? turnLatencyFor(base, view.selection) : 0;
  const unsaved = view ? hasUnsavedConfig({ ...pkg, selection: view.selection, usage: view.usage }) : false;

  const commit = async (selection: Selection, usage: Usage) => {
    setSaving(true); setSaveErr(null);
    try { const next = await api.saveConfiguration(pkg.id, selection, usage); apply(next); pending.current = null; } catch (e) { setSaveErr(e); fail(e); } finally { setSaving(false); }
  };
  const update = (selection: Selection, usage: Usage, title?: string) => {
    if (!view || readOnly) return;
    if (title && cost) setChange({ title, costBefore: cost.recurring, costAfter: priceOf(selection, usage, h, r).recurring, latBefore: latency, latAfter: turnLatencyFor(base, selection), prevSel: view.selection, prevUsage: view.usage });
    setLocal({ base: pkg.selection, selection, usage }); pending.current = { selection, usage };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (pending.current) void commit(pending.current.selection, pending.current.usage); }, title ? 150 : 800);
  };
  useContinue(async () => {
    if (pending.current) { if (timer.current) clearTimeout(timer.current); await commit(pending.current.selection, pending.current.usage); if (pending.current) return false; }
    return await flush();
  });

  if (!view || !cost) return <><div className="grid gap-4"><WorkspaceHeader /><Stepper /></div><div className="mt-8"><Alert tone="warn" title="Choose a package first">Go back to the recommendation and pick one. Then you can configure it here.</Alert></div><StepFooter stepId="configure" hideNext /></>;
  const setUsage = (p: Partial<Usage>) => update(view.selection, { ...view.usage, ...p });
  const reset = () => update(view.selection, usageFrom(r), "Usage reset to the estimate from your requirements");
  const pick = (layer: LayerKey, id: string) => {
    const name = layer === "hostingProfile" ? PROFILE_BY_ID[id]?.name : compLabel(COMPONENT_BY_ID[id]);
    update({ ...view.selection, [layer]: id }, view.usage, `Changed ${LAYER_LABEL[layer].toLowerCase()} to ${name}`);
  };
  const lat = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)} s`;
  return (
    <>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)]"><WorkspaceHeader /><Stepper /></div>
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0 grid grid-cols-[minmax(0,1fr)] gap-12">
          <div><p className="eyebrow mb-2">Step 4 of 5</p><h2 className="serif" style={{ fontSize: 30, lineHeight: 1.12, color: "var(--ink)" }}>Configure and price it.</h2><p className="mt-2" style={{ maxWidth: 580 }}>Swap any layer, adjust usage, and watch the cost. Every change can be undone or saved as a version.</p></div>
          <div className="grid gap-4 -mt-6">
            <ReadOnlyNotice />
            {simulation.stalePricing && <Alert tone="warn" title="Prices have changed" action={<Button size="sm" onClick={async () => { try { await api.refreshPrices(); refreshSim(); toast("Prices refreshed.", "pass"); } catch (e) { fail(e); } }}>Refresh prices</Button>}>Rates were updated after this was priced. Refresh to see the new totals before you submit. Rates as of {ratesAsOf}.</Alert>}
            {saveErr != null && <Alert tone="bad" title="This change isn't saved" action={<Button size="sm" onClick={() => void commit(view.selection, view.usage)}>Try again</Button>}>{saveErr instanceof api.ApiError ? saveErr.message : "Pricing isn't available right now."} Your change stays on this screen until it saves.</Alert>}
            {change && (
              <Alert tone="info" title={change.title} action={<>
                <Button size="sm" disabled={readOnly} onClick={() => { update(change.prevSel, change.prevUsage); setChange(null); }} icon={<RotateCcw size={13} />}>Undo</Button>
                <Button size="sm" onClick={() => setVDialog("diff")} icon={<History size={13} />}>Compare with last snapshot</Button>
                <Button size="sm" disabled={readOnly} onClick={() => setVDialog("save")} icon={<Save size={13} />}>Save as version</Button>
                <Button size="sm" variant="ghost" onClick={() => setChange(null)}>Dismiss</Button></>}>
                Monthly cost {change.costAfter === change.costBefore ? "unchanged" : <b className="ink">{inrDelta(change.costAfter - change.costBefore)}</b>}. Reply speed {Math.abs(change.latAfter - change.latBefore) < 0.05 ? "unchanged" : <b className="ink">{lat(change.latAfter - change.latBefore)}</b>}.
              </Alert>)}
          </div>

          <section aria-labelledby="c-layers">
            <div className="flex items-end justify-between gap-4 mb-4"><div><h2 id="c-layers" style={{ fontSize: 20 }}>Layers</h2><p className="mt-1">Everything a call passes through.</p></div>{saving && <span className="muted flex items-center gap-2" style={{ fontSize: 12.5 }}><Spinner size={13} />Pricing</span>}</div>
            <div className="va-tablewrap">
              <table className="va-table">
                <caption className="sr-only">Configuration layers</caption>
                <thead><tr><th scope="col">Layer</th><th scope="col">Choice</th><th scope="col">Compatibility</th><th scope="col">Benchmark</th><th scope="col" className="num">Unit rate</th><th scope="col"><span className="sr-only">Change</span></th></tr></thead>
                <tbody>
                  {LAYER_ORDER.map((l) => {
                    const st = layerStatus(l, view.selection, view.usage, r, h, simulation.unavailableProviders);
                    const comp = st.comp; const o = st.option;
                    const prof = l === "hostingProfile" ? PROFILE_BY_ID[view.selection.hostingProfile] : null;
                    return (
                      <tr key={l} className="row">
                        <th scope="row" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13, background: "transparent", fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>{LAYER_LABEL[l]}</th>
                        <td style={{ minWidth: 180 }}><span className="ink" style={{ fontWeight: 500 }}>{comp ? (comp.layer === "adapter" && comp.provider === "None" ? "None" : comp.model) : prof?.name}</span><div className="muted" style={{ fontSize: 12 }}>{comp ? (comp.provider === "None" ? "Not used" : comp.provider) : prof?.note}</div></td>
                        <td>{st.compat === "ok" ? <Pill tone="pass">Compatible</Pill> : st.compat === "blocked" ? <Pill tone="bad">Not compatible</Pill> : <Pill tone="warn">Check</Pill>}{o && [...o.blockers, ...o.warnings][0] && <div className="muted mt-1" style={{ fontSize: 11.5, maxWidth: 190 }}>{[...o.blockers, ...o.warnings][0]}</div>}</td>
                        <td>{o?.benchmark === "tested" ? <Pill tone="pass">Tested</Pill> : o?.benchmark === "partial" ? <Pill tone="warn">Partly tested</Pill> : o?.benchmark === "none" ? <Pill tone="bad">Not supported</Pill> : <span className="muted">{comp?.benchmarkDate ? dateLong(comp.benchmarkDate) : "Not applicable"}</span>}</td>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>{o?.rateText ?? "—"}</td>
                        <td style={{ textAlign: "right" }}><Button size="sm" disabled={readOnly} onClick={() => setPicker(l)}>Change</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {picker && <OptionPicker layer={picker} sel={view.selection} usage={view.usage} open onClose={() => setPicker(null)} onPick={(id) => pick(picker, id)} />}
          </section>

          <section aria-labelledby="c-usage">
            <div className="flex items-end justify-between gap-4 mb-4"><div><h2 id="c-usage" style={{ fontSize: 20 }}>Usage assumptions</h2><p className="mt-1" style={{ maxWidth: 560 }}>These drive the price. Change them to test a scenario.</p></div><Button size="sm" disabled={readOnly} icon={<RotateCcw size={13} />} onClick={reset}>Reset to estimate</Button></div>
            <fieldset disabled={readOnly} className="m-0 p-0 border-0 grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
              <Field label="Calls per month">{(p) => <NumberInput {...p} value={view.usage.callsPerMonth} onChange={(v) => setUsage({ callsPerMonth: v ?? 0 })} unit="calls" />}</Field>
              <Field label="Average call length">{(p) => <NumberInput {...p} value={view.usage.avgMinutes} onChange={(v) => setUsage({ avgMinutes: v ?? 0 })} unit="min" decimals={1} max={60} />}</Field>
              <Field label="Peak concurrent calls">{(p) => <NumberInput {...p} value={view.usage.peakConcurrency} onChange={(v) => setUsage({ peakConcurrency: v ?? 0 })} unit="calls" />}</Field>
              <Field label={<span className="inline-flex items-center gap-1">Model tokens per call <InfoTip text="Words the language model reads and writes during one call, counted in tokens." /></span>}>{(p) => <NumberInput {...p} value={view.usage.llmTokensPerCall} onChange={(v) => setUsage({ llmTokensPerCall: v ?? 0 })} unit="tokens" />}</Field>
              <Field label={<span className="inline-flex items-center gap-1">Voice characters per call <InfoTip text="Letters the voice reads aloud during one call." /></span>}>{(p) => <NumberInput {...p} value={view.usage.ttsCharsPerCall} onChange={(v) => setUsage({ ttsCharsPerCall: v ?? 0 })} unit="chars" />}</Field>
            </fieldset>
          </section>

          <section aria-labelledby="c-cost">
            <h2 id="c-cost" style={{ fontSize: 20 }}>Cost breakdown</h2><p className="mt-1 mb-4">Each line is the rate times your usage.</p>
            <div className="va-tablewrap">
              <table className="va-table">
                <caption className="sr-only">Monthly cost by line</caption>
                <thead><tr><th scope="col">Line</th><th scope="col">Rate</th><th scope="col">Usage</th><th scope="col" className="num">Per month</th><th scope="col" className="num">Share</th></tr></thead>
                <tbody>
                  {cost.lines.map((l, i) => (
                    <tr key={l.id}>
                      <td><span className="inline-flex items-center gap-2 ink" style={{ fontWeight: 500 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: SEG[i] }} aria-hidden />{l.label}</span>{l.note && <div className="muted" style={{ fontSize: 11.5 }}>{l.note}</div>}</td>
                      <td>{l.unitRate}</td><td>{l.usage}</td>
                      <td className="num ink">{l.monthly === null ? <span className="muted">Not included</span> : inr(l.monthly)}</td>
                      <td className="num muted">{l.monthly ? pct((l.monthly / (cost.recurring || 1)) * 100) : "—"}</td>
                    </tr>))}
                  <tr><td colSpan={3} className="ink" style={{ fontWeight: 600 }}>Recurring per month</td><td className="num ink" style={{ fontWeight: 700 }}>{inr(cost.recurring)}</td><td /></tr>
                  <tr><td colSpan={3}>One-time implementation</td><td className="num ink">{inr(cost.oneTime)}</td><td /></tr>
                </tbody>
              </table>
            </div>
            <div className="mt-6"><Composition cost={cost} /></div>
            <Alert tone="neutral" className="mt-5" title="Not included">{cost.excluded.join(". ")}.</Alert>
          </section>

          <section aria-labelledby="c-ver">
            <div className="flex items-end justify-between gap-4 mb-4"><div><h2 id="c-ver" style={{ fontSize: 20 }}>Versions</h2><p className="mt-1">Snapshots of this configuration.</p></div><Button size="sm" disabled={readOnly} icon={<Save size={13} />} onClick={() => setVDialog("save")}>Save as version</Button></div>
            {unsaved && <Alert tone="info" className="mb-4">You have changes since the last saved version.</Alert>}
            <Versions current={{ selection: view.selection, usage: view.usage }} onRestored={() => setChange(null)} />
          </section>
        </div>

        <aside className="va-card va-card--pad va-card--raised xl:sticky max-xl:order-first grid gap-5" style={{ top: 120 }} aria-label="Price summary">
          <div><div className="eyebrow">Per month</div><div className="serif ink tnum" style={{ fontSize: 40, lineHeight: 1.05 }}><CountUp value={cost.recurring} format={(n) => inr(Math.round(n))} /></div><p className="mt-1 muted" style={{ fontSize: 12.5 }}>Setup {inr(cost.oneTime)} once · {inr(cost.perMinute, { decimals: 2 })} a minute{r.costPerMinute ? (cost.perMinuteOver ? `, above your ${inr(r.costPerMinute, { decimals: 2 })} target` : `, within your ${inr(r.costPerMinute, { decimals: 2 })} target`) : ""}</p></div>
          <div><div className="eyebrow mb-2">Budget</div><BudgetMeter cost={cost} budget={r.monthlyBudget} /></div>
          <dl className="m-0 grid grid-cols-2 gap-4"><div><dt className="muted" style={{ fontSize: 12 }}>Reply speed</dt><dd className="m-0 ink tnum" style={{ fontWeight: 600 }}>{latency.toFixed(1)} s</dd></div><div><dt className="muted" style={{ fontSize: 12 }}>At month 12</dt><dd className="m-0 ink tnum" style={{ fontWeight: 600 }}>{cost.recurringAt12 ? inr(cost.recurringAt12) : "—"}</dd></div></dl>
          <p className="muted" style={{ fontSize: 11.5 }}>Rates as of {ratesAsOf}. Sample catalogue, not an offer.</p>
        </aside>
      </div>

      <Dialog open={vDialog === "save"} onClose={() => setVDialog(null)} title="Save as version" description="A snapshot you can compare with or restore later."
        footer={<><Button onClick={() => setVDialog(null)}>Cancel</Button><Button variant="primary" onClick={async () => { try { apply(await api.saveVersion(pkg.id, note)); setVDialog(null); setNote(""); setChange(null); toast("Version saved.", "pass"); } catch (e) { fail(e); } }}>Save version</Button></>}>
        <Field label="Note" optional>{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is different about this version?" data-autofocus />}</Field>
      </Dialog>
      <Dialog wide open={vDialog === "diff"} onClose={() => setVDialog(null)} title="Compared with the last saved version" footer={<Button onClick={() => setVDialog(null)}>Close</Button>}>
        {pkg.versions.length ? <DiffView a={{ selection: pkg.versions[pkg.versions.length - 1].selection, usage: pkg.versions[pkg.versions.length - 1].usage }} b={{ selection: view.selection, usage: view.usage }} labelA={pkg.versions[pkg.versions.length - 1].label} labelB="Now" /> : <p className="muted">No saved version to compare with yet.</p>}
      </Dialog>
      <StepFooter stepId="configure" nextLabel="Continue to quote" />
    </>
  );
}

export { ArrowRight, Check, Tooltip, compact, num };
