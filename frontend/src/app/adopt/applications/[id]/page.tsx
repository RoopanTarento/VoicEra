import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AvailabilityPill,
  BulletList,
  Container,
  LinkButton,
  Notice,
  PackagePill,
  PageIntro,
  Panel,
  Section,
} from "@/components/adopt/ui";
import { ConversationExample, HierarchyChain } from "@/components/adopt/content";
import { PlanButton, StartWorkspaceButton } from "@/components/adopt/actions";
import { APPLICATIONS, APPLICATION_BY_ID, segmentsForApplication } from "@/lib/adopt/applications";
import { PACKAGE_BY_ID, PACKAGES } from "@/lib/adopt/icp";
import { gapsFor } from "@/lib/adopt/capabilities";
import type { ApplicationId } from "@/lib/adopt/types";

export function generateStaticParams() {
  return APPLICATIONS.map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const app = APPLICATION_BY_ID[id as ApplicationId];
  return { title: app ? app.name : "Application" };
}

const TOC = [
  ["problem", "The problem"],
  ["journey", "Citizen journey"],
  ["example", "Example conversation"],
  ["does", "What it does"],
  ["configure", "What you configure"],
  ["knowledge", "Knowledge it needs"],
  ["integrations", "Integrations"],
  ["handoff", "Human handoff"],
  ["testing", "How to test it"],
  ["measures", "Measuring success"],
  ["package", "Which package"],
  ["depends", "What it depends on"],
];

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = APPLICATION_BY_ID[id as ApplicationId];
  if (!app) notFound();
  const pkg = PACKAGE_BY_ID[app.recommendedPackage];
  const segs = segmentsForApplication(app.id);
  const gaps = gapsFor(app.needs);

  return (
    <Container>
      <PageIntro
        eyebrow="Application"
        title={app.name}
        actions={
          <>
            <PlanButton applicationId={app.id} label="Plan this application" />
            <LinkButton href={`/adopt/citizen/${app.id}`} variant="outline">Try the citizen&apos;s side</LinkButton>
            <StartWorkspaceButton applicationId={app.id} packageId={app.recommendedPackage} label="Open a workspace" variant="outline" />
          </>
        }
      >
        <p>{app.oneLine}</p>
      </PageIntro>

      <div className="pt-6">
        <HierarchyChain segment={segs[0]} application={app} packageId={app.recommendedPackage} />
      </div>

      <div className="grid gap-10 lg:grid-cols-[190px_1fr]">
        <nav aria-label="On this page" className="sticky top-[88px] hidden self-start pt-9 lg:block">
          <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">On this page</p>
          <ul className="flex flex-col gap-0.5 border-l border-v-line text-[13px]">
            {TOC.map(([hash, label]) => (
              <li key={hash}>
                <a href={`#${hash}`} className="-ml-px block border-l border-transparent py-1.5 pl-3 text-v-body hover:border-v-accent hover:text-v-accent">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 divide-y divide-v-line">
          <Section id="problem" title="The problem it solves">
            <p className="max-w-[68ch] text-[14.5px] leading-relaxed text-v-body">{app.problem}</p>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Who adopts it</dt>
                <dd className="mt-1 text-sm leading-relaxed text-v-body">{app.adopter}</dd>
              </div>
              <div>
                <dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Who owns it on your side</dt>
                <dd className="mt-1 text-sm leading-relaxed text-v-body">{app.owners}</dd>
              </div>
            </dl>
            <div className="rounded-v-lg border border-v-line bg-v-surface-sunk px-4 py-3.5 text-[13px] leading-relaxed text-v-body">
              <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">The flow in the ICP</span>
              <p className="mt-1">{app.icpFlow}</p>
            </div>
          </Section>

          <Section id="journey" title="The citizen's journey" intro="What a citizen experiences from the first word to the end.">
            <ol className="flex flex-col">
              {app.journey.map((j, i) => (
                <li key={j.step} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < app.journey.length - 1 ? <span className="absolute left-[13px] top-7 h-[calc(100%-18px)] w-px bg-v-line" aria-hidden /> : null}
                  <span className="z-10 flex size-[27px] shrink-0 items-center justify-center rounded-full bg-v-fg font-mono text-[10.5px] text-white">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold">{j.step}</p>
                    <p className="text-[13.5px] leading-relaxed text-v-body">{j.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="example" title="Example conversation" intro="A sample, not a recording. Wording is illustrative.">
            <ConversationExample title={app.example.title} context={app.example.context} turns={app.example.turns} />
            <LinkButton href={`/adopt/citizen/${app.id}`} variant="outline" className="self-start">Try it yourself as a citizen</LinkButton>
          </Section>

          <Section id="does" title="What it can do">
            <BulletList items={app.canDo} />
            <p className="text-[13px] leading-relaxed text-v-muted">
              <span className="font-medium text-v-body">Already built:</span> {app.prebuilt}
            </p>
          </Section>

          <Section id="configure" title="What you configure" intro="This is all your department provides. You set it in the workspace.">
            <BulletList items={app.configure} />
            <p className="text-[13px] text-v-muted">
              Every application also needs your department details, languages, consent notice and handoff number.
            </p>
          </Section>

          <Section id="knowledge" title="Knowledge it needs" intro="The agent only speaks from content you approve.">
            <ul className="flex flex-col divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
              {app.knowledge.map((k) => (
                <li key={k.name} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <span>
                    <span className="text-sm font-semibold">{k.name}</span>
                    <span className="block text-[13px] text-v-body">{k.detail}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">{k.required ? "Required" : "Optional"}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="integrations" title="Integrations" intro={`Connects to: ${app.integrationSummary}`}>
            <div className="grid gap-4 md:grid-cols-2">
              {app.integrations.map((i) => (
                <Panel key={i.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-semibold leading-snug">{i.name}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">
                      {i.need === "required" ? "Needed" : i.need === "optional" ? "Optional" : "Not needed"}
                    </span>
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-v-body">{i.purpose}</p>
                  <div>
                    <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Your IT team provides</p>
                    <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-v-body">
                      {i.inputs.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-auto flex flex-col gap-1.5 border-t border-v-hairline pt-3">
                    <AvailabilityPill value={i.platform} />
                    <p className="text-[12px] leading-relaxed text-v-muted">{i.platformNote}</p>
                  </div>
                </Panel>
              ))}
            </div>
          </Section>

          <Section id="handoff" title="Human handoff" intro="A citizen can always ask for a person. The agent also hands over in these cases.">
            <BulletList items={app.handoff} />
            <Notice tone="warning" title="Handoff with context is not confirmed yet">
              The ICP lists handoff with the conversation attached as a priority gap. Confirm what will work at launch
              with the implementation team.
            </Notice>
          </Section>

          <Section id="testing" title="How to test it" intro="Run these in the workspace before any citizen hears the agent.">
            <BulletList items={app.testing} />
            <p className="text-[13px] text-v-muted">
              The workspace test is a local simulation built from your configuration. It checks what the agent would
              say and where your setup has gaps. It is not a live call.
            </p>
          </Section>

          <Section id="measures" title="Measuring success" intro="Suggested measures. Choose the few that matter to your department.">
            <ul className="grid gap-3 sm:grid-cols-2">
              {app.measures.map((m) => (
                <li key={m.name} className="rounded-v-lg border border-v-line bg-v-panel px-4 py-3">
                  <p className="text-sm font-semibold">{m.name}</p>
                  <p className="text-[13px] text-v-body">{m.detail}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="package" title="Which package fits" intro={app.packageReason}>
            <div className="flex flex-wrap items-center gap-3">
              <PackagePill id={app.recommendedPackage} />
              <span className="text-sm text-v-body">{pkg.positioning}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {PACKAGES.map((p) => (
                <Link
                  key={p.id}
                  href={`/adopt/packages/${p.id}`}
                  className={`rounded-v-lg border px-4 py-3 text-[13px] transition-colors hover:border-v-accent ${p.id === app.recommendedPackage ? "border-v-accent bg-v-pale" : "border-v-line bg-v-panel"}`}
                >
                  <span className="block font-semibold text-v-fg">{p.name}</span>
                  <span className="mt-0.5 block text-v-body">{p.bestFor}</span>
                </Link>
              ))}
            </div>
          </Section>

          <Section id="depends" title="What it depends on" intro="Things the platform has to do well for this application to work in production. Where they are not complete today, we say so.">
            {gaps.length === 0 ? (
              <p className="text-sm text-v-body">Everything this application relies on is available today.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
                {gaps.map((g) => (
                  <li key={g.id} className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{g.label}</p>
                      <p className="text-[13px] leading-relaxed text-v-body">{g.repoNote ?? g.icpSays}</p>
                    </div>
                    <AvailabilityPill value={g.availability} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12.5px] text-v-muted">
              Fits these segments: {segs.map((s) => s.name).join(", ")}.{" "}
              <Link href="/adopt/platform" className="text-v-accent hover:underline">See the full platform status</Link>
            </p>
          </Section>
        </div>
      </div>
    </Container>
  );
}
