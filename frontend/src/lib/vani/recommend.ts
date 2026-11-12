import {
  COMPLEXITY_TIER, COMPONENT_BY_ID, HOSTING_OPTIONS, LANGUAGE_BY_ID, LATENCIES, PACKAGES, PACKAGE_BY_ID, compLabel, sizeRank,
  type Asr, type CatalogPackage, type Support, type Telephony, type Tts,
} from "./catalog";
import { completeness, usageFrom } from "./defaults";
import { pct } from "./format";
import { priceOf, profileFor } from "./pricing";
import type { CostResult, Hosting, Requirements, Selection, StepId, Usage } from "./types";

/**
 * The recommendation. Hosting and data rules filter packages out first, with a reason for each.
 * What is left is scored against what the adopter said matters, and the score is split into parts
 * that can be shown. Nothing is hidden: the same numbers drive the page.
 */

export type LangLevel = "tested" | "partial" | "none";

export interface LangFit {
  id: string;
  name: string;
  level: LangLevel;
  asr: Support;
  tts: Support;
  benchmarked: boolean;
}

export interface Evaluation {
  pkg: CatalogPackage;
  selection: Selection;
  usage: Usage;
  cost: CostResult;
  latencyS: number;
  undersized: boolean;
  langs: LangFit[];
  parts: { lang: number; latency: number; budget: number; cost: number; quality: number; tier: number; hosting: number };
  fit: number;
  /** Reasons the package cannot be offered. Empty when it can. */
  excluded: string[];
}

export function langFit(pkg: CatalogPackage, sel: Pick<Selection, "asr" | "tts">, langId: string): LangFit {
  const asr = (COMPONENT_BY_ID[sel.asr] as Asr | undefined)?.langs[langId] ?? "none";
  const tts = (COMPONENT_BY_ID[sel.tts] as Tts | undefined)?.langs[langId] ?? "none";
  const benchmarked = pkg.benchmarkLangs.includes(langId);
  const level: LangLevel = asr === "none" || tts === "none" ? "none" : asr === "tested" && tts === "tested" && benchmarked ? "tested" : "partial";
  return { id: langId, name: LANGUAGE_BY_ID[langId]?.name ?? langId, level, asr, tts, benchmarked };
}

export function packageSelection(pkg: CatalogPackage, h: Hosting, usage: Usage, growth: number | null) {
  const peak = usage.peakConcurrency * (1 + Math.max(0, growth ?? 0) / 100);
  const { profile, undersized } = profileFor(h.kind, pkg.minProfile, peak);
  const selection: Selection = { ...pkg.selection, hostingProfile: profile.id };
  return { selection, undersized };
}

export function latencyTarget(r: Requirements): number | null {
  return LATENCIES.find((l) => l.id === r.latency)?.maxS ?? null;
}

/** Hard rules. A package that breaks one is excluded, and says why. */
export function exclusionReasons(pkg: CatalogPackage, r: Requirements, h: Hosting, usage: Usage, unavailable: string[] = []): string[] {
  const out: string[] = [];
  const comps = Object.values(pkg.selection).map((id) => COMPONENT_BY_ID[id]);
  const hostLabel = HOSTING_OPTIONS.find((o) => o.id === h.kind)?.label ?? h.kind;
  const blocker = comps.find((c) => !c.hosting.includes(h.kind));
  if (blocker) out.push(`Can't run on ${hostLabel}: ${compLabel(blocker)} isn't available there.`);
  if (h.inCountry) {
    const abroad = comps.find((c) => !c.inCountry);
    if (abroad) out.push(`Data would leave India: ${compLabel(abroad)} runs outside the country.`);
  }
  for (const l of r.languages) {
    const f = langFit(pkg, pkg.selection, l);
    if (f.level === "none") out.push(`Doesn't support ${f.name}: ${f.asr === "none" ? "no speech recognition" : "no voice"} for it.`);
  }
  const tel = COMPONENT_BY_ID[pkg.selection.telephony] as Telephony;
  if (!tel.channels.includes(r.channel)) out.push(`${tel.provider} doesn't carry this channel.`);
  if (r.interaction.includes("broadcast") && !tel.broadcast) out.push(`${tel.provider} can't run broadcast campaigns.`);
  if (COMPLEXITY_TIER[r.complexity] - pkg.maxTier >= 2) out.push("The language model is too small for complex reasoning.");
  if (usage.peakConcurrency > pkg.metrics.maxPeak) out.push(`Tested up to ${pkg.metrics.maxPeak} calls at once. You need ${usage.peakConcurrency}.`);
  for (const c of comps) if (unavailable.includes(c.id)) out.push(`${compLabel(c)} is unavailable right now.`);
  return out;
}

