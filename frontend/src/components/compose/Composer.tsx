"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Copy, GripVertical, Minus, OctagonAlert, Plus, TriangleAlert, X, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { OutcomeBanner } from "@/components/adopt/advisor/ui";
import { Notice, Spinner } from "@/components/adopt/ui";
import { ScenarioRunner } from "@/components/adopt/ScenarioRunner";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { buildChecklist, buildExplanation } from "@/lib/adopt/advisor/bundle";
import {
  BLOCKS, BLOCK_BY_ID, LANGUAGE_CHOICES, ORDER, STARTERS, fromSentence, fromStarter, judge, scriptFor,
  type Block, type BlockGroup, type BlockId, type Design, type NodeState, type Readiness, type Topic,
} from "@/lib/adopt/advisor/compose";
import { useCompose } from "@/lib/adopt/advisor/compose-store";
import { calculateCost, inr } from "@/lib/adopt/advisor/cost";
import { exportRecommendation } from "@/lib/adopt/advisor/export";
import { isDocumentedLanguage } from "@/lib/adopt/advisor/source";
import { useAdvisor } from "@/lib/adopt/advisor/store";
import type { SimContext } from "@/lib/adopt/simulate";

const GROUPS: { id: BlockGroup; title: string }[] = [
  { id: "start", title: "How the call starts" },
  { id: "conversation", title: "What is said" },
  { id: "safety", title: "When it goes off the path" },
  { id: "extras", title: "Things you might want to add" },
];

