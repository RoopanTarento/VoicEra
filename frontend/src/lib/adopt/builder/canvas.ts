import {
  CAPABILITIES, CAPABILITY_BY_ID, DEPTHS, LIMITS, OPTION_BY_ID, PACKAGE_NAME, capabilitiesOfDepth, maxDepth,
  type CapabilityId, type Depth, type LayerId, type PackageKey, type UseCaseId,
} from "./catalog";

/**
 * The canvas: one choice for each layer of the call pipeline.
 * The set of capabilities those choices bring in decides which package the build is:
 * exactly Deploy, Connect or Orchestrate, or a Custom mix of them.
 */

export interface Workload {
  callsPerMonth: number | null;
  avgMinutes: number | null;
  months: number;
  budget: number | null;
}

export interface Selection {
  channel: "ch-partner" | "ch-own" | "ch-browser";
  inbound: boolean;
  outbound: boolean;
  listen: string;
  think: string;
  speak: string;
  know: "kn-files" | "kn-none" | "kn-live";
  act: "act-none" | "act-api" | "act-full";
  handoff: "ho-callback" | "ho-office" | "ho-live";
  managedOps: boolean;
  evaluation: boolean;
  host: string;
  languages: string[];
  numbers: number;
  workload: Workload;
  /** Adopter's own cost per unit for each layer where they bring their own model. Theirs, not VoicERA's. */
  ownFigures: Partial<Record<LayerId, number | null>>;
  /** One-time figures the adopter typed for anything the documents do not price. */
  figures: Record<string, number | null>;
}

export interface Hints {
  languages: string[];
  inbound: boolean;
  outbound: boolean;
  /** True when every use case just asks and records, so no knowledge base is needed. */
  scriptOnly: boolean;
  handoff: "callback" | "office" | "live" | null;
  host: "bhashini" | "gov" | "private" | "onprem" | null;
  telephony: "new" | "own" | "browser" | null;
  models: "auto" | "open-only" | "proprietary-ok" | "own" | null;
  workload: Workload;
}

export const DEFAULT_WORKLOAD: Workload = { callsPerMonth: null, avgMinutes: null, months: 3, budget: null };

export const emptyHints = (): Hints => ({ languages: [], inbound: true, outbound: false, scriptOnly: false, handoff: null, host: null, telephony: null, models: null, workload: { ...DEFAULT_WORKLOAD } });

const HOST_ID = { bhashini: "host-bhashini", gov: "host-gov", private: "host-private", onprem: "host-onprem" } as const;

/** The starting canvas for a package, shaped by what the adopter has said. */
export function presetSelection(depth: Depth, h: Hints = emptyHints()): Selection {
  const channel = h.telephony === "own" ? "ch-own" : h.telephony === "browser" ? "ch-browser" : "ch-partner";
  const handoff: Selection["handoff"] =
    depth === "orchestrate" ? "ho-live" : h.handoff === "office" ? "ho-office" : "ho-callback";
  return {
    channel,
    inbound: h.inbound,
    outbound: h.outbound,
    listen: "asr-auto",
    think: h.models === "own" ? "llm-own" : "llm-auto",
    speak: "tts-auto",
    know: h.scriptOnly ? "kn-none" : "kn-files",
    act: depth === "deploy" ? "act-none" : depth === "connect" ? "act-api" : "act-full",
    handoff,
    managedOps: false,
    evaluation: false,
    host: HOST_ID[h.host ?? "bhashini"],
    languages: h.languages.length ? [...h.languages] : ["English"],
    numbers: h.inbound && channel !== "ch-browser" ? 1 : 0,
    workload: { ...h.workload },
    ownFigures: {},
    figures: {},
  };
}

/* ------------------------------------------------------------------ what a build adds up to */

export function capsOf(s: Selection): CapabilityId[] {
  const out = new Set<CapabilityId>(["workflow", "voice", "telephony", "analytics"]);
  const take = (id: string) => OPTION_BY_ID[id]?.caps?.forEach((c) => out.add(c));
  take(s.channel);
  take(s.know);
  take(s.act);
  take(s.handoff);
  take("w-dash");
  return CAPABILITIES.filter((c) => out.has(c.id)).map((c) => c.id);
}

export function requiredDepth(s: Selection): Depth {
  return capsOf(s).reduce<Depth>((d, id) => maxDepth(d, CAPABILITY_BY_ID[id].depth), "deploy");
}

export interface Classification {
  key: PackageKey;
  /** The lowest package that contains everything chosen. */
  needs: Depth;
  /** For Custom: the package whose every capability is present. */
  base: Depth | null;
  /** For Custom: capabilities taken from a higher package. */
  extras: CapabilityId[];
  label: string;
}

const same = (a: CapabilityId[], b: CapabilityId[]) => a.length === b.length && a.every((x) => b.includes(x));
/** A knowledge base is optional in every package (a survey needs none), so it never decides the package. */
const core = (c: CapabilityId[]) => c.filter((x) => x !== "knowledge");