export type Weights = Evaluation["parts"];
export const WEIGHTS: Record<Requirements["priority"], Weights> = {
  cost: { cost: 0.3, budget: 0.15, quality: 0.1, latency: 0.1, lang: 0.2, hosting: 0.05, tier: 0.1 },
  balanced: { cost: 0.15, budget: 0.15, quality: 0.2, latency: 0.15, lang: 0.2, hosting: 0.05, tier: 0.1 },
  quality: { cost: 0.05, budget: 0.1, quality: 0.35, latency: 0.1, lang: 0.2, hosting: 0.05, tier: 0.15 },
};

export interface EvalSet {
  all: Evaluation[];
  candidates: Evaluation[];
  excluded: Evaluation[];
}

/** Evaluate every catalogue package against the requirements and hosting rules. */
export function evaluateAll(r: Requirements, h: Hosting, usageIn?: Usage, unavailable: string[] = []): EvalSet {
  const usage = usageIn ?? usageFrom(r);
  const raw = PACKAGES.map((pkg) => {
    const { selection, undersized } = packageSelection(pkg, h, usage, r.growthPct);
    const cost = priceOf(selection, usage, h, r);
    const excluded = exclusionReasons(pkg, r, h, usage, unavailable);
    const langs = r.languages.map((l) => langFit(pkg, selection, l));
    return { pkg, selection, usage, cost, latencyS: pkg.metrics.turnLatencyS, undersized, langs, excluded };
  });
  const live = raw.filter((e) => e.excluded.length === 0);
  const rec = live.map((e) => e.cost.recurring);
  const min = Math.min(...rec, Infinity);
  const max = Math.max(...rec, -Infinity);
  const target = latencyTarget(r);
  const w = WEIGHTS[r.priority];
  const all: Evaluation[] = raw.map((e) => {
    const asr = COMPONENT_BY_ID[e.selection.asr] as Asr;
    const tts = COMPONENT_BY_ID[e.selection.tts] as Tts;
    const langScoreList: number[] = e.langs.map((l) => (l.level === "tested" ? 1 : l.level === "partial" ? 0.55 : 0));
    let lang = langScoreList.length ? langScoreList.reduce((a, b) => a + b, 0) / langScoreList.length : 0.7;
    const extras: number[] = [];
    if (r.dialects) extras.push(asr.dialectsTested ? 1 : 0.4);
    if (r.codeSwitching) extras.push(asr.codeSwitch ? 1 : 0.4);
    if (extras.length) lang = (lang * 2 + extras.reduce((a, b) => a + b, 0)) / (2 + extras.length);
    const latency = target === null ? 1 : e.latencyS <= target ? 1 : Math.max(0, 1 - (e.latencyS - target) / target);
    const budget = !r.monthlyBudget ? 0.7 : e.cost.recurring <= r.monthlyBudget ? 1 : Math.max(0, 1 - (e.cost.recurring / r.monthlyBudget - 1) * 1.5);
    const cost = max > min && Number.isFinite(min) ? 1 - (e.cost.recurring - min) / (max - min) : 1;
    let quality = (e.pkg.metrics.taskCompletion / 100) * 0.65 + (e.pkg.metrics.voiceQuality / 5) * 0.35;
    if (r.voice !== "none" && tts.voice !== r.voice) quality *= 0.9;
    const tier = COMPLEXITY_TIER[r.complexity] <= e.pkg.maxTier ? 1 : 0.5;
    const hosting = e.undersized ? 0.4 : sizeRank(PROFILE_SIZE(e.selection.hostingProfile)) > 1 ? 0.85 : 1;
    const parts = { lang, latency, budget, cost, quality, tier, hosting };
    const fit = Math.round(100 * (Object.keys(w) as (keyof Weights)[]).reduce((t, k) => t + w[k] * parts[k], 0));
    return { ...e, parts, fit };
  });
  return { all, candidates: all.filter((e) => e.excluded.length === 0).sort((a, b) => b.fit - a.fit), excluded: all.filter((e) => e.excluded.length > 0) };
}

