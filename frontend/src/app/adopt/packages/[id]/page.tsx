import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BulletList, Container, KeyValue, LinkButton, Notice, PageIntro, Section } from "@/components/adopt/ui";
import { AppCard } from "@/components/adopt/content";
import { PlanButton } from "@/components/adopt/actions";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { PACKAGES, PACKAGE_BY_ID, PACKAGE_ORDER, TIMING_CAVEAT } from "@/lib/adopt/icp";
import type { PackageId } from "@/lib/adopt/types";

export function generateStaticParams() {
  return PACKAGES.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = PACKAGE_BY_ID[id as PackageId];
  return { title: p ? p.name : "Package" };
}

const MOVE_UP: Record<PackageId, string> = {
  deploy:
    "Move to Connect when you want the agent to collect structured data, send it to a system, or check a citizen's status.",
  connect:
    "Move to Orchestrate when requests need to become cases that are routed, escalated, tracked and confirmed closed.",
  orchestrate: "Orchestrate is the deepest package. Further work is project-based custom development.",
};

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pkg = PACKAGE_BY_ID[id as PackageId];
  if (!pkg) notFound();
  const idx = PACKAGE_ORDER.indexOf(pkg.id);
  const prev = idx > 0 ? PACKAGE_BY_ID[PACKAGE_ORDER[idx - 1]] : null;
  const next = idx < PACKAGE_ORDER.length - 1 ? PACKAGE_BY_ID[PACKAGE_ORDER[idx + 1]] : null;

  return (
    <Container>
      <PageIntro
        eyebrow={`Package ${idx + 1} of 3`}
        title={pkg.name}
        actions={
          <>
            <PlanButton label={`Plan with ${pkg.name}`} />
            <LinkButton href="/adopt/packages" variant="outline">Compare all three</LinkButton>
          </>
        }
      >
        <p>{pkg.positioning}</p>
      </PageIntro>

      <Section id="overview" title="In brief">
        <KeyValue
          rows={[
            { k: "Who it is for", v: pkg.who },
            { k: "The problem", v: pkg.problem },
            { k: "Best for", v: pkg.bestFor },
            { k: "How it connects", v: pkg.integration },
            { k: "Typical launch", v: `${pkg.typicalLaunch}. ${TIMING_CAVEAT}` },
          ]}
        />
      </Section>

      <div className="grid gap-x-10 border-t border-v-line md:grid-cols-2">
        <Section id="accomplish" title="What you can accomplish">
          <BulletList items={pkg.accomplish} />
        </Section>
        <Section id="included" title="What is included">
          <BulletList items={pkg.included} />
        </Section>
        <Section id="provide" title="What you provide">
          <BulletList items={pkg.youProvide} />
        </Section>
        <Section id="configure" title="What gets configured">
          <BulletList items={pkg.weConfigure} />
        </Section>
        <Section id="dependencies" title="Dependencies and approvals">
          <BulletList items={pkg.dependencies} />
        </Section>
        <Section id="out" title="Not covered">
          <BulletList items={pkg.outOfScope} />
        </Section>
      </div>

      <Section id="apps" title="Applications that use this package" className="border-t border-v-line">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pkg.applications.map((a) => (
            <AppCard key={a} app={APPLICATION_BY_ID[a]} />
          ))}
        </div>
      </Section>

      <Section id="next" title="Next steps" className="border-t border-v-line">
        <BulletList items={pkg.nextSteps} />
        <Notice tone="info" title="Moving between packages">
          {MOVE_UP[pkg.id]}
        </Notice>
        <div className="flex flex-wrap gap-3 text-[13px]">
          {prev ? (
            <Link href={`/adopt/packages/${prev.id}`} className="rounded-v-md border border-v-line px-3.5 py-2 text-v-body hover:border-v-accent">
              Previous: {prev.name}
            </Link>
          ) : null}
          {next ? (
            <Link href={`/adopt/packages/${next.id}`} className="rounded-v-md border border-v-line px-3.5 py-2 text-v-body hover:border-v-accent">
              Next: {next.name}
            </Link>
          ) : null}
        </div>
        <p className="text-[12px] text-v-muted">{pkg.provenanceNote}</p>
      </Section>
    </Container>
  );
}
