import { COMPONENT_BY_ID, PACKAGE_BY_ID, compLabel } from "./catalog";
import { priceOf, turnLatencyFor } from "./pricing";
import { inputHash, type Evaluation, type RecommendationResult } from "./recommend";
import { usageFrom } from "./defaults";
import { defaultHosting, emptyRequirements } from "./defaults";
import type { Hosting, PackageRecord, Requirements, Selection, StepId, Usage, VersionSnapshot } from "./types";

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

export function newPackageRecord(orgId: string, userName: string, name: string, now: string): PackageRecord {
  return {
    id: uid("pk"), orgId, name, createdAt: now, createdBy: userName, updatedAt: now, updatedBy: userName,
    step: "requirements", reached: ["requirements"], requirements: { ...emptyRequirements(), serviceName: name }, hosting: defaultHosting(),
    recommendation: null, selection: null, usage: null, versions: [], quote: null, openItems: {}, archived: false,
  };
}

export const costOf = (p: Pick<PackageRecord, "selection" | "usage" | "hosting" | "requirements">) =>
  p.selection && p.usage ? priceOf(p.selection, p.usage, p.hosting, p.requirements) : null;

export function nextLabel(versions: VersionSnapshot[]) { return `v1.${versions.length}`; }

export function snapshotOf(p: PackageRecord, label: string, note: string, by: string, now: string): VersionSnapshot {
  const sel = p.selection as Selection;
  const usage = p.usage as Usage;
  const cost = priceOf(sel, usage, p.hosting, p.requirements);
  const baseId = p.recommendation?.baseId ?? "";
  return { id: uid("v"), label, note, createdAt: now, createdBy: by, selection: { ...sel }, usage: { ...usage }, monthly: cost.recurring, oneTime: cost.oneTime, latencyS: turnLatencyFor(baseId, sel), baseId };
}

export function applyRecommendation(p: PackageRecord, result: RecommendationResult, by: string, now: string): PackageRecord {
  if (!result.recommended) return p;
  const e = result.recommended.eval;
  const next: PackageRecord = {
    ...p, selection: { ...e.selection }, usage: { ...e.usage },
    recommendation: { generatedAt: now, inputHash: inputHash(p.requirements, p.hosting), baseId: e.pkg.id, variant: "recommended" },
    updatedAt: now, updatedBy: by,
  };
  if (next.versions.length === 0) next.versions = [snapshotOf(next, "v1.0", `Recommended: ${e.pkg.name}`, by, now)];
  else if (p.selection && diffConfig({ selection: p.selection, usage: p.usage ?? e.usage }, { selection: next.selection as Selection, usage: next.usage as Usage }).length > 0) {
    next.versions = [...next.versions, snapshotOf(next, nextLabel(next.versions), `Recommendation refreshed: ${e.pkg.name}`, by, now)];
  }
  return next;
}

export function chooseEvaluation(p: PackageRecord, e: Evaluation, variant: "recommended" | "cost" | "quality" | "latency", by: string, now: string): PackageRecord {
  const next: PackageRecord = {
    ...p, selection: { ...e.selection }, usage: { ...e.usage },
    recommendation: { generatedAt: p.recommendation?.generatedAt ?? now, inputHash: inputHash(p.requirements, p.hosting), baseId: e.pkg.id, variant },
    updatedAt: now, updatedBy: by,
  };
  const note = variant === "recommended" ? `Selected ${e.pkg.name}` : `Selected ${variant === "cost" ? "cost" : variant === "quality" ? "quality" : "latency"}-optimised: ${e.pkg.name}`;
  next.versions = [...p.versions, snapshotOf(next, nextLabel(p.versions), note, by, now)];
  return next;
}

export const isStale = (p: PackageRecord) => !!p.recommendation && p.recommendation.inputHash !== inputHash(p.requirements, p.hosting);

export interface Change { layer: string; from: string; to: string }
const LAYERS: { key: keyof Selection; label: string }[] = [
  { key: "asr", label: "Speech recognition" }, { key: "llm", label: "Language model" }, { key: "tts", label: "Voice" },
  { key: "telephony", label: "Telephony" }, { key: "adapter", label: "Language adapter" }, { key: "hostingProfile", label: "Hosting profile" },
];
const USAGE: { key: keyof Usage; label: string }[] = [
  { key: "callsPerMonth", label: "Calls per month" }, { key: "avgMinutes", label: "Average minutes" }, { key: "peakConcurrency", label: "Peak concurrent calls" },
  { key: "llmTokensPerCall", label: "Model tokens per call" }, { key: "ttsCharsPerCall", label: "Voice characters per call" },
];
const nameOf = (id: string) => (COMPONENT_BY_ID[id] ? compLabel(COMPONENT_BY_ID[id]) : id);

export function diffConfig(a: { selection: Selection; usage: Usage }, b: { selection: Selection; usage: Usage }): Change[] {
  const out: Change[] = [];
  for (const l of LAYERS) if (a.selection[l.key] !== b.selection[l.key]) out.push({ layer: l.label, from: l.key === "hostingProfile" ? a.selection[l.key] : nameOf(a.selection[l.key]), to: l.key === "hostingProfile" ? b.selection[l.key] : nameOf(b.selection[l.key]) });
  for (const u of USAGE) if (a.usage[u.key] !== b.usage[u.key]) out.push({ layer: u.label, from: String(a.usage[u.key]), to: String(b.usage[u.key]) });
  return out;
}

export function restoreVersion(p: PackageRecord, v: VersionSnapshot, by: string, now: string): PackageRecord {
  const next: PackageRecord = { ...p, selection: { ...v.selection }, usage: { ...v.usage }, updatedAt: now, updatedBy: by };
  next.versions = [...p.versions, snapshotOf(next, nextLabel(p.versions), `Restored ${v.label}`, by, now)];
  return next;
}

export function atVersion(p: PackageRecord) {
  const v = p.versions[p.versions.length - 1];
  return v ?? null;
}

/** True when the working configuration differs from the newest saved version. */
export function hasUnsavedConfig(p: PackageRecord): boolean {
  const v = atVersion(p);
  if (!v || !p.selection || !p.usage) return false;
  return diffConfig(v, { selection: p.selection, usage: p.usage }).length > 0;
}

export function duplicateRecord(p: PackageRecord, by: string, now: string, existing: string[]): PackageRecord {
  let name = `${p.name} (copy)`;
  for (let i = 2; existing.includes(name); i++) name = `${p.name} (copy ${i})`;
  return { ...p, id: uid("pk"), name, requirements: { ...p.requirements, serviceName: name }, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by, quote: null, openItems: {}, versions: p.versions.map((v) => ({ ...v })), archived: false };
}

export function resetUsage(p: PackageRecord): Usage { return usageFrom(p.requirements); }
export { PACKAGE_BY_ID };
export type { Hosting, Requirements, StepId };
