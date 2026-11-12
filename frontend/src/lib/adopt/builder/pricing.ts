import { LIMITS, OPTION_BY_ID, type Depth, type LayerId, type Option } from "./catalog";
import { requiredDepth, type Selection } from "./canvas";

/**
 * The price book is owned by the provider (VoicERA). The package documents give three prices only:
 *   one-time setup Rs. 50,000, Rs. 500 for each phone number, and a usage rate for open-source models.
 * The provider has since set the usage rate to 5 paisa per call. Everything else is blank until the provider sets it:
 * a blank is shown as "not set" and is never replaced by a guess.
 * Money is plain rupees. All arithmetic goes through `round2` so amounts stay exact to the paisa.
 */

export type UsageUnit = "call" | "minute";

export interface PriceBook {
  usageUnit: UsageUnit;
  /** Standard usage rate. Covers the platform, telephony and open-source models. */
  usageRate: number | null;
  /** One-time implementation, by package depth. Connect and Orchestrate are project-based. */
  setup: Record<Depth, number | null>;
  perNumber: number | null;
  /** Extra usage rate for a commercial or unclassified model, on top of the standard rate. */
  modelExtra: Record<string, number | null>;
  /** VoicERA's fee for connecting a model you bring yourself, per unit of usage. */
  ownFee: number | null;
  ownTelephonySetup: number | null;
  hostExtra: Record<string, number | null>;
  managedOpsAnnual: number | null;
  evaluationOneTime: number | null;
  licenceAnnual: number | null;
}

export const DEFAULT_PRICES: PriceBook = {
  usageUnit: "call",
  usageRate: 0.05,
  setup: { deploy: 50000, connect: null, orchestrate: null },
  perNumber: 500,
  modelExtra: {},
  ownFee: null,
  ownTelephonySetup: null,
  hostExtra: {},
  managedOpsAnnual: null,
  evaluationOneTime: null,
  licenceAnnual: null,
};

/** What the supplied package document itself says, so the provider's changes can be told apart. */
export const DOCUMENT_PRICES = { setupDeploy: 50000, perNumber: 500, openPerMinute: 0.5 } as const;

export type Source = "document" | "provider" | "adopter" | "unset";

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "Not set" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Rates under a rupee read better in paise. */
export const rate = (n: number | null, unit: UsageUnit): string => {
  if (n === null) return "Not set";
  const per = unit === "call" ? "call" : "minute";
  return n < 1 ? `${round2(n * 100)} paise per ${per}` : `₹${n} per ${per}`;
};

export function sourceOfSetup(depth: Depth, pb: PriceBook): Source {
  const v = pb.setup[depth];
  if (v === null) return "unset";
  return depth === "deploy" && v === DOCUMENT_PRICES.setupDeploy ? "document" : "provider";
}
export const sourceOfNumber = (pb: PriceBook): Source => (pb.perNumber === null ? "unset" : pb.perNumber === DOCUMENT_PRICES.perNumber ? "document" : "provider");
export const sourceOfUsage = (pb: PriceBook): Source => (pb.usageRate === null ? "unset" : "provider");

/* ------------------------------------------------------------------ cost */

export interface Line {
  id: string;
  label: string;
  amount: number;
  basis: string;
  kind: "one-time" | "usage" | "period";
  source: Source;
  /** How the amount is made: quantity × rate. Absent when the amount is not a simple product. */
  qty?: number;
  unit?: string;
  rate?: number;
}

export interface Unresolved {
  id: string;
  label: string;
  why: string;
  /** The adopter's own one-time figure, if typed. */
  figure: number | null;
  /** True when the adopter may type a one-time figure. False when another input is what is missing. */
  figurable: boolean;
}

export type BudgetState = "none" | "short" | "fits" | "open";

export interface Cost {
  depth: Depth;
  lines: Line[];
  unresolved: Unresolved[];
  /** Units of usage in the planning period: calls or minutes. Null while volume is unknown. */
  units: number | null;
  unitLabel: string;
  oneTime: number;
  usage: number;
  /** The adopter's own figures: bring-your-own models and anything they typed. */
  adopter: number;
  knownTotal: number;
  /** Known plus adopter figures. */
  grand: number;
  complete: boolean;
  notes: string[];
  budget: {
    state: BudgetState;
    value: number | null;
    headroom: number | null;
    /** What the headroom pays for at the standard rate, in units. */
    unitsCovered: number | null;
    note: string;
  };
}

function unitsFor(s: Selection, pb: PriceBook): number | null {
  const w = s.workload;
  if (w.callsPerMonth === null) return null;
  const calls = w.callsPerMonth * w.months;
  if (pb.usageUnit === "call") return calls;
  return w.avgMinutes === null ? null : round2(calls * w.avgMinutes);
}

