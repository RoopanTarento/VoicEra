"use client";

import { useState } from "react";
import { Check, Circle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/adopt/ui";
import { ScenarioRunner } from "@/components/adopt/ScenarioRunner";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { VERIFY_ITEMS, bringList, handoverFiles, scriptLines, stagesFor, type Canvas, type CanvasCost, type CanvasVerdict, type TemplateId } from "@/lib/adopt/advisor/canvas";
import type { Readiness } from "@/lib/adopt/advisor/compose";
import { useCanvas, type CanvasState } from "@/lib/adopt/advisor/canvas-store";
import type { SimContext } from "@/lib/adopt/simulate";
import type { ApplicationId } from "@/lib/adopt/types";
import { Fold, downloadZip } from "./parts";

const SAMPLE_APP: Partial<Record<TemplateId, ApplicationId>> = { grievance: "grievance", scheme: "scheme-discovery", survey: "surveys", forms: "form-filling" };

const TARGET_QUESTIONS = [
  "Can it run on our own infrastructure, or only hosted on Bhashini?",
  "If it can, which parts, and what does each need?",
  "Who operates it, and who is the data processor then?",
  "Is there a separate test environment?",
  "How are updates, backups and support handled?",
];

export function LaunchStep({ state, cost, verdict }: { state: CanvasState; cost: CanvasCost; verdict: CanvasVerdict | null }) {
  const { actions } = useCanvas();
  const c = state.canvas;
  const stages = stagesFor({ canvas: c, verdict, cost, verify: state.verify, signedOff: state.signedOff, handedOver: state.handedOver });
  const files = handoverFiles(c, cost, verdict);
  const slug = (c.name || c.department || "voice-package").trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const bring = bringList(c).filter((b) => b.applies);
  const inHand = bring.filter((b) => c.ready[b.id] === "yes").length;
  const ticked = VERIFY_ITEMS.filter((x) => state.verify[x.id]).length;
  const appId = SAMPLE_APP[c.template];
  const script = scriptLines(c);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-8 px-5 py-8 md:py-10">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[32px]">Get it live</h1>
        <p className="mt-1 text-[14.5px] leading-relaxed text-v-body">Seven steps from here to launch. This page does not deploy anything: the VoicEra team sets it up, hosted on Bhashini.</p>
      </header>

      <ol className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <li key={s.id}>
            <details open={s.state === "now"} className={`group rounded-v-xl border bg-white ${s.state === "now" ? "border-v-accent shadow-[0_0_0_3px_rgba(31,78,232,0.08)]" : "border-v-line"}`}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${s.state === "done" ? "border-v-ok bg-v-ok text-white" : s.state === "now" ? "border-v-accent text-v-accent" : "border-v-line-strong text-v-disabled"}`} aria-hidden>
                  {s.state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : s.state === "now" ? <Circle className="size-2 fill-current" /> : <span className="font-mono text-[10px]">{i + 1}</span>}
                </span>
                <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug">{s.title}</span>
                <span className="shrink-0 text-[12.5px] text-v-muted">{s.state === "done" ? "Done" : s.state === "now" ? "You are here" : s.owner}</span>
              </summary>
              <div className="flex flex-col gap-2 border-t border-v-line px-4 py-3.5 pl-[52px] text-[13.5px] leading-relaxed text-v-body">
                <p>{s.plain}</p>
                {s.documented ? <p className="text-v-muted">In the package document: {s.documented}</p> : null}
                <p className="font-medium text-v-fg">{s.reason}</p>
                {s.id === "budget" && s.state === "now" ? <Button size="sm" className="w-fit" onClick={() => actions.set({ step: "cost" })}>Open cost</Button> : null}
                {s.id === "design" && s.state === "now" ? <Button size="sm" className="w-fit" onClick={() => actions.set({ step: "canvas" })}>Back to build</Button> : null}
                {s.id === "setup" && s.state === "now" ? <Button size="sm" className="w-fit" onClick={() => actions.set({ handedOver: true })}>I have handed the pack over</Button> : null}
                {s.id === "setup" && state.handedOver ? <button type="button" className="w-fit text-[13px] font-semibold text-v-accent hover:underline" onClick={() => actions.set({ handedOver: false })}>Undo</button> : null}
              </div>
            </details>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3">
        <Fold title="Hand-over pack" summary="What the VoicEra team needs to start.">
          <p className="text-[14px] leading-relaxed text-v-body">{files.map((f) => f.name).join(", ")}.</p>
          <p className="mt-1 text-[12.5px] text-v-muted">Not an order and not a quote. Model names are left open because the document lists samples only.</p>
          <Button className="mt-4" onClick={() => downloadZip(`${slug || "voice-package"}-handover.zip`, files)}>Download the pack</Button>
        </Fold>

        <Fold title="What you bring" summary={`${inHand} of ${bring.length} in hand`}>
          <ul className="flex flex-col gap-4">
            {bring.map((b) => (
              <li key={b.id}>
                <p className="text-[14.5px] font-medium">{b.label}</p>
                <p className="text-[12.5px] text-v-muted">{b.detail}</p>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={b.label}>
                  {(["yes", "no", "unknown"] as Readiness[]).map((v) => (
                    <button key={v} type="button" aria-pressed={c.ready[b.id] === v} onClick={() => actions.ready(b.id, v)} className={`rounded-v-lg border px-3 py-1.5 text-[13px] font-medium ${c.ready[b.id] === v ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>{v === "yes" ? "In hand" : v === "no" ? "Not yet" : "Not sure"}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Fold>

        <Fold title="Check before launch" summary={`${ticked} of ${VERIFY_ITEMS.length} ticked`}>
          <p className="mb-4 text-[13.5px] leading-relaxed text-v-body">Tick each one only after you have seen it on a real test call.</p>
          <ul className="flex flex-col gap-2.5">
            {VERIFY_ITEMS.map((x) => (
              <li key={x.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-v-lg border border-v-line px-3.5 py-3 has-[:checked]:border-v-accent has-[:checked]:bg-v-pale">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--v-accent)]" checked={!!state.verify[x.id]} onChange={(e) => actions.tick(x.id, e.target.checked)} />
                  <span><span className="block text-[14px] font-medium leading-snug">{x.label}</span><span className="block text-[12.5px] text-v-muted">{x.detail}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </Fold>

        <Fold title="Try a sample call" summary="A scripted text conversation. It does not test any model.">
          {appId ? <Sandbox c={c} appId={appId} /> : <p className="text-[14px] text-v-body">There is no sample conversation for this use case. Test with real calls.</p>}
          {script.length ? (
            <div className="mt-6">
              <p className="mb-2 text-[13px] font-semibold">Your script draft</p>
              <ol className="flex flex-col gap-2">
                {script.map((l) => (
                  <li key={l.moduleId} className="rounded-v-lg bg-v-surface-sunk px-3.5 py-2.5">
                    <p className="font-mono text-[10px] uppercase tracking-[.1em] text-v-muted">{l.title}</p>
                    <p className="text-[13.5px] leading-relaxed">{l.says}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </Fold>

        <Fold title="Where it runs" summary={state.target === "managed" ? "Hosted on Bhashini" : "Our own system: not documented"}>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Where it runs">
            <TargetOption on={state.target === "managed"} onSelect={() => actions.set({ target: "managed" })} title="Hosted on Bhashini" sub="As described in the package document." />
            <TargetOption on={state.target === "own"} onSelect={() => actions.set({ target: "own" })} title="Our own system or a sandbox machine" sub="Not described in the package document." />
          </div>
          {state.target === "own" ? (
            <div className="mt-4 flex flex-col gap-3">
              <Notice tone="warning" title="Needs a written answer first">Nothing in the document says it can be installed on a department machine. Ask the VoicEra and Bhashini team:</Notice>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-v-body">{TARGET_QUESTIONS.map((q) => <li key={q}>{q}</li>)}</ol>
            </div>
          ) : null}
        </Fold>
      </div>
    </div>
  );
}

function TargetOption({ on, onSelect, title, sub }: { on: boolean; onSelect: () => void; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onSelect} className={`rounded-v-lg border px-4 py-3 text-left ${on ? "border-v-accent bg-v-pale" : "border-v-line bg-white hover:border-v-line-strong"}`}>
      <span className="block text-[14.5px] font-medium">{title}</span>
      <span className="block text-[12.5px] text-v-muted">{sub}</span>
    </button>
  );
}

function Sandbox({ c, appId }: { c: Canvas; appId: ApplicationId }) {
  const app = APPLICATION_BY_ID[appId];
  const [id, setId] = useState(app.scenarios[0].id);
  const scenario = app.scenarios.find((s) => s.id === id) ?? app.scenarios[0];
  const cfg: Record<string, unknown> = JSON.parse(JSON.stringify(app.defaults));
  cfg.department = c.department.trim() || "Sample Department";
  if (c.languages.length) cfg.languages = c.languages;
  const ctx: SimContext = { app, config: cfg, integrations: {}, packageId: "deploy" };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Situation">
        {app.scenarios.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === scenario.id} onClick={() => setId(s.id)} className={`rounded-v-lg border px-3.5 py-2 text-[13px] font-medium ${s.id === scenario.id ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>{s.title}</button>
        ))}
      </div>
      <ScenarioRunner key={`${appId}-${scenario.id}`} ctx={ctx} scenario={scenario} mode="adopter" />
    </div>
  );
}
