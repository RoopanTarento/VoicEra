import { GROUPS, QUESTIONS } from "./questions";
import { deriveUseCase } from "./usecases";
import type { Answers, FileReadiness, GroupId, Question, TableRow } from "./types";

/** Pure functions over the answer set. No React, no storage. */

export function visibleQuestions(a: Answers): Question[] {
  const uc = deriveUseCase(a);
  return QUESTIONS.filter((q) => {
    if (q.appliesTo && (!uc || !q.appliesTo.includes(uc))) return false;
    // Until the objective is chosen, nothing else is relevant.
    if (q.id !== "objective" && !a.values.objective) return false;
    // Information services also need the topic answered before the rest make sense.
    if (q.id !== "objective" && q.id !== "infoTopic" && !uc) return false;
    return q.when ? q.when(a) : true;
  });
}

export interface Step {
  id: GroupId;
  title: string;
  blurb: string;
  questions: Question[];
}

/** The steps that have at least one question for this person, in order. */
export function stepsFor(a: Answers): Step[] {
  const vis = visibleQuestions(a);
  return GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    blurb: g.blurb,
    questions: vis.filter((q) => q.group === g.id),
  })).filter((s) => s.questions.length > 0);
}

export function isAnswered(q: Question, a: Answers): boolean {
  if (a.unknown[q.id]) return true;
  const v = a.values[q.id];
  switch (q.kind) {
    case "multi":
    case "language":
      return Array.isArray(v) && v.length > 0;
    case "table":
      return Array.isArray(v) && (v as TableRow[]).some((r) => (r.name ?? "").trim() !== "");
    case "fileReadiness": {
      const f = v as FileReadiness | undefined;
      return !!f && (f.count != null || f.maxMB != null || (f.formats?.length ?? 0) > 0);
    }
    case "yesno":
      return typeof v === "boolean";
    case "number":
      return v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));
    case "shorttext":
    case "longtext":
      return typeof v === "string" && v.trim() !== "";
    default:
      return typeof v === "string" && v !== "";
  }
}

export function questionError(q: Question, a: Answers): string | null {
  if (a.unknown[q.id]) return null;
  const v = a.values[q.id];
  if (!isAnswered(q, a)) {
    if (!q.required) return null;
    return q.kind === "shorttext" || q.kind === "longtext" || q.kind === "number"
      ? "Enter an answer, or choose Not sure yet."
      : "Choose an option to continue.";
  }
  if (q.kind === "number") {
    const n = Number(v);
    if (q.min !== undefined && n < q.min) return `Enter ${q.min} or more.`;
    if (q.max !== undefined && n > q.max) return `Enter ${q.max} or fewer.`;
  }
  if (q.kind === "shorttext" && typeof v === "string" && v.length > 120) return "Keep this under 120 characters.";
  if (q.kind === "longtext" && typeof v === "string" && v.length > 600) return "Keep this under 600 characters.";
  if (q.kind === "language") {
    const bad = (v as string[]).find((l) => l.trim().length < 2);
    if (bad !== undefined) return "A language name needs at least 2 letters.";
  }
  if (q.kind === "fileReadiness") {
    const f = v as FileReadiness;
    if (f.count != null && (f.count < 0 || !Number.isInteger(f.count))) return "The number of files must be a whole number, zero or more.";
    if (f.maxMB != null && f.maxMB < 0) return "File size cannot be negative.";
  }
  return null;
}

export function stepErrors(step: Step, a: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of step.questions) {
    const e = questionError(q, a);
    if (e) out[q.id] = e;
  }
  return out;
}

/** Remove answers for questions that are no longer asked, so old answers cannot skew the result. */
export function prune(a: Answers): Answers {
  const visible = new Set(visibleQuestions(a).map((q) => q.id));
  const values: Record<string, unknown> = {};
  const unknown: Record<string, boolean> = {};
  const origin: Answers["origin"] = {};
  for (const [k, v] of Object.entries(a.values)) if (visible.has(k)) values[k] = v;
  for (const [k, v] of Object.entries(a.unknown)) if (visible.has(k) && v) unknown[k] = true;
  for (const [k, v] of Object.entries(a.origin)) if (visible.has(k)) origin[k] = v;
  return { values, unknown, origin };
}

export function setValue(a: Answers, id: string, value: unknown, origin: "user" | "interpreted" = "user"): Answers {
  const values = { ...a.values, [id]: value };
  const unknown = { ...a.unknown };
  delete unknown[id];
  return prune({ values, unknown, origin: { ...a.origin, [id]: origin } });
}

export function setUnknown(a: Answers, id: string, on: boolean): Answers {
  const values = { ...a.values };
  const unknown = { ...a.unknown };
  if (on) {
    delete values[id];
    unknown[id] = true;
  } else {
    delete unknown[id];
  }
  return prune({ values, unknown, origin: a.origin });
}

export function requiredRemaining(a: Answers): Question[] {
  return visibleQuestions(a).filter((q) => q.required && !isAnswered(q, a));
}

export function progress(a: Answers) {
  const vis = visibleQuestions(a);
  const required = vis.filter((q) => q.required);
  const done = required.filter((q) => isAnswered(q, a)).length;
  return { required: required.length, done, optional: vis.length - required.length };
}

/** Plain-language rendering of an answer, for summaries and exports. */
export function describeAnswer(q: Question, a: Answers): string {
  if (a.unknown[q.id]) return "Not sure yet";
  const v = a.values[q.id];
  if (v === undefined || v === null || v === "") return "Not answered";
  const opt = (x: string) => q.options?.find((o) => o.value === x)?.label ?? x;
  switch (q.kind) {
    case "multi":
    case "language":
      return (v as string[]).map(opt).join(", ");
    case "yesno":
      return v ? "Yes" : "No";
    case "table":
      return (v as TableRow[])
        .filter((r) => r.name?.trim())
        .map((r) => (r.audience ? `${r.name} (${r.audience})` : r.name))
        .join("; ");
    case "fileReadiness": {
      const f = v as FileReadiness;
      const parts: string[] = [];
      if (f.count != null) parts.push(`${f.count} file${f.count === 1 ? "" : "s"}`);
      if (f.maxMB != null) parts.push(`largest ${f.maxMB} MB`);
      if (f.formats?.length) parts.push(f.formats.join(", "));
      return parts.join(", ") || "Not answered";
    }
    case "number":
      return `${v}${q.unit ? ` ${q.unit}` : ""}`;
    default:
      return typeof v === "string" ? opt(v) : String(v);
  }
}
