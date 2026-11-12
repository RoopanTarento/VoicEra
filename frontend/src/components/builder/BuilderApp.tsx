"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Check, RotateCcw, Tags } from "lucide-react";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { recommend } from "@/lib/adopt/builder/profile";
import { useBuilder, type Stage } from "@/lib/adopt/builder/store";
import { CanvasStage } from "./CanvasStage";
import { CostStage } from "./CostStage";
import { DeployStage } from "./DeployStage";
import { Discover } from "./Discover";
import { Packages } from "./Packages";
import { PitchStage } from "./PitchStage";
import { ProviderPanel } from "./ProviderPanel";
import { ThemeToggle } from "./ThemeToggle";

const STAGES: { id: Stage; label: string }[] = [
  { id: "discover", label: "Discover" },
  { id: "package", label: "Package" },
  { id: "canvas", label: "Canvas" },
  { id: "cost", label: "Cost" },
  { id: "deploy", label: "Deploy" },
  { id: "pitch", label: "Pitch" },
];

export function BuilderApp() {
  const { state, hydrated, actions } = useBuilder();
  const [provider, setProvider] = useState(false);
  const [confirm, setConfirm] = useState(false);

  // Whatever the screen theme, paper is light: switch for the print and switch back.
  useEffect(() => {
    let prev: string | undefined;
    const before = () => { prev = document.documentElement.dataset.vbTheme; document.documentElement.dataset.vbTheme = "light"; };
    const after = () => { if (prev) document.documentElement.dataset.vbTheme = prev; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  if (!hydrated) {
    return <div className="flex h-full items-center justify-center"><span className="vb-eyebrow" role="status">Opening the builder</span></div>;
  }

  const p = state.profile;
  const have = {
    discover: true,
    package: p.useCases.length > 0,
    canvas: state.sel !== null,
    cost: state.sel !== null,
    deploy: state.sel !== null,
    pitch: p.useCases.length > 0,
  } satisfies Record<Stage, boolean>;
  const idx = STAGES.findIndex((s) => s.id === state.stage);
  void recommend;

  return (
    <div className="vb-unclip flex h-full min-h-0 flex-col">
      <header className="vb-noprint flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--vb-line)] px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <VoicEraMark size={22} className="text-[var(--vb-ink)]" />
          <span className="text-[15px] font-semibold tracking-tight">VoicERA</span>
          <span className="hidden h-4 w-px bg-[var(--vb-line-strong)] 2xl:block" aria-hidden />
          <span className="vb-muted hidden whitespace-nowrap text-[13.5px] 2xl:block">Package Builder</span>
        </div>

        <div className="hidden min-w-0 lg:block"><StageNav stage={state.stage} have={have} idx={idx} onGo={actions.goto} /></div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          <button type="button" onClick={() => setProvider(true)} className="vb-btn vb-btn-ghost vb-btn-sm" aria-label="Provider view: price book"><Tags className="size-3.5" aria-hidden /><span className="hidden md:inline">Provider view</span></button>
          {confirm ? (
            <span className="flex items-center gap-1.5 text-[13px]" role="alertdialog" aria-label="Confirm start over">
              <button type="button" className="vb-btn vb-btn-sm !bg-[var(--vb-rose)] !text-[var(--vb-on-solid)]" onClick={() => { actions.reset(); setConfirm(false); }}>Clear all</button>
              <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => setConfirm(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="vb-btn vb-btn-ghost vb-btn-sm" aria-label="Start over"><RotateCcw className="size-3.5" aria-hidden /><span className="hidden md:inline">Start over</span></button>
          )}
        </div>
      </header>
      <div className="vb-noprint shrink-0 border-b border-[var(--vb-line)] px-3 py-2 lg:hidden"><StageNav stage={state.stage} have={have} idx={idx} onGo={actions.goto} /></div>

      <main className="vb-unclip min-h-0 flex-1">
        {state.stage === "discover" ? <Discover /> : null}
        {state.stage === "package" ? <Packages /> : null}
        {state.stage === "canvas" ? <CanvasStage /> : null}
        {state.stage === "cost" ? <CostStage /> : null}
        {state.stage === "deploy" ? <DeployStage /> : null}
        {state.stage === "pitch" ? <PitchStage /> : null}
      </main>

      <AnimatePresence>{provider ? <ProviderPanel onClose={() => setProvider(false)} /> : null}</AnimatePresence>
    </div>
  );
}

function StageNav({ stage, have, idx, onGo }: { stage: Stage; have: Record<Stage, boolean>; idx: number; onGo: (s: Stage) => void }) {
  return (
    <nav aria-label="Stages" className="min-w-0">
      <ol className="flex items-center justify-between gap-0.5 lg:justify-start lg:gap-1">
        {STAGES.map((s, i) => {
          const active = s.id === stage;
          const done = i < idx && have[s.id];
          const can = have[s.id];
          return (
            <li key={s.id} className="flex items-center">
              <button type="button" disabled={!can} aria-current={active ? "step" : undefined} onClick={() => onGo(s.id)} title={can ? undefined : "Choose a package first"} className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 md:px-3 ${active ? "bg-[var(--vb-surface-3)] text-[var(--vb-ink)]" : "text-[var(--vb-body)] enabled:hover:text-[var(--vb-ink)]"}`}>
                <span className={`flex size-5 items-center justify-center rounded-full font-mono text-[10px] ${active ? "bg-[var(--vb-accent-strong)] text-white" : done ? "bg-[var(--vb-mint)] text-[var(--vb-on-solid)]" : "bg-[var(--vb-surface-3)] text-[var(--vb-muted)]"}`} aria-hidden>{done ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
                <span className={active ? "" : "hidden 2xl:inline"}>{s.label}</span>
              </button>
              {i < STAGES.length - 1 ? <span className="hidden h-px w-4 bg-[var(--vb-line-strong)] 2xl:block" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
