"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Building2, Languages, ListChecks, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IntentCards } from "@/components/wizard/StartStep";

const STEPS = [
  { icon: Building2, title: "Pick a department", note: "Health, Pension, Farmers, Housing…" },
  { icon: ListChecks, title: "Pick its schemes", note: "One or several, from the official list" },
  { icon: BookOpen, title: "We write the agent", note: "Greeting, script and checked scheme knowledge" },
  { icon: Languages, title: "Choose a language", note: "Then talk to your agent in the browser" },
];

/** Home for an organisation with no agents yet: what a scheme agent does,
 * the six kinds, and one way in. The full wizard is still a link away. */
export function FirstAgentWelcome({ orgName, canBuild }: { orgName?: string; canBuild: boolean }) {
  const cta = canBuild ? (
    <Link href="/agent-creation">
      <Button className="!h-12 !px-6 !text-[15px]">
        <Sparkles className="size-4" strokeWidth={1.9} />
        Build your scheme discovery agent
        <ArrowRight className="size-4" strokeWidth={1.9} />
      </Button>
    </Link>
  ) : null;

  return (
    <div className="flex flex-col gap-8 animate-v-rise">
      <div className="flex flex-col gap-5 rounded-v-xl border border-v-line bg-white p-6 sm:p-8">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-v-dim">
          Welcome to VoicEra{orgName ? ` · ${orgName}` : ""}
        </span>
        <div className="flex flex-col gap-3">
          <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-.7px] text-v-fg">
            What does a scheme agent do?
          </h1>
          <p className="max-w-[68ch] text-[15px] font-light leading-relaxed text-v-muted-2">
            It calls citizens about government schemes, answers from built-in knowledge checked against official
            sources, and records how each call went. Every agent is set up for one of the six jobs below, and switches
            to another during a call when the person needs it.
          </p>
        </div>
        {cta ?? (
          <p className="text-[13px] text-v-muted">
            Your Super admin or an Admin builds the first agent. It will show up here once it&apos;s ready.
          </p>
        )}
      </div>

      <section className="flex flex-col gap-3" aria-label="The six scheme agents">
        <span className="text-xs font-semibold uppercase tracking-[.08em] text-v-muted">Six kinds of scheme agent</span>
        <IntentCards />
      </section>

      <section className="flex flex-col gap-4 rounded-v-xl border border-v-line bg-v-soft/40 p-6" aria-label="Your first agent">
        <div className="flex flex-col gap-1">
          <span className="text-[17px] font-semibold tracking-tight">Your first agent: Discovery</span>
          <span className="max-w-[70ch] text-[13.5px] font-light leading-relaxed text-v-muted">
            It asks a few short questions and explains which schemes may fit the family and how to apply. Four quick
            steps, no technical settings: we pick the best speech and AI engines for the language you choose.
          </span>
        </div>
        <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-v-md border border-v-line bg-white p-3.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-v-pale font-mono text-[12px] font-semibold text-v-accent">
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                  <s.icon className="size-3.5 text-v-accent" strokeWidth={1.9} />
                  {s.title}
                </span>
                <span className="text-[12px] font-light leading-snug text-v-muted">{s.note}</span>
              </span>
            </li>
          ))}
        </ol>
        {cta ? <div className="flex flex-wrap items-center gap-4">{cta}</div> : null}
      </section>
    </div>
  );
}
