import { setValue } from "./answers";
import { calculateCost, type CostInput, type CostResult } from "./cost";
import { evaluate } from "./evaluate";
import { designToAnswers, emptyDesign, type BlockId, type Design, type Readiness, type Topic } from "./compose";
import { DOCUMENTED_LANGUAGES, PLATINUM, type SourceId } from "./source";
import type { Answers, Evaluation } from "./types";

/**
 * The Canvas package builder.
 *
 * A department picks a use case, says how much money it has, and arranges a service on a canvas of
 * lanes. Everything it adds is either:
 *   - priced in the package document (setup, per number, per minute for open-source models),
 *   - included in the package with no separate charge documented,
 *   - the department's own job,
 *   - or not priced / not in the package, in which case it is listed as "needs a quote" and is
 *     NEVER given an invented price. The person may type their own figure; it is kept apart and
 *     labelled as theirs.
 *
 * Fit is decided by the same rule engine as the advisor, so the two never disagree.
 */

/* ------------------------------------------------------------------ catalogue */

export type TemplateId = "grievance" | "scheme" | "survey" | "info" | "forms" | "custom";
export type LaneId = "reach" | "voice" | "talk" | "know" | "connect" | "safe" | "run";

export interface Lane {
  id: LaneId;
  title: string;
  plain: string;
}

export const LANES: Lane[] = [
  { id: "reach", title: "Reach", plain: "How citizens get to the service" },
  { id: "voice", title: "Hear and speak", plain: "Languages, listening, thinking and speaking" },
  { id: "talk", title: "Conversation", plain: "What the service says and asks" },
  { id: "know", title: "Knowledge", plain: "What it is allowed to answer from" },
  { id: "connect", title: "Connect", plain: "Links to your own systems" },
  { id: "safe", title: "When it goes off the path", plain: "Never guess, hand over, emergencies" },
  { id: "run", title: "Run and watch", plain: "Operations, monitoring and scale" },
];

/** How a module is treated commercially and by the package. */
export type Status =
  | "included" // in the package, no separate charge documented
  | "priced" // priced by a rate in the document
  | "yours" // the department supplies it
  | "confirm" // not documented for this use, needs confirmation
  | "outside" // out of scope or not recommended in the package document
  | "quote"; // may be possible, no price supplied

export interface Module {
  id: string;
  lane: LaneId;
  label: string;
  plain: string;
  status: Status;
  /** Short line about cost, shown on the card. */
  cost: string;
  source?: SourceId;
  /** The advisor block this stands for, so the rule engine can judge it. */
  block?: BlockId;
  /** Shown first for these templates. */
  for?: TemplateId[];
  /** A line the agent says, for the script. */
  says?: string;
  /** Needs the department to supply something before launch. */
  needs?: string;
  /** Counts toward the phone number charge. */
  numberCharge?: boolean;
  /** Cannot be removed: it is part of the engine. */
  core?: boolean;
}

