import type { Metadata } from "next";
import Link from "next/link";
import { Container, LinkButton, PageIntro, Section } from "@/components/adopt/ui";
import { Catalogue } from "@/components/adopt/Catalogue";
import { APPLICATIONS } from "@/lib/adopt/applications";
import { PACKAGE_BY_ID } from "@/lib/adopt/icp";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return (
    <Container>
      <PageIntro
        eyebrow="Application catalogue"
        title="Five applications, ready to configure"
        actions={<LinkButton href="/adopt/select" arrow>Help me choose</LinkButton>}
      >
        <p>
          Each application is a complete conversation. You do not build the flow. You provide your content and rules,
          and connect a system if the application needs one.
        </p>
      </PageIntro>

      <Section id="browse" title="Browse">
        <Catalogue />
      </Section>

      <Section
        id="compare"
        title="Side by side"
        intro="What is already built, what you configure, and what it connects to. This follows the ICP."
        className="border-t border-v-line"
      >
        <div className="overflow-x-auto rounded-v-xl border border-v-line bg-v-panel shadow-[var(--v-shadow-card)]">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-v-line bg-v-surface-sunk">
                {["Application", "Already built", "You configure", "Connects to", "Package"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-mono text-[9.5px] font-medium uppercase tracking-[.14em] text-v-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {APPLICATIONS.map((a) => (
                <tr key={a.id} className="border-b border-v-hairline align-top last:border-0">
                  <th scope="row" className="px-4 py-3.5 text-left font-semibold">
                    <Link href={`/adopt/applications/${a.id}`} className="text-v-fg hover:text-v-accent">
                      {a.name}
                    </Link>
                  </th>
                  <td className="px-4 py-3.5 leading-relaxed text-v-body">{a.prebuilt}</td>
                  <td className="px-4 py-3.5 leading-relaxed text-v-body">{a.configure.slice(0, 3).join(", ")}</td>
                  <td className="px-4 py-3.5 leading-relaxed text-v-body">{a.integrationSummary}</td>
                  <td className="px-4 py-3.5 text-v-body">{PACKAGE_BY_ID[a.recommendedPackage].name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </Container>
  );
}
