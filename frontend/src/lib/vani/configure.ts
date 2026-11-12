import { ADAPTERS, ASRS, COMPONENT_BY_ID, COMPLEXITY_TIER, HOSTING_OPTIONS, HOSTING_PROFILES, LANGUAGE_BY_ID, LLMS, TELEPHONY, TTSS, compLabel, type Asr, type Component, type Llm, type Telephony, type Tts } from "./catalog";
import { priceOf } from "./pricing";
import type { Hosting, Requirements, Selection, Usage } from "./types";

export type LayerKey = keyof Selection;
export const LAYER_LABEL: Record<LayerKey, string> = { asr: "Speech recognition", llm: "Language model", tts: "Voice", telephony: "Telephony", adapter: "Language adapter", hostingProfile: "Hosting profile" };
export const LAYER_ORDER: LayerKey[] = ["asr", "llm", "tts", "telephony", "adapter", "hostingProfile"];

export interface OptionInfo {
  id: string;
  title: string;
  provider: string;
  rateText: string;
  latencyMs: number | null;
  benchmark: "tested" | "partial" | "none" | "n/a";
  benchmarkDate: string | null;
  blockers: string[];
  warnings: string[];
  /** Monthly cost change if this replaced the current choice. */
  monthlyDelta: number;
  current: boolean;
}

const hostName = (h: Hosting) => HOSTING_OPTIONS.find((o) => o.id === h.kind)?.label ?? h.kind;

function checkComponent(c: Component, r: Requirements, h: Hosting, unavailable: string[]) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let benchmark: OptionInfo["benchmark"] = "n/a";
  if (!c.hosting.includes(h.kind)) blockers.push(`Isn't available on ${hostName(h).toLowerCase()}.`);
  if (h.inCountry && !c.inCountry) blockers.push("Runs outside India, but your data must stay in the country.");
  if (unavailable.includes(c.id)) blockers.push("The provider is unavailable right now. Try again later or pick another.");
  if (c.layer === "asr" || c.layer === "tts") {
    const langs = (c as Asr | Tts).langs;
    const none = r.languages.filter((l) => !langs[l] || langs[l] === "none");
    const partial = r.languages.filter((l) => langs[l] === "partial");
    if (none.length) blockers.push(`No support for ${none.map((l) => LANGUAGE_BY_ID[l]?.name ?? l).join(", ")}.`);
    if (partial.length) warnings.push(`${partial.map((l) => LANGUAGE_BY_ID[l]?.name ?? l).join(", ")} only partly tested.`);
    benchmark = none.length ? "none" : partial.length ? "partial" : "tested";
    if (c.layer === "asr") {
      if (r.dialects && !(c as Asr).dialectsTested) warnings.push("Dialects not tested.");
      if (r.codeSwitching && !(c as Asr).codeSwitch) warnings.push("No tested support for mixed-language speech.");
    }
  }
  if (c.layer === "llm" && (c as Llm).tier < COMPLEXITY_TIER[r.complexity]) warnings.push("Smaller than ideal for this kind of conversation.");
  if (c.layer === "telephony") {
    const t = c as Telephony;
    if (!t.channels.includes(r.channel)) blockers.push("Doesn't carry your channel.");
    if (r.interaction.includes("broadcast") && !t.broadcast) blockers.push("Can't run broadcast campaigns.");
  }
  if (!c.benchmarkDate && c.layer !== "adapter") warnings.push("No benchmark on record.");
  return { blockers, warnings, benchmark };
}

const rateText = (c: Component) => (c.rate === null ? "Rate unknown" : c.rate === 0 ? "No charge" : `₹${c.rate} ${c.unit}`);

export function optionsFor(layer: LayerKey, sel: Selection, usage: Usage, r: Requirements, h: Hosting, unavailable: string[] = []): OptionInfo[] {
  const base = priceOf(sel, usage, h, r).recurring;
  const delta = (next: Selection) => priceOf(next, usage, h, r).recurring - base;
  if (layer === "hostingProfile") {
    return HOSTING_PROFILES.filter((p) => p.kind === h.kind).map((p) => {
      const warnings: string[] = [];
      const peak = usage.peakConcurrency * (1 + Math.max(0, r.growthPct ?? 0) / 100);
      if (p.capacity < peak) warnings.push(`Handles ${p.capacity} calls at once. You expect up to ${Math.ceil(peak)}.`);
      if (p.needsApproval) warnings.push("Needs department approval.");
      return { id: p.id, title: p.name, provider: "", rateText: p.monthly ? `₹${p.monthly.toLocaleString("en-IN")} a month` : "Your hardware", latencyMs: null, benchmark: "n/a", benchmarkDate: null, blockers: [], warnings, monthlyDelta: delta({ ...sel, hostingProfile: p.id }), current: p.id === sel.hostingProfile };
    });
  }
  const list: Component[] = layer === "asr" ? ASRS : layer === "llm" ? LLMS : layer === "tts" ? TTSS : layer === "telephony" ? TELEPHONY : ADAPTERS;
  return list.map((c) => {
    const k = checkComponent(c, r, h, unavailable);
    return { id: c.id, title: compLabel(c), provider: c.provider, rateText: rateText(c), latencyMs: c.latencyMs, benchmark: k.benchmark, benchmarkDate: c.benchmarkDate, blockers: k.blockers, warnings: k.warnings, monthlyDelta: delta({ ...sel, [layer]: c.id }), current: c.id === sel[layer] };
  });
}

/** Status of the current choice in one layer, for the table. */
export function layerStatus(layer: LayerKey, sel: Selection, usage: Usage, r: Requirements, h: Hosting, unavailable: string[] = []) {
  const o = optionsFor(layer, sel, usage, r, h, unavailable).find((x) => x.current);
  const c = layer === "hostingProfile" ? null : COMPONENT_BY_ID[sel[layer]];
  return { option: o, comp: c, compat: !o ? "check" : o.blockers.length ? "blocked" : o.warnings.length ? "check" : "ok" } as const;
}
