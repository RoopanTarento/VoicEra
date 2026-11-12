import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { SourceChips } from "@/components/adopt/advisor/ui";
import { Container, LinkButton, Notice, PageIntro, Section } from "@/components/adopt/ui";
import { FAQ, MODEL_READINESS } from "@/lib/adopt/advisor/bundle";
import { CONFIRMATION_LINE, PLATINUM, SOURCES } from "@/lib/adopt/advisor/source";

export const metadata: Metadata = { title: "Advisor FAQ and data governance" };

export default function AdvisorFaqPage() {
  return (
    <Container narrow>
      <PageIntro eyebrow="FAQ and governance" title="What the package document answers, and what it does not">
        <p>
          We answer only what the supplied package document supports. Where it is blank, we say so rather than reassure you. The answers
          to the first four security questions are blank in the document today.
        </p>
      </PageIntro>

      <Section id="faq" title="Frequently asked questions">
        <div className="divide-y divide-v-line rounded-v-xl border border-v-line bg-v-panel">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[14.5px] font-semibold">
                <span>{f.q}</span>
                <span className="mt-0.5 shrink-0">{f.a === null ? <Badge tone="warn">Not answered</Badge> : <Badge tone="live">Answered</Badge>}</span>
              </summary>
              <div className="mt-3 flex flex-col gap-2.5">
                {f.a === null ? (
                  <Notice tone="warning">{CONFIRMATION_LINE}</Notice>
                ) : (
                  <p className="text-[14px] leading-relaxed text-v-body">{f.a}</p>
                )}
                <SourceChips ids={[f.src]} />
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section id="open" title="Open items in the package document" intro="These are unresolved until verified. The advisor never fills them in for you." className="border-t border-v-line">
        <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
          {PLATINUM.unresolved.map((u) => (
            <li key={u.id} className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div>
                <p className="text-[14px] font-medium">{u.label}</p>
                <p className="text-[12px] text-v-muted">{SOURCES[u.src].label}</p>
              </div>
              <Badge tone="warn">Needs confirmation</Badge>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="models" title="Model readiness" className="border-t border-v-line">
        <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
          {MODEL_READINESS.map((m) => (
            <li key={m.label} className="flex flex-col gap-1 px-4 py-3.5">
              <p className="text-[14px] font-semibold">{m.label}</p>
              <p className="text-[13px] leading-relaxed text-v-body">{m.value}</p>
            </li>
          ))}
        </ul>
        <p className="text-[12.5px] text-v-muted">No Voice Arena scores are shown, because the report has not been supplied.</p>
      </Section>

      <Section id="next" title="Where to go next" className="border-t border-v-line">
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/adopt/advisor" arrow>Start the advisor</LinkButton>
          <LinkButton href="/adopt/advisor/result" variant="outline">My recommendation</LinkButton>
          <Link href="/adopt/help" className="inline-flex items-center px-3 py-[11px] text-[13px] font-semibold text-v-accent hover:underline">General help</Link>
        </div>
      </Section>
    </Container>
  );
}
