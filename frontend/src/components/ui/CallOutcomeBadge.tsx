import { Badge } from "@/components/ui/Badge";
import type { CallAnalysis, CallOutcome } from "@/lib/api-types";

const OUTCOME_TONE: Record<CallOutcome, "live" | "accent" | "danger" | "warn" | "neutral" | "draft"> = {
  interested: "live",
  callback: "accent",
  not_interested: "danger",
  wrong_person: "warn",
  no_answer: "neutral",
  unclear: "draft",
  will_apply: "live",
  already_enrolled: "accent",
  informed: "live",
  issue_reported: "warn",
  no_issue: "neutral",
  survey_completed: "live",
  survey_partial: "accent",
  survey_declined: "neutral",
};

/** Display names for outcomes, matching the API's `outcome_label` (used where
 * there is no call yet, e.g. what an agent will record). */
export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  interested: "Interested",
  callback: "Call back later",
  not_interested: "Not interested",
  wrong_person: "Wrong person",
  no_answer: "No answer",
  unclear: "Unclear",
  will_apply: "Will apply",
  already_enrolled: "Already enrolled",
  informed: "Knows next steps",
  issue_reported: "Problem reported",
  no_issue: "No problem",
  survey_completed: "Survey completed",
  survey_partial: "Survey partly done",
  survey_declined: "Declined survey",
};

/** The call's analysed outcome (Interested, Call back, …) — shared by the
 * History table and the call detail sheet. */
export function OutcomeBadge({ outcome }: { outcome: CallOutcome }) {
  return <Badge tone={OUTCOME_TONE[outcome] ?? "neutral"}>{OUTCOME_LABELS[outcome] ?? outcome}</Badge>;
}

export function CallOutcomeBadge({ analysis }: { analysis?: CallAnalysis | null }) {
  if (!analysis?.outcome_label) return <span className="text-v-muted">–</span>;
  return <Badge tone={OUTCOME_TONE[analysis.outcome] ?? "neutral"}>{analysis.outcome_label}</Badge>;
}
