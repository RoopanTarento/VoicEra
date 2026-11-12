import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BulletList, Container, Notice, PageIntro, Panel, Section } from "@/components/adopt/ui";
import { APPLICATIONS } from "@/lib/adopt/applications";

export const metadata: Metadata = { title: "Citizen view" };

export default function CitizenIndexPage() {
  return (
    <Container>
      <PageIntro eyebrow="Citizen view" title="Hear it the way a citizen would">
        <p>
          Before you configure anything, try each application as the person on the phone. These are text
          demonstrations of the conversation, designed to show how the agent handles choices, mistakes and requests
          for a person.
        </p>
      </PageIntro>

      <Section id="journeys" title="Choose an application">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {APPLICATIONS.map((a) => (
            <Link
              key={a.id}
              href={`/adopt/citizen/${a.id}`}
              className="group flex h-full flex-col gap-2 rounded-v-xl border border-v-line bg-v-panel p-5 shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent"
            >
              <h3 className="text-[16px] font-semibold tracking-tight">{a.name}</h3>
              <p className="text-[13.5px] leading-relaxed text-v-body">{a.scenarios[0].situation}</p>
              <p className="mt-auto flex items-center justify-between border-t border-v-hairline pt-3 text-[12px] text-v-muted">
                <span>{a.scenarios.length} situations to try</span>
                <span className="inline-flex items-center gap-1 font-semibold text-v-accent">
                  Open <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </p>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        id="principles"
        title="What every citizen conversation is built to do"
        className="border-t border-v-line"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Panel>
            <h3 className="mb-3 text-[15px] font-semibold">Looking after the citizen</h3>
            <BulletList
              items={[
                "Say it is an automated assistant, and say whether the call is recorded, before collecting anything",
                "Offer a choice of language at the start",
                "Let the citizen ask for a person at any moment",
                "Send anyone in danger to 112, and say this service cannot send help",
                "Stop calling when asked to",
              ]}
            />
          </Panel>
          <Panel>
            <h3 className="mb-3 text-[15px] font-semibold">Keeping data small</h3>
            <BulletList
              items={[
                "Ask only for what the task needs",
                "Never ask for identity numbers, passwords, bank details or one-time codes",
                "Ask permission before looking up a person's record",
                "Do not guess when something cannot be found",
                "Show a citizen only their own information",
              ]}
            />
          </Panel>
        </div>
        <Notice tone="demo">
          Please do not type real personal details into the demonstration. It does not store or send anything beyond
          this browser.
        </Notice>
      </Section>
    </Container>
  );
}