import { PROFILE_BY_ID } from "./catalog";
const PROFILE_SIZE = (id: string) => PROFILE_BY_ID[id]?.size ?? "standard";

export type Variant = "recommended" | "cost" | "quality" | "latency";

export interface Alternative {
  variant: Exclude<Variant, "recommended">;
  eval: Evaluation;
  advantage: string;
  tradeoffs: string[];
}

export interface Recommended {
  eval: Evaluation;
  why: string[];
  tradeoffs: string[];
  unresolved: string[];
  confidence: number;
}

export interface RecommendationResult {
  set: EvalSet;
  status: "ok" | "none";
  recommended: Recommended | null;
  alternatives: Alternative[];
  excluded: Evaluation[];
  candidates: Evaluation[];
  completeness: ReturnType<typeof completeness>;
  budgetNotice: null | { closest: Evaluation; overByPct: number };
  /** If nothing can be recommended: what to change. */
  suggestions: string[];
}

const hostName = (h: Hosting) => HOSTING_OPTIONS.find((o) => o.id === h.kind)?.label ?? h.kind;

function whyFits(e: Evaluation, r: Requirements, h: Hosting): string[] {
  const out: string[] = [];
  const tested = e.langs.filter((l) => l.level === "tested").map((l) => l.name);
  if (e.langs.length && tested.length === e.langs.length) out.push(e.langs.length === 1 ? `Tested for ${tested[0]}` : `Tested for ${e.langs.length === 2 ? "both languages" : `all ${e.langs.length} languages`}`);
  else if (tested.length) out.push(`Tested for ${tested.join(", ")}`);
  out.push(`Runs on ${hostName(h).toLowerCase()} in ${h.region}${h.inCountry ? ", data stays in India" : ""}`);
  const t = latencyTarget(r);
  if (t === null) out.push(`Turns take about ${e.latencyS.toFixed(1)} s, measured`);
  else if (e.latencyS <= t) out.push(`Meets the ${LATENCIES.find((l) => l.id === r.latency)?.label.toLowerCase()} latency target (${e.latencyS.toFixed(1)} s measured)`);
  if (r.monthlyBudget && !e.cost.overBudget) out.push(`Within your budget: ${pct(e.cost.budgetUsedPct ?? 0)} of the ceiling`);
  if (COMPLEXITY_TIER[r.complexity] <= e.pkg.maxTier) out.push(`Handles ${r.complexity === "faq" ? "FAQ" : r.complexity === "transactional" ? "transactional" : "complex"} conversations`);
  return out.slice(0, 4);
}

function relCost(a: Evaluation, b: Evaluation) {
  return b.cost.recurring ? Math.round(((a.cost.recurring - b.cost.recurring) / b.cost.recurring) * 100) : 0;
}