export function costFor(s: Selection, pb: PriceBook): Cost {
  const depth = requiredDepth(s);
  const unit = pb.usageUnit;
  const units = unitsFor(s, pb);
  const unitLabel = unit === "call" ? "calls" : "minutes";
  const lines: Line[] = [];
  const unresolved: Unresolved[] = [];
  const notes: string[] = [
    "Only prices set in the package documents or by VoicERA are included. No tax, number rental or other charge is added.",
    "Billing for the documented package is through Bhashini.",
    pb.licenceAnnual === null ? "The ICP lists an annual platform licence. No amount is given, so none is included." : "",
  ].filter(Boolean);
  const need = (id: string, label: string, why: string, figurable = true) => unresolved.push({ id, label, why, figure: figurable ? (s.figures[id] ?? null) : null, figurable });

  // 1. Setup and implementation
  const setup = pb.setup[depth];
  if (setup !== null) lines.push({ id: "setup", label: depth === "deploy" ? "One-time setup" : `Implementation and integration (${depth})`, amount: setup, basis: "Once", kind: "one-time", source: sourceOfSetup(depth, pb), qty: 1, unit: "once", rate: setup });
  else need("setup", `Implementation and integration for ${depth === "connect" ? "Connect" : "Orchestrate"}`, "Project-based. The documents give no price for connecting your systems.");

  // 2. Phone numbers
  if (s.numbers > 0) {
    if (pb.perNumber !== null) lines.push({ id: "numbers", label: s.numbers === 1 ? "Phone number" : `${s.numbers} phone numbers`, amount: round2(s.numbers * pb.perNumber), basis: `${s.numbers} × ${inr(pb.perNumber)}`, kind: "one-time", source: sourceOfNumber(pb), qty: s.numbers, unit: s.numbers === 1 ? "number" : "numbers", rate: pb.perNumber });
    else need("numbers", "Phone numbers", "No price is set for a phone number.");
  }

  // 3. Standard usage
  if (units === null) need("volume", "Usage", unit === "call" ? "Add how many calls a month to price usage." : "Add calls a month and minutes a call to price usage.", false);
  else if (pb.usageRate === null) need("usage-rate", "Usage", "No usage rate is set.", false);
  else lines.push({ id: "usage", label: unit === "call" ? "Calls" : "Call minutes", amount: round2(units * pb.usageRate), basis: `${units.toLocaleString("en-IN")} ${unitLabel} × ${rate(pb.usageRate, unit)}`, kind: "usage", source: sourceOfUsage(pb), qty: units, unit: unitLabel, rate: pb.usageRate });

  // 4. Models
  let adopter = 0;
  for (const layer of ["listen", "think", "speak"] as const) {
    const o = OPTION_BY_ID[s[layer]];
    if (!o) continue;
    if (o.tier === "proprietary" || o.tier === "confirm") {
      const extra = pb.modelExtra[o.id] ?? null;
      const label = `${o.name} (${layer === "listen" ? "listening" : layer === "think" ? "thinking" : "speaking"})`;
      if (extra === null) need(`model-${o.id}`, label, o.tier === "proprietary" ? "A commercial model. The documents give no price." : "Listed in the documents without a price. To be confirmed.");
      else if (units === null) need(`model-${o.id}-volume`, label, "Add your volume to price this model.", false);
      else lines.push({ id: `model-${o.id}`, label, amount: round2(units * extra), basis: `${units.toLocaleString("en-IN")} ${unitLabel} × ${rate(extra, unit)}, on top of the standard rate`, kind: "usage", source: "provider", qty: units, unit: unitLabel, rate: extra });
    }
    if (o.tier === "own") {
      const fig = s.ownFigures[layer] ?? null;
      const name = layer === "listen" ? "speech" : layer === "think" ? "language" : "voice";
      if (fig !== null && units !== null) {
        const amt = round2(units * fig);
        adopter += amt;
        lines.push({ id: `own-${layer}`, label: `Your own ${name} model, billed by your provider`, amount: amt, basis: `${units.toLocaleString("en-IN")} ${unitLabel} × ${inr(fig)} (your figure)`, kind: "usage", source: "adopter", qty: units, unit: unitLabel, rate: fig });
      } else need(`own-${layer}`, `Your own ${name} model`, fig === null ? "Your provider's cost per " + unit + " is yours to enter." : "Add your volume to price this.", false);
      if (pb.ownFee === null) need(`ownfee-${layer}`, `VoicERA's fee for connecting your ${name} model`, "Not defined yet.");
      else if (units !== null) lines.push({ id: `ownfee-${layer}`, label: `Connecting your ${name} model`, amount: round2(units * pb.ownFee), basis: `${units.toLocaleString("en-IN")} ${unitLabel} × ${rate(pb.ownFee, unit)}`, kind: "usage", source: "provider", qty: units, unit: unitLabel, rate: pb.ownFee });
    }
  }

  // 5. Telephony, hosting, operations
  if (s.channel === "ch-own") {
    if (pb.ownTelephonySetup === null) need("own-telephony", "Connecting your own telephony provider", "Documented as 2 to 4 weeks, case by case. No price is given.");
    else lines.push({ id: "own-telephony", label: "Connecting your own telephony provider", amount: pb.ownTelephonySetup, basis: "Once", kind: "one-time", source: "provider", qty: 1, unit: "once", rate: pb.ownTelephonySetup });
  }
  if (s.host !== "host-bhashini") {
    const x = pb.hostExtra[s.host] ?? null;
    const name = OPTION_BY_ID[s.host]?.name ?? "Hosting";
    if (x === null) need(`host-${s.host}`, `${name} hosting`, "Not described in the package document. Availability and price are to be confirmed.");
    else lines.push({ id: `host-${s.host}`, label: `${name} hosting`, amount: x, basis: "Once", kind: "one-time", source: "provider", qty: 1, unit: "once", rate: x });
  }
  if (s.managedOps) {
    if (pb.managedOpsAnnual === null) need("managed-ops", "Managed operations", "Annual or managed service. The documents give no price.");
    else lines.push({ id: "managed-ops", label: "Managed operations", amount: round2((pb.managedOpsAnnual * s.workload.months) / 12), basis: `${inr(pb.managedOpsAnnual)} a year, for ${s.workload.months} month${s.workload.months === 1 ? "" : "s"}`, kind: "period", source: "provider" });
  }
  if (s.evaluation) {
    if (pb.evaluationOneTime === null) need("evaluation", "Conversation and language testing", "Listed in the ICP. The documents give no price.");
    else lines.push({ id: "evaluation", label: "Conversation and language testing", amount: pb.evaluationOneTime, basis: "Once", kind: "one-time", source: "provider", qty: 1, unit: "once", rate: pb.evaluationOneTime });
  }
  if (pb.licenceAnnual !== null) lines.push({ id: "licence", label: "Platform licence", amount: round2((pb.licenceAnnual * s.workload.months) / 12), basis: `${inr(pb.licenceAnnual)} a year, for ${s.workload.months} month${s.workload.months === 1 ? "" : "s"}`, kind: "period", source: "provider" });

  // Figures the adopter typed for unresolved items
  for (const u of unresolved) if (u.figure !== null) adopter += u.figure;

  const sum = (k: Line["kind"]) => round2(lines.filter((l) => l.kind === k && l.source !== "adopter").reduce((t, l) => t + l.amount, 0));
  const oneTime = sum("one-time");
  const usage = round2(sum("usage") + sum("period"));
  const knownTotal = round2(oneTime + usage);
  const grand = round2(knownTotal + adopter);
  const complete = unresolved.every((u) => u.figure !== null);

  // Budget
  const b = s.workload.budget;
  let state: BudgetState = "none";
  let headroom: number | null = null;
  let unitsCovered: number | null = null;
  let note = "Enter your budget to see how the plan fits.";
  if (b !== null && Number.isFinite(b) && b > 0) {
    headroom = round2(b - grand);
    if (headroom < 0) {
      state = "short";
      note = `The known cost is ${inr(-headroom)} over your budget.`;
    } else if (!complete) {
      state = "open";
      note = "Within budget so far, but some items are not priced yet.";
    } else {
      state = "fits";
      note = "Within your budget.";
    }
    if (pb.usageRate !== null && pb.usageRate > 0 && headroom >= 0) unitsCovered = Math.floor(headroom / pb.usageRate);
  }

  return { depth, lines, unresolved, units, unitLabel, oneTime, usage, adopter: round2(adopter), knownTotal, grand, complete, notes, budget: { state, value: b, headroom, unitsCovered, note } };
}

