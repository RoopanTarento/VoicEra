"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const DOCS_URL = "https://voicera.mintlify.app/docs/guides";

const COMING_SOON = [
  { title: "Enrolment and follow-ups", note: "e.g. enrolment help, health follow-ups" },
  { title: "Grievances and feedback", note: "e.g. grievance support, feedback surveys" },
];

/** No-login landing: describe the agent, or start from the one available template. */
export function Landing({
  description,
  onDescription,
  onBuild,
  onTemplate,
}: {
  description: string;
  onDescription: (text: string) => void;
  onBuild: () => void;
  onTemplate: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const footer = [
    { label: "Docs", href: DOCS_URL, external: true },
    { label: "Privacy", href: "/privacy", external: false },
    { label: "Terms", href: "/terms", external: false },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-[880px] flex-1 flex-col px-4 pb-10 pt-14 sm:px-6 sm:pt-20 animate-v-rise">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="m-0 text-[38px] font-semibold leading-[1.08] tracking-tight sm:text-[56px]">
            Build a voice agent.
            <br />
            Talk to it in a minute.
          </h1>
          <p className="m-0 max-w-[50ch] text-[15.5px] font-light leading-relaxed text-v-muted-2 sm:text-[17px]">
            No sign-up. Pick what it should do, choose a language, and try a call in your browser.
          </p>
        </div>

        <form
          className={`mt-10 flex flex-col gap-3 rounded-[20px] border bg-white px-5 pb-4 pt-4 transition-colors sm:px-6 ${
            focused ? "border-v-accent" : "border-v-line"
          }`}
          onSubmit={(e) => {
            e.preventDefault();
            onBuild();
          }}
        >
          <label htmlFor="describe" className="font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
            Describe your agent
          </label>
          <textarea
            id="describe"
            rows={2}
            maxLength={400}
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onBuild();
              }
            }}
            placeholder="e.g. Call farmers in Belagavi in Kannada and tell them which schemes they may qualify for"
            className="min-h-[84px] w-full resize-none sm:min-h-[56px] bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-v-faint"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-v-muted">We&apos;ll match it to the right template.</span>
            <Button type="submit">
              Build agent
              <ArrowRight className="size-4" strokeWidth={2} />
            </Button>
          </div>
        </form>

        <div className="mt-12 flex items-center gap-4">
          <span className="shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
            Or start from a template
          </span>
          <span className="h-px flex-1 bg-v-line" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={onTemplate}
            className="flex flex-col items-start gap-2 rounded-v-xl border-2 border-v-fg bg-white p-5 text-left transition-colors hover:bg-v-soft/40"
          >
            <Badge tone="accent">Available</Badge>
            <span className="text-[18px] font-semibold tracking-tight">Scheme discovery</span>
            <span className="text-[13.5px] font-light leading-relaxed text-v-muted-2">
              Finds government schemes a family may qualify for, and how to apply.
            </span>
          </button>
          {COMING_SOON.map((t) => (
            <div
              key={t.title}
              aria-disabled="true"
              className="flex flex-col items-start gap-2 rounded-v-xl border border-dashed border-v-line-strong p-5"
            >
              <Badge tone="draft">Coming soon</Badge>
              <span className="text-[18px] font-semibold tracking-tight text-v-muted-2">{t.title}</span>
              <span className="text-[13.5px] font-light leading-relaxed text-v-muted">{t.note}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="flex justify-center gap-6 pb-8 text-[13px] text-v-muted">
        {footer.map((l) => (
          <a
            key={l.label}
            href={l.href}
            {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="underline-offset-4 hover:text-v-fg hover:underline"
          >
            {l.label}
          </a>
        ))}
      </footer>
    </div>
  );
}
