"use client";

import { ReactNode } from "react";
import { AlertCircle, CheckCircle2, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import type { CheckStatus, Health, Outcome } from "@/lib/api/secure";

export function SecureHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-v-line pb-6">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.14em] text-v-accent">
          <ShieldCheck className="size-3.5" strokeWidth={2} />
          VoicEra Secure
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-[70ch] text-sm font-light leading-relaxed text-v-muted">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-sm text-v-danger">
      <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{message}</span>
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-10 text-sm text-v-muted">
      <Spinner light={false} />
      {label}…
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon ? <span className="text-v-dim">{icon}</span> : null}
      <span className="text-[15px] font-semibold">{title}</span>
      <span className="max-w-[52ch] text-sm font-light text-v-muted">{body}</span>
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
  );
}

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  if (outcome === "success") return <Badge tone="live">Granted</Badge>;
  if (outcome === "denied") return <Badge tone="danger">Denied</Badge>;
  return <Badge tone="warn">Error</Badge>;
}

const CHECK_ICON: Record<CheckStatus, ReactNode> = {
  pass: <CheckCircle2 className="size-4 text-v-ok" strokeWidth={2} />,
  warn: <TriangleAlert className="size-4 text-v-warn" strokeWidth={2} />,
  fail: <XCircle className="size-4 text-v-danger" strokeWidth={2} />,
};

export function HealthPanel({ health, compact = false }: { health: Health; compact?: boolean }) {
  const tone = health.status === "pass" ? "live" : health.status === "warn" ? "warn" : "danger";
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Security health</span>
          <span className="text-lg font-semibold tracking-tight">{health.label}</span>
        </div>
        <Badge tone={tone}>
          {health.checks.filter((c) => c.status === "pass").length}/{health.checks.length} checks pass
        </Badge>
      </div>
      <ul className="flex flex-col divide-y divide-v-hairline">
        {(compact ? health.checks.filter((c) => c.status !== "pass").concat(health.checks.filter((c) => c.status === "pass")).slice(0, 5) : health.checks).map((c) => (
          <li key={c.id} className="flex items-start gap-2.5 py-2.5">
            <span className="mt-0.5">{CHECK_ICON[c.status]}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium">{c.label}</span>
              <span className="text-xs font-light text-v-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <span className="text-[11px] text-v-dim">
        Based on {health.checks.length} implemented checks. Checked {formatWhen(health.checked_at)}.
      </span>
    </Card>
  );
}

export function TableShell({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-v-md border border-v-line bg-v-panel">
      <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-v-line bg-v-soft px-4 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-v-muted ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border-b border-v-hairline px-4 py-3 align-top ${className}`}>
      {children}
    </td>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="font-mono text-[12px] tracking-tight text-v-fg">
      {children}
    </span>
  );
}

/** "CNT-a8f72c1e…" — short form for tables; the full ID is in the title. */
export function ShortId({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-v-disabled">—</span>;
  return <Mono title={id}>{id.length > 16 ? `${id.slice(0, 13)}…` : id}</Mono>;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function humanize(value: string): string {
  return value.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function SectionTitle({ title, note, actions }: { title: string; note?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {note ? <span className="text-xs font-light text-v-muted">{note}</span> : null}
      </div>
      {actions}
    </div>
  );
}

export function errorText(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
