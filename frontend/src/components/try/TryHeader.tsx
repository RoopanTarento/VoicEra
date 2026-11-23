"use client";

import { Check, Lock } from "lucide-react";
import { LogoMark } from "@/components/ui/VoicEraMark";

export type TryStep = 1 | 2 | 3;

const STEPS: { n: TryStep; label: string }[] = [
  { n: 1, label: "Set up" },
  { n: 2, label: "Try it" },
  { n: 3, label: "Launch" },
];

/** Top bar of the no-login flow: logo, the three-step progress (when inside
 * the flow) and a right-hand slot (Sign in, the call's label, or Back). */
export function TryHeader({
  step,
  right,
  onLogo,
}: {
  step?: TryStep;
  right?: React.ReactNode;
  onLogo?: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-v-line bg-white/95 backdrop-blur">
      <div className="mx-auto grid h-16 w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6">
        <button type="button" onClick={onLogo} className="flex items-center gap-2.5" aria-label="VoicEra home">
          <LogoMark size={30} />
          <span className="text-[16px] font-semibold tracking-tight">VoicEra</span>
        </button>

        {step ? (
          <nav aria-label="Progress" className="flex justify-center">
            <ol className="m-0 flex list-none items-center gap-4 p-0 sm:gap-8">
              {STEPS.map(({ n, label }) => {
                const done = n < step;
                const current = n === step;
                return (
                  <li
                    key={n}
                    aria-current={current ? "step" : undefined}
                    className={`relative flex items-center gap-1 py-1.5 text-[11.5px] font-semibold uppercase tracking-[.08em] sm:text-[12.5px] ${
                      current ? "text-v-fg" : "text-v-muted"
                    }`}
                  >
                    {n === 3 && step < 3 ? <Lock className="size-3" strokeWidth={2.2} aria-label="Locked" /> : null}
                    <span>
                      {n}
                      <span className="hidden sm:inline"> {label}</span>
                    </span>
                    {done ? <Check className="size-3.5 text-v-success" strokeWidth={2.6} aria-label="Done" /> : null}
                    {current ? <span className="absolute inset-x-0 -bottom-[3px] h-[2px] rounded-full bg-v-accent" /> : null}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : (
          <span />
        )}

        <div className="flex justify-end text-[13.5px] font-medium text-v-muted-2">{right}</div>
      </div>
    </header>
  );
}
