import { isDocumentedLanguage } from "./source";
import { deriveDirection, deriveUseCase, getValue, isInbound, isOutbound } from "./usecases";
import type { Answers, Direction, FileReadiness, TableRow, UseCaseId } from "./types";

/** Small helpers used by question triggers and by the rules, so both read the answers the same way. */

export const caseOf = (a: Answers): UseCaseId | null => deriveUseCase(a);
export const directionOf = (a: Answers): Direction | null => deriveDirection(a);
export const outboundOn = (a: Answers) => isOutbound(directionOf(a));
export const inboundOn = (a: Answers) => isInbound(directionOf(a));

export function selectedNeeds(a: Answers): string[] {
  const v = getValue<string[]>(a, "needs");
  return Array.isArray(v) ? v : [];
}

export function selectedLanguages(a: Answers): string[] {
  const v = getValue<string[]>(a, "languages");
  return Array.isArray(v) ? v : [];
}

export function undocumentedLanguages(a: Answers): string[] {
  return selectedLanguages(a).filter((l) => !isDocumentedLanguage(l));
}

/** Will the service answer questions from a knowledge base? Schemes and information services always do. */
export function kbIsNeeded(a: Answers): boolean {
  const uc = caseOf(a);
  if (!uc) return false;
  if (uc === "survey-feedback") return getValue<boolean>(a, "kbNeeded") === true;
  return true;
}

export function fileReadiness(a: Answers): FileReadiness {
  return getValue<FileReadiness>(a, "kbFiles") ?? {};
}

export function schemeRows(a: Answers): TableRow[] {
  const v = getValue<TableRow[]>(a, "schemeScope");
  return Array.isArray(v) ? v.filter((r) => r.name?.trim()) : [];
}

const INTEGRATION_NEEDS: Record<string, string> = {
  "existing-system": "a connection to an existing government system",
  database: "a connection to a departmental database",
  "case-records": "reading or updating case records",
  "api-webhook": "an API or webhook",
};

/** Why this requirement would need custom integration, in the person's terms. Empty when it does not. */
export function integrationReasons(a: Answers): string[] {
  const out: string[] = [];
  for (const n of selectedNeeds(a)) if (INTEGRATION_NEEDS[n]) out.push(`You need ${INTEGRATION_NEEDS[n]}.`);
  const mode = getValue<string>(a, "eligibilityMode");
  if (mode === "live-check") out.push("You want eligibility checked live against department records.");
  if (mode === "application") out.push("You want the service to submit applications.");
  const uc = caseOf(a);
  if (uc === "grievance") out.push("Complaint registration normally files the complaint in a complaints system.");
  if (uc === "form-application") out.push("Form and application support normally passes details to a form or application system.");
  return Array.from(new Set(out));
}

export const needsIntegration = (a: Answers) => integrationReasons(a).length > 0;

export const technicalSectionOpen = (a: Answers) =>
  selectedNeeds(a).some((n) => Object.keys(INTEGRATION_NEEDS).includes(n)) || needsIntegration(a);

export function text(a: Answers, id: string): string {
  const v = getValue<string>(a, id);
  return typeof v === "string" ? v.trim() : "";
}

export function num(a: Answers, id: string): number | null {
  const v = getValue<number | string | null>(a, id);
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
