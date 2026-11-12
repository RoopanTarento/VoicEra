import { COMPLEXITIES, USE_CASE_BY_ID } from "./catalog";
import type { Hosting, Requirements, StepId, Usage } from "./types";

export const emptyRequirements = (): Requirements => ({
  serviceName: "",
  useCase: "",
  interaction: ["inbound"],
  channel: "pstn",
  complexity: "faq",
  languages: [],
  voice: "none",
  dialects: false,
  codeSwitching: false,
  callsPerMonth: null,
  avgMinutes: null,
  peakConcurrent: null,
  growthPct: null,
  priority: "balanced",
  latency: "1-2",
  monthlyBudget: null,
  costPerMinute: null,
});

export const defaultHosting = (): Hosting => ({
  kind: "govcloud",
  region: "Mumbai",
  operator: "Platform-managed",
  inCountry: true,
  recording: "off",
  transcripts: "redacted",
  retention: {
    recordings: { days: null, access: "nobody" },
    transcripts: { days: 90, access: "operations" },
    logs: { days: 30, access: "platform_admin" },
    memory: { days: null, access: "nobody" },
  },
  pii: ["phone", "name", "govid"],
  piiCustom: "",
  integrations: { telephony: true, adapter: true, govApis: false, crm: false },
  availability: 99.5,
  support: "unset",
  disasterRecovery: false,
  callerNotice: "",
  retentionConfirmedBy: "",
});

/** What choosing a use case fills in. The adopter can change every one of them. */
export function applyUseCase(r: Requirements, useCaseId: string): Requirements {
  const u = USE_CASE_BY_ID[useCaseId];
  if (!u) return { ...r, useCase: useCaseId };
  return { ...r, useCase: useCaseId, complexity: u.complexity, interaction: [...u.interaction] };
}

const round100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);

/** Usage assumptions pre-filled from the requirements. Tokens and characters grow with the length of the call. */
export function usageFrom(r: Requirements): Usage {
  const c = COMPLEXITIES.find((x) => x.id === r.complexity) ?? COMPLEXITIES[0];
  const scale = (r.avgMinutes ?? 3) / 3;
  return {
    callsPerMonth: r.callsPerMonth ?? 0,
    avgMinutes: r.avgMinutes ?? 0,
    peakConcurrency: r.peakConcurrent ?? 0,
    llmTokensPerCall: round100(c.tokens * scale),
    ttsCharsPerCall: round100(c.chars * scale),
  };
}

export interface RequirementsIssue {
  field: string;
  message: string;
}

/** What must be filled before Continue. Budget and growth are optional, and lower the confidence instead. */
export function requirementsIssues(r: Requirements): RequirementsIssue[] {
  const out: RequirementsIssue[] = [];
  if (!r.serviceName.trim()) out.push({ field: "serviceName", message: "Give the service a name." });
  if (!r.useCase) out.push({ field: "useCase", message: "Choose a use case." });
  if (r.interaction.length === 0) out.push({ field: "interaction", message: "Choose at least one way calls happen." });
  if (r.languages.length === 0) out.push({ field: "languages", message: "Add at least one language." });
  if (!r.callsPerMonth || r.callsPerMonth <= 0) out.push({ field: "callsPerMonth", message: "Enter calls per month." });
  if (!r.avgMinutes || r.avgMinutes <= 0) out.push({ field: "avgMinutes", message: "Enter the average call length." });
  if (!r.peakConcurrent || r.peakConcurrent <= 0) out.push({ field: "peakConcurrent", message: "Enter the peak concurrent calls." });
  if (r.avgMinutes !== null && r.avgMinutes > 60) out.push({ field: "avgMinutes", message: "Average call length looks too long. Enter minutes, up to 60." });
  if (r.growthPct !== null && (r.growthPct < -90 || r.growthPct > 1000)) out.push({ field: "growthPct", message: "Growth should be between -90% and 1000%." });
  if (r.callsPerMonth && r.peakConcurrent && r.peakConcurrent > r.callsPerMonth) out.push({ field: "peakConcurrent", message: "Peak concurrent calls cannot be more than calls per month." });
  if (r.peakConcurrent && r.peakConcurrent > 5000) out.push({ field: "peakConcurrent", message: "That peak looks very high. Check the number." });
  return out;
}

export interface GroupStatus {
  id: string;
  label: string;
  done: boolean;
  hint: string;
}

/** The nine groups of input the recommendation draws on. */
export function completeness(r: Requirements, h: Hosting, reached: StepId[]): { done: number; total: number; groups: GroupStatus[]; missing: string[] } {
  const hostingSeen = reached.includes("hosting") || reached.includes("recommendation") || reached.includes("configure") || reached.includes("quote");
  const groups: GroupStatus[] = [
    { id: "usecase", label: "Use case & interaction", done: !!r.serviceName.trim() && !!r.useCase && r.interaction.length > 0, hint: "Service name and use case" },
    { id: "languages", label: "Languages", done: r.languages.length > 0, hint: "At least one language" },
    { id: "scale", label: "Scale", done: !!r.callsPerMonth && !!r.avgMinutes && !!r.peakConcurrent, hint: "Calls, duration and peak" },
    { id: "quality", label: "Quality & latency", done: !!r.priority && !!r.latency, hint: "What matters most" },
    { id: "budget", label: "Budget", done: !!r.monthlyBudget, hint: "Monthly ceiling" },
    { id: "hosting", label: "Hosting", done: hostingSeen && !!h.kind && !!h.region, hint: "Where it runs" },
    { id: "data", label: "Data handling", done: hostingSeen && !!h.transcripts, hint: "Recording and retention" },
    { id: "integrations", label: "Integrations", done: hostingSeen, hint: "Telephony and systems" },
    { id: "operations", label: "Operations", done: hostingSeen && h.support !== "unset" && !!h.availability, hint: "Support and availability" },
  ];
  const done = groups.filter((g) => g.done).length;
  return { done, total: groups.length, groups, missing: groups.filter((g) => !g.done).map((g) => g.label) };
}
