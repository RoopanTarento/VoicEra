import {
  ADAPTERS, ASRS, AVAILABILITY_FEE, COMPONENT_BY_ID, DR_MONTHLY, HOSTING_PROFILES, LLMS, PACKAGE_BY_ID, PROFILE_BY_ID, SETUP_FEES, SUPPORT_MODELS, TELEPHONY, TTSS,
  sizeRank, type Adapter, type Asr, type HostingProfile, type Llm, type ProfileSize, type Telephony, type Tts,
} from "./catalog";
import { inr, millions, num } from "./format";
import type { CostLine, CostResult, Hosting, HostingKind, Requirements, Selection, Usage } from "./types";

/**
 * The cost engine. Every number is a unit rate times a usage assumption, or a fixed charge.
 * It is an estimate, never an invoice. Rates come from the (sample) catalogue.
 */

export function profileFor(kind: HostingKind, minSize: ProfileSize, peak: number): { profile: HostingProfile; undersized: boolean } {
  const options = HOSTING_PROFILES.filter((p) => p.kind === kind).sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
  const ok = options.filter((p) => sizeRank(p.size) >= sizeRank(minSize));
  const fit = ok.find((p) => p.capacity >= peak);
  if (fit) return { profile: fit, undersized: false };
  const biggest = ok[ok.length - 1] ?? options[options.length - 1];
  return { profile: biggest, undersized: true };
}

export const supportFee = (s: Hosting["support"]) => SUPPORT_MODELS.find((m) => m.id === (s === "unset" ? "business" : s))?.fee ?? 0;

export function oneTimeFor(profile: HostingProfile, h: Hosting, adapterId: string): number {
  const i = h.integrations;
  return (
    SETUP_FEES.base +
    profile.setup +
    (i.govApis ? SETUP_FEES.govApis : 0) +
    (i.crm ? SETUP_FEES.crm : 0) +
    (i.telephony ? SETUP_FEES.telephony : 0) +
    (adapterId === "adapter-coss" ? SETUP_FEES.adapter : 0) +
    (h.disasterRecovery ? SETUP_FEES.disasterRecovery : 0)
  );
}

function recurringFor(sel: Selection, u: Usage, h: Hosting, scale: number): { lines: CostLine[]; total: number } {
  const asr = COMPONENT_BY_ID[sel.asr] as Asr | undefined;
  const llm = COMPONENT_BY_ID[sel.llm] as Llm | undefined;
  const tts = COMPONENT_BY_ID[sel.tts] as Tts | undefined;
  const tel = COMPONENT_BY_ID[sel.telephony] as Telephony | undefined;
  const ada = COMPONENT_BY_ID[sel.adapter] as Adapter | undefined;
  const prof = PROFILE_BY_ID[sel.hostingProfile];
  const calls = u.callsPerMonth * scale;
  const minutes = calls * u.avgMinutes;
  const asrCost = asr?.rate != null ? minutes * asr.rate : null;
  const telCost = tel?.rate != null ? minutes * tel.rate : null;
  const llmCost = llm?.rate != null ? ((calls * u.llmTokensPerCall) / 1000) * llm.rate : null;
  const ttsCost = tts?.rate != null ? ((calls * u.ttsCharsPerCall) / 1000) * tts.rate : null;
  const hosting = (prof?.monthly ?? 0) + (h.disasterRecovery ? DR_MONTHLY : 0);
  const platform = supportFee(h.support) + (AVAILABILITY_FEE[h.availability] ?? 0);
  const langCost = ada?.rate == null ? null : calls * ada.rate;
  const lines: CostLine[] = [
    { id: "asr", label: "ASR", unitRate: asr ? `${inr(asr.rate, { decimals: 2 })} ${asr.unit}` : "—", usage: `${num(minutes)} min`, monthly: asrCost },
    { id: "llm", label: "LLM", unitRate: llm ? `${inr(llm.rate, { decimals: 3 })} ${llm.unit}` : "—", usage: `${millions(calls * u.llmTokensPerCall)} tokens`, monthly: llmCost },
    { id: "tts", label: "TTS", unitRate: tts ? `${inr(tts.rate, { decimals: 2 })} ${tts.unit}` : "—", usage: `${millions(calls * u.ttsCharsPerCall)} chars`, monthly: ttsCost },
    { id: "telephony", label: "Telephony", unitRate: tel ? `${inr(tel.rate, { decimals: 2 })} ${tel.unit}` : "—", usage: `${num(minutes)} min`, monthly: telCost },
    { id: "hosting", label: "Hosting / infrastructure", unitRate: prof ? `${inr(prof.monthly)} / month fixed` : "—", usage: "1 environment", monthly: hosting, note: prof?.kind === "onprem" ? "Your hardware is not included" : undefined },
    { id: "language", label: "Language services", unitRate: ada?.rate == null ? "Rate unknown" : "No charge", usage: "—", monthly: langCost, note: ada?.rate == null ? "Not included" : undefined },
    { id: "platform", label: "Platform & support", unitRate: SUPPORT_MODELS.find((m) => m.id === (h.support === "unset" ? "business" : h.support))?.label ?? "—", usage: "—", monthly: platform, note: h.support === "unset" ? "Assumes business hours" : undefined },
  ];
  const total = lines.reduce((t, l) => t + (l.monthly ?? 0), 0);
  return { lines, total };
}

