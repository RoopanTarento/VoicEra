"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { VoiceWave } from "@/components/try/VoiceWave";
import {
  buildTryAgent,
  prepareTryCall,
  registerTryCall,
  type TryAgent,
  type TryPrepared,
  type TryStack,
} from "@/lib/api/try-agent";

export interface CreatedAgent {
  agent: TryAgent;
  prepared: TryPrepared;
  callId: string;
}

/** Shown while the agent is written and its test call is set up; moves on by itself. */
export function Creating({
  schemeIds,
  language,
  languageName,
  onDone,
  onBack,
}: {
  schemeIds: string[];
  language: string;
  languageName: string;
  onDone: (created: CreatedAgent) => void;
  onBack: () => void;
}) {
  const [done, setDone] = useState(0);
  const [stack, setStack] = useState<TryStack | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const finish = useRef(onDone);
  useEffect(() => {
    finish.current = onDone;
  }, [onDone]);

  const steps = [
    "Writing the greeting and script",
    "Checking scheme facts against official sources",
    `Setting up the ${languageName} voice`,
    "Getting the test call ready",
  ];

  useEffect(() => {
    let cancelled = false;
    const step = (n: number) => !cancelled && setDone(n);
    (async () => {
      try {
        const agent = await buildTryAgent(schemeIds, language);
        if (cancelled) return;
        step(1);
        if (agent.stack) setStack(agent.stack);
        // The scheme facts come with the agent (built-in packs checked against
        // official sources); this step confirms they're attached.
        await new Promise((r) => setTimeout(r, 450));
        step(2);
        if (!agent.stack) throw new Error(agent.stack_error || `Test calls in ${languageName} aren't available yet.`);
        const prepared = await prepareTryCall(schemeIds, language, agent.greeting);
        if (cancelled) return;
        setStack(prepared.stack);
        step(3);
        const { call_id } = await registerTryCall(prepared.agent_id, prepared.preview_token);
        if (cancelled) return;
        step(4);
        await new Promise((r) => setTimeout(r, 500));
        if (!cancelled) finish.current({ agent, prepared, callId: call_id });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schemeIds, language, languageName, attempt]);

  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-col items-center px-4 pb-16 pt-14 text-center sm:px-6 animate-v-rise">
      {/* Ripples and moving voice bars while it works; a check when it's done. */}
      <span className="relative flex size-[96px] items-center justify-center">
        {!error && done < steps.length ? (
          <>
            <span className="absolute inset-0 rounded-full bg-v-pale animate-v-pulse motion-reduce:animate-none" />
            <span className="absolute inset-0 rounded-full bg-v-pale animate-v-pulse [animation-delay:0.8s] motion-reduce:animate-none" />
          </>
        ) : null}
        <span className="relative flex size-[96px] items-center justify-center rounded-full bg-v-pale">
          {done >= steps.length ? (
            <span className="flex size-12 items-center justify-center rounded-full bg-v-accent text-white animate-v-pop">
              <Check className="size-6" strokeWidth={2.6} />
            </span>
          ) : (
            <VoiceWave bars={5} height={38} barWidth={5} gap={5} className="bg-v-fg" paused={Boolean(error)} />
          )}
        </span>
      </span>
      <h1 className="m-0 mt-6 text-[30px] font-semibold tracking-tight sm:text-[34px]">Creating your agent</h1>
      <p className="m-0 mt-1.5 text-[15px] font-light text-v-muted-2">About 20 seconds.</p>

      <ol className="relative m-0 mt-8 flex w-full list-none flex-col gap-4 overflow-hidden rounded-v-xl border border-v-line bg-white px-6 py-5 text-left">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-v-accent transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${done / steps.length})` }}
        />
        {steps.map((label, i) => {
          const state = i < done ? "done" : i === done && !error ? "active" : "waiting";
          return (
            <li key={label} className="flex items-center gap-3 text-[15px]">
              <span className="flex size-5 shrink-0 items-center justify-center">
                {state === "done" ? (
                  <Check className="size-5 text-v-fg animate-v-pop" strokeWidth={2.4} />
                ) : state === "active" ? (
                  <Spinner light={false} />
                ) : (
                  <span className="size-[18px] rounded-full border-2 border-v-line-strong" />
                )}
              </span>
              <span className={state === "active" ? "font-semibold text-v-fg" : state === "done" ? "text-v-fg" : "text-v-muted"}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <div role="alert" className="mt-4 flex w-full flex-col items-start gap-3 rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-left text-[13.5px] text-v-danger">
          {error}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setError("");
                setDone(0);
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onBack}>
              Change language
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-8 flex w-full items-center justify-between gap-3">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">Runs on a fixed stack</span>
        <span className="text-[13px] text-v-muted">Change it after you sign in</span>
      </div>
      <div className="mt-3 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-3">
        {(
          [
            ["Listens with", stack?.stt],
            ["Thinks with", stack?.llm],
            ["Speaks with", stack?.tts],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 rounded-v-md bg-v-soft px-4 py-3">
            <span className="text-[12.5px] text-v-muted-2">{label}</span>
            <span className="break-words text-[14px] font-semibold leading-snug text-v-fg">{value ?? "…"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
