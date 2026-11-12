"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, Minus, OctagonAlert, RotateCcw, TriangleAlert } from "lucide-react";
import { OutcomeBanner } from "@/components/adopt/advisor/ui";
import { buildChecklist } from "@/lib/adopt/advisor/bundle";
import { calculateCost, inr, type CostInput } from "@/lib/adopt/advisor/cost";
import { OUTCOME_LABEL } from "@/lib/adopt/advisor/evaluate";
import { buildFlow, type FlowNode, type NodeStatus, type WhatIf } from "@/lib/adopt/advisor/studio";
import type { Answers, DimResult, Evaluation } from "@/lib/adopt/advisor/types";

const STATUS: Record<NodeStatus, { ring: string; dot: string; label: string }> = {
  ok: { ring: "border-v-line bg-white", dot: "bg-v-ok", label: "Fits" },
  warn: { ring: "border-v-warning/60 bg-v-warn-tint", dot: "bg-v-warning", label: "Needs attention" },
  blocked: { ring: "border-v-danger bg-v-danger-pale", dot: "bg-v-danger", label: "Outside the package" },
  pending: { ring: "border-dashed border-v-line-strong bg-white/60", dot: "bg-v-disabled", label: "Not known yet" },
  off: { ring: "border-v-line bg-v-surface-sunk", dot: "bg-v-disabled", label: "Not needed" },
};

function StatusMark({ s }: { s: NodeStatus }) {
  if (s === "ok") return <Check className="size-3 text-v-ok" strokeWidth={3} aria-hidden />;
  if (s === "blocked") return <OctagonAlert className="size-3 text-v-danger" aria-hidden />;
  if (s === "warn") return <TriangleAlert className="size-3 text-v-warning-deep" aria-hidden />;
  return <Minus className="size-3 text-v-disabled" aria-hidden />;
}

