"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  BulletList,
  EmptyState,
  LinkButton,
  Notice,
  PackagePill,
  Panel,
  ProvenanceBadge,
  Section,
  Spinner,
} from "@/components/adopt/ui";
import { HierarchyChain } from "@/components/adopt/content";
import { useAdopt } from "@/lib/adopt/state";
import { isAnswered, recommend, visibleQuestions } from "@/lib/adopt/questionnaire";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { PACKAGE_BY_ID, SEGMENTS, TIMING_CAVEAT } from "@/lib/adopt/icp";
import type { QuestionnaireAnswers, Recommendation } from "@/lib/adopt/types";

function briefText(a: QuestionnaireAnswers, r: Recommendation): string {
  const app = APPLICATION_BY_ID[r.applicationId];
  const pkg = PACKAGE_BY_ID[r.packageId];
  const lines: string[] = [];
  lines.push(`# VoicERA plan: ${a.department ?? "Department"}`);
  lines.push("");
  lines.push(`Application: ${app.name}`);
  lines.push(`Package: ${pkg.name} (${pkg.positioning})`);
  lines.push("");
  lines.push("## Why this application");
  r.whyApplication.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## Why this package");
  r.whyPackage.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## What can be configured now");
  r.configureNow.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## Dependencies");
  r.dependencies.forEach((d) => lines.push(`- [${d.severity}] ${d.text}`));
  lines.push("");
  lines.push("## What the implementation team needs from you");
  r.teamNeeds.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## Open questions");
  r.openQuestions.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## Your answers");
  for (const q of visibleQuestions(a)) {
    const v = a[q.id];
    const opts = q.options ? q.options(a) : [];
    const text = Array.isArray(v)
      ? v.map((x) => opts.find((o) => o.value === x)?.label ?? x).join(", ")
      : typeof v === "string"
        ? (opts.find((o) => o.value === v)?.label ?? v)
        : "";
    lines.push(`- ${q.title} ${text || "Not answered"}`);
  }
  lines.push("");
  lines.push(`Timing: ${TIMING_CAVEAT}`);
  lines.push("No price is set. See the commercial components on the Packages page.");
  return lines.join("\n");
}

const SEV: Record<string, { label: string; tone: "danger" | "warning" | "info" }> = {
  blocker: { label: "Blocks launch until resolved", tone: "danger" },
  "needs-decision": { label: "Needs a decision", tone: "warning" },
  note: { label: "Good to know", tone: "info" },
};