export const MODULES: Module[] = [
  // Reach
  { id: "ch-in", lane: "reach", label: "Citizens call a number", plain: "A phone number citizens dial.", status: "priced", cost: "₹500 for each number", source: "PKG-COST", block: "in-call", numberCharge: true, says: "Hello, this is the {department} assistant. This call may be recorded, and you can ask for a person at any time." },
  { id: "ch-out", lane: "reach", label: "We call citizens (campaign)", plain: "A campaign your department starts, from a phone list you supply.", status: "yours", cost: "No separate charge documented. You supply the list.", source: "PKG-BRING", block: "out-call", needs: "A list of citizens' phone numbers", says: "Hello, this is the {department} assistant. Is this a good time for a short call?" },
  { id: "ch-web", lane: "reach", label: "Voice link in a browser", plain: "Citizens talk to it from a web page, no phone call.", status: "included", cost: "No separate charge documented", source: "PKG-FEATURES" },
  { id: "ch-own", lane: "reach", label: "Your own telephony provider and numbers", plain: "Documented as 2 to 4 weeks, case by case.", status: "quote", cost: "Price not supplied", source: "PKG-TELEPHONY", block: "own-number" },
  { id: "ch-wa", lane: "reach", label: "WhatsApp calling", plain: "Out of scope for this package.", status: "outside", cost: "Not in the package", source: "PKG-OOS", block: "whatsapp" },

  // Hear and speak
  { id: "vo-detect", lane: "voice", label: "Detect the language and switch mid-call", plain: "The citizen can change language during the call.", status: "included", cost: "No separate charge documented", source: "PKG-FEATURES" },
  { id: "vo-intro", lane: "voice", label: "Your own opening message", plain: "The first thing the citizen hears, in your words.", status: "included", cost: "No separate charge documented", source: "PKG-FEATURES" },
  { id: "vo-hold", lane: "voice", label: "Hold messages", plain: "What is said while the service works something out.", status: "included", cost: "No separate charge documented", source: "PKG-FEATURES" },
  { id: "vo-noise", lane: "voice", label: "Noise cancellation", plain: "Cleaner listening on a noisy line.", status: "included", cost: "No separate charge documented", source: "PKG-FEATURES" },

  // Conversation
  { id: "tk-listen", lane: "talk", label: "Listen to the need", plain: "The citizen says it in their own words.", status: "included", cost: "In the per-minute rate", block: "hear-need", for: ["grievance", "scheme", "info", "forms", "custom"], says: "What do you need help with? You can describe it in your own words." },
  { id: "tk-qualify", lane: "talk", label: "Ask a few qualifying questions", plain: "Narrow down which scheme may apply.", status: "included", cost: "In the per-minute rate", block: "qualify", for: ["scheme"], says: "To check which schemes may apply, may I ask a few questions?" },
  { id: "tk-match", lane: "talk", label: "Match schemes from the knowledge base", plain: "Names the schemes that may apply.", status: "included", cost: "In the per-minute rate", block: "match", for: ["scheme"], says: "Based on what you said, [scheme] may apply. It is for [who it is for]." },
  { id: "tk-explain", lane: "talk", label: "Explain documents and how to apply", plain: "Where to go and what to bring.", status: "included", cost: "In the per-minute rate", block: "explain", for: ["scheme"], says: "You may need [documents]. You can apply at [where]." },
  { id: "tk-survey", lane: "talk", label: "Ask the survey questions", plain: "One at a time, in the citizen's language.", status: "included", cost: "In the per-minute rate", block: "survey-q", for: ["survey"], says: "On a scale of 1 to 5, how would you rate the service?" },
  { id: "tk-table", lane: "talk", label: "Capture answers as a table", plain: "A downloadable dataset.", status: "included", cost: "No separate charge documented", source: "PKG-DASH", block: "capture", for: ["survey"], says: "Thank you. I have noted your answers." },
  { id: "tk-gv-detail", lane: "talk", label: "Ask what, where and since when", plain: "Takes the complaint category, place and date, one question at a time.", status: "confirm", cost: "In the per-minute rate", for: ["grievance"], says: "Which department or service is this about, and where did it happen?" },
  { id: "tk-gv-readback", lane: "talk", label: "Read the complaint back to confirm", plain: "So the citizen can correct it before it is recorded.", status: "confirm", cost: "In the per-minute rate", for: ["grievance"], says: "Let me read that back. Is that right?" },
  { id: "tk-gv-table", lane: "talk", label: "Record each complaint as a table row", plain: "A downloadable list your staff work from. The document describes this dataset for surveys and feedback.", status: "confirm", cost: "Confirm it is offered for complaints", source: "PKG-DASH", for: ["grievance"], says: "Thank you. Your complaint has been noted and a member of staff will follow up." },
  { id: "tk-info", lane: "talk", label: "Answer common questions", plain: "Opening hours, documents, fees, where to go.", status: "included", cost: "In the per-minute rate", for: ["info"], block: "match", says: "I can help with common questions about {department}." },
  { id: "tk-remind", lane: "talk", label: "Follow-up reminder call", plain: "A second call to remind or check.", status: "yours", cost: "Counts as another campaign", source: "PKG-SUPPORT", block: "reminder", says: "I am calling to follow up on our earlier conversation." },
  { id: "tk-long", lane: "talk", label: "Allow calls longer than 3 minutes", plain: "Not recommended in the package.", status: "outside", cost: "Not recommended", source: "PKG-NOTREC", block: "long-calls" },

  // Knowledge
  { id: "kn-files", lane: "know", label: "Knowledge files", plain: "Up to 10 text files of up to 5 MB each.", status: "yours", cost: "No separate charge documented. You supply the files.", source: "PKG-KB", needs: "Approved knowledge files, as text" },

  // Connect
  { id: "cn-lookup", lane: "connect", label: "Check a citizen's record", plain: "Live look-up in your database.", status: "outside", cost: "Not in the package", source: "PKG-OOS", block: "lookup", for: ["scheme", "forms", "info"], says: "Let me check your record." },
  { id: "cn-register", lane: "connect", label: "File the complaint in your system", plain: "Create the ticket and give a reference number.", status: "outside", cost: "Not in the package", source: "PKG-OOS", block: "crm", for: ["grievance"], says: "I have registered your complaint. Your reference number is [number]." },
  { id: "cn-status", lane: "connect", label: "Tell the citizen the status", plain: "Reads the current state from your system.", status: "outside", cost: "Not in the package", source: "PKG-OOS", block: "lookup", for: ["grievance"], says: "Let me check the status of your complaint." },
  { id: "cn-submit", lane: "connect", label: "Submit an application", plain: "Take it and file it in your system.", status: "outside", cost: "Not in the package", source: "PKG-OOS", block: "submit", for: ["scheme", "forms"], says: "I will submit your application now." },
  { id: "cn-case", lane: "connect", label: "Update a case in your system", plain: "Read or write case records.", status: "outside", cost: "Not in the package", source: "PKG-OOS", block: "crm", says: "I have updated your case." },
  { id: "cn-media", lane: "connect", label: "Accept photos or video", plain: "Beyond voice.", status: "outside", cost: "Not recommended", source: "PKG-NOTREC", block: "images", for: ["grievance"] },

  // Safe
  { id: "sf-unknown", lane: "safe", label: "Say so when it does not know", plain: "Never guess.", status: "included", cost: "In the per-minute rate", block: "say-unknown", says: "I do not have that information, so I will not guess." },
  { id: "sf-callback", lane: "safe", label: "Offer a staff callback", plain: "Staff ring back later.", status: "yours", cost: "Your staff time", block: "callback", says: "I can ask a member of staff to call you back." },
  { id: "sf-redirect", lane: "safe", label: "Point to an office", plain: "Says where to go or who to contact.", status: "included", cost: "In the per-minute rate", block: "redirect", says: "You can ask at the district office." },
  { id: "sf-transfer", lane: "safe", label: "Pass the call to a person live", plain: "Not listed in the package.", status: "confirm", cost: "Not listed", block: "live-transfer" },
  { id: "sf-emergency", lane: "safe", label: "Send emergencies to 112", plain: "It cannot send help.", status: "included", cost: "In the per-minute rate", block: "emergency", says: "If anyone is in danger, please call 112 now. This service cannot send help." },

  // Run
  { id: "rn-dash", lane: "run", label: "Monitoring dashboard", plain: "Calls attempted, connected, dropped, completed, average length.", status: "included", cost: "No separate charge documented", source: "PKG-DASH" },
  { id: "rn-analysis", lane: "run", label: "Post-campaign analysis", plain: "Shared within 3 working days.", status: "included", cost: "No separate charge documented", source: "PKG-SLA" },
  { id: "rn-ops", lane: "run", label: "Campaign operator support", plain: "One dedicated operator and a shared programme manager. Up to 10 campaign setups a month.", status: "included", cost: "No separate charge documented", source: "PKG-SUPPORT" },
  { id: "rn-bigcamp", lane: "run", label: "More than 10 campaigns a month", plain: "Above the support allowance.", status: "outside", cost: "Not in the package", source: "PKG-SUPPORT", block: "big-campaign" },
  { id: "rn-peak", lane: "run", label: "More than 500 calls at once", plain: "Above the documented limit.", status: "outside", cost: "Not in the package", source: "PKG-SCALE", block: "peak-gt500" },
];