function Node({ n, selected, onPick, index }: { n: FlowNode; selected: boolean; onPick: () => void; index?: number }) {
  const st = STATUS[n.status];
  return (
    <motion.button
      layout
      type="button"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      onClick={onPick}
      aria-pressed={selected}
      aria-label={`${n.title}. ${st.label}. ${n.detail}`}
      className={`flex min-h-[78px] w-full flex-col gap-1 rounded-v-lg border px-3 py-2.5 text-left transition-colors ${st.ring} ${n.system ? "border-dashed" : ""} ${selected ? "ring-2 ring-v-accent/50" : "hover:border-v-line-strong"}`}
    >
      <span className="flex items-center gap-1.5">
        {index !== undefined ? <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-v-fg font-mono text-[9px] text-white" aria-hidden>{index}</span> : <span className={`size-1.5 shrink-0 rounded-full ${st.dot}`} aria-hidden />}
        <span className="font-mono text-[9px] uppercase tracking-[.12em] text-v-muted">{n.system ? "Your system" : st.label}</span>
        <span className="ml-auto"><StatusMark s={n.status} /></span>
      </span>
      <span className="text-[13px] font-semibold leading-tight text-v-fg">{n.title}</span>
      <span className="text-[11.5px] leading-snug text-v-body">{n.detail}</span>
    </motion.button>
  );
}

/** Ticks a number toward its target so changes feel like a meter, not a jump. */
function useTween(target: number, ms = 450) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const next = a + (target - a) * eased;
      from.current = next;
      setV(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const RESULT_DOT: Record<DimResult, string> = {
  fit: "bg-v-ok",
  conditional: "bg-v-accent",
  unresolved: "bg-v-disabled",
  review: "bg-v-warning",
  blocked: "bg-v-danger",
  na: "bg-v-line-strong",
};

export function BlueprintPane({
  answers,
  ev,
  cost,
  togo,
  schemeCount,
  questionCount,
  onOpenHandover,
  whatIfs,
  onTry,
  canUndo,
  onUndo,
}: {
  answers: Answers;
  ev: Evaluation | null;
  cost: CostInput;
  togo: number;
  schemeCount: number;
  questionCount: number;
  onOpenHandover: () => void;
  whatIfs: WhatIf[];
  onTry: (w: WhatIf) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const flow = buildFlow(answers, ev, schemeCount, questionCount);
  const c = calculateCost(cost);
  const shown = useTween(c.knownTotal ?? 0);
  const all = [...flow.main, ...flow.branches, ...flow.base];
  const pickedNode = all.find((n) => n.id === picked) ?? null;
  const list = ev ? buildChecklist(answers, ev) : [];
  const applicable = list.filter((i) => i.status !== "na");
  const ready = applicable.filter((i) => i.status === "ready").length;
  const toDo = applicable.filter((i) => i.status !== "ready").slice(0, 4);

  if (!ev) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="grid grid-cols-3 gap-2 opacity-60" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="h-12 w-24 rounded-v-lg border border-dashed border-v-line-strong" />
          ))}
        </div>
        <p className="text-[15px] font-semibold">Your blueprint appears here</p>
        <p className="max-w-[38ch] text-[13px] leading-relaxed text-v-body">As you describe the service, the call flow draws itself and each part lights up for how well it fits the package.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-5 md:px-6">
      <div className="flex flex-col gap-2">
        {ev.outcome === "outside-scope" || togo === 0 ? (
          <OutcomeBanner outcome={ev.outcome} pendingGovernance={ev.pendingGovernance} compact />
        ) : (
          <div className="rounded-v-xl border border-v-line bg-white px-4 py-3.5">
            <p className="text-[15px] font-semibold">Still working it out</p>
            <p className="text-[12.5px] text-v-body">{togo} {togo === 1 ? "question" : "questions"} to go before I give a view. Anything outside the package shows up straight away.</p>
          </div>
        )}
        {ev.outcome === "outside-scope" && togo > 0 ? <p className="text-[12px] text-v-muted">This is already clear. You can keep going to see the whole picture.</p> : null}
      </div>

      {canUndo ? (
        <button type="button" onClick={onUndo} className="inline-flex w-fit items-center gap-1.5 rounded-v-md border border-v-line bg-white px-3 py-1.5 text-[12.5px] font-medium text-v-body hover:border-v-accent">
          <RotateCcw className="size-3.5" aria-hidden /> Undo the last change
        </button>
      ) : null}

      {whatIfs.length > 0 && ev.outcome !== "suitable" ? (
        <section aria-labelledby="whatif-h" className="flex flex-col gap-3">
          <div>
            <h2 id="whatif-h" className="text-[15px] font-semibold">What would make this fit</h2>
            <p className="text-[12.5px] text-v-body">Each of these was re-checked against the package. Try one and watch the blueprint change.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {whatIfs.map((w) => (
              <li key={w.id} className="flex flex-col gap-2 rounded-v-xl border border-v-line bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold">{w.label}</p>
                  <p className="text-[12px] leading-snug text-v-body">{w.detail}</p>
                  <p className="mt-1 text-[11.5px] text-v-muted">Result after: {OUTCOME_LABEL[w.outcome]}{w.remaining ? `. ${w.remaining} ${w.remaining === 1 ? "item" : "items"} left to settle` : ""}</p>
                </div>
                <button type="button" onClick={() => onTry(w)} className="shrink-0 rounded-v-md bg-v-accent px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-v-accent-deep">Try this</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="flow-h" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="flow-h" className="text-[15px] font-semibold">The call, step by step</h2>
          <span className="text-[11.5px] text-v-muted">Select a step to see why it is coloured that way</span>
        </div>
        <div className="rounded-v-xl border border-v-line p-4" style={{ backgroundImage: "radial-gradient(var(--v-line) 1px, transparent 1px)", backgroundSize: "18px 18px", backgroundColor: "var(--v-surface-sunk)" }}>
          <ol className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(158px,1fr))]" aria-label="Call flow, in order">
            <AnimatePresence initial={false}>
              {flow.main.map((n, i) => (
                <li key={n.id} className="flex">
                  <Node n={n} index={i + 1} selected={picked === n.id} onPick={() => setPicked(picked === n.id ? null : n.id)} />
                </li>
              ))}
            </AnimatePresence>
          </ol>
          <div className="mt-4 border-t border-dashed border-v-line-strong pt-3">
            <p className="mb-2 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">
              <CornerDownRight className="size-3" aria-hidden /> When it goes off the path
            </p>
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(158px,1fr))]" aria-label="Off the path">
              <AnimatePresence initial={false}>
                {flow.branches.map((n) => (
                  <li key={n.id} className="flex">
                    <Node n={n} selected={picked === n.id} onPick={() => setPicked(picked === n.id ? null : n.id)} />
                  </li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
          <div className="mt-4 border-t border-dashed border-v-line-strong pt-3">
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Underneath it all</p>
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(158px,1fr))]" aria-label="Underneath">
              {flow.base.map((n) => (
                <li key={n.id} className="flex">
                  <Node n={n} selected={picked === n.id} onPick={() => setPicked(picked === n.id ? null : n.id)} />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div aria-live="polite" className="min-h-[44px]">
          {pickedNode ? (
            <p className="rounded-v-lg border border-v-line bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-v-body">
              <span className="font-semibold text-v-fg">{pickedNode.title}.</span> {pickedNode.note ?? STATUS[pickedNode.status].label + "."}
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="fit-h" className="flex flex-col gap-3">
        <h2 id="fit-h" className="text-[15px] font-semibold">Fit against the package, one dimension at a time</h2>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {ev.dimensions.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 text-[12.5px]" title={d.consequence}>
              <motion.span layout key={d.result} initial={{ scale: 0.4 }} animate={{ scale: 1 }} className={`size-2.5 shrink-0 rounded-full ${RESULT_DOT[d.result]}`} aria-hidden />
              <span className={d.result === "na" ? "text-v-disabled" : "text-v-fg"}>{d.label}</span>
              <span className="ml-auto text-[11px] text-v-muted">{d.result === "fit" ? "Fits" : d.result === "blocked" ? "Outside" : d.result === "review" ? "Review" : d.result === "conditional" ? "Conditions" : d.result === "na" ? "n/a" : "Open"}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="cost-h" className="rounded-v-xl border border-v-line bg-white p-4">
          <h2 id="cost-h" className="text-[15px] font-semibold">Cost so far</h2>
          <p className="mt-2 text-[28px] font-semibold tabular-nums tracking-tight" aria-live="polite">{inr(Math.round(shown))}</p>
          <p className="text-[12px] leading-relaxed text-v-body">{c.totalIsComplete ? "Indicative total from documented rates." : "Known costs only. Usage is not included until the model type and minutes are known."}</p>
          <button type="button" onClick={onOpenHandover} className="mt-2 text-[12.5px] font-semibold text-v-accent hover:underline">Adjust the estimate</button>
        </section>
        <section aria-labelledby="bring-h" className="rounded-v-xl border border-v-line bg-white p-4">
          <h2 id="bring-h" className="text-[15px] font-semibold">What you bring</h2>
          <p className="mt-2 text-[13px] text-v-body"><span className="text-[22px] font-semibold tabular-nums text-v-fg">{ready}</span> of {applicable.length} in hand</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-v-line" role="progressbar" aria-valuemin={0} aria-valuemax={applicable.length} aria-valuenow={ready} aria-label="Items in hand">
            <motion.div className="h-full rounded-full bg-v-accent" initial={false} animate={{ width: `${applicable.length ? (ready / applicable.length) * 100 : 0}%` }} />
          </div>
          <ul className="mt-3 flex flex-col gap-1 text-[12px] text-v-body">
            {toDo.map((i) => (
              <li key={i.id} className="truncate" title={i.detail}>• {i.label}</li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-[11.5px] text-v-muted">{OUTCOME_LABEL[ev.outcome]}. Built from fixed rules over your answers and the package document, not from a guess.</p>
    </div>
  );
}
