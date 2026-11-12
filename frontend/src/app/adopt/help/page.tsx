import type { Metadata } from "next";
import Link from "next/link";
import { Container, LinkButton, Notice, PageIntro, Section } from "@/components/adopt/ui";

export const metadata: Metadata = { title: "Help and support" };

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Does this call anyone or connect to our systems?",
    a: "No. Everything here runs in your browser. The conversation tests are scripted walk-throughs, the operations figures are demonstration data, and the deployment rehearsal only checks your own setup. Nothing is called, connected or put live.",
  },
  {
    q: "Where are my answers kept?",
    a: "In this browser's local storage, on this device only. Nothing is sent to a server. If you clear your browser data or use the start over link in the footer, they are gone. Download the recommendation or hand-over brief if you want a copy.",
  },
  {
    q: "What is the difference between the three packages?",
    a: "How far VoicERA connects into your own systems. Deploy answers questions and runs surveys from your content with no system connection. Connect adds light API links so the agent can collect structured data and check status. Orchestrate connects the full workflow, from taking a complaint to confirming it is resolved. Compare them on the Packages page.",
  },
  {
    q: "How long will it take?",
    a: "The ICP gives typical ranges: days for Deploy, weeks for Connect, weeks to months for Orchestrate. They are not commitments. Your own approvals, content review and integration access set the real timeline.",
  },
  {
    q: "What will it cost?",
    a: "This experience does not set prices. The ICP describes the structure: an annual platform licence, usage-based voice charges, one-time implementation, managed operations, and project-based custom development where needed. Ask the VoicERA team for a scoped quote.",
  },
  {
    q: "Why does it say some things are not available yet?",
    a: "Because they are not. The ICP lists several capabilities as mandatory priorities that a check of the repository found incomplete, such as production SIP and calling your own APIs. We would rather you hear it here than at launch.",
  },
  {
    q: "What does the conversation test actually do?",
    a: "It builds the agent's lines from your saved configuration and lets you choose or type replies. It recognises requests for a person, requests to repeat, requests to stop, emergencies and sensitive details, and flags gaps in your setup. It does not use speech, a language model or telephony, so it cannot tell you how the real agent will sound.",
  },
  {
    q: "What if a citizen is in danger?",
    a: "VoicERA applications are not emergency services. Every conversation sends anyone in danger to 112 and says the service cannot send help. You set the exact wording in the configuration.",
  },
  {
    q: "Which languages are supported?",
    a: "You can choose from 13 Indian languages here. Voice readiness differs by language and provider, so each language needs confirming with the implementation team before launch. The demonstration itself is shown in English text.",
  },
];

const TERMS: [string, string][] = [
  ["ICP", "Ideal customer profile. The document that defines the segments, applications and packages used throughout this experience."],
  ["API", "A documented way for one program to read from or write to another, such as your grievance system."],
  ["Webhook", "A message one system sends to another when something happens."],
  ["SLA", "The response time you promise for a type of request."],
  ["Handoff", "Passing a caller from the agent to a person."],
  ["SIP", "A standard way to connect voice calls over the internet to a telephone network. Government telephony often requires it."],
  ["RBAC", "Role-based access control. Who may see and change what."],
  ["Retention", "How long recordings and transcripts are kept before they are deleted."],
];

export default function HelpPage() {
  return (
    <Container narrow>
      <PageIntro eyebrow="Help and support" title="Questions people ask first">
        <p>Plain answers about what this experience is, what it does not do, and where to go next.</p>
      </PageIntro>

      <Section id="faq" title="Frequently asked">
        <div className="divide-y divide-v-line rounded-v-xl border border-v-line bg-v-panel">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[14.5px] font-semibold">
                {f.q}
                <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-[.12em] text-v-accent group-open:hidden">Open</span>
                <span className="mt-0.5 hidden shrink-0 font-mono text-[10px] uppercase tracking-[.12em] text-v-accent group-open:inline">Close</span>
              </summary>
              <p className="mt-2.5 text-[14px] leading-relaxed text-v-body">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section id="glossary" title="Plain-language glossary" className="border-t border-v-line">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[110px_1fr]">
          {TERMS.map(([t, d]) => (
            <div key={t} className="contents">
              <dt className="text-sm font-semibold">{t}</dt>
              <dd className="text-[13.5px] leading-relaxed text-v-body">{d}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="docs" title="Where to read more" className="border-t border-v-line">
        <ul className="flex flex-col gap-2 text-[14px]">
          <li><Link href="/adopt/platform" className="font-semibold text-v-accent hover:underline">What the platform includes</Link>, with what is and is not available today</li>
          <li><Link href="/adopt/packages" className="font-semibold text-v-accent hover:underline">Package comparison</Link>, from the adopter&apos;s side</li>
          <li><Link href="/adopt/applications" className="font-semibold text-v-accent hover:underline">Application catalogue</Link>, with the citizen journey for each</li>
          <li><Link href="/adopt/workspace/readiness" className="font-semibold text-v-accent hover:underline">Readiness</Link>, to download a hand-over brief</li>
          <li>
            <a href="https://voicera.mintlify.app/docs/guides" target="_blank" rel="noopener noreferrer" className="font-semibold text-v-accent hover:underline">
              VoicERA platform guides<span className="sr-only"> (opens in a new tab)</span>
            </a>
            , the product documentation used by the console
          </li>
        </ul>
      </Section>

      <Section id="support" title="Talking to the VoicERA team" className="border-t border-v-line">
        <p className="max-w-[60ch] text-[14px] leading-relaxed text-v-body">
          Scoping, pricing and implementation are handled by the VoicERA team. Download your recommendation or
          hand-over brief first so the conversation starts from your actual answers.
        </p>
        <Notice tone="warning" title="Contact details are not set in this build">
          There is no support address or phone number in this experience yet, and we have not made one up. Use the
          VoicERA website for now. Which contact route to show here is an open decision.
        </Notice>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://voicera.world"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-v-md border border-v-line-strong bg-white px-[17px] py-[11px] text-[13px] font-semibold text-v-fg hover:border-v-fg hover:bg-v-fg hover:text-white"
          >
            Open voicera.world
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <LinkButton href="/adopt/select/result" variant="ghost">View my recommendation</LinkButton>
        </div>
      </Section>
    </Container>
  );
}