const STATE_STYLE: Record<NodeState, string> = {
  ok: "border-v-line bg-white",
  warn: "border-v-warning/70 bg-v-warn-tint",
  blocked: "border-v-danger bg-v-danger-pale",
  pending: "border-dashed border-v-line-strong bg-white/60",
};

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Composer() {
  const { state, hydrated, actions } = useCompose();
  const [sentence, setSentence] = useState("");
  const [dragging, setDragging] = useState(false);
  const [mobile, setMobile] = useState<"blocks" | "call" | "verdict">("call");
  const d = state.design;

  if (!hydrated) return <Spinner label="Opening the composer" />;

  /* ----------------------------- start ----------------------------- */
  if (!state.started) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col justify-center gap-9 px-5 py-10 md:px-8">
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">VoicERA Composer</span>
            <h1 className="text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[48px]">Build the call. See at once whether it fits.</h1>
            <p className="max-w-[58ch] text-[15px] font-light leading-relaxed text-v-body">
              There is nothing to answer. You put a voice service together from blocks, and the package rules judge what you built as you build it.
              Add something the package does not cover and it turns red, with the reason.
            </p>
          </div>

          <div>
            <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Start from a shape</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {STARTERS.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => actions.begin(fromStarter(s))} className="flex h-full w-full flex-col gap-1.5 rounded-v-xl border border-v-line bg-v-panel p-4 text-left shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent">
                    <span className="text-[15px] font-semibold leading-snug">{s.title}</span>
                    <span className="text-[12.5px] leading-relaxed text-v-body">{s.plain}</span>
                    <span className="mt-auto pt-2 font-mono text-[10px] uppercase tracking-[.1em] text-v-muted">{s.blocks.length ? `${s.blocks.length} blocks` : "Empty canvas"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Or say it in one sentence and I will lay it out</p>
            <label htmlFor="compose-sentence" className="sr-only">Describe the service</label>
            <textarea
              id="compose-sentence"
              rows={2}
              value={sentence}
              maxLength={600}
              onChange={(e) => setSentence(e.target.value)}
              placeholder="For example: Citizens call, and we check their pension eligibility live against our database, in Hindi and Tamil."
              className="w-full resize-none rounded-v-xl border border-v-line-strong bg-white px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-v-dim focus:border-v-accent"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={sentence.trim().length < 10} onClick={() => actions.begin(fromSentence(sentence.trim()))}>
                Lay it out <ArrowRight className="size-3.5" aria-hidden />
              </Button>
              <span className="text-[12px] text-v-muted">Read by fixed rules, with no AI. It only adds blocks for what you said. Nothing leaves this device.</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------- composing ----------------------------- */
  const costInput = { numbers: d.numbers, minutes: d.minutes, minutesIsAssumption: false, category: d.category };
  const verdict = judge(d, { cost: { category: d.category, minutes: d.minutes } });
  const outbound = d.blocks.includes("out-call") || d.blocks.includes("reminder");
  const topicOk = (b: Block) => !b.topics || b.topics.includes(d.topic);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-v-line bg-v-panel lg:hidden" role="tablist" aria-label="Composer sections">
        {([["blocks", "Blocks"], ["call", "The call"], ["verdict", "Verdict"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mobile === id} type="button" onClick={() => setMobile(id)} className={`-mb-px flex-1 border-b-2 py-3 text-[13px] font-semibold ${mobile === id ? "border-v-accent text-v-accent-deep" : "border-transparent text-v-body"}`}>
            {label}
            {id === "verdict" && verdict ? <span className={`ml-1.5 inline-block size-2 rounded-full ${verdict.ev.outcome === "outside-scope" ? "bg-v-danger" : verdict.ev.outcome === "needs-review" ? "bg-v-warning" : "bg-v-accent"}`} aria-hidden /> : null}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)_350px]">
        {/* ------------------------- palette ------------------------- */}
        <aside aria-label="Blocks" className={`min-h-0 overflow-y-auto border-r border-v-line bg-v-panel p-4 ${mobile === "blocks" ? "block" : "hidden"} lg:block`}>
          <fieldset className="mb-5">
            <legend className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">The service is about</legend>
            <div className="flex overflow-hidden rounded-v-lg border border-v-line-strong bg-white text-[12.5px] font-medium">
              {([["scheme", "Schemes"], ["survey", "Feedback"], ["other", "Other"]] as [Topic, string][]).map(([t, label]) => (
                <button key={t} type="button" aria-pressed={d.topic === t} onClick={() => actions.topic(t)} className={`flex-1 px-2 py-2 ${d.topic === t ? "bg-v-fg text-white" : "text-v-body hover:bg-v-soft"}`}>{label}</button>
              ))}
            </div>
          </fieldset>

          {GROUPS.map((g) => (
            <section key={g.id} className="mb-5" aria-labelledby={`pal-${g.id}`}>
              <h2 id={`pal-${g.id}`} className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">{g.title}</h2>
              <ul className="flex flex-col gap-1.5">
                {BLOCKS.filter((b) => b.group === g.id && topicOk(b)).map((b) => {
                  const on = d.blocks.includes(b.id);
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", b.id); e.dataTransfer.effectAllowed = "copy"; setDragging(true); }}
                        onDragEnd={() => setDragging(false)}
                        onClick={() => actions.toggle(b.id)}
                        aria-pressed={on}
                        className={`flex w-full items-start gap-2 rounded-v-lg border px-2.5 py-2 text-left transition-colors ${on ? "border-v-accent bg-v-pale" : "border-v-line bg-white hover:border-v-line-strong"}`}
                      >
                        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-v-disabled" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-semibold leading-snug">{b.label}</span>
                          <span className="block text-[11px] leading-snug text-v-muted">{b.plain}</span>
                        </span>
                        <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${on ? "bg-v-accent text-white" : "border border-v-line-strong text-v-muted"}`} aria-hidden>
                          {on ? <Check className="size-3" strokeWidth={3} /> : <Plus className="size-3" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section aria-labelledby="pal-lang">
            <h2 id="pal-lang" className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Languages</h2>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Languages">
              {LANGUAGE_CHOICES.map((l) => {
                const on = d.languages.includes(l);
                const doc = isDocumentedLanguage(l);
                return (
                  <button key={l} type="button" aria-pressed={on} onClick={() => actions.patch({ languages: on ? d.languages.filter((x) => x !== l) : [...d.languages, l] })}
                    className={`rounded-v-md border px-2.5 py-1 text-[12px] ${on ? (doc ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-warning bg-v-warn-tint text-v-warn-ink") : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>
                    {l}
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        {/* ------------------------- canvas ------------------------- */}
        <section aria-label="The call" className={`flex min-h-0 flex-col ${mobile === "call" ? "flex" : "hidden"} lg:flex`}>
          <div role="tablist" aria-label="Views" className="flex shrink-0 gap-1 border-b border-v-line bg-v-panel px-3 md:px-5">
            {([["canvas", "The call"], ["hear", "Hear it"], ["script", "Script"]] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={state.tab === id} type="button" onClick={() => actions.setTab(id)} className={`-mb-px border-b-2 px-3.5 py-3 text-[13px] font-semibold ${state.tab === id ? "border-v-accent text-v-accent-deep" : "border-transparent text-v-body hover:text-v-fg"}`}>{label}</button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-v-surface-sunk" style={{ backgroundImage: "radial-gradient(var(--v-line) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
            {state.tab === "canvas" ? (
              <div
                className={`mx-auto flex max-w-[640px] flex-col gap-4 px-4 py-6 md:px-6 ${dragging ? "rounded-v-xl outline-dashed outline-2 outline-v-accent" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const id = e.dataTransfer.getData("text/plain") as BlockId; if (BLOCK_BY_ID[id]) actions.add(id); }}
              >
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                    <label htmlFor="dept" className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Your department (optional)</label>
                    <Input id="dept" value={d.department} maxLength={80} placeholder="Used in the script" onChange={(e) => actions.patch({ department: e.target.value })} />
                  </div>
                  <fieldset>
                    <legend className="mb-1 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">A typical call lasts</legend>
                    <div className="flex overflow-hidden rounded-v-lg border border-v-line-strong bg-white text-[12.5px] font-medium">
                      {([["short", "Under 3 min"], ["about", "About 3 min"]] as const).map(([v, label]) => (
                        <button key={v} type="button" aria-pressed={d.length === v} onClick={() => actions.patch({ length: v })} className={`px-3 py-2 ${d.length === v ? "bg-v-fg text-white" : "text-v-body hover:bg-v-soft"}`}>{label}</button>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <ol className="flex flex-col" aria-label="Blocks in the call, in order">
                  <AnimatePresence initial={false}>
                    {ORDER.filter((id) => d.blocks.includes(id)).map((id, i, arr) => {
                      const b = BLOCK_BY_ID[id];
                      const st = verdict?.blocks[id];
                      const state_ = st?.state ?? "ok";
                      return (
                        <motion.li key={id} layout initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="flex flex-col items-stretch">
                          <div className={`flex items-start gap-3 rounded-v-xl border px-4 py-3 ${STATE_STYLE[state_]}`}>
                            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-v-fg font-mono text-[10.5px] text-white" aria-hidden>{i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-2 text-[14px] font-semibold leading-snug">
                                {b.label}
                                {state_ === "blocked" ? <OctagonAlert className="size-4 text-v-danger" aria-label="Outside the package" /> : state_ === "warn" ? <TriangleAlert className="size-4 text-v-warning-deep" aria-label="Needs attention" /> : null}
                              </p>
                              <p className="text-[12.5px] leading-snug text-v-body">{b.plain}</p>
                              {st?.why ? <p className="mt-1.5 text-[12.5px] leading-relaxed text-v-fg">{st.why}</p> : null}
                              {id === "match" ? <KbSettings d={d} patch={actions.patch} /> : null}
                            </div>
                            <button type="button" onClick={() => actions.toggle(id)} aria-label={`Remove ${b.label}`} className="shrink-0 rounded-v-md p-1.5 text-v-muted hover:bg-white hover:text-v-danger">
                              <X className="size-4" aria-hidden />
                            </button>
                          </div>
                          {i < arr.length - 1 ? <span className="mx-auto h-3 w-px bg-v-line-strong" aria-hidden /> : null}
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ol>

                {d.blocks.length === 0 ? (
                  <div className="rounded-v-xl border border-dashed border-v-line-strong bg-white/70 px-6 py-10 text-center">
                    <p className="text-[15px] font-semibold">Drag a block here, or click one on the left</p>
                    <p className="mt-1 text-[13px] text-v-body">Start with how the call begins.</p>
                  </div>
                ) : null}

                <Readiness d={d} patch={actions.patch} outbound={outbound} showKb={d.blocks.includes("match") || d.topic === "other"} />
              </div>
            ) : null}

            {state.tab === "hear" ? <HearIt d={d} /> : null}

            {state.tab === "script" ? (
              <div className="mx-auto flex max-w-[640px] flex-col gap-3 px-4 py-6 md:px-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[16px] font-semibold">A draft of what the agent says</h2>
                  <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard?.writeText(scriptFor(d).map((s) => `[${s.title}]\n${s.says}`).join("\n\n")); }}>
                    <Copy className="size-3.5" aria-hidden /> Copy
                  </Button>
                </div>
                {scriptFor(d).length === 0 ? <Notice tone="info">Add blocks to the call and the script appears here.</Notice> : (
                  <ol className="flex flex-col gap-2">
                    {scriptFor(d).map((s) => (
                      <li key={s.block} className="rounded-v-xl border border-v-line bg-white px-4 py-3">
                        <p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-v-muted">{s.title}</p>
                        <p className="text-[14px] leading-relaxed">{s.says}</p>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="text-[12px] text-v-muted">Square brackets are filled from your knowledge base during the call. This is a draft for your department to approve.</p>
              </div>
            ) : null}
          </div>
        </section>

        {/* ------------------------- verdict ------------------------- */}
        <aside aria-label="Verdict" className={`min-h-0 overflow-y-auto border-l border-v-line bg-v-panel p-4 ${mobile === "verdict" ? "block" : "hidden"} lg:block`}>
          <Verdict d={d} verdict={verdict} costInput={costInput} patch={actions.patch} toggle={actions.toggle} />
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- readiness */

const READY_LABEL: Record<Readiness, string> = { yes: "Yes", no: "Not yet", unknown: "Unsure" };

function Seg({ value, onChange, label }: { value: Readiness; onChange: (v: Readiness) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 overflow-hidden rounded-v-lg border border-v-line-strong bg-white text-[12px] font-medium">
      {(["yes", "no", "unknown"] as Readiness[]).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`px-2.5 py-1.5 ${value === v ? (v === "yes" ? "bg-v-ok text-white" : v === "no" ? "bg-v-danger text-white" : "bg-v-fg text-white") : "text-v-body hover:bg-v-soft"}`}>
          {READY_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

function Readiness({ d, patch, outbound, showKb }: { d: Design; patch: (p: Partial<Design>) => void; outbound: boolean; showKb: boolean }) {
  const rows: { key: keyof Design["ready"]; label: string; show: boolean }[] = [
    { key: "script", label: "The script is written and approved", show: true },
    { key: "knowledge", label: "The knowledge material is approved", show: showKb },
    { key: "phoneList", label: "We have the citizens' phone list", show: outbound },
    { key: "permission", label: "We have permission to call them", show: outbound },
    { key: "testers", label: "People are available to test calls", show: true },
  ];
  return (
    <section aria-labelledby="ready-h" className="mt-2 rounded-v-xl border border-v-line bg-white p-4">
      <h2 id="ready-h" className="text-[14px] font-semibold">What you have in hand</h2>
      <p className="mb-3 text-[12px] text-v-muted">Left on Unsure, each one stays an open condition. We never assume it for you.</p>
      <ul className="flex flex-col divide-y divide-v-hairline">
        {rows.filter((r) => r.show).map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-[13px]">{r.label}</span>
            <Seg label={r.label} value={d.ready[r.key]} onChange={(v) => patch({ ready: { ...d.ready, [r.key]: v } })} />
          </li>
        ))}
        <li className="flex flex-wrap items-center justify-between gap-2 py-2">
          <label htmlFor="sens" className="text-[13px]">What will be discussed on calls</label>
          <select id="sens" value={d.sensitivity} onChange={(e) => patch({ sensitivity: e.target.value as Design["sensitivity"] })} className="rounded-v-lg border border-v-line-strong bg-white px-2.5 py-1.5 text-[12.5px]">
            <option value="unknown">Unsure</option>
            <option value="public">Public information only</option>
            <option value="personal">Some personal details</option>
            <option value="sensitive">Sensitive personal details</option>
          </select>
        </li>
      </ul>
    </section>
  );
}

function KbSettings({ d, patch }: { d: Design; patch: (p: Partial<Design>) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
      <label className="flex items-center gap-1.5">Files
        <input type="number" min={0} step={1} value={d.kbCount} onChange={(e) => patch({ kbCount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="w-16 rounded-v-md border border-v-line-strong bg-white px-2 py-1" aria-label="Number of knowledge files" />
      </label>
      <label className="flex items-center gap-1.5">Largest MB
        <input type="number" min={0} step="any" value={d.kbMaxMB} onChange={(e) => patch({ kbMaxMB: Math.max(0, Number(e.target.value) || 0) })} className="w-16 rounded-v-md border border-v-line-strong bg-white px-2 py-1" aria-label="Size of the largest file in megabytes" />
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={d.kbTextFiles} onChange={(e) => patch({ kbTextFiles: e.target.checked })} className="size-3.5 accent-[var(--v-accent)]" /> Text files
      </label>
    </div>
  );
}

/* ---------------------------------------------------------------- verdict */

function Verdict({ d, verdict, costInput, patch, toggle }: { d: Design; verdict: ReturnType<typeof judge>; costInput: { numbers: number | null; minutes: number | null; minutesIsAssumption: boolean; category: Design["category"] }; patch: (p: Partial<Design>) => void; toggle: (id: BlockId) => void }) {
  const router = useRouter();
  const advisor = useAdvisor();
  const cost = calculateCost(costInput);

  if (!verdict) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold">The verdict appears here</p>
        <p className="text-[13px] leading-relaxed text-v-body">Add the first block and the package rules start judging what you build.</p>
      </div>
    );
  }
  const { ev } = verdict;
  const list = buildChecklist(verdict.answers, ev).filter((i) => i.status !== "na");
  const ready = list.filter((i) => i.status === "ready").length;
  const ex = buildExplanation(verdict.answers, ev, buildChecklist(verdict.answers, ev));

  function openFull() {
    advisor.actions.replaceAnswers(verdict!.answers);
    advisor.actions.setCost({ numbers: d.numbers, minutes: d.minutes, minutesIsAssumption: false, category: d.category });
    router.push("/adopt/advisor/result");
  }

  return (
    <div className="flex flex-col gap-5">
      <OutcomeBanner outcome={ev.outcome} pendingGovernance={ev.pendingGovernance} />

      {verdict.culprits.length ? (
        <section aria-labelledby="because-h" className="flex flex-col gap-2">
          <h2 id="because-h" className="text-[14px] font-semibold">Because of</h2>
          <ul className="flex flex-col gap-2">
            {verdict.culprits.map((id) => (
              <li key={id} className="flex items-center justify-between gap-2 rounded-v-lg border border-v-line bg-white px-3 py-2">
                <span className="text-[12.5px] font-medium">{BLOCK_BY_ID[id].label}</span>
                <button type="button" onClick={() => toggle(id)} className="inline-flex shrink-0 items-center gap-1 rounded-v-md border border-v-line px-2.5 py-1 text-[12px] font-semibold text-v-accent hover:bg-v-pale">
                  <Minus className="size-3" aria-hidden /> Remove it
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ev.findings.length ? (
        <section aria-labelledby="open-h" className="flex flex-col gap-2">
          <h2 id="open-h" className="text-[14px] font-semibold">What is open</h2>
          <ul className="flex flex-col gap-1.5">
            {ev.findings.slice(0, 6).map((f) => (
              <li key={f.id} title={f.detail} className="flex items-start gap-2 text-[12.5px] leading-snug">
                <span className={`mt-1 size-2 shrink-0 rounded-full ${f.severity === "blocker" ? "bg-v-danger" : f.severity === "review" ? "bg-v-warning" : "bg-v-accent"}`} aria-hidden />
                <span><span className="font-medium">{f.title}.</span> <span className="text-v-body">{f.detail.split(/(?<=[.!?])\s/)[0]}</span></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="cost-h" className="rounded-v-xl border border-v-line bg-v-surface-sunk p-3.5">
        <h2 id="cost-h" className="text-[14px] font-semibold">Cost</h2>
        <p className="mt-1 text-[24px] font-semibold tabular-nums tracking-tight" aria-live="polite">{inr(cost.knownTotal)}</p>
        <p className="text-[11.5px] text-v-body">{cost.totalIsComplete ? "Indicative total from documented rates." : "Known costs only. Usage is not included yet."}</p>
        <div className="mt-3 grid gap-2.5">
          <label className="flex items-center justify-between gap-3 text-[12.5px]">Phone numbers
            <input type="number" min={0} step={1} value={d.numbers ?? ""} onChange={(e) => patch({ numbers: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })} className="w-20 rounded-v-md border border-v-line-strong bg-white px-2 py-1 text-right" />
          </label>
          <label className="flex items-center justify-between gap-3 text-[12.5px]">Billable minutes
            <input type="number" min={0} step="any" value={d.minutes ?? ""} onChange={(e) => patch({ minutes: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} className="w-24 rounded-v-md border border-v-line-strong bg-white px-2 py-1 text-right" />
          </label>
          <div role="radiogroup" aria-label="Model type" className="flex overflow-hidden rounded-v-lg border border-v-line-strong bg-white text-[12px] font-medium">
            {([["open", "Open-source"], ["proprietary", "Proprietary"], ["unknown", "Not decided"]] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={d.category === v} onClick={() => patch({ category: v })} className={`flex-1 px-2 py-1.5 ${d.category === v ? "bg-v-fg text-white" : "text-v-body hover:bg-v-soft"}`}>{label}</button>
            ))}
          </div>
        </div>
        {cost.unresolvedNote ? <p className="mt-2 text-[11.5px] leading-snug text-v-warn-ink">{cost.unresolvedNote}</p> : null}
      </section>

      <section aria-labelledby="bring-h">
        <h2 id="bring-h" className="text-[14px] font-semibold">What you would bring</h2>
        <p className="text-[12.5px] text-v-body"><span className="text-[18px] font-semibold tabular-nums text-v-fg">{ready}</span> of {list.length} in hand</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-v-line" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={ready} aria-label="Items in hand">
          <motion.div className="h-full rounded-full bg-v-accent" initial={false} animate={{ width: `${list.length ? (ready / list.length) * 100 : 0}%` }} />
        </div>
      </section>

      <div className="flex flex-col gap-2">
        <Button onClick={openFull}>Open the full recommendation <ArrowRight className="size-3.5" aria-hidden /></Button>
        <Button variant="outline" onClick={() => { const md = exportRecommendation(verdict.answers, costInput, d.department); if (md) download("voicera-platinum-recommendation.md", md, "text/markdown"); }}>Export it</Button>
        <p className="text-[11.5px] leading-snug text-v-muted">{ex.summary} Nothing is sent anywhere.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hear it */

function HearIt({ d }: { d: Design }) {
  const scheme = d.topic !== "survey";
  const app = APPLICATION_BY_ID[scheme ? "scheme-discovery" : "surveys"];
  const [id, setId] = useState(app.scenarios[0].id);
  const scenario = app.scenarios.find((s) => s.id === id) ?? app.scenarios[0];
  const cfg: Record<string, unknown> = JSON.parse(JSON.stringify(app.defaults));
  cfg.department = d.department.trim() || "Sample Department";
  if (d.languages.length) cfg.languages = d.languages;
  const ctx: SimContext = { app, config: cfg, integrations: {}, packageId: "deploy" };

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-4 px-4 py-6 md:px-6">
      <Notice tone="demo" title="A text simulation">
        It uses the department name and languages from your build, with sample content. No speech, model or telephony is involved, and nobody is called.
        {d.blocks.includes("lookup") || d.blocks.includes("submit") ? " The record lookup you added is not part of the package, so it is not played." : ""}
      </Notice>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Situation">
        {app.scenarios.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === scenario.id} onClick={() => setId(s.id)} className={`rounded-v-lg border px-3.5 py-2 text-[13px] font-medium ${s.id === scenario.id ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>{s.title}</button>
        ))}
      </div>
      <ScenarioRunner key={scenario.id} ctx={ctx} scenario={scenario} mode="adopter" />
      <p className="text-[12px] text-v-muted">Want to hear it with your own schemes? <Link href="/adopt/advisor/poc" className="font-semibold text-v-accent hover:underline">Build the proof of concept</Link>.</p>
    </div>
  );
}
