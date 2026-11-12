import { AlertTriangle, CircleCheck, CircleHelp, Minus, OctagonAlert, SearchCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { OUTCOME_EXPLANATION, OUTCOME_LABEL } from "@/lib/adopt/advisor/evaluate";
import { SOURCES, type SourceId } from "@/lib/adopt/advisor/source";
import type { DimResult, Outcome } from "@/lib/adopt/advisor/types";
import type { CheckStatus } from "@/lib/adopt/advisor/bundle";

const SHORT: Record<SourceId, string> = {
  "PKG-SUMMARY": "offer summary",
  "PKG-INCLUDES": "what's included",
  "PKG-SUITED": "suited for",
  "PKG-BRING": "department brings",
  "PKG-SCALE": "scale",
  "PKG-SUPPORT": "support",
  "PKG-SLA": "SLA",
  "PKG-LANG": "languages",
  "PKG-KB": "knowledge base",
  "PKG-FEATURES": "features",
  "PKG-OOS": "out of scope",
  "PKG-NOTREC": "not recommended",
  "PKG-MODELS": "models",
  "PKG-TELEPHONY": "telephony",
  "PKG-COST": "cost",
  "PKG-BILLING": "billing",
  "PKG-QUALITY": "quality",
  "PKG-DASH": "dashboard",
  "PKG-FAQ": "FAQ",
  ICP: "ICP",
  ASSUMPTION: "assumption",
};

const RESULT: Record<DimResult, { label: string; tone: "live" | "accent" | "warn" | "danger" | "draft" }> = {
  fit: { label: "Fits", tone: "live" },
  conditional: { label: "With conditions", tone: "accent" },
  unresolved: { label: "Not confirmed", tone: "warn" },
  review: { label: "Needs review", tone: "warn" },
  blocked: { label: "Outside scope", tone: "danger" },
  na: { label: "Not applicable", tone: "draft" },
};

export function ResultBadge({ result }: { result: DimResult }) {
  const r = RESULT[result];
  return <Badge tone={r.tone}>{r.label}</Badge>;
}

const CHECK: Record<CheckStatus, { label: string; tone: "live" | "danger" | "warn" | "draft" }> = {
  ready: { label: "Ready", tone: "live" },
  missing: { label: "Missing", tone: "danger" },
  review: { label: "Needs review", tone: "warn" },
  na: { label: "Not applicable", tone: "draft" },
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  const c = CHECK[status];
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

/** Where a statement comes from. Anything without a package source is shown as an assumption. */
export function SourceChip({ id }: { id: SourceId }) {
  const s = SOURCES[id];
  const assumption = id === "ASSUMPTION";
  return (
    <span
      title={s.note ? `${s.label}. ${s.note}` : s.label}
      className={`inline-flex items-center rounded-v-sm border px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-[.1em] ${
        assumption ? "border-v-warning/40 bg-v-warn-tint text-v-warn-ink" : "border-v-line bg-v-surface-sunk text-v-muted"
      }`}
    >
      {id === "ASSUMPTION" ? "Assumption" : id === "ICP" ? "ICP" : `Package · ${SHORT[id]}`}
    </span>
  );
}

export function SourceChips({ ids }: { ids: SourceId[] }) {
  if (!ids.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((i) => (
        <SourceChip key={i} id={i} />
      ))}
    </span>
  );
}

const OUTCOME_STYLE: Record<Outcome, { box: string; icon: typeof CircleCheck; iconCls: string }> = {
  suitable: { box: "border-v-ok/30 bg-v-ok-tint", icon: CircleCheck, iconCls: "text-v-ok" },
  "suitable-with-conditions": { box: "border-v-blue-soft bg-v-pale", icon: SearchCheck, iconCls: "text-v-accent" },
  "needs-review": { box: "border-v-warning/40 bg-v-warn-tint", icon: AlertTriangle, iconCls: "text-v-warning-deep" },
  "outside-scope": { box: "border-v-danger-line bg-v-danger-pale", icon: OctagonAlert, iconCls: "text-v-danger" },
};

export function OutcomeBanner({ outcome, pendingGovernance, compact = false }: { outcome: Outcome; pendingGovernance?: boolean; compact?: boolean }) {
  const s = OUTCOME_STYLE[outcome];
  const Icon = s.icon;
  return (
    <div role="status" className={`flex gap-3 rounded-v-xl border px-4 py-4 md:px-5 ${s.box}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${s.iconCls}`} strokeWidth={1.9} aria-hidden />
      <div className="min-w-0">
        <p className="text-[16px] font-semibold leading-snug tracking-tight">{OUTCOME_LABEL[outcome]}</p>
        {pendingGovernance ? (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-v-sm bg-white/70 px-2 py-0.5 text-[12px] font-semibold text-v-warn-ink">
            <CircleHelp className="size-3.5" aria-hidden /> Pending security and data-governance confirmation
          </p>
        ) : null}
        {!compact ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-v-body">{OUTCOME_EXPLANATION[outcome]}</p> : null}
      </div>
    </div>
  );
}

export function ResultIcon({ result }: { result: DimResult }) {
  if (result === "fit") return <CircleCheck className="size-4 text-v-ok" aria-hidden />;
  if (result === "blocked") return <OctagonAlert className="size-4 text-v-danger" aria-hidden />;
  if (result === "na") return <Minus className="size-4 text-v-disabled" aria-hidden />;
  return <AlertTriangle className="size-4 text-v-warning" aria-hidden />;
}
