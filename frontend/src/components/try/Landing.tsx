"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type { DemoTemplate } from "@/lib/api/try-agent";

const DOCS_URL = "https://voicera.mintlify.app/docs/guides";

/** No-login landing: describe the agent (the router picks the template), or start from one of the six templates. */
export function Landing({
  templates,
  description,
  onDescription,
  onBuild,
  onTemplate,
  routing,
  notice,
}: {
  templates: DemoTemplate[];
  description: string;
  onDescription: (text: string) => void;
  onBuild: () => void;
  onTemplate: (templateId: string) => void;
  routing: boolean;
  notice: string;
}) {
  const [focused, setFocused] = useState(false);
  const footer = [
    { label: "Docs", href: DOCS_URL, external: true },
    { label: "Privacy", href: "/privacy", external: false },
    { label: "Terms", href: "/terms", external: false },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-4 pb-10 pt-14 sm:px-6 sm:pt-20 animate-v-rise">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="m-0 text-[34px] font-semibold leading-[1.1] tracking-tight sm:text-[52px]">
            Build a voice agent for any public service.
            <br />
            Talk to it in a minute.
          </h1>
          <p className="m-0 max-w-[56ch] text-[15.5px] font-light leading-relaxed text-v-muted-2 sm:text-[17px]">
            No sign-up. Pick what it should do, answer three questions, and try a call in your browser.
          </p>
        </div>

        <form
          className={`mt-10 flex flex-col gap-3 rounded-[20px] border bg-white px-5 pb-4 pt-4 transition-colors sm:px-6 ${
            focused ? "border-v-accent" : "border-v-line"
          }`}
          onSubmit={(e) => {
            e.preventDefault();
            if (description.trim() && !routing) onBuild();
          }}
        >
          <label htmlFor="describe" className="font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
            Describe your agent
          </label>
          <textarea
            id="describe"
            rows={2}
            maxLength={600}
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (description.trim() && !routing) onBuild();
              }
            }}
            placeholder="e.g. Answer questions about new electricity connections in Kannada, or remind mothers about their child's next vaccination"
            className="min-h-[84px] w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-v-faint sm:min-h-[56px]"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-v-muted">We&apos;ll match it to the right template.</span>
            <Button type="submit" disabled={!description.trim() || routing}>
              {routing ? <Spinner /> : null}
              Build agent
              {routing ? null : <ArrowRight className="size-4" strokeWidth={2} />}
            </Button>
          </div>
        </form>
        {notice ? (
          <p role="alert" className="m-0 mt-3 rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-[13.5px] text-v-danger">
            {notice}
          </p>
        ) : null}

        <div className="mt-12 flex items-center gap-4">
          <span className="shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
            Or start from a template
          </span>
          <span className="h-px flex-1 bg-v-line" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <button
              key={t.template_id}
              type="button"
              onClick={() => onTemplate(t.template_id)}
              className="flex flex-col items-start gap-2 rounded-v-xl border border-v-line bg-white p-5 text-left transition-colors hover:border-v-fg"
            >
              <Badge tone="accent">{t.job}</Badge>
              <span className="text-[18px] font-semibold leading-snug tracking-tight">{t.name}</span>
              <span className="text-[13.5px] font-light leading-relaxed text-v-muted-2">{t.description}</span>
              <span className="mt-auto w-full border-t border-v-line pt-3 text-[12.5px] leading-relaxed text-v-muted">
                {t.example_uses
                  .split(";")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 4)
                  .join(" · ")}
              </span>
            </button>
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