export const MODULE_BY_ID: Record<string, Module> = Object.fromEntries(MODULES.map((m) => [m.id, m]));

/* ------------------------------------------------------------------ templates */

export interface Template {
  id: TemplateId;
  title: string;
  plain: string;
  topic: Topic;
  /** The engine objective this stands for. */
  objective: string;
  /** Honest line on how it sits against the package. */
  stance: string;
  modules: string[];
  languages: string[];
}

export const TEMPLATES: Template[] = [
  {
    id: "grievance",
    title: "Grievance helpline",
    plain: "Citizens call, describe a complaint, and it is recorded for staff to act on.",
    topic: "other",
    objective: "complaints",
    stance: "Not one of the two documented use cases. Taking the complaint is possible to design; filing it in your complaints system is outside the package.",
    modules: ["ch-in", "vo-detect", "vo-intro", "tk-listen", "tk-gv-detail", "tk-gv-readback", "tk-gv-table", "kn-files", "sf-unknown", "sf-callback", "sf-emergency", "rn-dash", "rn-analysis", "rn-ops"],
    languages: ["Hindi", "English"],
  },
  {
    id: "scheme",
    title: "Scheme discovery helpline",
    plain: "Citizens say what they need and hear which schemes may apply, and where to apply.",
    topic: "scheme",
    objective: "scheme-discover",
    stance: "A documented use case, inbound and outbound.",
    modules: ["ch-in", "vo-detect", "vo-intro", "tk-listen", "tk-qualify", "tk-match", "tk-explain", "kn-files", "sf-unknown", "sf-callback", "sf-emergency", "rn-dash", "rn-analysis", "rn-ops"],
    languages: ["Hindi", "English"],
  },
  {
    id: "survey",
    title: "Citizen feedback survey",
    plain: "Call citizens after a service and collect their answers as a table.",
    topic: "survey",
    objective: "feedback-service",
    stance: "A documented use case, suited for outbound.",
    modules: ["ch-out", "vo-detect", "vo-intro", "tk-survey", "tk-table", "sf-emergency", "rn-dash", "rn-analysis", "rn-ops"],
    languages: ["English"],
  },
  {
    id: "info",
    title: "Information helpline",
    plain: "Answer common questions about a service: hours, documents, fees, where to go.",
    topic: "other",
    objective: "inbound-info",
    stance: "Not one of the two documented use cases unless it is about schemes. Needs confirmation.",
    modules: ["ch-in", "vo-detect", "vo-intro", "tk-listen", "tk-info", "kn-files", "sf-unknown", "sf-redirect", "sf-emergency", "rn-dash", "rn-analysis", "rn-ops"],
    languages: ["Hindi", "English"],
  },
  {
    id: "forms",
    title: "Form and application help",
    plain: "Collect details by voice and pass them to a form or application system.",
    topic: "other",
    objective: "forms",
    stance: "Not documented for this package, and it normally needs a connection to your system, which is outside the package.",
    modules: ["ch-in", "vo-detect", "vo-intro", "tk-listen", "cn-submit", "kn-files", "sf-unknown", "sf-callback", "sf-emergency", "rn-dash", "rn-analysis", "rn-ops"],
    languages: ["Hindi", "English"],
  },
  {
    id: "custom",
    title: "Something else",
    plain: "Start with the basics and add what you need.",
    topic: "other",
    objective: "other",
    stance: "Not one of the two documented use cases. Needs confirmation.",
    modules: ["ch-in", "vo-detect", "vo-intro", "tk-listen", "sf-unknown", "sf-emergency", "rn-dash"],
    languages: ["English"],
  },
];

export const TEMPLATE_BY_ID: Record<TemplateId, Template> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t])) as Record<TemplateId, Template>;

/* ------------------------------------------------------------------ state */

export type ModelKind = "open" | "proprietary" | "undecided";

export interface CustomModule {
  id: string;
  lane: LaneId;
  label: string;
  note: string;
}

export interface Canvas {
  template: TemplateId;
  name: string;
  department: string;
  /** What the department can spend, in rupees, for the planning period below. */
  budget: number | null;
  /** The planning period the budget covers. A planning assumption, not a package term. */
  months: number;
  callsPerMonth: number | null;
  avgMinutes: number | null;
  numbers: number;
  modules: string[];
  custom: CustomModule[];
  voiceModel: ModelKind;
  llmModel: ModelKind;
  languages: string[];
  kb: { count: number; maxMB: number; textFiles: boolean };
  ready: Design["ready"];
  sensitivity: Design["sensitivity"];
  /** Figures the person typed for things the package does not price. Theirs, not VoicERA's. */
  figures: Record<string, number | null>;
}

