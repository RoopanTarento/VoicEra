"use client";

import { useState } from "react";
import { Minus, Plus, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { StateIcon, NumField, rupees } from "./parts";
import {
  LANGUAGE_CHOICES, MODULES, RATES, TEMPLATES, TEMPLATE_BY_ID, moduleState,
  type Canvas, type CanvasVerdict, type LaneId, type Module, type ModelKind,
} from "@/lib/adopt/advisor/canvas";
import { useCanvas } from "@/lib/adopt/advisor/canvas-store";
import { OUTCOME_LABEL } from "@/lib/adopt/advisor/evaluate";
import { isDocumentedLanguage } from "@/lib/adopt/advisor/source";
import type { Outcome } from "@/lib/adopt/advisor/types";

const SECTIONS: { id: string; title: string; lanes: LaneId[]; hint?: string }[] = [
  { id: "reach", title: "How people reach it", lanes: ["reach"] },
  { id: "voice", title: "Voice and languages", lanes: [] },
  { id: "talk", title: "What it says", lanes: ["talk", "know"] },
  { id: "safe", title: "When something goes wrong", lanes: ["safe"] },
  { id: "more", title: "Systems and scale", lanes: ["connect", "run"], hint: "Most of these are outside the package. Add only what you need." },
];

const OUTCOME_TONE: Record<Outcome, string> = {
  suitable: "border-v-ok/40 bg-v-ok-tint text-v-ok-ink",
  "suitable-with-conditions": "border-v-blue-soft bg-v-pale text-v-accent-deep",
  "needs-review": "border-v-warning/40 bg-v-warn-tint text-v-warn-ink",
  "outside-scope": "border-v-danger/40 bg-v-danger-pale text-v-danger-deep",
};

export function BuildStep({ verdict }: { verdict: CanvasVerdict | null }) {
  const { state, actions } = useCanvas();
  const c = state.canvas;
  const t = TEMPLATE_BY_ID[c.template];
  const [changing, setChanging] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-9 px-5 py-8 md:py-10">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[32px]">{t.title}</h1>
          <p className="mt-1 text-[14.5px] leading-relaxed text-v-body">{t.plain}</p>
          <button type="button" onClick={() => setChanging((v) => !v)} aria-expanded={changing} className="mt-1.5 text-[13px] font-semibold text-v-accent hover:underline">{changing ? "Keep this one" : "Change use case"}</button>
          {changing ? (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Use case">
              {TEMPLATES.map((x) => (
                <button key={x.id} type="button" aria-pressed={c.template === x.id} onClick={() => { actions.template(x.id); setChanging(false); }} className={`rounded-v-lg border px-3.5 py-2 text-[13px] font-medium ${c.template === x.id ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>{x.title}</button>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <label htmlFor="cv-dept" className="mb-1 block text-[13px] font-semibold">Department name</label>
          <Input id="cv-dept" value={c.department} maxLength={80} placeholder="For example, Water Supply Board" onChange={(e) => actions.patch({ department: e.target.value })} />
        </div>
        <FitBanner c={c} verdict={verdict} />
      </header>

      {SECTIONS.map((s) => (
        <Section key={s.id} id={s.id} title={s.title} hint={s.hint} lanes={s.lanes} c={c} verdict={verdict} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ fit */

function FitBanner({ c, verdict }: { c: Canvas; verdict: CanvasVerdict | null }) {
  const { actions } = useCanvas();
  const [open, setOpen] = useState(false);
  if (!verdict) return null;
  const ev = verdict.ev;
  const issues = ev.findings.filter((x) => x.severity === "blocker" || x.severity === "review").slice(0, 3);
  const outside = MODULES.filter((m) => c.modules.includes(m.id) && m.status === "outside");
  return (
    <div role="status" className={`rounded-v-xl border px-5 py-4 ${OUTCOME_TONE[ev.outcome]}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.14em] opacity-80">Fit with the package</p>
          <p className="text-[17px] font-semibold leading-snug">{OUTCOME_LABEL[ev.outcome]}</p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold underline-offset-2 hover:underline">
          Why <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
      {outside.length ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {outside.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-v-lg bg-white/70 px-3 py-2 text-[13px] text-v-fg">
              <span>{m.label} is not in the package.</span>
              <button type="button" onClick={() => actions.toggle(m.id)} className="shrink-0 font-semibold text-v-danger hover:underline">Remove it</button>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <ul className="mt-3 flex flex-col gap-2 text-[13px] leading-snug text-v-fg">
          {issues.length === 0 ? <li>Nothing is blocking. Some details are still open.</li> : issues.map((x) => <li key={x.id}><span className="font-semibold">{x.title}.</span> {x.detail.length > 170 ? `${x.detail.slice(0, 167)}...` : x.detail}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ sections */

function Section({ id, title, hint, lanes, c, verdict }: { id: string; title: string; hint?: string; lanes: LaneId[]; c: Canvas; verdict: CanvasVerdict | null }) {
  const { actions } = useCanvas();
  const chosen = MODULES.filter((m) => lanes.includes(m.lane) && c.modules.includes(m.id));
  const custom = c.custom.filter((x) => lanes.includes(x.lane));

  return (
    <section aria-labelledby={`sec-${id}`} className="flex flex-col gap-3">
      <div>
        <h2 id={`sec-${id}`} className="text-[18px] font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="text-[13px] text-v-muted">{hint}</p> : null}
      </div>

      {id === "voice" ? <VoiceCard c={c} /> : (
        <>
          {chosen.length + custom.length === 0 ? <p className="rounded-v-xl border border-dashed border-v-line-strong px-4 py-3.5 text-[14px] text-v-muted">Nothing added.</p> : (
            <ul className="flex flex-col gap-2">
              {chosen.map((m) => <Row key={m.id} m={m} c={c} verdict={verdict} onRemove={() => actions.toggle(m.id)} />)}
              {custom.map((x) => (
                <li key={x.id} className="flex items-center gap-3 rounded-v-xl border border-dashed border-v-warning/70 bg-v-warn-tint px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium leading-snug">{x.label}</p>
                    <p className="text-[12.5px] text-v-warn-ink">Your own addition. Not assessed or priced.</p>
                  </div>
                  <button type="button" onClick={() => actions.removeCust(x.id)} aria-label={`Remove ${x.label}`} className="rounded-v-sm p-1 text-v-muted hover:text-v-danger"><X className="size-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
          <Adder lanes={lanes} c={c} />
        </>
      )}
    </section>
  );
}

function flagFor(m: Module, state: string): string | null {
  if (state === "blocked") return m.cost === "Not recommended" ? "Not recommended" : "Not in the package";
  if (state === "warn") return m.status === "quote" ? "Needs a quote" : "Confirm first";
  return null;
}

function Row({ m, c, verdict, onRemove }: { m: Module; c: Canvas; verdict: CanvasVerdict | null; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const st = moduleState(m, verdict);
  const flag = flagFor(m, st.state);
  const tone = st.state === "blocked" ? "border-v-danger/50 bg-v-danger-pale" : st.state === "warn" ? "border-v-warning/50 bg-v-warn-tint" : "border-v-line bg-white";
  return (
    <li className={`rounded-v-xl border ${tone}`}>
      <div className="flex items-center gap-2 pr-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left">
          <StateIcon state={st.state} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium leading-snug">{m.label}{m.id === "ch-in" && c.numbers > 1 ? <span className="text-v-muted"> × {c.numbers}</span> : null}</span>
            {flag ? <span className={`block text-[12.5px] ${st.state === "blocked" ? "text-v-danger" : "text-v-warn-ink"}`}>{flag}</span> : null}
          </span>
          <ChevronDown className={`size-4 shrink-0 text-v-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <button type="button" onClick={onRemove} aria-label={`Remove ${m.label}`} className="rounded-v-sm p-1.5 text-v-muted hover:text-v-danger"><X className="size-4" aria-hidden /></button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-v-line/70 px-4 py-3.5 pl-11 text-[13.5px] leading-relaxed text-v-body">
          <p>{m.plain}</p>
          <p className="text-v-muted">{m.cost}</p>
          {st.why ? <p>{st.why}</p> : null}
          {m.needs ? <p className="text-v-muted">You bring: {m.needs}.</p> : null}
          {m.id === "ch-in" ? <Numbers c={c} /> : null}
          {m.id === "kn-files" ? <Knowledge c={c} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function Numbers({ c }: { c: Canvas }) {
  const { actions } = useCanvas();
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <span className="text-[13px] font-semibold text-v-fg">Phone numbers</span>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="One fewer number" disabled={c.numbers <= 1} onClick={() => actions.patch({ numbers: Math.max(1, c.numbers - 1) })} className="flex size-8 items-center justify-center rounded-v-md border border-v-line-strong bg-white disabled:opacity-40"><Minus className="size-3.5" aria-hidden /></button>
        <span className="w-8 text-center text-[15px] font-semibold tabular-nums text-v-fg" aria-live="polite">{c.numbers}</span>
        <button type="button" aria-label="One more number" disabled={c.numbers >= 100} onClick={() => actions.patch({ numbers: Math.min(100, c.numbers + 1) })} className="flex size-8 items-center justify-center rounded-v-md border border-v-line-strong bg-white disabled:opacity-40"><Plus className="size-3.5" aria-hidden /></button>
      </div>
      <span className="text-[12.5px] text-v-muted">{rupees(c.numbers * RATES.perNumber)}</span>
    </div>
  );
}

function Knowledge({ c }: { c: Canvas }) {
  const { actions } = useCanvas();
  const over = c.kb.count > 10 || c.kb.maxMB > 5 || !c.kb.textFiles;
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumField id="kb-count" label="How many files" value={c.kb.count} min={0} max={200} onChange={(v) => actions.patch({ kb: { ...c.kb, count: v ?? 0 } })} />
        <NumField id="kb-mb" label="Largest file, MB" value={c.kb.maxMB} min={0} max={500} step={0.5} onChange={(v) => actions.patch({ kb: { ...c.kb, maxMB: v ?? 0 } })} />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-v-fg">
        <input type="checkbox" className="accent-[var(--v-accent)]" checked={c.kb.textFiles} onChange={(e) => actions.patch({ kb: { ...c.kb, textFiles: e.target.checked } })} />
        All plain text
      </label>
      <p className={`text-[12.5px] ${over ? "text-v-danger" : "text-v-muted"}`}>{over ? "Above the limit of 10 text files, 5 MB each." : "Within the limit: 10 text files, 5 MB each."}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ add */

function Adder({ lanes, c }: { lanes: LaneId[]; c: Canvas }) {
  const { actions } = useCanvas();
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState(false);
  const [label, setLabel] = useState("");
  const options = MODULES.filter((m) => lanes.includes(m.lane) && !c.modules.includes(m.id)).sort((a, b) => Number(b.for?.includes(c.template) ?? false) - Number(a.for?.includes(c.template) ?? false));

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex w-fit items-center gap-1.5 rounded-v-lg border border-v-line-strong bg-white px-3.5 py-2 text-[13px] font-semibold hover:border-v-accent hover:text-v-accent">
        <Plus className="size-3.5" aria-hidden /> Add
      </button>
    );
  return (
    <div className="rounded-v-xl border border-v-line bg-v-surface-sunk p-2">
      <ul className="flex flex-col">
        {options.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => actions.add(m.id)} className="flex w-full items-center gap-3 rounded-v-lg px-3 py-2.5 text-left hover:bg-white">
              <Plus className="size-4 shrink-0 text-v-accent" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium leading-snug">{m.label}</span>
                <span className="block text-[12.5px] leading-snug text-v-muted">{m.status === "outside" ? "Not in the package" : m.plain}</span>
              </span>
            </button>
          </li>
        ))}
        {options.length === 0 ? <li className="px-3 py-2.5 text-[13px] text-v-muted">Everything here is already added.</li> : null}
      </ul>
      {own ? (
        <form
          className="flex gap-2 border-t border-v-line p-2"
          onSubmit={(e) => { e.preventDefault(); if (!label.trim()) return; actions.addCust(lanes[0], label, ""); setLabel(""); setOwn(false); }}
        >
          <label htmlFor={`own-${lanes[0]}`} className="sr-only">What is it?</label>
          <Input id={`own-${lanes[0]}`} value={label} maxLength={60} placeholder="What is it?" onChange={(e) => setLabel(e.target.value)} />
          <Button size="sm" type="submit" disabled={!label.trim()}>Add</Button>
        </form>
      ) : (
        <button type="button" onClick={() => setOwn(true)} className="w-full border-t border-v-line px-3 py-2.5 text-left text-[13px] font-semibold text-v-accent hover:underline">Add something of your own</button>
      )}
      <div className="p-1"><Button size="sm" variant="ghost" onClick={() => { setOpen(false); setOwn(false); }}>Done</Button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ voice */

const MODEL_OPTS: { id: ModelKind; label: string; hint: string }[] = [
  { id: "open", label: "Open-source", hint: `${rupees(RATES.perMinuteOpen)} a minute, everything included` },
  { id: "proprietary", label: "Proprietary", hint: "Price not supplied" },
  { id: "undecided", label: "Decide later", hint: "The cost of calls stays open" },
];

function VoiceCard({ c }: { c: Canvas }) {
  const { actions } = useCanvas();
  const [open, setOpen] = useState(false);
  const kind: ModelKind | "mixed" = c.voiceModel === c.llmModel ? c.voiceModel : "mixed";
  const kindLabel = kind === "mixed" ? "Mixed models" : MODEL_OPTS.find((o) => o.id === kind)!.label + (kind === "undecided" ? "" : " models");
  const toggleLang = (l: string) => actions.patch({ languages: c.languages.includes(l) ? c.languages.filter((x) => x !== l) : [...c.languages, l] });
  return (
    <div className="rounded-v-xl border border-v-line bg-white">
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[15px] font-medium leading-snug">{c.languages.length ? c.languages.join(", ") : "No language chosen"}</p>
          <p className="text-[13px] text-v-muted">{kindLabel}</p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="shrink-0 text-[13px] font-semibold text-v-accent hover:underline">{open ? "Done" : "Change"}</button>
      </div>
      {open ? (
        <div className="flex flex-col gap-6 border-t border-v-line px-4 py-5">
          <fieldset>
            <legend className="text-[13px] font-semibold">Models</legend>
            <div className="mt-2 flex flex-col gap-2">
              {MODEL_OPTS.map((o) => (
                <label key={o.id} className={`flex cursor-pointer items-start gap-2.5 rounded-v-lg border px-3 py-2.5 text-[14px] ${kind === o.id ? "border-v-accent bg-v-pale" : "border-v-line hover:border-v-line-strong"}`}>
                  <input type="radio" name="models" className="mt-1 accent-[var(--v-accent)]" checked={kind === o.id} onChange={() => actions.models(o.id)} />
                  <span><span className="font-medium">{o.label}</span><span className="block text-[12.5px] text-v-muted">{o.hint}</span></span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] text-v-muted">The package includes three voice and two language model choices. The document lists samples only.</p>
          </fieldset>
          <div>
            <p className="text-[13px] font-semibold">Languages</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Languages">
              {LANGUAGE_CHOICES.map((l) => {
                const on = c.languages.includes(l);
                return (
                  <button key={l} type="button" aria-pressed={on} onClick={() => toggleLang(l)} className={`rounded-v-lg border px-3 py-1.5 text-[13px] font-medium ${on ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>
                    {l}{!isDocumentedLanguage(l) ? <span className="ml-1 text-[11px] text-v-warn-ink">confirm</span> : null}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12.5px] text-v-muted">English and ten Indian languages are documented. Ones marked confirm are not.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
