"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, Download, FileText, HelpCircle, Pencil, Presentation, Send, X } from "lucide-react";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { LIMITS, PACKAGE_NAME, PACKAGE_CARDS, PRICE_POINTS_NOTE } from "@/lib/adopt/builder/catalog";
import { classify } from "@/lib/adopt/builder/canvas";
import { KB_BY_ID, SUGGESTED } from "@/lib/adopt/builder/kb";
import { buildPitch, pitchToMarkdown } from "@/lib/adopt/builder/pitch";
import { costFor, inr, rate } from "@/lib/adopt/builder/pricing";
import { QUESTION_BY_ID, nextQuestion, plannedQuestions, recommend, selectionFor, type Choice, type QId, type Question } from "@/lib/adopt/builder/profile";
import { useBuilder, usePrices, type LogItem } from "@/lib/adopt/builder/store";
import { NumInput, Tag, download } from "./parts";

export function Discover() {
  const { state } = useBuilder();
  const { pb } = usePrices();
  const [pitchOpen, setPitchOpen] = useState(false);
  const p = state.profile;
  const rec = recommend(p);
  const prov = selectionFor(p, rec.startAt);
  const cost = p.scale ? costFor(prov, pb) : null;
  const pitch = buildPitch(p, pb, p.scale ? prov : null, cost, rec);
  const canSkip = p.useCases.length > 0;

  return (
    <div className="relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(420px,480px)]">
      <Chat onShowPitch={() => setPitchOpen(true)} canSkip={canSkip} progress={pitch.progress} />

      <aside aria-label="Your pitch" className="vb-scroll hidden min-h-0 overflow-y-auto border-l border-[var(--vb-line)] p-6 lg:block">
        <PitchSheet />
      </aside>

      <AnimatePresence>
        {pitchOpen ? (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" className="vb-scrim absolute inset-0" aria-label="Close the pitch" onClick={() => setPitchOpen(false)} />
            <motion.div className="vb-scroll absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-[var(--vb-bg-2)] p-4" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} transition={{ duration: 0.22 }}>
              <div className="mb-3 flex justify-end">
                <button type="button" onClick={() => setPitchOpen(false)} className="vb-btn vb-btn-ghost vb-btn-sm"><X className="size-3.5" aria-hidden /> Close</button>
              </div>
              <PitchSheet />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ chat */

function Chat({ onShowPitch, canSkip, progress }: { onShowPitch: () => void; canSkip: boolean; progress: number }) {
  const { state, actions } = useBuilder();
  const p = state.profile;
  const q = nextQuestion(p);
  const scroller = useRef<HTMLDivElement>(null);
  const planned = plannedQuestions(p);
  const answered = planned.filter((x) => p.answered.includes(x.id)).length;
  const lastIdx = new Map<string, number>();
  state.log.forEach((m, i) => { if (m.who === "user" && m.qid) lastIdx.set(m.qid, i); });

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [state.log.length, q?.id]);

  return (
    <section aria-label="Conversation" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 px-5 py-3 md:px-8">
        <div className="min-w-0">
          <p className="vb-eyebrow">Let us work out your package</p>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="vb-bar w-32" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={planned.length} aria-valuenow={answered}><i style={{ width: `${planned.length ? (answered / planned.length) * 100 : 0}%` }} /></div>
            <span className="vb-muted text-[12.5px] tabular-nums">{answered} of about {Math.max(planned.length, 8)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onShowPitch} className="vb-btn vb-btn-ghost vb-btn-sm lg:hidden"><FileText className="size-3.5" aria-hidden /> Your pitch <span className="vb-muted tabular-nums">{Math.round(progress * 100)}%</span></button>
          {canSkip ? <button type="button" onClick={() => actions.goto("package")} className="vb-btn vb-btn-ghost vb-btn-sm">See my package <ArrowRight className="size-3.5" aria-hidden /></button> : null}
          {canSkip ? <button type="button" onClick={() => actions.goto("pitch")} className="vb-btn vb-btn-accent vb-btn-sm hidden sm:inline-flex"><Presentation className="size-3.5" aria-hidden /> Present the pitch</button> : null}
        </div>
      </header>

      <div ref={scroller} role="log" aria-live="polite" aria-label="Conversation so far" className="vb-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2 md:px-8">
        <div className="mx-auto flex max-w-[680px] flex-col gap-5">
          {state.log.map((m, i) => <Message key={m.id} m={m} editable={m.who === "user" && !!m.qid && lastIdx.get(m.qid) === i} />)}
          {q ? <Pending key={`${q.id}-${state.log.length}`} q={q} /> : null}
        </div>
      </div>

      <Composer />
    </section>
  );
}

function Message({ m, editable }: { m: LogItem; editable: boolean }) {
  const { actions } = useBuilder();
  const ask = actions.ask;
  if (m.who === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end gap-1.5">
        <p className="vb-bubble-user">{m.text}</p>
        {editable && m.qid ? (
          <button type="button" onClick={() => actions.edit(m.qid as QId)} className="vb-muted inline-flex items-center gap-1 text-[12px] hover:text-[var(--vb-ink)]"><Pencil className="size-3" aria-hidden /> Change this</button>
        ) : null}
      </motion.div>
    );
  }
  if (m.kind === "note") return <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="vb-note ml-10">{m.text}</motion.p>;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="vb-agent">
      <span className="vb-agent-mark" aria-hidden><VoicEraMark size={15} className="text-[var(--vb-ink)]" /></span>
      <div className="min-w-0 flex-1">
        {m.kind === "kb" ? (
          <div className="vb-card-2 flex flex-col gap-3 p-4">
            <p className="vb-eyebrow">{m.text}</p>
            {m.paragraphs?.map((t, i) => <p key={i} className="text-[15px] leading-relaxed">{t}</p>)}
            <div className="flex flex-wrap items-center gap-2">
              <Tag>{m.src === "OURS" ? "Our guidance, not a measured result" : `From the documents: ${m.src}`}</Tag>
              {m.follow?.map((f) => KB_BY_ID[f] ? <button key={f} type="button" onClick={() => ask(KB_BY_ID[f].q)} className="vb-tag info cursor-pointer hover:brightness-125">{KB_BY_ID[f].q}</button> : null)}
            </div>
          </div>
        ) : m.kind === "open" ? (
          <div className="rounded-2xl border border-[var(--vb-amber)]/40 bg-[var(--vb-amber-soft)] p-4 text-[14.5px] leading-relaxed">{m.text}</div>
        ) : (
          <p className="text-[17px] leading-relaxed">{m.text}</p>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ the question in hand */

function Pending({ q }: { q: Question }) {
  const { state, actions } = useBuilder();
  const p = state.profile;
  const [picked, setPicked] = useState<string[]>([]);
  const [budget, setBudget] = useState<number | null>(p.budget);
  const [why, setWhy] = useState(false);
  const choices = q.choices?.(p) ?? [];

  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="ml-10 flex flex-col gap-3">
      {q.kind === "single" ? (
        <div role="radiogroup" aria-label={q.prompt(p)} className={`grid gap-2.5 ${choices.length > 4 ? "sm:grid-cols-2" : ""}`}>
          {choices.map((c) => <ChoiceButton key={c.id} c={c} role="radio" checked={false} onClick={() => actions.answer(q.id, c.id)} />)}
        </div>
      ) : null}

      {q.kind === "multi" ? (
        <>
          <div role="group" aria-label={q.prompt(p)} className="grid gap-2.5 sm:grid-cols-2">
            {choices.map((c) => <ChoiceButton key={c.id} c={c} role="checkbox" checked={picked.includes(c.id)} onClick={() => toggle(c.id)} />)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="vb-btn vb-btn-accent" disabled={picked.length === 0} onClick={() => actions.answer(q.id, picked)}>Continue <ArrowRight className="size-4" aria-hidden /></button>
            <span className="vb-muted text-[13px]">{picked.length ? `${picked.length} chosen` : "Choose at least one"}</span>
          </div>
        </>
      ) : null}

      {q.kind === "number" ? (
        <div className="flex flex-wrap items-end gap-3">
          <NumInput label="Budget" prefix="₹" value={budget} onChange={setBudget} step={1000} width="220px" />
          <button type="button" className="vb-btn vb-btn-accent" disabled={!budget || budget <= 0} onClick={() => actions.answer(q.id, budget)}>Continue <ArrowRight className="size-4" aria-hidden /></button>
          <button type="button" className="vb-btn vb-btn-ghost" onClick={() => actions.answer(q.id, null)}>Not sure yet</button>
        </div>
      ) : null}

      {q.kind === "done" ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="vb-btn vb-btn-primary" onClick={() => { actions.answer("more", null); actions.goto("package"); }}>Show my package <ArrowRight className="size-4" aria-hidden /></button>
          <span className="vb-muted text-[13px]">Or ask me anything below first.</span>
        </div>
      ) : null}

      <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="vb-muted inline-flex w-fit items-center gap-1.5 text-[12.5px] hover:text-[var(--vb-ink)]">
        <HelpCircle className="size-3.5" aria-hidden /> Why am I asked this?
      </button>
      {why ? <p className="vb-note">{q.why}</p> : null}
    </motion.div>
  );
}

function ChoiceButton({ c, role, checked, onClick }: { c: Choice; role: "radio" | "checkbox"; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" role={role} aria-checked={role === "radio" ? false : checked} aria-pressed={role === "checkbox" ? checked : undefined} onClick={onClick} className="vb-choice">
      {role === "checkbox" ? <span className="vb-mark sq" aria-hidden>{checked ? <Check className="size-3.5" strokeWidth={3} /> : null}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug">{c.label}</span>
        {c.hint ? <span className="vb-muted mt-0.5 block text-[13px] leading-snug">{c.hint}</span> : null}
        {c.suggested ? <span className="vb-tag info mt-1.5">Usually fits your kind of department</span> : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ composer */

function Composer() {
  const { actions } = useBuilder();
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    actions.ask(t);
    setText("");
  };
  return (
    <div className="shrink-0 border-t border-[var(--vb-line)] bg-[var(--vb-bg-2)]/70 px-5 py-3 backdrop-blur md:px-8">
      <div className="mx-auto max-w-[680px]">
        <div className="vb-scroll -mx-1 mb-2.5 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Questions adopters often ask">
          {SUGGESTED.map((id) => (
            <button key={id} type="button" onClick={() => actions.ask(KB_BY_ID[id].q)} className="vb-tag info shrink-0 cursor-pointer hover:brightness-125">{KB_BY_ID[id].q}</button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2">
          <label htmlFor="vb-ask" className="sr-only">Type your answer, or ask me anything</label>
          <input id="vb-ask" className="vb-input flex-1" value={text} maxLength={400} placeholder="Type your answer, or ask me anything about VoicERA" onChange={(e) => setText(e.target.value)} autoComplete="off" />
          <button type="submit" className="vb-btn vb-btn-accent h-[46px] w-[46px] shrink-0 !px-0" disabled={!text.trim()} aria-label="Send"><Send className="size-4" aria-hidden /></button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the pitch, writing itself */

export function PitchSheet() {
  const { state, actions } = useBuilder();
  const { pb } = usePrices();
  const [copied, setCopied] = useState(false);
  const p = state.profile;
  const rec = recommend(p);
  const prov = state.sel ?? selectionFor(p, rec.startAt);
  const cost = p.scale || state.sel ? costFor(prov, pb) : null;
  const pitch = buildPitch(p, pb, p.scale || state.sel ? prov : null, cost, rec);
  const personal = pitch.sections.length > 0;
  const md = pitchToMarkdown(pitch);
  const key = state.sel ? classify(state.sel).key : rec.want;

  return (
    <article className="vb-sheet p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="vb-eyebrow">Your pitch</p>
        {p.useCases.length ? <Tag tone="info">Leaning toward {PACKAGE_NAME[key]}</Tag> : null}
      </div>
      <h2 className="vb-serif mt-3 text-[30px] font-normal leading-[1.12]">{pitch.headline}</h2>
      <p className="vb-body mt-3 text-[15px] leading-relaxed">{pitch.sub}</p>

      <div className="mt-5" aria-label="How much of the pitch is filled in">
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--vb-paper-line)]"><motion.div className="h-full rounded-full bg-[var(--vb-accent-strong)]" initial={false} animate={{ width: `${pitch.progress * 100}%` }} transition={{ duration: 0.4 }} /></div>
        <p className="vb-muted mt-1.5 text-[12px]">{personal ? "It grows with every answer." : "Answer a question and this page starts to describe your service."}</p>
      </div>

      <div className="mt-6 flex flex-col gap-5">
        <AnimatePresence initial={false}>
          {pitch.sections.map((s) => (
            <motion.section key={s.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="border-t border-[var(--vb-paper-line)] pt-4">
              <div className="flex items-center gap-2"><h3 className="vb-eyebrow">{s.title}</h3>{s.flag ? <Tag tone="warn">Open</Tag> : null}</div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {s.lines.map((l) => <li key={l} className="text-[14.5px] leading-relaxed">{l}</li>)}
              </ul>
            </motion.section>
          ))}
        </AnimatePresence>

        {!personal ? <Platform /> : null}
      </div>

      {personal ? (
        <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--vb-paper-line)] pt-5">
          <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => { void navigator.clipboard?.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1600); }}><Copy className="size-3.5" aria-hidden /> {copied ? "Copied" : "Copy"}</button>
          <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => download("voicera-pitch.md", md, "text/markdown")}><Download className="size-3.5" aria-hidden /> Download</button>
          {p.useCases.length ? <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => actions.goto("package")}>Package <ArrowRight className="size-3.5" aria-hidden /></button> : null}
          {p.useCases.length ? <button type="button" className="vb-btn vb-btn-accent vb-btn-sm" onClick={() => actions.goto("pitch")}><Presentation className="size-3.5" aria-hidden /> Present the full pitch</button> : null}
        </div>
      ) : null}
    </article>
  );
}

/** What VoicERA is, before any answer. */
function Platform() {
  const { pb } = usePrices();
  return (
    <>
      <section className="border-t border-[var(--vb-paper-line)] pt-4">
        <h3 className="vb-eyebrow">What VoicERA is</h3>
        <p className="mt-2 text-[14.5px] leading-relaxed">The open, sovereign conversational layer that lets a government turn citizen conversations into actions across the systems it already uses. It does not replace them.</p>
      </section>
      <section className="border-t border-[var(--vb-paper-line)] pt-4">
        <h3 className="vb-eyebrow">One platform, three depths</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {(["deploy", "connect", "orchestrate"] as const).map((d) => (
            <li key={d} className="flex items-baseline justify-between gap-3 text-[14.5px]"><span><span className="font-semibold">{PACKAGE_NAME[d]}</span> <span className="vb-body">{PACKAGE_CARDS[d].bestFor}</span></span><span className="vb-muted shrink-0 text-[13px]">{PACKAGE_CARDS[d].launch}</span></li>
          ))}
        </ul>
      </section>
      <section className="border-t border-[var(--vb-paper-line)] pt-4">
        <h3 className="vb-eyebrow">The facts, from the package document</h3>
        <ul className="mt-2 flex flex-col gap-1.5 text-[14.5px] leading-relaxed">
          <li>Eleven languages, with switching mid-call.</li>
          <li>Up to {LIMITS.concurrent} calls at once, response time target under {LIMITS.latency} seconds.</li>
          <li>Set up in {LIMITS.setupDays} working days once you have handed over what is needed.</li>
          <li>Setup {inr(pb.setup.deploy)}, {inr(pb.perNumber)} a number, and {rate(pb.usageRate, pb.usageUnit)}.</li>
        </ul>
        <p className="vb-muted mt-2 text-[12.5px]">{PRICE_POINTS_NOTE}</p>
      </section>
    </>
  );
}

export { QUESTION_BY_ID };
