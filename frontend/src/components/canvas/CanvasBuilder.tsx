"use client";

import { ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/adopt/ui";
import { handoverFiles } from "@/lib/adopt/advisor/canvas";
import { useCanvas, type Step } from "@/lib/adopt/advisor/canvas-store";
import { inr } from "@/lib/adopt/advisor/cost";
import { BuildStep } from "./BuildStep";
import { CostStep } from "./CostStep";
import { LaunchStep } from "./LaunchStep";
import { PitchFlow } from "./PitchFlow";
import { derive, downloadZip } from "./parts";

const STEPS: { id: Exclude<Step, "pitch" | "about" | "plan">; n: number; label: string }[] = [
  { id: "canvas", n: 1, label: "Build" },
  { id: "cost", n: 2, label: "Cost" },
  { id: "launch", n: 3, label: "Launch" },
];

export function CanvasBuilder() {
  const { state, hydrated, actions } = useCanvas();
  if (!hydrated) return <Spinner label="Opening the canvas" />;
  // Before the builder: the pitch, the questions and the personal plan.
  if (!state.started || state.step === "pitch" || state.step === "about" || state.step === "plan") return <PitchFlow step={state.started ? "canvas" : state.step} />;

  const c = state.canvas;
  const { cost, verdict } = derive(c);
  const step = state.step as Exclude<Step, "pitch" | "about" | "plan">;
  const f = cost.fit;
  const budgetText = f.state === "none" ? "No budget set" : f.state === "short" ? "Over budget" : f.state === "fits" ? "Within budget" : "Budget check needs a model choice";
  const slug = (c.name || c.department || "voice-package").trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Steps" className="shrink-0 border-b border-v-line bg-v-panel">
        <ol className="mx-auto flex max-w-[680px] items-center gap-2 px-5 py-2.5">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <button type="button" aria-current={step === s.id ? "step" : undefined} onClick={() => actions.set({ step: s.id })} className={`flex items-center gap-2 rounded-v-lg px-2 py-1.5 text-[13.5px] font-semibold ${step === s.id ? "text-v-fg" : "text-v-muted hover:text-v-fg"}`}>
                <span className={`flex size-5 items-center justify-center rounded-full font-mono text-[10px] ${step === s.id ? "bg-v-accent text-white" : "bg-v-line text-v-body"}`} aria-hidden>{s.n}</span>{s.label}
              </button>
              {i < STEPS.length - 1 ? <span className="h-px w-6 bg-v-line-strong" aria-hidden /> : null}
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {step === "canvas" ? <BuildStep verdict={verdict} /> : null}
        {step === "cost" ? <CostStep c={c} cost={cost} signedOff={state.signedOff} /> : null}
        {step === "launch" ? <LaunchStep state={state} cost={cost} verdict={verdict} /> : null}
      </div>

      <footer className="shrink-0 border-t border-v-line bg-v-panel">
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-4 px-5 py-3">
          <div className="min-w-0" aria-live="polite">
            <p className="text-[17px] font-semibold leading-tight tabular-nums">{inr(cost.grand)} <span className="text-[12.5px] font-normal text-v-muted">{cost.grandIsComplete ? "indicative" : "known so far"}</span></p>
            <p className={`text-[12.5px] ${f.state === "short" ? "font-semibold text-v-danger" : "text-v-muted"}`}>{budgetText}</p>
          </div>
          {step === "canvas" ? <Button onClick={() => actions.set({ step: "cost" })}>Next: cost <ArrowRight className="size-3.5" aria-hidden /></Button> : null}
          {step === "cost" ? <Button onClick={() => actions.set({ step: "launch" })}>Next: launch <ArrowRight className="size-3.5" aria-hidden /></Button> : null}
          {step === "launch" ? <Button onClick={() => downloadZip(`${slug}-handover.zip`, handoverFiles(c, cost, verdict))}><Download className="size-3.5" aria-hidden /> Hand-over pack</Button> : null}
        </div>
      </footer>
    </div>
  );
}