export function Result() {
  const router = useRouter();
  const { state, hydrated, actions } = useAdopt();
  if (!hydrated) return <Spinner label="Preparing your recommendation" />;

  const a = state.answers;
  const rec = recommend(a);
  if (!rec) {
    return (
      <div className="py-12">
        <EmptyState
          title="There is no recommendation yet"
          action={<LinkButton href="/adopt/select" arrow>Answer the questions</LinkButton>}
        >
          A recommendation needs to know what you want citizens to be able to do. It takes a few minutes, and your
          answers are kept as you go.
        </EmptyState>
      </div>
    );
  }

  const app = APPLICATION_BY_ID[rec.applicationId];
  const pkg = PACKAGE_BY_ID[rec.packageId];
  const seg = SEGMENTS.find((s) => s.id === a.segmentId) ?? null;
  const missing = visibleQuestions(a).filter((q) => !isAnswered(q, a)).length;
  const grouped = (["blocker", "needs-decision", "note"] as const).map((sev) => ({
    sev,
    items: rec.dependencies.filter((d) => d.severity === sev),
  }));

  function download() {
    const blob = new Blob([briefText(a, rec as Recommendation)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = "voicera-plan.md";
    el.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-4 border-b border-v-line pb-8 pt-10 md:pt-14">
        <span className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">Your recommendation</span>
        <h1 className="max-w-[24ch] text-[30px] font-semibold leading-[1.12] tracking-tight md:text-[40px]">
          {app.name}, with the {pkg.name} package
        </h1>
        <p className="max-w-[64ch] text-[15px] font-light leading-relaxed text-v-body">
          {a.department ? `For ${a.department}. ` : ""}This follows from your answers. Change any of them and it updates.
        </p>
        <HierarchyChain segment={seg} application={app} packageId={rec.packageId} />
        <div className="flex flex-wrap gap-3 pt-1">
          <Button
            onClick={() => {
              actions.startFromRecommendation();
              router.push("/adopt/workspace");
            }}
          >
            Enter the workspace <ArrowRight className="size-3.5" aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => router.push("/adopt/select")}>
            <Pencil className="size-3.5" aria-hidden /> Change my answers
          </Button>
          <Button variant="ghost" onClick={download}>
            <Download className="size-3.5" aria-hidden /> Download this as a brief
          </Button>
        </div>
      </header>

      {missing > 0 ? (
        <div className="pt-6">
          <Notice tone="warning" title="Some answers are still missing">
            This is based on what you have answered so far. <Link href="/adopt/select" className="font-semibold underline">Finish the questions</Link> for a firmer picture.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-x-12 md:grid-cols-2">
        <Section id="why-app" title="Why this application">
          <BulletList items={rec.whyApplication} />
        </Section>
        <Section id="why-pkg" title="Why this package">
          <div className="flex items-center gap-2">
            <PackagePill id={rec.packageId} />
            <span className="text-[13px] text-v-body">{pkg.positioning}</span>
          </div>
          <BulletList items={rec.whyPackage} />
          <p className="text-[12.5px] text-v-muted">{TIMING_CAVEAT}</p>
        </Section>
      </div>

      <Section id="now" title="What you can configure now" className="border-t border-v-line" intro="You can start on all of this in the workspace today, without waiting for any system.">
        <BulletList items={rec.configureNow} />
      </Section>

      <Section id="depends" title="What this depends on" className="border-t border-v-line" intro="Be honest with yourselves about these early. They decide whether and when this can launch.">
        <div className="flex flex-col gap-5">
          {grouped.map(({ sev, items }) =>
            items.length ? (
              <div key={sev} className="flex flex-col gap-2.5">
                <p className="font-mono text-[10px] uppercase tracking-[.14em] text-v-muted">{SEV[sev].label}</p>
                {items.map((d, i) => (
                  <Notice key={i} tone={SEV[sev].tone}>{d.text}</Notice>
                ))}
              </div>
            ) : null,
          )}
        </div>
      </Section>

      <div className="grid gap-x-12 border-t border-v-line md:grid-cols-2">
        <Section id="team" title="What the implementation team needs">
          <BulletList items={rec.teamNeeds} />
        </Section>
        <Section id="open" title="Questions still open">
          <BulletList items={rec.openQuestions} />
        </Section>
      </div>

      {rec.alternatives.length ? (
        <Section id="alt" title="Other routes to consider" className="border-t border-v-line">
          <div className="grid gap-4 md:grid-cols-2">
            {rec.alternatives.map((alt) => (
              <Panel key={alt.title} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-semibold">{alt.title}</h3>
                  <ProvenanceBadge kind={alt.provenance} />
                </div>
                <p className="text-[13.5px] leading-relaxed text-v-body">{alt.text}</p>
              </Panel>
            ))}
          </div>
        </Section>
      ) : null}

      <Section id="platinum" title="Check this against the Platinum package" className="border-t border-v-line" intro="The VoicEra Fully Loaded (Platinum) package has its own documented limits, prices and prerequisites. The advisor checks your requirements against them.">
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/adopt/advisor" variant="outline" arrow>Open the package advisor</LinkButton>
          {app.id === "scheme-discovery" ? <LinkButton href="/adopt/advisor/poc" variant="outline">Build a Scheme Discovery proof of concept</LinkButton> : null}
        </div>
      </Section>

      <Section id="pricing" title="Price and dates" className="border-t border-v-line">
        <p className="max-w-[64ch] text-sm leading-relaxed text-v-body">
          Nothing here sets a price or a delivery date. The ICP defines the shape of the commercial model (platform
          licence, usage, implementation, managed operations) and typical timing ranges, but not amounts or promises.
          The VoicERA team can scope your case.
        </p>
        <div className="flex flex-wrap gap-3">
          <LinkButton href={`/adopt/applications/${app.id}`} variant="outline">Read about {app.name}</LinkButton>
          <LinkButton href="/adopt/packages" variant="outline">Compare packages</LinkButton>
        </div>
      </Section>
    </div>
  );
}
