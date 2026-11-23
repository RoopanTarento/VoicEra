"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { summariseTryCall, type TryCallSummary, type TryScheme } from "@/lib/api/try-agent";
import type { EndedCall } from "@/components/try/LiveCall";

const LAUNCH_BENEFITS = ["Get a phone number", "Upload a contact list", "Run a campaign", "See how every call went"];

function duration(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

/** After the test call: what happened on it, and the way to launch for real. */
export function CallSummary({
  call,
  language,
  languageName,
  schemes,
  onCallAgain,
  onAnotherLanguage,
  onSignIn,
}: {
  call: EndedCall;
  language: string;
  languageName: string;
  schemes: TryScheme[];
  onCallAgain: () => void;
  onAnotherLanguage: () => void;
  onSignIn: () => void;
}) {
  const [summary, setSummary] = useState<TryCallSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    summariseTryCall(
      schemes.map((s) => s.id),
      call.transcript.map((l) => ({ role: l.role, text: l.text })),
    )
      .then((s) => !cancelled && setSummary(s))
      .catch(() => !cancelled && setSummaryError(true));
    return () => {
      cancelled = true;
    };
  }, [call, schemes]);

  const name = (id: string) => schemes.find((s) => s.id === id)?.name ?? id;
  const rows: [string, React.ReactNode, boolean][] = summary
    ? [
        ["Schemes that may fit", summary.fit.length ? summary.fit.map(name).join(", ") : "None yet", true],
        ["Also explained", summary.explained.length ? summary.explained.map(name).join(", ") : "None", false],
        ["Outcome", summary.outcome, false],
      ]
    : [];

  return (
    <section className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-12 lg:pt-14 animate-v-rise">
      <div className="flex flex-col">
        <h1 className="m-0 text-[30px] font-semibold tracking-tight sm:text-[36px]">How your test call went</h1>
        <p className="m-0 mt-1.5 text-[15px] text-v-muted-2">
          {duration(call.seconds)} · {languageName}
        </p>

        <div className="mt-7 overflow-hidden rounded-v-xl border border-v-line bg-white">
          {summary ? (
            rows.map(([label, value, strong]) => (
              <div key={label} className="flex items-baseline justify-between gap-6 border-b border-v-line px-5 py-4 last:border-b-0">
                <span className="text-[14.5px] text-v-muted-2">{label}</span>
                <span className={`text-right text-[16px] ${strong ? "font-semibold text-v-fg" : "text-v-fg"}`}>{value}</span>
              </div>
            ))
          ) : summaryError ? (
            <p className="m-0 px-5 py-4 text-[14px] text-v-muted-2">Couldn&apos;t sum up this call. The full transcript is below.</p>
          ) : (
            <p className="m-0 flex items-center gap-2 px-5 py-4 text-[14px] text-v-muted-2">
              <Spinner light={false} /> Reading the call…
            </p>
          )}
        </div>

        {call.transcript.length ? (
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
            className="mt-5 self-start text-[14px] font-semibold text-v-accent underline underline-offset-4 hover:text-v-accent-deep"
          >
            {showTranscript ? "Hide transcript" : "See full transcript"}
          </button>
        ) : null}
        {showTranscript ? (
          <ol className="m-0 mt-4 flex list-none flex-col gap-3 rounded-v-xl border border-v-line bg-white p-5">
            {call.transcript.map((l) => (
              <li key={l.key} className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-v-muted-2">{l.role === "agent" ? "Agent" : "You"}</span>
                <span lang={language} className="text-[15px] leading-relaxed">
                  {l.text}
                </span>
                {l.english ? <span className="text-[13.5px] text-v-muted-2">{l.english}</span> : null}
              </li>
            ))}
          </ol>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" onClick={onCallAgain}>
            Call again
          </Button>
          <Button variant="pill-link" onClick={onAnotherLanguage}>
            Try another language
          </Button>
        </div>
      </div>

      <aside className="flex h-fit flex-col gap-5 rounded-[24px] bg-v-fg px-7 py-8 text-white">
        <h2 className="m-0 text-[22px] font-semibold tracking-tight">Ready to call real people?</h2>
        <p className="m-0 text-[14.5px] font-light leading-relaxed text-white/70">
          Sign in and this agent moves to your workspace, where you can:
        </p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {LAUNCH_BENEFITS.map((b) => (
            <li key={b} className="flex items-center gap-3 text-[16px]">
              <Check className="size-4 text-v-blue-soft" strokeWidth={2.6} />
              {b}
            </li>
          ))}
        </ul>
        <Button onClick={onSignIn} className="mt-1 w-full !py-3.5 !text-[15px]">
          Sign in to launch
        </Button>
        <button type="button" onClick={onSignIn} className="text-center text-[14px] text-v-blue-soft underline underline-offset-4 hover:text-white">
          New here? Create an account
        </button>
      </aside>
    </section>
  );
}
