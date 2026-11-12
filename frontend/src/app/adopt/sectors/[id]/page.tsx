import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, KeyValue, Notice, PageIntro, ProvenanceBadge, Section } from "@/components/adopt/ui";
import { AppCard, HierarchyChain } from "@/components/adopt/content";
import { PlanButton } from "@/components/adopt/actions";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { ARCHETYPES, PRODUCT_FAMILIES, SEGMENTS } from "@/lib/adopt/icp";

const VARIANT_FOR: Record<string, string> = {
  civic: "Civic Resolution",
  highways: "Highway Resolution",
  utilities: "Utility Resolution",
  census: "Census Support",
  welfare: "Scheme Engagement",
  agriculture: "Farmer Engagement",
};

export function generateStaticParams() {
  return SEGMENTS.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const seg = SEGMENTS.find((s) => s.id === id);
  return { title: seg ? seg.name : "Sector" };
}

export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seg = SEGMENTS.find((s) => s.id === id);
  if (!seg) notFound();
  const arch = ARCHETYPES.find((a) => a.id === seg.archetype)!;
  const variantName = VARIANT_FOR[seg.id];
  const variant = PRODUCT_FAMILIES.flatMap((f) => f.variants).find((v) => v.name === variantName);

  return (
    <Container>
      <PageIntro
        eyebrow={arch.name}
        title={seg.name}
        actions={<PlanButton segmentId={seg.id} label="Plan this segment" />}
      >
        <p>{seg.role}.</p>
      </PageIntro>

      <div className="py-6">
        <HierarchyChain segment={seg} />
      </div>

      <Section id="workflow" title="How this segment works" className="border-t border-v-line">
        <KeyValue
          rows={[
            { k: "Strongest workflow", v: seg.workflow },
            { k: "Why it works well", v: seg.whyItWins },
            { k: "VoicERA role", v: seg.role },
            { k: "Typical adopters", v: seg.adopters },
            { k: "Pattern", v: `${arch.name}. ${arch.coreNeed}` },
            ...(seg.challenge ? [{ k: "Challenge", v: seg.challenge }] : []),
          ]}
        />
        {seg.archetype === "complex" ? (
          <Notice tone="warning" title="An expansion market, not a first deployment">
            The ICP describes this segment as high value but harder: more complex workflows, more domain knowledge and
            more integration. Expect to start narrow and integrate later.
          </Notice>
        ) : null}
        {variant ? (
          <div className="rounded-v-xl border border-v-line bg-v-surface-sunk p-5">
            <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Product variant in the ICP</p>
            <h3 className="mt-1 text-[16px] font-semibold">{variant.name}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-v-body">
              Citizens: {variant.inbound}. VoicERA reaches out with: {variant.outbound}.
            </p>
          </div>
        ) : null}
      </Section>

      <Section
        id="apps"
        title="Applications that fit"
        intro={
          <span className="flex flex-wrap items-center gap-2">
            {seg.fitNote} <ProvenanceBadge kind={seg.fitSource} />
          </span>
        }
        className="border-t border-v-line"
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {seg.applications.map((aid) => (
            <AppCard key={aid} app={APPLICATION_BY_ID[aid]} />
          ))}
        </div>
      </Section>
    </Container>
  );
}