/** A canvas is Deploy, Connect or Orchestrate only when its capabilities match that package's own preset. */
export function classify(s: Selection): Classification {
  const caps = core(capsOf(s));
  const needs = requiredDepth(s);
  for (const d of DEPTHS) {
    if (same(caps, core(capsOf(presetSelection(d))))) return { key: d, needs, base: d, extras: [], label: PACKAGE_NAME[d] };
  }
  // Custom: find the highest package that is fully present, and list what is taken beyond it.
  let base: Depth = "deploy";
  for (const d of DEPTHS) if (core(capabilitiesOfDepth(d)).every((c) => caps.includes(c))) base = d;
  const baseCaps = capabilitiesOfDepth(base);
  const extras = caps.filter((c) => !baseCaps.includes(c));
  const from = extras.some((c) => CAPABILITY_BY_ID[c].depth === "orchestrate") ? "Orchestrate" : "Connect";
  return { key: "custom", needs, base, extras, label: `${PACKAGE_NAME[base]} plus ${extras.length} from ${from}` };
}

/** The same canvas, moved to a package's preset. Keeps the adopter's own languages, volume and model choices. */
export function moveToPackage(s: Selection, depth: Depth): Selection {
  const p = presetSelection(depth, {
    languages: s.languages,
    inbound: s.inbound,
    outbound: s.outbound,
    scriptOnly: s.know === "kn-none",
    handoff: s.handoff === "ho-office" ? "office" : "callback",
    host: (Object.keys(HOST_ID) as (keyof typeof HOST_ID)[]).find((k) => HOST_ID[k] === s.host) ?? null,
    telephony: s.channel === "ch-own" ? "own" : s.channel === "ch-browser" ? "browser" : "new",
    models: null,
    workload: s.workload,
  });
  return { ...p, listen: s.listen, think: s.think, speak: s.speak, managedOps: s.managedOps, evaluation: s.evaluation, numbers: s.numbers, ownFigures: s.ownFigures, figures: s.figures };
}

/* ------------------------------------------------------------------ guidance for the canvas */

export type Tone = "ok" | "info" | "warn";
export interface Note {
  layer: LayerId | "overall";
  tone: Tone;
  text: string;
}

/** Things worth saying about this canvas for these use cases. Never alarming without a reason in the documents. */
export function notesFor(s: Selection, useCases: UseCaseId[]): Note[] {
  const n: Note[] = [];
  const has = (u: UseCaseId) => useCases.includes(u);
  if (has("grievance") && s.act !== "act-full") {
    n.push({ layer: "act", tone: "info", text: s.act === "act-api" ? "Complaints can be captured and sent to your system, but case creation and tracking to closure are Orchestrate." : "Complaints will be captured but not filed in your system. The ICP places full grievance handling at Orchestrate." });
  }
  if ((has("forms") || has("status")) && s.act === "act-none") n.push({ layer: "act", tone: "warn", text: "Forms and status checks need a connection to your system. Without one it can only explain the process." });
  if (has("grievance") && s.handoff !== "ho-live") n.push({ layer: "handoff", tone: "info", text: "Upset or urgent callers are best passed to a person live. That is part of Orchestrate." });
  if (s.know === "kn-none" && (has("scheme") || has("helpline") || has("grievance"))) n.push({ layer: "know", tone: "warn", text: "Without a knowledge base the agent cannot answer from your content." });
  if (s.outbound && s.channel === "ch-browser") n.push({ layer: "channel", tone: "warn", text: "Outbound campaigns call phones, so they need a phone line, not just a browser link." });
  if (s.inbound && s.channel === "ch-browser") n.push({ layer: "channel", tone: "info", text: "Citizens with a basic phone cannot use a browser link." });
  if (s.channel === "ch-own") n.push({ layer: "channel", tone: "info", text: `Using your own provider is documented as ${LIMITS.ownTelephonyWeeks[0]} to ${LIMITS.ownTelephonyWeeks[1]} weeks, case by case.` });
  for (const l of ["listen", "think", "speak"] as const) {
    const o = OPTION_BY_ID[s[l]];
    if (o?.tier === "proprietary") n.push({ layer: l, tone: "info", text: `${o.name} is a commercial model. The documents give no price, so it is not in the total until a price is set.` });
    if (o?.tier === "confirm") n.push({ layer: l, tone: "info", text: `${o.name} is listed in the documents without a price or detail. To be confirmed.` });
    if (o?.tier === "own") n.push({ layer: l, tone: "info", text: "You bring this model. Your provider bills you directly, and VoicERA's connection fee is not defined yet." });
  }
  if (s.host !== "host-bhashini") n.push({ layer: "host", tone: "warn", text: "The package document only describes hosting on Bhashini. This option is listed in the ICP, so availability and cost need confirming." });
  const sizable = s.workload.callsPerMonth !== null && s.workload.callsPerMonth >= 100000;
  if (sizable) n.push({ layer: "overall", tone: "info", text: `The documented limit is ${LIMITS.concurrent} calls at once. At this volume, what matters is how many calls arrive at the same moment.` });
  if (s.workload.avgMinutes !== null && s.workload.avgMinutes > LIMITS.callMinutes) n.push({ layer: "overall", tone: "warn", text: `Calls over ${LIMITS.callMinutes} minutes are not recommended in the package document.` });
  if (s.languages.length === 0) n.push({ layer: "overall", tone: "warn", text: "Choose at least one language." });
  return n;
}

export const LAYER_ORDER: LayerId[] = ["channel", "listen", "think", "speak", "know", "act", "handoff", "watch", "host"];