export function modulesFor(templateId: TemplateId): string[] {
  return [...TEMPLATE_BY_ID[templateId].modules];
}

export function newCanvas(templateId: TemplateId = "grievance"): Canvas {
  const t = TEMPLATE_BY_ID[templateId];
  return {
    template: templateId,
    name: "",
    department: "",
    budget: null,
    months: 3,
    callsPerMonth: null,
    avgMinutes: null,
    numbers: t.modules.includes("ch-in") ? 1 : 0,
    modules: modulesFor(templateId),
    custom: [],
    voiceModel: "undecided",
    llmModel: "undecided",
    languages: [...t.languages],
    kb: { count: 3, maxMB: 1, textFiles: true },
    ready: { script: "unknown", knowledge: "unknown", phoneList: "unknown", permission: "unknown", testers: "unknown" },
    sensitivity: "unknown",
    figures: {},
  };
}

/** Switch template: modules and languages reset to the template, budget and volume are kept. */
export function applyTemplate(c: Canvas, id: TemplateId): Canvas {
  const base = newCanvas(id);
  return {
    ...base,
    name: c.name,
    department: c.department,
    budget: c.budget,
    months: c.months,
    callsPerMonth: c.callsPerMonth,
    avgMinutes: c.avgMinutes,
    ready: c.ready,
    sensitivity: c.sensitivity,
    voiceModel: c.voiceModel,
    llmModel: c.llmModel,
  };
}

export function toggleModule(c: Canvas, id: string): Canvas {
  const m = MODULE_BY_ID[id];
  if (!m || m.core) return c;
  const on = c.modules.includes(id);
  let modules = on ? c.modules.filter((x) => x !== id) : [...c.modules, id];
  // The three live-handover choices exclude each other.
  const EXCL = ["sf-callback", "sf-redirect", "sf-transfer"];
  if (!on && EXCL.includes(id)) modules = modules.filter((x) => x === id || !EXCL.includes(x));
  const order = new Map(MODULES.map((x, i) => [x.id, i]));
  modules.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  let numbers = c.numbers;
  if (id === "ch-in") numbers = on ? 0 : Math.max(1, c.numbers);
  return { ...c, modules, numbers };
}

export function addCustom(c: Canvas, lane: LaneId, label: string, note: string): Canvas {
  const l = label.trim().slice(0, 60);
  if (!l) return c;
  const id = `x-${c.custom.length + 1}-${Math.abs(hash(l)) % 10000}`;
  return { ...c, custom: [...c.custom, { id, lane, label: l, note: note.trim().slice(0, 200) }] };
}

