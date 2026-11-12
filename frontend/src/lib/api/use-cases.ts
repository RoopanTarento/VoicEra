import { apiFetch, apiFetchBlob } from "@/lib/api/http";
import type { AgentUseCase, SchemeIntent } from "@/lib/api-types";

export interface UseCaseInfo {
  id: "scheme" | "city_survey";
  name: string;
  description: string;
}

/** What a scheme agent's calls are for, and what they record. */
export interface IntentInfo {
  id: SchemeIntent;
  name: string;
  description: string;
  /** null = any number of schemes. */
  max_schemes: number | null;
  steps: string[];
  /** Outcomes this intent's calls usually end with (a call that switched path can end with another's). */
  outcomes: string[];
}

/** How a scheme's benefit reaches people (cash, insurance, loan…). */
export interface SchemeKind {
  id: string;
  label: string;
}

/** A government scheme the agent can explain. Built-in facts are checked against official sources. */
export interface Scheme {
  id: string;
  name: string;
  category: string;
  summary: string;
  benefit: string;
  eligibility: string;
  documents: string[];
  how_to_apply: string;
  website: string;
  helpline: string;
  questions: string[];
  sources: string[];
  kind: string;
  /** File name of the scheme's built-in knowledge pack. */
  pack_name: string;
  last_checked: string;
  /** Added by this organisation (state or city scheme). */
  custom: boolean;
  created_by?: string;
}

export interface SurveyQuestion {
  id: string;
  kind: "rating" | "yes_no" | "open";
  text: string;
}

export interface Survey {
  id: string;
  name: string;
  topic: string;
  /** Set on a scheme feedback survey. */
  scheme_id?: string;
  questions: SurveyQuestion[];
}

export interface UseCaseCatalogue {
  use_cases: UseCaseInfo[];
  intents: IntentInfo[];
  kinds: SchemeKind[];
  schemes: Scheme[];
  surveys: Survey[];
  /** The survey a Feedback agent runs, one per scheme. */
  feedback_surveys: Survey[];
  facts_checked: string;
}

/** A scheme's built-in knowledge pack (written into the agent's prompt; no upload). */
export interface KnowledgePack {
  scheme_id: string;
  name: string;
}

/** Ready-made agent text for a use case; every field stays editable in the wizard. */
export interface UseCasePreset {
  use_case: AgentUseCase;
  name: string;
  purpose: string;
  welcome: string;
  prompt: string;
  /** Built-in knowledge packs written into the prompt (empty for city surveys). */
  knowledge: KnowledgePack[];
}

export interface CustomSchemeInput {
  name: string;
  category?: string;
  summary?: string;
  benefit: string;
  eligibility: string;
  how_to_apply: string;
  website?: string;
  helpline?: string;
  kind?: string;
  documents?: string[];
  questions?: string[];
  sources?: string[];
}

export function getUseCaseCatalogue(): Promise<UseCaseCatalogue> {
  return apiFetch<UseCaseCatalogue>("/use-cases");
}

export function getUseCasePreset(useCase: AgentUseCase): Promise<UseCasePreset> {
  return apiFetch<UseCasePreset>("/use-cases/preset", {
    method: "POST",
    body: JSON.stringify({
      use_case: useCase.type,
      intent: useCase.type === "scheme" ? (useCase.intent ?? "discovery") : null,
      scheme_ids: useCase.scheme_ids,
      survey_id: useCase.survey_id ?? null,
    }),
  });
}

/** A scheme's built-in knowledge pack as a PDF. */
export function fetchKnowledgePack(schemeId: string): Promise<Blob> {
  return apiFetchBlob(`/use-cases/knowledge/${encodeURIComponent(schemeId)}`);
}

export function addCustomScheme(input: CustomSchemeInput): Promise<Scheme> {
  return apiFetch<Scheme>("/use-cases/schemes", { method: "POST", body: JSON.stringify(input) });
}

export function deleteCustomScheme(schemeId: string): Promise<{ status: string }> {
  return apiFetch(`/use-cases/schemes/${encodeURIComponent(schemeId)}`, { method: "DELETE" });
}

/** A saved agent's use case in the current shape: agents saved before intents
 * existed say "scheme_discovery", which is a scheme agent with the discovery intent. */
export function normaliseUseCase(raw: unknown): AgentUseCase | null {
  if (!raw || typeof raw !== "object") return null;
  const uc = raw as { type?: string; intent?: string | null; scheme_ids?: string[]; survey_id?: string | null };
  if (uc.type === "scheme" || uc.type === "scheme_discovery") {
    const intents: SchemeIntent[] = ["awareness", "discovery", "enrolment", "utilisation", "support", "feedback"];
    const intent = intents.includes(uc.intent as SchemeIntent) ? (uc.intent as SchemeIntent) : "discovery";
    return { type: "scheme", intent, scheme_ids: uc.scheme_ids ?? [], survey_id: null };
  }
  if (uc.type === "city_survey") return { type: "city_survey", intent: null, scheme_ids: [], survey_id: uc.survey_id ?? null };
  return null;
}

/** "1 scheme", "Up to 3 schemes" or "Any number of schemes", for an intent's limit. */
export function schemeLimitLabel(max: number | null): string {
  if (max === 1) return "1 scheme";
  if (max) return `Up to ${max} schemes`;
  return "Any number of schemes";
}
