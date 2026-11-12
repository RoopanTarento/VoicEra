import type { Metadata } from "next";
import Link from "next/link";
import { Container, LinkButton, Notice, PageIntro, Section } from "@/components/adopt/ui";
import { PackageCompare } from "@/components/adopt/PackageCompare";
import { COMMERCIAL_COMPONENTS, PLATINUM_INCLUDES, TIMING_CAVEAT } from "@/lib/adopt/icp";

export const metadata: Metadata = { title: "Packages" };

export default function PackagesPage() {
  return (
    <Container>
      <PageIntro
        eyebrow="Packages"
        title="Deploy, Connect or Orchestrate"
        actions={<LinkButton href="/adopt/select" arrow>Find the right one for me</LinkButton>}
      >
        <p>
          The three packages are the same platform at different depths. The difference is how far VoicERA connects
          into your own systems. Start with the one that matches where you are, and move up when you are ready.
        </p>
      </PageIntro>

      <Section id="compare" title="Compared from your side" intro="Read across to compare, or read down for one package.">
        <PackageCompare />
        <Notice tone="info" title="About timings">
          {TIMING_CAVEAT}
        </Notice>
      </Section>

      <Section
        id="common"
        title="Every package includes the same platform"
        intro="The packages differ in integration depth, not in the platform underneath."
        className="border-t border-v-line"
      >
        <dl className="grid gap-x-10 gap-y-4 md:grid-cols-2">
          {PLATINUM_INCLUDES.map((c) => (
            <div key={c.area} className="border-b border-v-hairline pb-3">
              <dt className="text-sm font-semibold">{c.area}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-v-body">{c.items}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12.5px] text-v-muted">
          This is the ICP&apos;s description of the full platform. Several items are still being completed.{" "}
          <Link href="/adopt/platform" className="text-v-accent hover:underline">See what is available today</Link>.
        </p>
      </Section>

      <Section
        id="platinum"
        title="Fully Loaded (Platinum): check the fit"
        intro="A commercial package with documented limits, prices and prerequisites, suited for citizen feedback and surveys and for scheme discovery. The advisor checks your requirements against it."
        className="border-t border-v-line"
      >
        <LinkButton href="/adopt/advisor" arrow className="self-start">Open the package advisor</LinkButton>
      </Section>

      <Section
        id="commercial"
        title="How it is paid for"
        intro="The ICP defines the structure of the commercial model. It does not set amounts, and neither do we."
        className="border-t border-v-line"
      >
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {COMMERCIAL_COMPONENTS.map((c) => (
            <li key={c.name} className="rounded-v-lg border border-v-line bg-v-panel px-4 py-3">
              <p className="text-sm font-semibold">{c.name}</p>
              <p className="mt-0.5 text-[12.5px] text-v-body">{c.model}</p>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-v-muted">Ask the VoicERA team for a quote that reflects your scope.</p>
      </Section>
    </Container>
  );
}
