import type { Metadata } from "next";
import { Container, AvailabilityPill, Notice, PageIntro, Section } from "@/components/adopt/ui";
import { CAPABILITIES } from "@/lib/adopt/capabilities";
import { PLATFORM_LAYERS, PLATINUM_INCLUDES } from "@/lib/adopt/icp";

export const metadata: Metadata = { title: "What the platform includes" };

export default function PlatformPage() {
  const groups = Array.from(new Set(CAPABILITIES.map((c) => c.layer)));
  return (
    <Container>
      <PageIntro eyebrow="Platform" title="What sits underneath every application">
        <p>
          The five applications and three packages are all built on the same platform. This page shows its six layers
          and, plainly, what is available today and what is still being completed.
        </p>
      </PageIntro>

      <Section id="layers" title="Six layers" intro="From the citizen's call down to running it in production.">
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_LAYERS.map((l, i) => (
            <li key={l.id} className="flex flex-col gap-3 rounded-v-xl border border-v-line bg-v-panel p-5 shadow-[var(--v-shadow-card)]">
              <div className="flex items-center gap-2.5">
                <span className="flex size-6 items-center justify-center rounded-full bg-v-fg font-mono text-[10.5px] text-white">{i + 1}</span>
                <h3 className="text-[16px] font-semibold tracking-tight">{l.name}</h3>
              </div>
              <p className="text-[12.5px] text-v-muted">{l.question}</p>
              <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-v-body">
                {l.items.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="status"
        title="What is available today"
        intro="Two sources are shown side by side: what the ICP says, and what a check of the repository on 5 October 2026 found. Where they differ, treat it as something to confirm."
        className="border-t border-v-line"
      >
        <Notice tone="warning" title="Several things the ICP calls mandatory are not complete yet">
          Production SIP, calling your own APIs, human handoff with context, workflow orchestration, automated agent
          testing, retention controls and usage metering are all listed as priority gaps. Applications that depend on
          them say so on their own pages.
        </Notice>
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[.14em] text-v-muted">{g}</h3>
            <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
              {CAPABILITIES.filter((c) => c.layer === g).map((c) => (
                <li key={c.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{c.label}</p>
                    <p className="text-[12.5px] leading-relaxed text-v-muted">
                      <span className="text-v-body">ICP:</span> {c.icpSays}
                      {c.priority ? ` (${c.priority})` : ""}
                    </p>
                    {c.repoNote ? (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-v-muted">
                        <span className="text-v-body">Repository check:</span> {c.repoNote}
                      </p>
                    ) : null}
                  </div>
                  <AvailabilityPill value={c.availability} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section id="includes" title="The full Platinum scope" intro="The ICP describes the complete platform like this. It is the destination, not a statement of what is finished." className="border-t border-v-line">
        <dl className="grid gap-x-10 gap-y-4 md:grid-cols-2">
          {PLATINUM_INCLUDES.map((c) => (
            <div key={c.area} className="border-b border-v-hairline pb-3">
              <dt className="text-sm font-semibold">{c.area}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-v-body">{c.items}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </Container>
  );
}