/** What choosing this option does to the cost, in a few words, for the canvas and the option list. */
export function chipFor(o: Option, pb: PriceBook): { text: string; tone: "ok" | "info" | "warn" } {
  switch (o.tier) {
    case "auto":
    case "open":
      return { text: "In the standard price", tone: "ok" };
    case "included":
      if (o.id === "ch-partner") return { text: pb.perNumber === null ? "Number price not set" : `${inr(pb.perNumber)} per number`, tone: "ok" };
      return { text: "No separate charge", tone: "ok" };
    case "proprietary":
    case "confirm": {
      const x = pb.modelExtra[o.id] ?? null;
      return x === null ? { text: o.tier === "proprietary" ? "Price not set" : "To be confirmed", tone: "warn" } : { text: `+ ${rate(x, pb.usageUnit)}`, tone: "info" };
    }
    case "own":
      return { text: "Your provider bills you", tone: "info" };
    case "quote":
      if (o.id === "ch-own") return { text: pb.ownTelephonySetup === null ? "Price not set" : inr(pb.ownTelephonySetup), tone: pb.ownTelephonySetup === null ? "warn" : "info" };
      if (o.layer === "host") { const x = pb.hostExtra[o.id] ?? null; return x === null ? { text: "To be confirmed", tone: "warn" } : { text: inr(x), tone: "info" }; }
      if (o.layer === "act") return { text: "Project-based", tone: "warn" };
      return { text: "Price not set", tone: "warn" };
  }
}

export const LAYER_UNIT_NOTE = (pb: PriceBook) => `The standard usage price is ${rate(pb.usageRate, pb.usageUnit)}. It covers the platform, the phone line and open-source models.`;

/** Used by tests and the pitch: the documented limits the standard offer rests on. */
export const documentedLimits = LIMITS;

export type { LayerId };