function tradeoffsFor(e: Evaluation, set: EvalSet): string[] {
  const out: string[] = [];
  const cheapest = [...set.candidates].sort((a, b) => a.cost.recurring - b.cost.recurring)[0];
  if (cheapest && cheapest.pkg.id !== e.pkg.id) out.push(`Costs ${relCost(e, cheapest)}% more per month than the cost-optimised option`);
  const fastest = [...set.candidates].sort((a, b) => a.latencyS - b.latencyS)[0];
  if (fastest && fastest.pkg.id !== e.pkg.id && e.latencyS - fastest.latencyS >= 0.3) out.push(`Turns are ${(e.latencyS - fastest.latencyS).toFixed(1)} s slower than the fastest option`);
  const tts = COMPONENT_BY_ID[e.selection.tts] as Tts;
  const voices = e.langs.filter((l) => l.level !== "tested");
  if (voices.length) out.push(`Fewer tested voice choices for ${voices.map((v) => v.name).join(", ")}`);
  if (!tts.streaming) out.push("Speech is not streamed, so replies start a little later");
  if (e.undersized) out.push("Needs a larger hosting profile than exists here");
  else if (PROFILE_SIZE(e.selection.hostingProfile) === "large") out.push("Needs a larger hosting profile");
  if (e.cost.overBudget) out.push(`${Math.round((e.cost.budgetUsedPct ?? 100) - 100)}% above your budget ceiling`);
  return out.slice(0, 3);
}

function unresolvedFor(e: Evaluation, r: Requirements, h: Hosting): string[] {
  const out: string[] = [];
  const asr = COMPONENT_BY_ID[e.selection.asr] as Asr;
  if (r.dialects && !asr.dialectsTested) out.push("Dialect performance not tested");
  for (const l of e.langs) if (l.level === "partial") out.push(`${l.name} not benchmarked end to end`);
  if (h.support === "unset") out.push("Support model not yet chosen");
  if (!h.callerNotice.trim()) out.push("Caller notice text still needed");
  return out.slice(0, 4);
}

/** Confidence is the fit, discounted for answers not yet given and items still unresolved. */
export function confidenceOf(fit: number, comp: { done: number; total: number }, unresolved: number): number {
  return Math.max(20, Math.min(99, Math.round(fit * (0.55 + 0.45 * (comp.done / comp.total)) - Math.min(15, 3 * unresolved))));
}

export function explainEval(e: Evaluation, set: EvalSet, r: Requirements, h: Hosting) {
  return { why: whyFits(e, r, h), tradeoffs: tradeoffsFor(e, set), unresolved: unresolvedFor(e, r, h) };
}

