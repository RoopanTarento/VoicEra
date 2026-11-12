"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Check, Globe2, LifeBuoy, Phone, Gauge } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DOCUMENTED_LANGUAGES } from "@/lib/adopt/advisor/source";
import { OUTCOME_LABEL } from "@/lib/adopt/advisor/evaluate";
import {
  LENGTH, NOT_COVERED, OFFER_TILES, PRICES, PRICE_CAVEATS, QUESTION_COUNT, QUESTION_TEMPLATES, SCALE, STILL_OPEN,
  firstOpenQuestion, planFor,
} from "@/lib/adopt/advisor/pitch";
import { useCanvas, type Step } from "@/lib/adopt/advisor/canvas-store";
import { FlowDiagram } from "./FlowDiagram";
import { Fold, NumField } from "./parts";

const TILE_ICON: Record<string, typeof Globe2> = { languages: Globe2, channels: Phone, scale: Gauge, content: BookOpen, watch: BarChart3, people: LifeBuoy };

const ORDER: { id: Extract<Step, "pitch" | "about" | "plan">; label: string }[] = [
  { id: "pitch", label: "What we offer" },
  { id: "about", label: "About you" },
  { id: "plan", label: "Your plan" },
];

export function PitchFlow({ step }: { step: Step }) {
  const { actions } = useCanvas();
  const at = step === "about" ? "about" : step === "plan" ? "plan" : "pitch";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Progress" className="shrink-0 border-b border-v-line bg-v-panel">
        <ol className="mx-auto flex max-w-[760px] items-center gap-2 px-5 py-2.5">
          {ORDER.map((s, i) => {
            const idx = ORDER.findIndex((x) => x.id === at);
            const done = i < idx;
            return (
              <li key={s.id} className="flex items-center gap-2">
                <button type="button" aria-current={at === s.id ? "step" : undefined} disabled={i > idx} onClick={() => actions.set({ step: s.id })} className={`flex items-center gap-2 rounded-v-lg px-2 py-1.5 text-[13.5px] font-semibold disabled:cursor-default ${at === s.id ? "text-v-fg" : "text-v-muted enabled:hover:text-v-fg"}`}>
                  <span className={`flex size-5 items-center justify-center rounded-full font-mono text-[10px] ${at === s.id ? "bg-v-accent text-white" : done ? "bg-v-ok text-white" : "bg-v-line text-v-body"}`} aria-hidden>{done ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < ORDER.length - 1 ? <span className="h-px w-6 bg-v-line-strong" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {at === "pitch" ? <Pitch /> : null}
        {at === "about" ? <About /> : null}
        {at === "plan" ? <Plan /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 1. the pitch */

function Pitch() {
  const { actions } = useCanvas();
  const [i, setI] = useState(0);
  const last = 3;
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col gap-8 px-5 py-10 md:py-14">
      <div className="flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {i === 0 ? <PanelWhat /> : null}
            {i === 1 ? <PanelOffer /> : null}
            {i === 2 ? <PanelHow /> : null}
            {i === 3 ? <PanelCost /> : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" role="group" aria-label="Pitch pages">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} type="button" aria-label={`Page ${n + 1} of 4`} aria-current={n === i ? "step" : undefined} onClick={() => setI(n)} className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-v-accent" : "w-2 bg-v-line-strong hover:bg-v-muted"}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {i > 0 ? <Button variant="ghost" onClick={() => setI(i - 1)}><ArrowLeft className="size-3.5" aria-hidden /> Back</Button> : <Button variant="ghost" onClick={() => actions.set({ step: "about" })}>Skip the intro</Button>}
          {i < last ? <Button onClick={() => setI(i + 1)}>Next <ArrowRight className="size-3.5" aria-hidden /></Button> : <Button onClick={() => actions.set({ step: "about" })}>Tell us what you need <ArrowRight className="size-3.5" aria-hidden /></Button>}
        </div>
      </div>
    </div>
  );
}

const H1 = "text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[46px]";
const LEAD = "mt-4 max-w-[54ch] text-[17px] font-light leading-relaxed text-v-body";

function PanelWhat() {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">VoicERA for government</p>
      <h1 className={`mt-3 ${H1}`}>Anyone can now talk to intelligence.</h1>
      <p className={LEAD}>VoicERA lets citizens talk to a government service by voice, in their own language, on a phone or in a browser. It answers from content your department approves.</p>
      <ul className="mt-8 flex flex-wrap gap-2" aria-label="Languages">
        {DOCUMENTED_LANGUAGES.map((l) => <li key={l} className="rounded-v-lg border border-v-line bg-white px-3 py-1.5 text-[13.5px] font-medium">{l}</li>)}
      </ul>
    </div>
  );
}

function PanelOffer() {
  return (
    <div>
      <h2 className={H1}>What you get.</h2>
      <p className={LEAD}>One package, set up for you. These are the facts from the package document.</p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {OFFER_TILES.map((t) => {
          const Icon = TILE_ICON[t.id] ?? Globe2;
          return (
            <li key={t.id} className="rounded-v-xl border border-v-line bg-white p-4">
              <span className="flex size-8 items-center justify-center rounded-v-md bg-v-surface-sunk"><Icon className="size-4" aria-hidden /></span>
              <p className="mt-3 text-[16px] font-semibold leading-snug tracking-tight">{t.title}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-v-body">{t.line}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PanelHow() {
  return (
    <div>
      <h2 className={H1}>How it works.</h2>
      <p className={LEAD}>You bring the content. VoicERA runs the call. You see what happened.</p>
      <div className="mt-8"><FlowDiagram /></div>
    </div>
  );
}

function PanelCost() {
  return (
    <div>
      <h2 className={H1}>What it costs.</h2>
      <p className={LEAD}>Three prices, taken straight from the package document.</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {PRICES.map((p) => (
          <li key={p.id} className="rounded-v-xl border border-v-line bg-white p-4">
            <p className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{p.amount}</p>
            <p className="mt-1 text-[13px] font-medium text-v-body">{p.unit}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-v-muted">{p.line}</p>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-v-muted">{PRICE_CAVEATS.map((x) => <li key={x}>{x}</li>)}</ul>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section aria-label="Not covered" className="rounded-v-xl border border-v-line bg-white p-4">
          <h3 className="text-[15px] font-semibold">What it does not cover</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-v-body">{NOT_COVERED.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
        <section aria-label="Still open" className="rounded-v-xl border border-v-line bg-white p-4">
          <h3 className="text-[15px] font-semibold">Still to be confirmed</h3>
          <p className="mt-1 text-[13px] text-v-muted">The VoicEra team has not yet answered these in the document.</p>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-v-body">{STILL_OPEN.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 2. about you */

function About() {
  const { state, actions } = useCanvas();
  const p = state.profile;
  const open = firstOpenQuestion(p);
  const [q, setQ] = useState(() => Math.min(open, QUESTION_COUNT - 1));
  const [budget, setBudget] = useState<number | null>(p.budget);

  const next = () => (q + 1 >= QUESTION_COUNT ? actions.set({ step: "plan" }) : setQ(q + 1));
  const back = () => (q === 0 ? actions.set({ step: "pitch" }) : setQ(q - 1));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col gap-8 px-5 py-10 md:py-14">
      <div>
        <p className="text-[13px] text-v-muted" aria-live="polite">Question {q + 1} of {QUESTION_COUNT}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-v-line" role="progressbar" aria-valuemin={0} aria-valuemax={QUESTION_COUNT} aria-valuenow={q + 1} aria-label="Questions">
          <div className="h-full rounded-full bg-v-accent transition-[width]" style={{ width: `${((q + 1) / QUESTION_COUNT) * 100}%` }} />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={q} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="flex flex-col gap-5">
          {q === 0 ? (
            <>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">What do you want to build?</h1>
              <Choices value={p.template} options={QUESTION_TEMPLATES} onPick={(id) => { actions.profile({ template: id }); next(); }} />
            </>
          ) : null}
          {q === 1 ? (
            <>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">How many calls would it handle?</h1>
              <Choices value={p.scale} options={SCALE.map((s) => ({ id: s.id, label: s.label, hint: s.hint }))} onPick={(id) => { actions.profile({ scale: id }); next(); }} />
            </>
          ) : null}
          {q === 2 ? (
            <>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">How long is a typical call?</h1>
              <Choices value={p.length} options={LENGTH.map((l) => ({ id: l.id, label: l.label, hint: l.hint }))} onPick={(id) => { actions.profile({ length: id }); next(); }} />
            </>
          ) : null}
          {q === 3 ? (
            <>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">How much can you spend?</h1>
              <NumField id="about-budget" label="Total budget" prefix="₹" value={budget} onChange={setBudget} step={1000} hint="Setup, phone numbers and calls together. You can change it later." />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { actions.profile({ budget: budget && budget > 0 ? budget : null, budgetAsked: true }); next(); }} disabled={!budget || budget <= 0}>Continue <ArrowRight className="size-3.5" aria-hidden /></Button>
                <Button variant="ghost" onClick={() => { actions.profile({ budget: null, budgetAsked: true }); setBudget(null); next(); }}>I do not know yet</Button>
              </div>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      <div className="mt-auto flex items-center justify-between gap-4 pt-4">
        <Button variant="ghost" onClick={back}><ArrowLeft className="size-3.5" aria-hidden /> Back</Button>
        {q < 3 && (q === 0 ? p.template !== null : q === 1 ? p.scale !== null : p.length !== null) ? <Button variant="ghost" onClick={next}>Keep my answer <ArrowRight className="size-3.5" aria-hidden /></Button> : null}
      </div>
      <p className="text-[12.5px] text-v-muted">These are planning figures. You can change every one of them later.</p>
    </div>
  );
}

function Choices<T extends string>({ value, options, onPick }: { value: T | null; options: { id: T; label: string; hint?: string }[]; onPick: (id: T) => void }) {
  return (
    <ul className="flex flex-col gap-2.5" role="radiogroup">
      {options.map((o) => (
        <li key={o.id}>
          <button type="button" role="radio" aria-checked={value === o.id} onClick={() => onPick(o.id)} className={`flex w-full items-start gap-3 rounded-v-xl border px-4 py-3.5 text-left transition-colors ${value === o.id ? "border-v-accent bg-v-pale" : "border-v-line bg-white hover:border-v-line-strong"}`}>
            <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${value === o.id ? "border-v-accent bg-v-accent text-white" : "border-v-line-strong"}`} aria-hidden>{value === o.id ? <Check className="size-3" strokeWidth={3} /> : null}</span>
            <span className="min-w-0"><span className="block text-[16px] font-medium leading-snug">{o.label}</span>{o.hint ? <span className="mt-0.5 block text-[13.5px] leading-snug text-v-muted">{o.hint}</span> : null}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ 3. your plan */

function Plan() {
  const { state, actions } = useCanvas();
  const p = state.profile;
  const plan = planFor(p);
  const out = plan.verdict?.ev.outcome;
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-9 px-5 py-10 md:py-14">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">Your plan</p>
        <h1 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[42px]">{plan.title}</h1>
        {out ? <p className="mt-3 text-[15px] text-v-body">Fit with the package: <span className="font-semibold text-v-fg">{OUTCOME_LABEL[out]}</span></p> : null}
        <div className="mt-5 max-w-[360px]">
          <label htmlFor="plan-dept" className="mb-1 block text-[13px] font-semibold">Department name <span className="font-normal text-v-muted">(optional)</span></label>
          <Input id="plan-dept" value={p.department} maxLength={80} placeholder="For example, Water Supply Board" onChange={(e) => actions.profile({ department: e.target.value })} />
        </div>
      </header>

      <section aria-labelledby="plan-does">
        <h2 id="plan-does" className="text-[20px] font-semibold tracking-tight">What citizens will experience</h2>
        <ol className="mt-3 flex flex-col gap-2.5">
          {plan.does.map((d, n) => (
            <li key={d} className="flex gap-3 rounded-v-xl border border-v-line bg-white px-4 py-3 text-[15px] leading-relaxed">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-v-fg font-mono text-[11px] text-white" aria-hidden>{n + 1}</span>{d}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="plan-flow">
        <h2 id="plan-flow" className="text-[20px] font-semibold tracking-tight">How it runs, and what you pay for</h2>
        <div className="mt-3"><FlowDiagram c={plan.canvas} cost={plan.cost} /></div>
      </section>

      <section aria-label="Headline numbers" className="grid gap-3 sm:grid-cols-3">
        {plan.headline.map((h) => (
          <div key={h.label} className="rounded-v-xl border border-v-line bg-white p-4">
            <p className="text-[12.5px] text-v-muted">{h.label}</p>
            <p className={`mt-0.5 text-[24px] font-semibold leading-tight tabular-nums ${h.value === "Over" ? "text-v-danger" : ""}`}>{h.value}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-v-muted">{h.sub}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-col gap-3">
        <Fold title="Good to know" summary={`${plan.beware.length} points`} defaultOpen>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[14px] leading-relaxed text-v-body">{plan.beware.map((b) => <li key={b}>{b}</li>)}</ul>
        </Fold>
        <Fold title="What you bring" summary="The department supplies these">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-v-body">{plan.brings.map((b) => <li key={b}>{b}</li>)}</ul>
        </Fold>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => actions.build()}>Build it on the canvas <ArrowRight className="size-3.5" aria-hidden /></Button>
        <Button variant="ghost" onClick={() => actions.set({ step: "about" })}>Change my answers</Button>
      </div>
      <p className="-mt-4 text-[12.5px] text-v-muted">Indicative only. Not a quote, an order or an offer. Everything stays in this browser.</p>
    </div>
  );
}