const r0 = (n: number) => Math.round(n);

export function priceOf(sel: Selection, u: Usage, h: Hosting, r: Pick<Requirements, "monthlyBudget" | "costPerMinute" | "growthPct">): CostResult {
  const now = recurringFor(sel, u, h, 1);
  const lines = now.lines.map((l) => ({ ...l, monthly: l.monthly === null ? null : r0(l.monthly) }));
  const recurring = lines.reduce((t, l) => t + (l.monthly ?? 0), 0);
  const prof = PROFILE_BY_ID[sel.hostingProfile];
  const oneTime = prof ? oneTimeFor(prof, h, sel.adapter) : 0;
  const minutes = u.callsPerMonth * u.avgMinutes;
  const perMinute = minutes > 0 ? recurring / minutes : 0;
  const budgetUsedPct = r.monthlyBudget ? (recurring / r.monthlyBudget) * 100 : null;
  const growth = r.growthPct ?? null;
  const at12 = growth === null ? null : r0(recurringFor(sel, u, h, 1 + growth / 100).total);
  const excluded = ["Taxes", "Customer-provided infrastructure", "Third-party charges with unknown rates"];
  if (lines.find((l) => l.id === "language")?.monthly === null) excluded.unshift("Language-service charges (rate unknown)");
  return {
    lines,
    recurring,
    oneTime,
    budgetUsedPct,
    overBudget: budgetUsedPct !== null && budgetUsedPct > 100,
    perMinute,
    perMinuteOver: !!r.costPerMinute && perMinute > r.costPerMinute,
    recurringAt12: at12,
    minutes,
    excluded,
  };
}

/** Sum of component latencies, a rough end-to-end figure used only to adjust a measured package figure. */
export function stackLatencyMs(sel: Selection): number {
  return ["asr", "llm", "tts", "telephony", "adapter"].reduce((t, k) => t + (COMPONENT_BY_ID[sel[k as keyof Selection]]?.latencyMs ?? 0), 0);
}

/**
 * Turn latency for a configured stack: the measured figure of the package it started from,
 * moved by how much the swapped components differ in speed. Reported as an estimate.
 */
export function turnLatencyFor(baseId: string, sel: Selection): number {
  const pkg = PACKAGE_BY_ID[baseId];
  if (!pkg) return 0;
  const base = { ...pkg.selection } as Selection;
  const diff = stackLatencyMs(sel) - stackLatencyMs(base);
  return Math.max(0.3, Math.round((pkg.metrics.turnLatencyS + diff / 1000) * 10) / 10);
}

export const ALL_OPTIONS = { asr: ASRS, llm: LLMS, tts: TTSS, telephony: TELEPHONY, adapter: ADAPTERS };

/** What changed in the price between two configurations of the same usage. */
export function priceDelta(a: CostResult, b: CostResult): { monthly: number; oneTime: number } {
  return { monthly: b.recurring - a.recurring, oneTime: b.oneTime - a.oneTime };
}
