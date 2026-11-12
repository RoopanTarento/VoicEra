"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Eye } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { DEPTHS, LAYERS, LAYER_BY_ID, OPTION_BY_ID, PACKAGE_CARDS, PACKAGE_NAME, depthRank, type LayerId } from "@/lib/adopt/builder/catalog";
import { classify, type Selection } from "@/lib/adopt/builder/canvas";
import { CARRIES_OVER, growPath, currentDepth } from "@/lib/adopt/builder/grow";
import { chipFor, costFor, inr, rate, type Cost, type Line } from "@/lib/adopt/builder/pricing";
import { useBuilder, usePrices } from "@/lib/adopt/builder/store";
import { buildQuote } from "@/lib/adopt/builder/quote";
import { NumInput, Tag } from "./parts";
import { QuoteView } from "./QuoteView";

const layerChoice = (s: Selection, l: LayerId) => ({ channel: s.channel, listen: s.listen, think: s.think, speak: s.speak, know: s.know, act: s.act, handoff: s.handoff, watch: "w-dash", host: s.host } as Record<LayerId, string>)[l];

export function CostStage() {
  const { state, actions } = useBuilder();
  const sel = state.sel;
  if (!sel) return null;
  const tab = state.costTab;

  return (
    <div className="vb-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
        <div role="tablist" aria-label="Cost views" className="vb-noprint flex w-fit max-w-full overflow-x-auto rounded-full border border-[var(--vb-line-strong)] p-0.5">
          {([["cost", "Summary"], ["quote", "Itemised quote"], ["grow", "If you grow"]] as const).map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => actions.patch({ costTab: id })} className={`shrink-0 rounded-full px-5 py-2 text-[14px] font-semibold transition-colors ${tab === id ? "bg-[var(--vb-ink)] text-[var(--vb-on-ink)]" : "text-[var(--vb-body)] hover:text-[var(--vb-ink)]"}`}>{label}</button>
          ))}
        </div>
        {tab === "cost" ? <CostView sel={sel} /> : tab === "quote" ? <QuoteView /> : <GrowView sel={sel} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ cost */

function groupOf(l: Line): "setup" | "numbers" | "calls" | "models" | "ops" | "yours" {
  if (l.source === "adopter") return "yours";
  if (l.id === "usage") return "calls";
  if (l.id === "numbers") return "numbers";
  if (l.id.startsWith("model-") || l.id.startsWith("ownfee-")) return "models";
  if (l.id === "managed-ops" || l.id === "licence") return "ops";
  return "setup";
}

const GROUP: Record<ReturnType<typeof groupOf>, { label: string; colour: string }> = {
  setup: { label: "One-time setup", colour: "var(--vb-ink)" },
  numbers: { label: "Phone numbers", colour: "var(--vb-grey)" },
  calls: { label: "Calls", colour: "var(--vb-accent)" },
  models: { label: "Models", colour: "var(--vb-amber)" },
  ops: { label: "Operations", colour: "var(--vb-violet)" },
  yours: { label: "Your own figures", colour: "var(--vb-mint)" },
};


function CostView({ sel }: { sel: Selection }) {
  const { state, actions } = useBuilder();
  const { pb } = usePrices();
  const cost = costFor(sel, pb);
  const cls = classify(sel);
  const w = sel.workload;
  const base = cost.lines.filter((l) => l.source !== "adopter").reduce<Record<string, number>>((acc, l) => { const g = groupOf(l); acc[g] = (acc[g] ?? 0) + l.amount; return acc; }, {});
  if (cost.adopter > 0) base.yours = cost.adopter;
  const slices = Object.entries(base).filter(([, v]) => v > 0).map(([k, v]) => ({ key: k as keyof typeof GROUP, name: GROUP[k as keyof typeof GROUP].label, value: Math.round(v * 100) / 100 }));
  const total = slices.reduce((t, s) => t + s.value, 0);
  const quote = buildQuote(sel, pb);

  return (
    <>
      <header className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <p className="vb-eyebrow">{cls.key === "custom" ? cls.label : PACKAGE_NAME[cls.key]} · {sel.languages.length} language{sel.languages.length === 1 ? "" : "s"}</p>
          <p className="vb-muted mt-4 text-[14px]">{cost.complete ? "Indicative total" : "Known so far. This is not the full cost."}</p>
          <motion.p key={cost.grand} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="vb-serif text-[64px] leading-[1.05] tabular-nums md:text-[84px]" aria-live="polite">{inr(cost.grand)}</motion.p>
          <p className={`mt-2 text-[15px] leading-relaxed ${cost.budget.state === "short" ? "text-[var(--vb-rose)]" : "vb-body"}`}>{cost.budget.note}</p>
          <div className="mt-4 max-w-[560px]"><BudgetMeter cost={cost} budget={w.budget} /></div>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <Stat k="Usage price" v={rate(pb.usageRate, pb.usageUnit)} />
          <Stat k={pb.usageUnit === "call" ? "Per 1,000 calls" : "Per 1,000 minutes"} v={pb.usageRate === null ? "Not set" : inr(Math.round(pb.usageRate * 1000 * 100) / 100)} />
          <Stat k="One-time, once" v={inr(quote.sections.find((x) => x.id === "once")?.subtotal ?? 0)} />
          <Stat k="Monthly run rate" v={quote.monthlyRun === null ? "Add volume" : inr(quote.monthlyRun)} />
        </dl>
      </header>

      <section aria-label="Your numbers" className="vb-card grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-4">
        <NumInput label="Budget" prefix="₹" step={1000} value={w.budget} onChange={(v) => actions.setWorkload({ budget: v })} />
        <NumInput label="Calls a month" value={w.callsPerMonth} onChange={(v) => actions.setWorkload({ callsPerMonth: v })} />
        <NumInput label="Minutes a call" step={0.5} value={w.avgMinutes} onChange={(v) => actions.setWorkload({ avgMinutes: v })} hint={pb.usageUnit === "minute" ? "Needed, because calls are priced by the minute." : "Not needed for the price, which is per call."} />
        <NumInput label="Months to plan for" value={w.months} onChange={(v) => actions.setWorkload({ months: Math.max(1, Math.round(v ?? 1)) })} />
      </section>

      <section aria-labelledby="where-h" className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="vb-card p-6">
          <h2 id="where-h" className="vb-serif text-[24px] leading-tight">Where the money goes</h2>
          {slices.length ? (
            <div className="mt-4 flex flex-col items-center gap-5">
              <div className="relative h-[210px] w-[210px]" role="img" aria-label={`Cost split: ${slices.map((s) => `${s.name} ${inr(s.value)}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={slices} dataKey="value" nameKey="name" innerRadius={68} outerRadius={98} paddingAngle={slices.length > 1 ? 3 : 0} stroke="none" isAnimationActive={false}>
                      {slices.map((s) => <Cell key={s.key} fill={GROUP[s.key].colour} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--vb-surface)", border: "1px solid var(--vb-line-strong)", borderRadius: 10, fontSize: 12, color: "var(--vb-ink)" }} itemStyle={{ color: "var(--vb-ink)" }} formatter={(v) => inr(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"><span className="vb-muted text-[11px]">Known</span><span className="vb-serif text-[22px] tabular-nums">{inr(total)}</span></div>
              </div>
              <ul className="flex w-full flex-col gap-2.5 text-[14px]">
                {slices.map((s) => (
                  <li key={s.key} className="flex items-center gap-3"><span className="size-3 shrink-0 rounded-[4px]" style={{ background: GROUP[s.key].colour }} aria-hidden /><span className="flex-1">{s.name}</span><span className="tabular-nums">{inr(s.value)}</span><span className="vb-muted w-10 text-right text-[12.5px] tabular-nums">{s.value / total < 0.01 ? "<1" : Math.round((s.value / total) * 100)}%</span></li>
                ))}
              </ul>
            </div>
          ) : <p className="vb-muted mt-4 text-[14px] leading-relaxed">Nothing is priced yet. Add your volume, or set prices in the provider view.</p>}
        </div>

        <div className="vb-card p-6">
          <h2 className="vb-serif text-[24px] leading-tight">How it adds up</h2>
          <p className="vb-muted mt-1 text-[13.5px]">In {quote.sections.length} part{quote.sections.length === 1 ? "" : "s"}. Every line is in the itemised quote.</p>
          <div className="mt-4 flex flex-col gap-5">
            {quote.sections.map((sec) => (
              <section key={sec.id} aria-label={sec.title}>
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--vb-line-strong)] pb-2"><h3 className="text-[15px] font-semibold">{sec.title}</h3><p className="text-[16px] font-semibold tabular-nums">{inr(sec.subtotal)}</p></div>
                <ul>
                  {sec.rows.map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-4 border-b border-[var(--vb-line)] py-2.5 text-[14px] last:border-0">
                      <span className="min-w-0"><span className="block leading-snug">{r.item}</span><span className="vb-muted block text-[12px] leading-snug">{r.status === "open" ? "Waiting for a quote" : r.qty !== null && r.rate !== null ? `${r.qty.toLocaleString("en-IN")} ${r.unit} × ${inr(r.rate)}` : r.detail}</span></span>
                      <span className={`shrink-0 tabular-nums ${r.status === "open" ? "text-[var(--vb-amber)]" : ""}`}>{r.amount === null ? "To be quoted" : inr(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <button type="button" onClick={() => actions.patch({ costTab: "quote" })} className="vb-btn vb-btn-ghost vb-btn-sm mt-5">Open the itemised quote <ArrowRight className="size-3.5" aria-hidden /></button>
        </div>
      </section>

      <section aria-labelledby="layers-h" className="vb-card p-6">
        <h2 id="layers-h" className="vb-serif text-[24px] leading-tight">What each choice costs</h2>
        <p className="vb-muted mt-1 text-[13.5px]">Every layer of the call, with what your choice does to the price. Change any of them on the canvas.</p>
        <ul className="mt-4 grid gap-x-8 md:grid-cols-2">
          {LAYERS.map((L) => {
            const o = OPTION_BY_ID[layerChoice(sel, L.id)];
            const chip = o ? chipFor(o, pb) : null;
            return (
              <li key={L.id} className="flex items-center justify-between gap-3 border-b border-[var(--vb-line)] py-3">
                <div className="min-w-0"><p className="text-[14px] font-medium leading-snug">{L.name}</p><p className="vb-muted truncate text-[12.5px]">{o?.name}</p></div>
                {chip ? <Tag tone={chip.tone === "ok" ? "ok" : chip.tone === "warn" ? "warn" : "info"}>{chip.text}</Tag> : null}
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => actions.goto("canvas")} className="vb-btn vb-btn-ghost vb-btn-sm mt-4"><ArrowLeft className="size-3.5" aria-hidden /> Change on the canvas</button>
      </section>

      {cost.unresolved.length ? (
        <section aria-labelledby="unp-h" className="vb-card border-[var(--vb-amber)]/40 p-6">
          <h2 id="unp-h" className="vb-serif text-[24px] leading-tight">Not priced yet</h2>
          <p className="vb-body mt-1 max-w-[64ch] text-[14px] leading-relaxed">The documents give no price for these, and VoicERA does not guess one. They are not in the total above. If you have a quote or an estimate of your own, type it and the total will reflect it, labelled as yours.</p>
          <ul className="mt-5 flex flex-col gap-5">
            {cost.unresolved.map((u) => (
              <li key={u.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-end">
                <div><p className="text-[14.5px] font-medium">{u.label}</p><p className="vb-muted text-[13px] leading-snug">{u.why}</p></div>
                {u.figurable ? <NumInput label="Your figure" prefix="₹" step={1000} value={u.figure} onChange={(v) => actions.setFigure(u.id, v)} /> : <p className="vb-muted text-[12.5px]">{u.id.startsWith("own-") ? "Enter your provider's cost on the canvas." : "Fill in the numbers above."}</p>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="vb-card group">
        <summary className="cursor-pointer list-none px-6 py-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">What this estimate assumes</summary>
        <ul className="vb-body flex list-disc flex-col gap-2 border-t vb-hair px-10 py-5 text-[14px] leading-relaxed">
          {cost.notes.map((n) => <li key={n}>{n}</li>)}
          <li>The months and volumes are your planning figures, not terms of the package.</li>
          <li>We assume the standard usage price still applies when you add a commercial model, and the model adds to it. The package document says commercial pricing depends on the model.</li>
          <li>Whether the phone number charge repeats is not stated, so it is counted once.</li>
        </ul>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
        <label className="flex cursor-pointer items-start gap-3 text-[14.5px] leading-snug">
          <input type="checkbox" className="mt-0.5 size-[18px] accent-[var(--vb-accent-strong)]" checked={state.signed} onChange={(e) => actions.patch({ signed: e.target.checked })} />
          <span>I have reviewed this cost. I know anything not priced is not in it.</span>
        </label>
        <button type="button" className="vb-btn vb-btn-primary" onClick={() => actions.goto("deploy")}>See how it goes live <ArrowRight className="size-4" aria-hidden /></button>
      </div>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="vb-card-2 p-4"><dt className="vb-eyebrow">{k}</dt><dd className="mt-1.5 text-[17px] font-semibold leading-tight tabular-nums">{v}</dd></div>
  );
}

function BudgetMeter({ cost, budget }: { cost: Cost; budget: number | null }) {
  const scale = Math.max(budget ?? 0, cost.grand, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const over = budget !== null && cost.grand > budget;
  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--vb-surface-3)]" role="img" aria-label={budget === null ? "No budget entered" : `${inr(cost.grand)} of a ${inr(budget)} budget`}>
        <motion.div className={`h-full rounded-full ${over ? "bg-[var(--vb-rose)]" : "bg-gradient-to-r from-[var(--vb-accent-strong)] to-[var(--vb-accent)]"}`} initial={false} animate={{ width: pct(cost.grand) }} transition={{ duration: 0.4 }} />
        {budget !== null ? <span className="absolute inset-y-0 w-0.5 bg-[var(--vb-ink)]" style={{ left: pct(budget) }} aria-hidden /> : null}
      </div>
      <div className="vb-muted mt-1.5 flex justify-between text-[12px]"><span>{inr(cost.grand)} known</span><span>{budget === null ? "No budget set" : `Budget ${inr(budget)}`}</span></div>
    </div>
  );
}

/* ------------------------------------------------------------------ growth */

function GrowView({ sel }: { sel: Selection }) {
  const { actions } = useBuilder();
  const { pb } = usePrices();
  const cls = classify(sel);
  const at = currentDepth(sel);
  const steps = growPath(sel, pb);

  return (
    <>
      <header className="max-w-[720px]">
        <p className="vb-eyebrow">If you grow</p>
        <h1 className="vb-serif mt-3 text-[40px] leading-[1.08] md:text-[52px]">Start where you are. Move up when you are ready.</h1>
        <p className="vb-body mt-4 text-[16px] leading-relaxed">The three packages are one platform at different depths, so growing is adding a connection, not starting again. Here is what each step up would add, what it would ask of you, and what it does to the price.</p>
      </header>

      <ol className="grid gap-3 md:grid-cols-3" aria-label="The ladder">
        {DEPTHS.map((d, i) => {
          const here = d === at;
          const past = depthRank(d) < depthRank(at);
          return (
            <li key={d} className={`vb-card relative p-5 ${here ? "!border-[var(--vb-accent)]" : ""}`}>
              <div className="flex items-center justify-between"><span className="vb-mono text-[12px] vb-muted">0{i + 1}</span>{here ? <Tag tone="info">{cls.key === "custom" ? "You are here, with extras" : "You are here"}</Tag> : past ? <Tag tone="ok">Included</Tag> : <Tag>Next</Tag>}</div>
              <p className="vb-serif mt-3 text-[28px] leading-none">{PACKAGE_NAME[d]}</p>
              <p className="vb-body mt-2 text-[13.5px] leading-snug">{PACKAGE_CARDS[d].integration}</p>
              <p className="vb-muted mt-1 text-[13px]">Typically {PACKAGE_CARDS[d].launch.toLowerCase()}</p>
            </li>
          );
        })}
      </ol>

      {cls.key === "custom" ? (
        <p className="vb-card-2 p-4 text-[14px] leading-relaxed">Your canvas is <span className="font-semibold">{cls.label}</span>. It already takes {cls.extras.length} capabilit{cls.extras.length === 1 ? "y" : "ies"} from a higher package, so moving up to the full package adds the rest rather than all of it.</p>
      ) : null}

      {steps.length === 0 ? (
        <div className="vb-card p-6">
          <h2 className="vb-serif text-[26px]">You are already at the top.</h2>
          <p className="vb-body mt-2 max-w-[60ch] text-[15px] leading-relaxed">From here, growth is more use cases, more languages and more departments on the same platform, which is how the ICP describes scaling.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-5">
          {steps.map((s) => {
            const quoted = s.then.unresolved.some((u) => u.id === "setup");
            return (
              <li key={s.to} className="vb-card p-6 md:p-8">
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <p className="vb-eyebrow">Move up to</p>
                    <h2 className="vb-serif mt-2 text-[38px] leading-none">{PACKAGE_NAME[s.to]}</h2>
                    <p className="vb-body mt-3 text-[15px] leading-relaxed">{PACKAGE_CARDS[s.to].tagline}</p>
                    <p className="vb-eyebrow mt-6">What you gain</p>
                    <ul className="mt-2 flex flex-col gap-1.5">{s.capsAdded.map((c) => <li key={c} className="flex gap-2.5 text-[14.5px]"><Check className="mt-0.5 size-4 shrink-0 text-[var(--vb-accent)]" aria-hidden />{c}</li>)}</ul>
                    <ul className="vb-body mt-3 flex flex-col gap-1 text-[13.5px] leading-relaxed">{s.gains.slice(0, 3).map((g) => <li key={g}>{g}</li>)}</ul>
                  </div>
                  <div className="flex flex-col gap-5">
                    <div>
                      <p className="vb-eyebrow">What it asks of you</p>
                      <ul className="vb-body mt-2 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-relaxed">{s.bring.slice(0, 4).map((b) => <li key={b}>{b}</li>)}</ul>
                      <p className="vb-muted mt-2 text-[13px]">Typical launch: {s.launch.toLowerCase()}. A range, not a commitment.</p>
                    </div>
                    <div className="vb-card-2 p-4">
                      <p className="vb-eyebrow">What it does to the price</p>
                      <p className="mt-2 text-[14px] leading-relaxed">Known today <span className="font-semibold tabular-nums">{inr(s.now.knownTotal)}</span>. At {PACKAGE_NAME[s.to]}, <span className="font-semibold tabular-nums">{inr(s.then.knownTotal)}</span> is known{quoted ? ", and the implementation and integration are quoted by VoicERA, so they are not priced here." : "."}</p>
                      {s.newUnpriced.length ? <p className="vb-muted mt-2 text-[12.5px] leading-relaxed">Becomes unpriced: {s.newUnpriced.join("; ")}.</p> : null}
                    </div>
                    <button type="button" className="vb-btn vb-btn-ghost w-fit" onClick={() => { actions.moveTo(s.to); actions.goto("canvas"); }}><Eye className="size-4" aria-hidden /> Preview {PACKAGE_NAME[s.to]} on the canvas</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="vb-card p-6" aria-labelledby="carry-h">
        <h2 id="carry-h" className="vb-serif text-[24px] leading-tight">What carries over when you grow</h2>
        <ul className="mt-4 grid gap-x-8 gap-y-2.5 md:grid-cols-2">{CARRIES_OVER.map((c) => <li key={c} className="flex gap-2.5 text-[14.5px]"><Check className="mt-0.5 size-4 shrink-0 text-[var(--vb-accent)]" aria-hidden />{c}</li>)}</ul>
      </section>

      <div className="flex flex-wrap items-center gap-3 pb-6">
        <button type="button" className="vb-btn vb-btn-ghost" onClick={() => actions.patch({ costTab: "cost" })}><ArrowLeft className="size-4" aria-hidden /> Back to the cost</button>
        <button type="button" className="vb-btn vb-btn-primary" onClick={() => actions.goto("deploy")}>See how it goes live <ArrowRight className="size-4" aria-hidden /></button>
      </div>
    </>
  );
}

export { LAYER_BY_ID };
