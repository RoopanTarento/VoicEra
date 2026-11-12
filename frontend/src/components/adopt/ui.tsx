import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Circle, Info, Minus, TestTube2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Availability, PackageId, Provenance, ReadinessStatus } from "@/lib/adopt/types";
import { AVAILABILITY_LABEL } from "@/lib/adopt/capabilities";

export function Container({
  children,
  className = "",
  narrow = false,
}: {
  children: React.ReactNode;
  className?: string;
  narrow?: boolean;
}) {
  return (
    <div className={`mx-auto w-full px-5 md:px-8 ${narrow ? "max-w-[820px]" : "max-w-[1160px]"} ${className}`}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[.16em] text-v-muted ${className}`}>{children}</span>
  );
}

export function PageIntro({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-v-line pb-8 pt-10 md:pt-14">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="max-w-[22ch] text-[30px] font-semibold leading-[1.12] tracking-tight md:text-[40px]">{title}</h1>
      {children ? (
        <div className="max-w-[68ch] text-[15px] font-light leading-relaxed text-v-body">{children}</div>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-3 pt-1">{actions}</div> : null}
    </header>
  );
}

export function SectionHead({
  title,
  children,
  id,
}: {
  title: string;
  children?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 id={id} className="text-xl font-semibold tracking-tight md:text-[22px]">
        {title}
      </h2>
      {children ? <p className="max-w-[68ch] text-sm font-light leading-relaxed text-v-body">{children}</p> : null}
    </div>
  );
}

export function Section({
  title,
  intro,
  children,
  id,
  className = "",
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-5 py-9 ${className}`}>
      <SectionHead title={title} id={id}>
        {intro}
      </SectionHead>
      {children}
    </section>
  );
}

const PROV: Record<Provenance, { label: string; tone: "neutral" | "accent" | "warn" | "draft"; title: string }> = {
  icp: { label: "From the ICP", tone: "neutral", title: "Stated in the VoicERA ICP document" },
  inferred: { label: "Our suggestion", tone: "accent", title: "Not stated in the ICP. This is our reading and should be checked" },
  tbc: { label: "To confirm", tone: "warn", title: "Needs confirming with the implementation team" },
  repo: { label: "Repository check", tone: "draft", title: "Found by checking the repository, 5 Oct 2026" },
};

export function ProvenanceBadge({ kind }: { kind: Provenance }) {
  const p = PROV[kind];
  return (
    <span title={p.title}>
      <Badge tone={p.tone}>{p.label}</Badge>
    </span>
  );
}

export function AvailabilityPill({ value }: { value: Availability }) {
  const tone = value === "available" ? "live" : value === "partial" ? "warn" : "danger";
  return <Badge tone={tone}>{AVAILABILITY_LABEL[value]}</Badge>;
}

export function PackagePill({ id }: { id: PackageId }) {
  return <Badge tone="accent">{id[0].toUpperCase() + id.slice(1)}</Badge>;
}

export function StatusPill({ status }: { status: ReadinessStatus }) {
  const map: Record<ReadinessStatus, { label: string; tone: "live" | "accent" | "danger" | "draft" }> = {
    done: { label: "Done", tone: "live" },
    "in-progress": { label: "In progress", tone: "accent" },
    blocked: { label: "Blocked", tone: "danger" },
    "not-applicable": { label: "Not needed", tone: "draft" },
  };
  const m = map[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function StatusIcon({ status }: { status: ReadinessStatus }) {
  if (status === "done")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-v-ok text-white" aria-hidden>
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  if (status === "blocked")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-v-danger text-white" aria-hidden>
        <Minus className="size-3" strokeWidth={3} />
      </span>
    );
  if (status === "in-progress")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-v-accent bg-v-pale" aria-hidden />
    );
  return <Circle className="size-5 shrink-0 text-v-disabled" aria-hidden />;
}

type NoticeTone = "info" | "warning" | "demo" | "danger";

export function Notice({
  tone = "info",
  title,
  children,
  className = "",
}: {
  tone?: NoticeTone;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const styles: Record<NoticeTone, string> = {
    info: "border-v-blue-soft bg-v-pale text-v-accent-deep",
    demo: "border-v-line-strong bg-v-surface-sunk text-v-body",
    warning: "border-v-warning/30 bg-v-warn-tint text-v-warn-ink",
    danger: "border-v-danger-line bg-v-danger-pale text-v-danger-deep",
  };
  const Icon = tone === "warning" || tone === "danger" ? AlertTriangle : tone === "demo" ? TestTube2 : Info;
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`flex gap-3 rounded-v-lg border px-4 py-3.5 text-[13px] leading-relaxed ${styles[tone]} ${className}`}>
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5 font-normal" : "font-normal"}>{children}</div>
      </div>
    </div>
  );
}

export function BulletList({ items, className = "" }: { items: React.ReactNode[]; className?: string }) {
  return (
    <ul className={`flex flex-col gap-2 text-sm leading-relaxed text-v-body ${className}`}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[9px] size-1 shrink-0 rounded-full bg-v-accent" aria-hidden />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
  className = "",
  arrow = false,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "outline" | "dark" | "ghost";
  className?: string;
  arrow?: boolean;
}) {
  const v: Record<string, string> = {
    primary: "bg-v-accent text-white shadow-[var(--v-shadow-primary)] hover:bg-v-accent-deep",
    dark: "bg-v-fg text-white hover:bg-v-accent",
    outline: "border border-v-line-strong bg-white text-v-fg hover:border-v-fg hover:bg-v-fg hover:text-white",
    ghost: "border border-v-line bg-transparent text-v-body hover:border-v-line-strong hover:bg-v-track",
  };
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-v-md px-[17px] py-[11px] text-[13px] font-semibold transition-colors duration-[120ms] ${v[variant]} ${className}`}
    >
      {children}
      {arrow ? <ArrowRight className="size-3.5" strokeWidth={2.2} aria-hidden /> : null}
    </Link>
  );
}

export function Panel({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={`rounded-v-xl border border-v-line bg-v-panel shadow-[var(--v-shadow-card)] ${padded ? "p-5 md:p-6" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function KeyValue({ rows }: { rows: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-[170px_1fr]">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="font-mono text-[10px] uppercase tracking-[.14em] text-v-muted sm:pt-1">{r.k}</dt>
          <dd className="text-sm leading-relaxed text-v-body">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-v-xl border border-dashed border-v-line-strong bg-v-surface-sunk px-6 py-8">
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? <div className="max-w-[60ch] text-sm leading-relaxed text-v-body">{children}</div> : null}
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-16 text-sm text-v-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-v-line-strong border-t-v-accent" aria-hidden />
      {label}
    </div>
  );
}
