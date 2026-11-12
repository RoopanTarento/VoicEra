import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { ApplicationDef, ConversationTurn, PackageDef, Segment } from "@/lib/adopt/types";
import { ARCHETYPES } from "@/lib/adopt/icp";
import { Badge } from "@/components/ui/Badge";
import { PackagePill, ProvenanceBadge } from "@/components/adopt/ui";

export function Bubble({ turn }: { turn: ConversationTurn }) {
  if (turn.who === "note") {
    return <p className="mx-auto max-w-[52ch] rounded-v-md bg-v-track px-3 py-2 text-center text-[11.5px] leading-snug text-v-muted">{turn.text}</p>;
  }
  const agent = turn.who === "agent";
  return (
    <div className={`flex ${agent ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[86%]">
        <p className={`mb-1 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted ${agent ? "" : "text-right"}`}>
          {agent ? "VoicERA agent" : "Citizen"}
        </p>
        <p
          className={`rounded-v-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
            agent ? "rounded-tl-sm border border-v-line bg-white text-v-fg" : "rounded-tr-sm bg-v-accent text-white"
          }`}
        >
          {turn.text}
        </p>
      </div>
    </div>
  );
}

export function ConversationExample({
  title,
  context,
  turns,
}: {
  title: string;
  context?: string;
  turns: ConversationTurn[];
}) {
  return (
    <figure className="rounded-v-xl border border-v-line bg-v-surface-sunk">
      <figcaption className="border-b border-v-line px-5 py-3.5">
        <p className="text-sm font-semibold">{title}</p>
        {context ? <p className="mt-0.5 text-[12px] text-v-muted">{context}</p> : null}
      </figcaption>
      <div className="flex flex-col gap-3 p-5">
        {turns.map((t, i) => (
          <Bubble key={i} turn={t} />
        ))}
      </div>
    </figure>
  );
}

export function HierarchyChain({
  segment,
  application,
  packageId,
  compact = false,
}: {
  segment?: Segment | null;
  application?: ApplicationDef | null;
  packageId?: string | null;
  compact?: boolean;
}) {
  const arch = segment ? ARCHETYPES.find((a) => a.id === segment.archetype) : null;
  const links: { label: string; sub: string; href?: string }[] = [];
  if (segment) links.push({ label: segment.name, sub: "Segment", href: `/adopt/sectors/${segment.id}` });
  if (arch) links.push({ label: arch.name, sub: "Archetype" });
  if (application) links.push({ label: application.name, sub: "Application", href: `/adopt/applications/${application.id}` });
  if (packageId) links.push({ label: packageId[0].toUpperCase() + packageId.slice(1), sub: "Package", href: `/adopt/packages/${packageId}` });
  links.push({ label: "VoicERA platform", sub: "Underneath", href: "/adopt/platform" });
  return (
    <ol className={`flex flex-wrap items-stretch gap-y-2 ${compact ? "text-[12px]" : "text-[13px]"}`} aria-label="Where this sits">
      {links.map((l, i) => {
        const inner = (
          <span className="flex flex-col">
            <span className="font-mono text-[9px] uppercase tracking-[.14em] text-v-muted">{l.sub}</span>
            <span className="font-medium text-v-fg">{l.label}</span>
          </span>
        );
        return (
          <li key={l.sub + l.label} className="flex items-center">
            {l.href ? (
              <Link href={l.href} className="rounded-v-md border border-v-line bg-white px-3 py-2 transition-colors hover:border-v-accent">
                {inner}
              </Link>
            ) : (
              <span className="rounded-v-md border border-v-line bg-white px-3 py-2">{inner}</span>
            )}
            {i < links.length - 1 ? <ChevronRight className="mx-1 size-4 shrink-0 text-v-disabled" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function AppCard({
  app,
  note,
  highlight = false,
}: {
  app: ApplicationDef;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={`/adopt/applications/${app.id}`}
      className={`group flex h-full flex-col gap-3 rounded-v-xl border bg-v-panel p-5 shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent ${
        highlight ? "border-v-accent" : "border-v-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[17px] font-semibold leading-snug tracking-tight">{app.name}</h3>
        <PackagePill id={app.recommendedPackage} />
      </div>
      <p className="text-[13.5px] leading-relaxed text-v-body">{app.oneLine}</p>
      <dl className="mt-auto grid gap-1.5 border-t border-v-hairline pt-3 text-[12px]">
        <div className="flex gap-2">
          <dt className="w-[76px] shrink-0 font-mono text-[9.5px] uppercase tracking-[.12em] text-v-muted">Best fit</dt>
          <dd className="text-v-body">{app.bestFit}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[76px] shrink-0 font-mono text-[9.5px] uppercase tracking-[.12em] text-v-muted">Connects to</dt>
          <dd className="text-v-body">{app.integrationSummary}</dd>
        </div>
      </dl>
      {note ? <p className="text-[12px] text-v-muted">{note}</p> : null}
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-v-accent">
        See how it works <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

export function PackageCard({ pkg, recommended = false }: { pkg: PackageDef; recommended?: boolean }) {
  return (
    <Link
      href={`/adopt/packages/${pkg.id}`}
      className={`group flex h-full flex-col gap-3 rounded-v-xl border bg-v-panel p-5 shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent ${
        recommended ? "border-v-accent" : "border-v-line"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold tracking-tight">{pkg.name}</h3>
        {recommended ? <Badge tone="accent">Recommended</Badge> : null}
      </div>
      <p className="text-[14px] font-medium leading-snug text-v-fg">{pkg.positioning}</p>
      <p className="text-[13px] leading-relaxed text-v-body">{pkg.bestFor}</p>
      <p className="mt-auto flex items-center justify-between border-t border-v-hairline pt-3 text-[12px] text-v-muted">
        <span>{pkg.integration}</span>
        <span className="inline-flex items-center gap-1 font-semibold text-v-accent">
          Details <ArrowRight className="size-3.5" aria-hidden />
        </span>
      </p>
    </Link>
  );
}

export function SegmentCard({ seg, selected = false, onPick }: { seg: Segment; selected?: boolean; onPick?: () => void }) {
  return (
    <Link
      href={`/adopt/sectors/${seg.id}`}
      onClick={onPick}
      className={`group flex h-full flex-col gap-2 rounded-v-xl border bg-v-panel p-5 shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent ${
        selected ? "border-v-accent" : "border-v-line"
      }`}
    >
      <h3 className="text-[16px] font-semibold leading-snug tracking-tight">{seg.name}</h3>
      <p className="text-[13px] leading-relaxed text-v-body">{seg.workflow}</p>
      <p className="mt-auto flex items-center justify-between border-t border-v-hairline pt-3 text-[12px] text-v-muted">
        <span>{seg.applications.length} {seg.applications.length === 1 ? "application" : "applications"}</span>
        <ProvenanceBadge kind={seg.fitSource} />
      </p>
    </Link>
  );
}
