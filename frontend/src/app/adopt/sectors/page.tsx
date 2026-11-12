import type { Metadata } from "next";
import { Container, LinkButton, PageIntro, Section } from "@/components/adopt/ui";
import { SegmentCard } from "@/components/adopt/content";
import { ARCHETYPES, PRODUCT_FAMILIES, SEGMENTS } from "@/lib/adopt/icp";

export const metadata: Metadata = { title: "Sectors" };

export default function SectorsPage() {
  return (
    <Container>
      <PageIntro
        eyebrow="Choose your service"
        title="Start from the part of government you work in"
        actions={<LinkButton href="/adopt/select" arrow>Skip to the guided questions</LinkButton>}
      >
        <p>
          These nine segments come from the VoicERA ICP. They fall into three patterns of how a department talks to
          citizens. Pick yours to see which ready-made applications fit and why.
        </p>
      </PageIntro>

      {ARCHETYPES.map((a) => {
        const segs = SEGMENTS.filter((s) => s.archetype === a.id);
        return (
          <Section
            key={a.id}
            id={`arch-${a.id}`}
            title={a.name}
            intro={`${a.tagline}. ${a.coreNeed}`}
            className="border-b border-v-line last:border-0"
          >
            <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Interaction</dt>
                <dd className="mt-1 text-v-body">{a.interactionModel}</dd>
              </div>
              <div>
                <dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">What VoicERA does</dt>
                <dd className="mt-1 text-v-body">{a.opportunity}</dd>
              </div>
              <div>
                <dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Role in the product</dt>
                <dd className="mt-1 text-v-body">{a.strategicRole}</dd>
              </div>
            </dl>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {segs.map((s) => (
                <SegmentCard key={s.id} seg={s} />
              ))}
            </div>
          </Section>
        );
      })}

      <Section
        id="families"
        title="Two product families sit across these segments"
        intro="The ICP groups the work into a Resolution agent for always-on services and an Engagement agent for programmes. The five applications are configured from these."
        className="border-t border-v-line"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {PRODUCT_FAMILIES.map((f) => (
            <div key={f.id} className="flex flex-col gap-3 rounded-v-xl border border-v-line bg-v-panel p-5 shadow-[var(--v-shadow-card)]">
              <h3 className="text-[17px] font-semibold tracking-tight">{f.name}</h3>
              <p className="text-[13.5px] leading-relaxed text-v-body">{f.need}</p>
              <p className="font-mono text-[11px] tracking-wide text-v-muted-2">{f.workflow.join("  >  ")}</p>
              <ul className="flex flex-col divide-y divide-v-hairline border-t border-v-hairline text-[13px]">
                {f.variants.map((v) => (
                  <li key={v.name} className="flex flex-col gap-0.5 py-2.5">
                    <span className="font-semibold text-v-fg">{v.name}</span>
                    <span className="text-v-body">
                      Outbound: {v.outbound}. Inbound: {v.inbound}.
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-v-muted">Example adopters: {f.examples}. Runs as {f.deploymentModel.toLowerCase()}.</p>
            </div>
          ))}
        </div>
      </Section>
    </Container>
  );
}