export function removeCustom(c: Canvas, id: string): Canvas {
  const figures = { ...c.figures };
  delete figures[id];
  return { ...c, custom: c.custom.filter((x) => x.id !== id), figures };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/* ------------------------------------------------------------------ cost and budget */

const C = PLATINUM.commercial;
export const RATES = {
  setup: C.oneTimeSetupInr.value,
  perNumber: C.perNumberInr.value,
  perMinuteOpen: C.openSourcePerMinuteInr.value,
};

export function modelCategory(c: Canvas): "open" | "proprietary" | "unknown" {
  if (c.voiceModel === "proprietary" || c.llmModel === "proprietary") return "proprietary";
  if (c.voiceModel === "open" && c.llmModel === "open") return "open";
  return "unknown";
}

/** Total billable minutes in the planning period, when volume is known. */
export function periodMinutes(c: Canvas): number | null {
  if (c.callsPerMonth === null || c.avgMinutes === null) return null;
  const m = c.callsPerMonth * c.avgMinutes * c.months;
  return Number.isFinite(m) ? Math.round(m * 100) / 100 : null;
}

export function costInput(c: Canvas): CostInput {
  return { numbers: c.numbers, minutes: periodMinutes(c), minutesIsAssumption: true, category: modelCategory(c) };
}

export interface Unpriced {
  id: string;
  label: string;
  why: string;
  kind: "quote" | "outside" | "custom";
  /** The person's own figure, if typed. */
  figure: number | null;
}

export interface BudgetFit {
  budget: number | null;
  /** Documented charges that cannot be avoided for this build. */
  fixed: number;
  /** The figures the person typed, summed. */
  yourFigures: number;
  /** Money left after fixed charges and the person's own figures. Negative means short. */
  headroom: number | null;
  state: "none" | "short" | "fits" | "open";
  /** With open-source models: minutes the headroom pays for, in total and per month. */
  affordableMinutes: number | null;
  affordableMinutesPerMonth: number | null;
  affordableCallsPerMonth: number | null;
  /** Cost of the planned volume. */
  plannedUsage: number | null;
  /** The smallest budget that covers documented charges for this build (no usage). */
  minimumBudget: number;
  note: string;
}

export interface CanvasCost {
  core: CostResult;
  unpriced: Unpriced[];
  yourFigures: number;
  /** Documented total plus the person's own figures. */
  grand: number | null;
  grandIsComplete: boolean;
  fit: BudgetFit;
}

export function unpricedFor(c: Canvas): Unpriced[] {
  const out: Unpriced[] = [];
  for (const id of c.modules) {
    const m = MODULE_BY_ID[id];
    if (!m) continue;
    if (m.status === "quote") out.push({ id, label: m.label, why: "The package document does not give a price for this.", kind: "quote", figure: c.figures[id] ?? null });
    else if (m.status === "outside") out.push({ id, label: m.label, why: "Outside the package. It would be a separate assessment and a separate quote.", kind: "outside", figure: c.figures[id] ?? null });
    else if (m.status === "confirm" && m.cost === "Not listed") out.push({ id, label: m.label, why: "Not listed in the package document. Needs confirmation and a price.", kind: "quote", figure: c.figures[id] ?? null });
  }
  for (const x of c.custom) out.push({ id: x.id, label: x.label, why: "Your own addition. Not assessed and not priced by VoicERA.", kind: "custom", figure: c.figures[x.id] ?? null });
  if (modelCategory(c) === "proprietary") {
    out.push({ id: "proprietary-usage", label: "Proprietary model usage", why: "Per-minute pricing for proprietary models has not been supplied.", kind: "quote", figure: c.figures["proprietary-usage"] ?? null });
  }
  return out;
}

export function costFor(c: Canvas): CanvasCost {
  const core = calculateCost(costInput(c));
  const unpriced = unpricedFor(c);
  const yourFigures = unpriced.reduce((s, u) => s + (u.figure ?? 0), 0);
  const knownTotal = core.knownTotal;
  const grand = knownTotal === null ? null : knownTotal + yourFigures;
  const everyUnpricedHasFigure = unpriced.every((u) => u.figure !== null);
  const grandIsComplete = core.totalIsComplete && everyUnpricedHasFigure;
  return { core, unpriced, yourFigures, grand, grandIsComplete, fit: budgetFit(c, core, yourFigures) };
}

function budgetFit(c: Canvas, core: CostResult, yourFigures: number): BudgetFit {
  const fixed = RATES.setup + c.numbers * RATES.perNumber;
  const minimumBudget = fixed + yourFigures;
  const cat = modelCategory(c);
  const planned = periodMinutes(c);
  const plannedUsage = cat === "open" && planned !== null ? Math.round(planned * RATES.perMinuteOpen * 100) / 100 : null;
  const base: BudgetFit = {
    budget: c.budget,
    fixed,
    yourFigures,
    headroom: null,
    state: "none",
    affordableMinutes: null,
    affordableMinutesPerMonth: null,
    affordableCallsPerMonth: null,
    plannedUsage,
    minimumBudget,
    note: "",
  };
  if (c.budget === null || !Number.isFinite(c.budget) || c.budget <= 0) {
    return { ...base, note: `Enter your budget to see what it covers. The documented setup alone is ₹${RATES.setup.toLocaleString("en-IN")}.` };
  }
  const headroom = c.budget - fixed - yourFigures;
  base.headroom = headroom;
  if (headroom < 0) {
    return { ...base, state: "short", note: `The budget is ₹${Math.abs(headroom).toLocaleString("en-IN")} short of the documented one-time charges for this build, before any calls.` };
  }
  if (cat === "open") {
    const minutes = Math.floor(headroom / RATES.perMinuteOpen);
    const perMonth = Math.floor(minutes / c.months);
    const calls = c.avgMinutes && c.avgMinutes > 0 ? Math.floor(perMonth / c.avgMinutes) : null;
    const needed = plannedUsage;
    const fits = needed === null ? true : needed <= headroom + 1e-9;
    return {
      ...base,
      state: fits ? "fits" : "short",
      affordableMinutes: minutes,
      affordableMinutesPerMonth: perMonth,
      affordableCallsPerMonth: calls,
      note: needed !== null && !fits ? `The planned volume costs ₹${needed.toLocaleString("en-IN")} in calls but only ₹${headroom.toLocaleString("en-IN")} is left after the one-time charges.` : "",
    };
  }
  return {
    ...base,
    state: "open",
    note: cat === "proprietary"
      ? "Per-minute pricing for proprietary models has not been supplied, so what the rest of the budget buys cannot be worked out."
      : "Choose open-source models to see what the rest of the budget buys in call minutes.",
  };
}

export interface BreakdownPart {
  id: "setup" | "numbers" | "calls" | "yours";
  label: string;
  amount: number;
}

/** The parts of the known cost, for the chart. Parts that are zero or not yet known are left out. */
export function breakdownParts(c: Canvas, cost: CanvasCost): { parts: BreakdownPart[]; total: number; callsUnknown: boolean } {
  const parts: BreakdownPart[] = [{ id: "setup", label: "One-time setup", amount: RATES.setup }];
  if (c.numbers > 0) parts.push({ id: "numbers", label: c.numbers === 1 ? "Phone number" : `${c.numbers} phone numbers`, amount: c.numbers * RATES.perNumber });
  const usage = cost.core.usageTotal;
  if (usage !== null && usage > 0) parts.push({ id: "calls", label: "Calls", amount: usage });
  if (cost.yourFigures > 0) parts.push({ id: "yours", label: "Your own figures", amount: cost.yourFigures });
  return { parts, total: parts.reduce((t, p) => t + p.amount, 0), callsUnknown: usage === null };
}

export interface MonthPoint {
  month: number;
  cumulative: number;
}

/**
 * Cumulative cost month by month: the one-time charges at month 0, then planned call cost added each month.
 * Only for open-source models with a known volume, because that is the only per-minute rate in the document.
 * Calls are assumed to be spread evenly across the months.
 */
export function monthlySeries(c: Canvas, cost: CanvasCost): { points: MonthPoint[]; runsOutMonth: number | null } | null {
  if (modelCategory(c) !== "open" || c.callsPerMonth === null || c.avgMinutes === null) return null;
  const monthly = Math.round(c.callsPerMonth * c.avgMinutes * RATES.perMinuteOpen * 100) / 100;
  const start = RATES.setup + c.numbers * RATES.perNumber + cost.yourFigures;
  const points: MonthPoint[] = [];
  let runsOut: number | null = null;
  for (let m = 0; m <= c.months; m++) {
    const cumulative = Math.round((start + monthly * m) * 100) / 100;
    points.push({ month: m, cumulative });
    if (runsOut === null && c.budget !== null && cumulative > c.budget) runsOut = m;
  }
  return { points, runsOutMonth: runsOut };
}

/** What a budget buys at a few volumes, for the explorer table. Open-source models only. */
export function volumeTable(c: Canvas, minutesList: number[]): { minutes: number; usage: number; total: number; withinBudget: boolean | null }[] {
  const fixed = RATES.setup + c.numbers * RATES.perNumber;
  return minutesList.map((minutes) => {
    const usage = Math.round(minutes * RATES.perMinuteOpen * 100) / 100;
    const total = fixed + usage;
    return { minutes, usage, total, withinBudget: c.budget ? total <= c.budget : null };
  });
}

/** One-tap starting point for a budget: open-source models, one number, the template's modules. */
export function recommendForBudget(c: Canvas, budget: number): Canvas {
  const t = TEMPLATE_BY_ID[c.template];
  const base = applyTemplate(c, c.template);
  return {
    ...base,
    budget,
    voiceModel: "open",
    llmModel: "open",
    numbers: t.modules.includes("ch-in") ? 1 : 0,
  };
}

/* ------------------------------------------------------------------ fit verdict */

export interface CanvasVerdict {
  design: Design;
  answers: Answers;
  ev: Evaluation;
}

export function canvasToDesign(c: Canvas): Design {
  const t = TEMPLATE_BY_ID[c.template];
  const d = emptyDesign(t.topic);
  const blocks = new Set<BlockId>();
  for (const id of c.modules) {
    const b = MODULE_BY_ID[id]?.block;
    if (b) blocks.add(b);
  }
  d.blocks = [...blocks];
  d.languages = c.languages;
  d.department = c.department;
  d.kbCount = c.kb.count;
  d.kbMaxMB = c.kb.maxMB;
  d.kbTextFiles = c.kb.textFiles;
  d.ready = c.ready;
  d.sensitivity = c.sensitivity;
  d.category = modelCategory(c);
  d.numbers = c.numbers;
  d.minutes = periodMinutes(c);
  return d;
}

export function canvasToAnswers(c: Canvas): Answers {
  const t = TEMPLATE_BY_ID[c.template];
  const d = canvasToDesign(c);
  let a = designToAnswers(d);
  // A grievance line that only takes complaints (no link to a complaints system) is not "registration",
  // which the engine treats as needing a system link. It is judged as another use case, and says so.
  const linksSystem = c.modules.includes("cn-register") || c.modules.includes("cn-status");
  const objective = t.id === "grievance" && !linksSystem ? "other" : t.objective;
  a = setValue(a, "objective", objective);
  if (objective === "inbound-info") a = setValue(a, "infoTopic", "other");
  // Unknown stays unknown: only set a direction the canvas actually shows.
  const inbound = c.modules.includes("ch-in") || c.modules.includes("ch-web");
  const outbound = c.modules.includes("ch-out") || c.modules.includes("tk-remind");
  if (t.objective !== "feedback-service") {
    if (inbound || outbound) a = setValue(a, "direction", inbound && outbound ? "both" : inbound ? "inbound" : "outbound");
  }
  if (inbound && !c.modules.includes("ch-in")) {
    // A browser link has no number to buy.
    a = setValue(a, "numberSource", "new");
  }
  return a;
}

export function judgeCanvas(c: Canvas): CanvasVerdict | null {
  const design = canvasToDesign(c);
  const answers = canvasToAnswers(c);
  const ev = evaluate(answers, { cost: { category: modelCategory(c), minutes: periodMinutes(c) } });
  if (!ev) return null;
  return { design, answers, ev };
}

/** The state of one module on the canvas, from the verdict. */
export type ModuleState = "ok" | "warn" | "blocked";
export function moduleState(m: Module, v: CanvasVerdict | null): { state: ModuleState; why?: string } {
  if (m.status === "outside") return { state: "blocked", why: m.cost === "Not recommended" ? "The package document does not recommend this." : "The package document lists this as out of scope." };
  if (m.status === "quote") return { state: "warn", why: "Possible, but the document gives no price and no timeline beyond a range." };
  if (m.status === "confirm") return { state: "warn", why: "Needs confirmation from the VoicEra/Bhashini team before you rely on it." };
  if (v && m.block) {
    // A block can still be flagged by the engine, for example a use case outside the documented two.
    const dim = v.ev.dimensions.find((x) => x.id === "use-case");
    if (dim && (dim.result === "review" || dim.result === "blocked") && (m.id === "tk-listen" || m.id === "tk-info")) {
      return { state: "warn", why: "This use case is not one of the two documented ones, so this step needs confirmation." };
    }
  }
  return { state: "ok" };
}

/* ------------------------------------------------------------------ script and exports */

export interface ScriptLine {
  moduleId: string;
  title: string;
  says: string;
}

export function scriptLines(c: Canvas): ScriptLine[] {
  const dept = c.department.trim() || "department";
  const lines: ScriptLine[] = [];
  for (const m of MODULES) {
    if (!c.modules.includes(m.id) || !m.says) continue;
    const flag = m.status === "outside" ? " (not in the package)" : m.status === "confirm" || m.status === "quote" ? " (confirm first)" : "";
    lines.push({ moduleId: m.id, title: `${m.label}${flag}`, says: m.says.replace("{department}", dept) });
  }
  return lines;
}

export const LANGUAGE_CHOICES = [...DOCUMENTED_LANGUAGES, "Odia", "Urdu", "Konkani", "Maithili", "Nepali"] as string[];

export interface Readiness3 {
  id: keyof Design["ready"];
  label: string;
  detail: string;
  applies: boolean;
}

export function bringList(c: Canvas): Readiness3[] {
  const outbound = c.modules.includes("ch-out") || c.modules.includes("tk-remind");
  return [
    { id: "script", label: "Conversation script flow", detail: "What the service says, in what order, for your use case.", applies: true },
    { id: "knowledge", label: "A basic knowledge base", detail: "Up to 10 text files, up to 5 MB each.", applies: true },
    { id: "phoneList", label: "Citizens' phone numbers", detail: "Only for outbound campaigns.", applies: outbound },
    { id: "permission", label: "Permission to call", detail: "Confirm you may call these citizens. This is your decision to make.", applies: outbound },
    { id: "testers", label: "People to test calls before launch", detail: "The department tests after the agent is set up and before launch.", applies: true },
  ];
}

export function setReady(c: Canvas, id: keyof Design["ready"], v: Readiness): Canvas {
  return { ...c, ready: { ...c.ready, [id]: v } };
}

/** The pack of files handed to the VoicEra team. Plain text, generated in the browser. */
export function handoverFiles(c: Canvas, cost: CanvasCost, v: CanvasVerdict | null): { name: string; content: string }[] {
  const t = TEMPLATE_BY_ID[c.template];
  const inr = (n: number | null) => (n === null ? "Not calculated" : `Rs. ${n.toLocaleString("en-IN")}`);
  const on = MODULES.filter((m) => c.modules.includes(m.id));
  const L: string[] = [];
  L.push(`# ${c.name.trim() || "Custom voice service"}: handover summary`, "");
  L.push(`Department: ${c.department.trim() || "Not entered"}`);
  L.push(`Use case: ${t.title}. ${t.stance}`);
  L.push(`Package: ${PLATINUM.name}`, "");
  L.push("## Fit against the package", "");
  L.push(v ? `Outcome: ${v.ev.outcome}${v.ev.pendingGovernance ? " (pending security and data-governance confirmation)" : ""}` : "Outcome: not yet judged");
  if (v) for (const f of v.ev.findings.filter((x) => x.severity === "blocker" || x.severity === "review")) L.push(`- ${f.severity.toUpperCase()}: ${f.title}. ${f.detail}`);
  L.push("", "## What is on the canvas", "");
  for (const lane of LANES) {
    const items = on.filter((m) => m.lane === lane.id);
    const cust = c.custom.filter((x) => x.lane === lane.id);
    if (!items.length && !cust.length) continue;
    L.push(`### ${lane.title}`);
    for (const m of items) L.push(`- ${m.label} (${m.status}: ${m.cost})`);
    for (const x of cust) L.push(`- ${x.label} (your own addition, not assessed)${x.note ? `: ${x.note}` : ""}`);
    L.push("");
  }
  L.push(`Languages: ${c.languages.join(", ") || "None chosen"}`);
  L.push(`Voice models: ${c.voiceModel}. Language model: ${c.llmModel}.`, "");
  L.push("## Cost", "");
  for (const line of cost.core.lines) L.push(`- ${line.label}: ${inr(line.amount)} (${line.basis})`);
  L.push(`- ${cost.core.totalLabel}: ${inr(cost.core.knownTotal)}`);
  if (cost.unpriced.length) {
    L.push("", "Not priced in the package document, so not in the total above:");
    for (const u of cost.unpriced) L.push(`- ${u.label}: ${u.why}${u.figure !== null ? ` Your own figure: ${inr(u.figure)} (yours, not VoicERA's).` : ""}`);
  }
  L.push("", "## Budget", "");
  L.push(`Budget entered: ${inr(c.budget)} over ${c.months} month${c.months === 1 ? "" : "s"} (the period is a planning assumption).`);
  if (cost.fit.note) L.push(cost.fit.note);
  L.push("", "No tax, number rental, recurring fee or extra charge is added, because none is in the package document.");

  const cfg = {
    package: PLATINUM.id,
    name: c.name.trim() || null,
    department: c.department.trim() || null,
    useCase: c.template,
    modules: c.modules,
    custom: c.custom,
    languages: c.languages,
    models: { voice: c.voiceModel, llm: c.llmModel, note: "The package document lists sample models only. The actual options are to be confirmed." },
    numbers: c.numbers,
    knowledge: c.kb,
    readiness: c.ready,
    planning: { budget: c.budget, months: c.months, callsPerMonth: c.callsPerMonth, avgMinutes: c.avgMinutes },
    note: "Generated in the browser from the canvas. Not an order and not a quote.",
  };

  const script = scriptLines(c).map((s) => `[${s.title}]\n${s.says}`).join("\n\n");
  const checklist = ["Item,Applies,State", ...bringList(c).map((b) => `"${b.label}",${b.applies ? "yes" : "no"},${c.ready[b.id]}`)].join("\n");
  return [
    { name: "README.md", content: L.join("\n") },
    { name: "agent-config.json", content: JSON.stringify(cfg, null, 2) },
    { name: "script-draft.txt", content: script || "No script lines yet." },
    { name: "department-brings.csv", content: checklist },
  ];
}

/* ------------------------------------------------------------------ deployment stages */

export type StageState = "done" | "now" | "waiting" | "open";

export interface Stage {
  id: string;
  title: string;
  owner: "You" | "VoicEra team" | "Both";
  plain: string;
  /** What the package document says about it, if anything. */
  documented?: string;
  state: StageState;
  /** Why it is in this state. */
  reason: string;
}

export interface VerifyItem {
  id: string;
  label: string;
  detail: string;
}

export const VERIFY_ITEMS: VerifyItem[] = [
  { id: "langs", label: "Each chosen language was tested on a real call", detail: "Speak and listen in every language you chose, not only English." },
  { id: "kb", label: "Answers match your approved knowledge files", detail: "Ask ten real questions. Note anything it invents." },
  { id: "unknown", label: "It says so when it does not know", detail: "Ask something outside the files. It should not guess." },
  { id: "emergency", label: "An emergency goes to 112", detail: "Say there is danger. It should direct to 112 and not promise help." },
  { id: "handover", label: "The handover you chose works", detail: "Callback or office pointer is offered when asked." },
  { id: "latency", label: "Response time felt acceptable", detail: "The document gives a target under 1.5 seconds. Judge it on real calls." },
  { id: "privacy", label: "It never asked for identity numbers, bank details or one-time codes", detail: "Read the transcripts of the test calls." },
];

export interface DeployInput {
  canvas: Canvas;
  verdict: CanvasVerdict | null;
  cost: CanvasCost;
  verify: Record<string, boolean>;
  signedOff: boolean;
  handedOver: boolean;
}

export function stagesFor(i: DeployInput): Stage[] {
  const { canvas: c, verdict: v, cost, verify } = i;
  const list = bringList(c).filter((b) => b.applies);
  const inHand = list.filter((b) => c.ready[b.id] === "yes").length;
  const allInHand = inHand === list.length;
  const blockers = v ? v.ev.setupBlockers.length : 1;
  const outcome = v?.ev.outcome;
  const designReady = c.modules.length > 0 && c.languages.length > 0 && c.department.trim().length > 0 && !!outcome && outcome !== "outside-scope";
  const budgetOk = cost.fit.state === "fits" || (cost.fit.state === "open" && cost.fit.headroom !== null && cost.fit.headroom >= 0);
  const verified = VERIFY_ITEMS.every((x) => verify[x.id]);
  const verifiedCount = VERIFY_ITEMS.filter((x) => verify[x.id]).length;

  const st: Stage[] = [];
  st.push({
    id: "design",
    title: "Design on the canvas",
    owner: "You",
    plain: "Choose the use case, the modules and the languages. Name the department.",
    state: designReady ? "done" : "now",
    reason: designReady ? "Department named, languages chosen, and the build is not outside the package." : !c.department.trim() ? "Enter the department name." : c.languages.length === 0 ? "Choose at least one language." : outcome === "outside-scope" ? "The build is outside the package. Remove the blocked modules." : "Add modules to the canvas.",
  });
  st.push({
    id: "budget",
    title: "Cost and budget sign-off",
    owner: "You",
    plain: "Check the build against the money you have. Approve internally.",
    documented: "Billing is through Bhashini.",
    state: i.signedOff ? "done" : designReady && budgetOk ? "now" : "waiting",
    reason: i.signedOff ? "Signed off by you in this session." : !designReady ? "Finish the design first." : !budgetOk ? "The budget does not yet cover the build." : "Ready for your sign-off.",
  });
  st.push({
    id: "inputs",
    title: "Hand over what the department brings",
    owner: "You",
    plain: "Script, knowledge files, phone list, test people.",
    documented: "The department supplies a use case, script flow, a basic knowledge base, phone numbers for outbound, and test resources.",
    state: allInHand ? "done" : i.signedOff || designReady ? "now" : "waiting",
    reason: `${inHand} of ${list.length} in hand.`,
  });
  st.push({
    id: "setup",
    title: "Agent set up by the VoicEra team",
    owner: "VoicEra team",
    plain: "The team builds the agent and campaign from your inputs.",
    documented: "Set up in 2 working days after all requirements are provided.",
    state: i.handedOver ? "done" : allInHand && blockers === 0 ? "now" : "waiting",
    reason: i.handedOver ? "You marked the pack as handed over." : blockers > 0 ? `${blockers} open item${blockers === 1 ? "" : "s"} must be settled first.` : !allInHand ? "Waiting for the inputs above." : "Ready for hand-over.",
  });
  st.push({
    id: "verify",
    title: "Test and verify before launch",
    owner: "Both",
    plain: "The department makes real test calls and checks the agent against the list on the Verify tab.",
    documented: "The department tests after agent setup and before launch. Model quality is not committed in the document, which points to a Voice Arena report that has not been supplied.",
    state: verified ? "done" : i.handedOver ? "now" : "waiting",
    reason: `${verifiedCount} of ${VERIFY_ITEMS.length} checks ticked by you.`,
  });
  st.push({
    id: "launch",
    title: "Launch the campaign or open the number",
    owner: "Both",
    plain: "Go live to citizens.",
    documented: "Campaign setup and monitoring support, up to 10 a month.",
    state: verified ? "now" : "waiting",
    reason: verified ? "All checks ticked." : "Finish verification first.",
  });
  st.push({
    id: "run",
    title: "Monitor and improve",
    owner: "Both",
    plain: "Watch calls, read the analysis, tune the script and knowledge.",
    documented: "Dashboard of calls attempted, connected, dropped, completed and average length. Post-campaign analysis within 3 working days. 24-hour support to troubleshoot.",
    state: "waiting",
    reason: "Starts after launch.",
  });
  return st;
}