export function recommend(r: Requirements, h: Hosting, reached: StepId[], usageIn?: Usage, unavailable: string[] = [], unresolvedExtra = 0): RecommendationResult {
  const set = evaluateAll(r, h, usageIn, unavailable);
  const comp = completeness(r, h, reached);
  if (set.candidates.length === 0) {
    const reasons = new Set(set.excluded.flatMap((e) => e.excluded));
    const suggestions: string[] = [];
    const bad = r.languages.filter((l) => set.all.every((e) => e.langs.find((x) => x.id === l)?.level === "none"));
    for (const l of bad) suggestions.push(`No package supports ${LANGUAGE_BY_ID[l]?.name ?? l} yet. Remove it, or ask for it to be benchmarked.`);
    if ([...reasons].some((x) => x.startsWith("Can't run on"))) suggestions.push("Try a different hosting option. Some packages only run on certain clouds.");
    if ([...reasons].some((x) => x.startsWith("Data would leave India"))) suggestions.push("Turn off \"Data must stay in-country\" only if policy allows it.");
    if ([...reasons].some((x) => x.startsWith("Tested up to"))) suggestions.push("Lower the peak concurrent calls, or phase the rollout.");
    if (suggestions.length === 0) suggestions.push("Change a requirement and try again.");
    return { set, status: "none", recommended: null, alternatives: [], excluded: set.excluded, candidates: [], completeness: comp, budgetNotice: null, suggestions };
  }
  const top = set.candidates[0];
  const unresolved = unresolvedFor(top, r, h);
  const confidence = confidenceOf(top.fit, comp, Math.max(unresolved.length, unresolvedExtra));
  const recommended: Recommended = { eval: top, why: whyFits(top, r, h), tradeoffs: tradeoffsFor(top, set), unresolved, confidence };

  const used = new Set([top.pkg.id]);
  const pick = (sort: (a: Evaluation, b: Evaluation) => number): Evaluation | undefined => {
    const c = set.candidates.filter((e) => !used.has(e.pkg.id)).sort(sort)[0];
    if (c) used.add(c.pkg.id);
    return c;
  };
  const alternatives: Alternative[] = [];
  const cost = pick((a, b) => a.cost.recurring - b.cost.recurring);
  const quality = pick((a, b) => b.pkg.metrics.taskCompletion - a.pkg.metrics.taskCompletion);
  const latency = pick((a, b) => a.latencyS - b.latencyS);
  if (cost) {
    const lower = Math.round(((top.cost.recurring - cost.cost.recurring) / top.cost.recurring) * 100);
    const gives = cost.langs.find((l) => l.level !== "tested");
    alternatives.push({ variant: "cost", eval: cost, advantage: lower > 0 ? `${lower}% lower monthly cost` : "Similar monthly cost", tradeoffs: [`Slower turns: ${cost.latencyS.toFixed(1)} s measured`, gives ? `Gives up: ${gives.name} not benchmarked end to end` : `Lower task completion (${cost.pkg.metrics.taskCompletion}%)`] });
  }
  if (quality) {
    alternatives.push({ variant: "quality", eval: quality, advantage: `Best measured task completion: ${quality.pkg.metrics.taskCompletion}%`, tradeoffs: [quality.cost.overBudget ? `${Math.round((quality.cost.budgetUsedPct ?? 100) - 100)}% above budget ceiling` : `${Math.round(((quality.cost.recurring - top.cost.recurring) / top.cost.recurring) * 100)}% higher monthly cost`, PROFILE_SIZE(quality.selection.hostingProfile) === "large" ? "Needs a larger hosting profile" : "Similar hosting profile"] });
  }
  if (latency) {
    const lang = latency.langs.find((l) => l.level !== "tested");
    const tts = COMPONENT_BY_ID[latency.selection.tts] as Tts;
    alternatives.push({ variant: "latency", eval: latency, advantage: `Fastest turns: ${latency.latencyS.toFixed(1)} s measured`, tradeoffs: [lang ? `${lang.name} not yet benchmarked` : "All languages benchmarked", tts.streaming ? "Streaming TTS only" : "Non-streaming speech"] });
  }

  let budgetNotice: RecommendationResult["budgetNotice"] = null;
  if (r.monthlyBudget && set.candidates.every((e) => e.cost.overBudget)) {
    const closest = [...set.candidates].sort((a, b) => a.cost.recurring - b.cost.recurring)[0];
    budgetNotice = { closest, overByPct: Math.round(((closest.cost.recurring - r.monthlyBudget) / r.monthlyBudget) * 100) };
  }
  return { set, status: "ok", recommended, alternatives, excluded: set.excluded, candidates: set.candidates, completeness: comp, budgetNotice, suggestions: [] };
}

/** A short fingerprint of everything the recommendation depends on, to notice when it is out of date. */
export function inputHash(r: Requirements, h: Hosting): string {
  const o = {
    u: r.useCase, i: [...r.interaction].sort(), c: r.channel, x: r.complexity, l: [...r.languages].sort(), v: r.voice, d: r.dialects, s: r.codeSwitching,
    n: r.callsPerMonth, m: r.avgMinutes, p: r.peakConcurrent, g: r.growthPct, q: r.priority, t: r.latency, b: r.monthlyBudget, cp: r.costPerMinute,
    hk: h.kind, hr: h.region, hc: h.inCountry, i2: h.integrations,
  };
  let x = 5381;
  const str = JSON.stringify(o);
  for (let i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

export { PACKAGE_BY_ID };
