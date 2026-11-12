"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, RotateCcw, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  chooseOption,
  choicesFor,
  coverage,
  sayFreeText,
  startRun,
  type Msg,
  type RunState,
  type SimContext,
} from "@/lib/adopt/simulate";
import type { ScenarioDef } from "@/lib/adopt/types";

function MsgView({ m, large }: { m: Msg; large: boolean }) {
  const size = large ? "text-[16px]" : "text-[13.5px]";
  if (m.who === "note") {
    return <p className="mx-auto max-w-[44ch] rounded-v-md bg-v-track px-3 py-1.5 text-center text-[11.5px] leading-snug text-v-muted">{m.text}</p>;
  }
  const agent = m.who === "agent";
  const tone =
    m.tone === "emergency"
      ? "border-v-danger-line bg-v-danger-pale text-v-danger-deep"
      : m.tone === "warning"
        ? "border-v-warning/30 bg-v-warn-tint text-v-warn-ink"
        : agent
          ? "border-v-line bg-white text-v-fg"
          : "border-v-accent bg-v-accent text-white";
  return (
    <div className={`flex ${agent ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[88%]">
        <p className={`mb-1 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted ${agent ? "" : "text-right"}`}>
          {agent ? "Agent" : "Citizen"}
        </p>
        <p className={`rounded-v-lg border px-3.5 py-2.5 leading-relaxed ${size} ${agent ? "rounded-tl-sm" : "rounded-tr-sm"} ${tone}`}>
          {m.text}
        </p>
      </div>
    </div>
  );
}

export interface RunnerProps {
  ctx: SimContext;
  scenario: ScenarioDef;
  mode: "adopter" | "citizen";
  /** Called whenever the run changes, so the workspace can keep results. */
  onRun?: (run: RunState) => void;
  /** Called when the person restarts, so results can be reset. */
  onRestart?: () => void;
  large?: boolean;
}

export function ScenarioRunner({ ctx, scenario, mode, onRun, onRestart, large = false }: RunnerProps) {
  const [run, setRun] = useState<RunState>(() => startRun(ctx, scenario));
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.transcript.length]);

  const choices = useMemo(() => choicesFor(ctx, scenario, run), [ctx, scenario, run]);
  const { seen, missed } = coverage(scenario, run);

  function apply(next: RunState) {
    setRun(next);
    onRun?.(next);
  }

  function restart() {
    const fresh = startRun(ctx, scenario);
    setText("");
    onRestart?.();
    setRun(fresh);
    onRun?.(fresh);
  }

  function submitText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || run.ended) return;
    apply(sayFreeText(ctx, scenario, run, text));
    setText("");
  }

  const converse = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        tabIndex={0}
        className={`flex flex-col gap-3 overflow-y-auto px-4 py-4 ${mode === "citizen" ? "min-h-0 flex-1" : "max-h-[460px] min-h-[260px] rounded-v-lg border border-v-line bg-v-surface-sunk"}`}
      >
        {run.transcript.map((m) => (
          <MsgView key={m.id} m={m} large={large} />
        ))}
      </div>

      <div className={`flex flex-col gap-3 ${mode === "citizen" ? "border-t border-v-line bg-white p-3" : "pt-4"}`}>
        {run.ended ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-v-lg border border-v-line bg-v-surface-sunk px-4 py-3">
            <p className="text-[13px] text-v-body">
              {run.endedBy === "emergency"
                ? "The agent sent the caller elsewhere because someone may be in danger."
                : run.endedBy === "handoff"
                  ? "The conversation moved to a person. In this demonstration nothing is transferred."
                  : "The conversation has ended."}
            </p>
            <Button variant="outline" size="sm" onClick={restart}>
              <RotateCcw className="size-3.5" aria-hidden /> Start again
            </Button>
          </div>
        ) : (
          <>
            {choices.length > 0 ? (
              <div className="flex flex-col gap-2" role="group" aria-label="Suggested replies">
                {choices.map((c) => (
                  <button
                    key={c.index}
                    type="button"
                    onClick={() => apply(chooseOption(ctx, scenario, run, c.index))}
                    className={`rounded-v-lg border border-v-line-strong bg-white px-3.5 text-left font-medium text-v-fg transition-colors hover:border-v-accent hover:bg-v-pale focus-visible:border-v-accent ${
                      large ? "min-h-[52px] py-3 text-[15.5px]" : "min-h-[44px] py-2.5 text-[13.5px]"
                    }`}
                  >
                    {c.text}
                  </button>
                ))}
              </div>
            ) : null}
            <form onSubmit={submitText} className="flex items-center gap-2">
              <label htmlFor={`say-${mode}-${scenario.id}`} className="sr-only">
                Type your own reply
              </label>
              <input
                id={`say-${mode}-${scenario.id}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={200}
                autoComplete="off"
                placeholder="Or type your own reply"
                className={`min-w-0 flex-1 rounded-v-lg border border-v-line-strong bg-white px-3.5 text-v-fg placeholder:text-v-dim focus:border-v-accent ${large ? "py-3 text-[15.5px]" : "py-2.5 text-[13.5px]"}`}
              />
              <Button type="submit" size="md" disabled={!text.trim()} aria-label="Send reply">
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => apply(sayFreeText(ctx, scenario, run, "please repeat that"))}
                className="inline-flex items-center gap-1.5 rounded-v-md border border-v-line px-3 py-2 text-[12.5px] text-v-body hover:bg-v-soft"
              >
                <RotateCcw className="size-3.5" aria-hidden /> Repeat that
              </button>
              <button
                type="button"
                onClick={() => apply(sayFreeText(ctx, scenario, run, "I want to speak to a person"))}
                className="inline-flex items-center gap-1.5 rounded-v-md border border-v-line px-3 py-2 text-[12.5px] text-v-body hover:bg-v-soft"
              >
                <UserRound className="size-3.5" aria-hidden /> Speak to a person
              </button>
              {mode === "adopter" ? (
                <button type="button" onClick={restart} className="ml-auto text-[12.5px] text-v-muted underline-offset-2 hover:underline">
                  Restart
                </button>
              ) : null}
            </div>
            {mode === "citizen" ? (
              <p className="text-[11.5px] leading-snug text-v-muted">
                This is a demonstration. Please do not type real personal details, bank details or codes.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  if (mode === "citizen") return converse;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div>{converse}</div>
      <aside aria-label="What this run showed" className="flex flex-col gap-5">
        <div>
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Behaviours to confirm</p>
          <ul className="flex flex-col gap-2">
            {scenario.expects.map((e) => {
              const ok = seen.includes(e);
              return (
                <li key={e} className="flex items-start gap-2 text-[13px] leading-snug">
                  <span
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-v-ok text-white" : "border border-v-line-strong bg-white"}`}
                    aria-hidden
                  >
                    {ok ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  <span className={ok ? "text-v-fg" : "text-v-muted"}>
                    {e}
                    <span className="sr-only">{ok ? " (seen)" : " (not yet seen)"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {run.ended && missed.length > 0 ? (
            <p className="mt-2 text-[12px] text-v-muted">
              {missed.length} not seen on this path. Restart and take a different route to cover them.
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Gaps found in your setup</p>
          {run.gaps.length === 0 ? (
            <p className="text-[13px] text-v-muted">None so far.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {run.gaps.map((g) => (
                <li key={g} className="flex items-start gap-2 rounded-v-md border border-v-warning/30 bg-v-warn-tint px-3 py-2 text-[12.5px] leading-snug text-v-warn-ink">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {g}
                </li>
              ))}
            </ul>
          )}
        </div>

        {run.actions.length > 0 ? (
          <div>
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">System steps described, not performed</p>
            <ul className="flex flex-col gap-1.5 text-[12.5px] text-v-body">
              {run.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

/** A simple phone outline for the citizen view. Purely visual. */
export function PhoneFrame({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="mx-auto flex h-[min(720px,calc(100dvh-170px))] min-h-[520px] w-full max-w-[400px] flex-col overflow-hidden rounded-[28px] border-[6px] border-v-fg bg-v-surface-sunk shadow-[0_18px_40px_-24px_rgba(20,22,26,0.5)]">
      <div className="flex items-center justify-between bg-v-fg px-5 pb-2.5 pt-3 text-white">
        <span className="min-w-0 truncate text-[13px] font-medium">{title}</span>
        <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[.14em] text-white/70">
          <span className="size-1.5 rounded-full bg-v-warning" aria-hidden /> Demo
        </span>
      </div>
      {children}
    </div>
  );
}
