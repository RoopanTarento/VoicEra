import { setValue } from "./answers";
import { evaluate, type EvalContext } from "./evaluate";
import { interpret } from "./interpret";
import { DOCUMENTED_LANGUAGES } from "./source";
import { emptyAnswers } from "./usecases";
import type { Answers, DimensionId, Evaluation } from "./types";

/**
 * The Composer: the service is built by adding blocks to a call, not by answering questions.
 * A composition is turned into the same answers the rule engine already understands, so the
 * verdict, limits and cost come from the same package rules. Nothing is guessed: whatever a
 * composition does not say stays unknown and shows up as an open condition.
 */

export type Topic = "scheme" | "survey" | "other";
export type BlockId =
  | "in-call" | "out-call" | "own-number"
  | "hear-need" | "qualify" | "match" | "explain" | "survey-q" | "capture" | "reminder"
  | "say-unknown" | "callback" | "redirect" | "live-transfer" | "emergency"
  | "lookup" | "submit" | "crm" | "whatsapp" | "images" | "long-calls" | "big-campaign" | "peak-gt500";

export type BlockGroup = "start" | "conversation" | "safety" | "extras";

export interface Block {
  id: BlockId;
  group: BlockGroup;
  label: string;
  plain: string;
  /** Which topics it makes sense for. Omit for all. */
  topics?: Topic[];
  /** The dimension that decides whether this block is a problem. */
  causes?: DimensionId;
  /** Only one of these sets may be on at once. */
  exclusive?: BlockId[];
  /** Shown in the palette as a risky addition. */
  risky?: boolean;
  /** Agent line shown in the script. */
  says?: string;
}

export const BLOCKS: Block[] = [
  { id: "in-call", group: "start", label: "Citizens call a number", plain: "A phone number citizens dial.", says: "Hello, this is the {department} assistant. This call may be recorded, and you can ask for a person at any time." },
  { id: "out-call", group: "start", label: "We call citizens", plain: "A campaign the department starts.", says: "Hello, this is the {department} assistant. Is this a good time for a short call?" },
  { id: "own-number", group: "start", label: "Use our own number and provider", plain: "Documented as 2 to 4 weeks, case by case.", causes: "telephony" },

  { id: "hear-need", group: "conversation", label: "Listen to the need", plain: "The citizen says it in their own words.", topics: ["scheme", "other"], says: "What do you need help with? You can describe it in your own words." },
  { id: "qualify", group: "conversation", label: "Ask a few qualifying questions", plain: "Narrow down which scheme may apply.", topics: ["scheme"], says: "To check which schemes may apply, may I ask a few questions?" },
  { id: "match", group: "conversation", label: "Match schemes from the knowledge base", plain: "Up to 10 text files of 5 MB.", topics: ["scheme", "other"], causes: "knowledge", says: "Based on what you said, [scheme] may apply. It is for [who it is for]." },
  { id: "explain", group: "conversation", label: "Explain documents and how to apply", plain: "Where to go and what to bring.", topics: ["scheme"], says: "You may need [documents]. You can apply at [where]." },
  { id: "survey-q", group: "conversation", label: "Ask the survey questions", plain: "One at a time, in the citizen's language.", topics: ["survey"], causes: "duration", says: "On a scale of 1 to 5, how would you rate the service?" },
  { id: "capture", group: "conversation", label: "Capture answers as a table", plain: "A downloadable dataset.", topics: ["survey"], says: "Thank you. I have noted your answers." },
  { id: "reminder", group: "conversation", label: "Follow-up reminder call", plain: "A second call to remind or check.", topics: ["scheme", "survey"], says: "I am calling to follow up on our earlier conversation." },

  { id: "say-unknown", group: "safety", label: "Say so when it does not know", plain: "Never guess.", says: "I do not have that information, so I will not guess." },
  { id: "callback", group: "safety", label: "Offer a staff callback", plain: "Staff ring back later.", exclusive: ["redirect", "live-transfer"], says: "I can ask a member of staff to call you back." },
  { id: "redirect", group: "safety", label: "Point to an office", plain: "Says where to go or who to contact.", exclusive: ["callback", "live-transfer"], says: "You can ask at the district office." },
  { id: "live-transfer", group: "safety", label: "Pass the call to a person live", plain: "Not listed in the package.", exclusive: ["callback", "redirect"], causes: "telephony", risky: true, says: "I will connect you to a person now." },
  { id: "emergency", group: "safety", label: "Send emergencies to 112", plain: "It cannot send help.", says: "If anyone is in danger, please call 112 now. This service cannot send help." },

  { id: "lookup", group: "extras", label: "Check a citizen's record", plain: "Live eligibility from your database.", causes: "integration", risky: true, topics: ["scheme", "other"], says: "Let me check your record." },
  { id: "submit", group: "extras", label: "Submit an application", plain: "Take and file it in your system.", causes: "integration", risky: true, topics: ["scheme", "other"], says: "I will submit your application now." },
  { id: "crm", group: "extras", label: "Update a case in your system", plain: "Read or write case records.", causes: "integration", risky: true, says: "I have updated your case." },
  { id: "whatsapp", group: "extras", label: "Reach people on WhatsApp calling", plain: "Out of scope for this package.", causes: "integration", risky: true },
  { id: "images", group: "extras", label: "Accept photos or video", plain: "Beyond voice.", causes: "integration", risky: true },
  { id: "long-calls", group: "extras", label: "Allow calls longer than 3 minutes", plain: "Not recommended.", causes: "duration", risky: true },
  { id: "big-campaign", group: "extras", label: "Run more than 10 campaigns a month", plain: "Above the support allowance.", causes: "campaign-ops", risky: true },
  { id: "peak-gt500", group: "extras", label: "Handle more than 500 calls at once", plain: "Above the documented limit.", causes: "usage", risky: true },
];

export const BLOCK_BY_ID: Record<BlockId, Block> = Object.fromEntries(BLOCKS.map((b) => [b.id, b])) as Record<BlockId, Block>;

/** The fixed order of a call, so the canvas always reads like a conversation. */
export const ORDER: BlockId[] = [
  "in-call", "out-call", "own-number", "hear-need", "qualify", "survey-q", "match", "explain", "capture",
  "lookup", "submit", "crm", "whatsapp", "images", "long-calls", "big-campaign", "peak-gt500",
  "say-unknown", "callback", "redirect", "live-transfer", "emergency", "reminder",
];

export type Readiness = "yes" | "no" | "unknown";

export interface Design {
  topic: Topic;
  blocks: BlockId[];
  languages: string[];
  length: "short" | "about";
  department: string;
  kbCount: number;
  kbMaxMB: number;
  kbTextFiles: boolean;
  /** What the department says it has. Left unknown until the person says. */
  ready: { script: Readiness; knowledge: Readiness; phoneList: Readiness; permission: Readiness; testers: Readiness };
  sensitivity: "unknown" | "public" | "personal" | "sensitive";
  category: "unknown" | "open" | "proprietary";
  numbers: number | null;
  minutes: number | null;
}

export function emptyDesign(topic: Topic = "scheme"): Design {
  return {
    topic,
    blocks: [],
    languages: [],
    length: "short",
    department: "",
    kbCount: 3,
    kbMaxMB: 1,
    kbTextFiles: true,
    ready: { script: "unknown", knowledge: "unknown", phoneList: "unknown", permission: "unknown", testers: "unknown" },
    sensitivity: "unknown",
    category: "unknown",
    numbers: null,
    minutes: null,
  };
}

export interface Starter {
  id: string;
  title: string;
  plain: string;
  topic: Topic;
  blocks: BlockId[];
  languages: string[];
}

export const STARTERS: Starter[] = [
  { id: "helpline", title: "Scheme helpline", plain: "Citizens call, say what they need, and hear which schemes may apply.", topic: "scheme", blocks: ["in-call", "hear-need", "qualify", "match", "explain", "say-unknown", "callback", "emergency"], languages: ["Hindi", "English"] },
  { id: "feedback", title: "Feedback campaign", plain: "Call citizens after a service and collect their answers.", topic: "survey", blocks: ["out-call", "survey-q", "capture", "emergency"], languages: ["English"] },
  { id: "reach", title: "Scheme outreach with a reminder", plain: "Call eligible people, answer questions, and follow up.", topic: "scheme", blocks: ["in-call", "out-call", "hear-need", "match", "explain", "reminder", "say-unknown", "callback", "emergency"], languages: ["Hindi", "English"] },
  { id: "blank", title: "Start from nothing", plain: "Build the call block by block.", topic: "scheme", blocks: [], languages: [] },
];

export function fromStarter(s: Starter): Design {
  return { ...emptyDesign(s.topic), blocks: [...s.blocks], languages: [...s.languages] };
}

/** Reads one sentence into a first design. Only what was said is added. */
export function fromSentence(text: string): Design {
  const i = interpret(text);
  const topic: Topic = i.useCase === "survey-feedback" ? "survey" : i.useCase === "scheme-discovery" ? "scheme" : "other";
  const blocks = new Set<BlockId>();
  if (i.direction === "inbound" || i.direction === "both") blocks.add("in-call");
  if (i.direction === "outbound" || i.direction === "both" || topic === "survey") blocks.add("out-call");
  if (topic === "scheme") ["hear-need", "match", "explain", "say-unknown"].forEach((b) => blocks.add(b as BlockId));
  if (topic === "survey") ["survey-q", "capture"].forEach((b) => blocks.add(b as BlockId));
  if (topic === "other") ["hear-need", "say-unknown"].forEach((b) => blocks.add(b as BlockId));
  blocks.add("emergency");
  if (i.eligibilityMode === "live-check" || i.needs.includes("database")) blocks.add("lookup");
  if (i.needs.includes("existing-system") || i.needs.includes("case-records") || i.needs.includes("api-webhook")) blocks.add("crm");
  if (i.needs.includes("whatsapp")) blocks.add("whatsapp");
  if (i.needs.includes("multimodal")) blocks.add("images");
  if (i.duration === "long") blocks.add("long-calls");
  const d = emptyDesign(topic);
  d.blocks = ORDER.filter((b) => blocks.has(b));
  d.languages = i.languages;
  d.numbers = i.direction === "inbound" || i.direction === "both" ? 1 : null;
  return d;
}

export function toggleBlock(d: Design, id: BlockId): Design {
  const on = d.blocks.includes(id);
  let next = on ? d.blocks.filter((b) => b !== id) : [...d.blocks, id];
  if (!on) next = next.filter((b) => !(BLOCK_BY_ID[id].exclusive ?? []).includes(b));
  return { ...d, blocks: ORDER.filter((b) => next.includes(b)) };
}

export function setTopic(d: Design, topic: Topic): Design {
  const allowed = (b: BlockId) => !BLOCK_BY_ID[b].topics || BLOCK_BY_ID[b].topics!.includes(topic);
  return { ...d, topic, blocks: d.blocks.filter(allowed) };
}

const has = (d: Design, b: BlockId) => d.blocks.includes(b);

/** Turns a composition into engine answers. Anything the composition does not say stays unknown. */
export function designToAnswers(d: Design): Answers {
  let a = emptyAnswers();
  const put = (id: string, v: unknown) => {
    a = setValue(a, id, v);
  };
  const unknown = (id: string) => {
    a = { ...a, unknown: { ...a.unknown, [id]: true } };
  };
  const readyVal = (r: Readiness, yes: string, no: string, id: string) => (r === "yes" ? put(id, yes) : r === "no" ? put(id, no) : unknown(id));

  const inbound = has(d, "in-call");
  const outbound = has(d, "out-call") || has(d, "reminder");

  put("objective", d.topic === "scheme" ? "scheme-discover" : d.topic === "survey" ? (outbound || !inbound ? "feedback-service" : "citizen-survey") : "other");
  if (d.topic === "survey") {
    if (inbound && !outbound) {
      put("surveyOutbound", "not-correct");
      put("direction", "inbound");
    } else put("surveyOutbound", "confirm");
  } else if (inbound || outbound) {
    put("direction", inbound && outbound ? "both" : inbound ? "inbound" : "outbound");
  }
  if (d.topic === "scheme") {
    put("eligibilityMode", has(d, "submit") ? "application" : has(d, "lookup") ? "live-check" : has(d, "qualify") ? "rules" : "general");
  }
  put("languages", d.languages);
  put("convDuration", has(d, "long-calls") ? "long" : d.length);

  const needs: string[] = [];
  if (has(d, "lookup")) needs.push("database");
  if (has(d, "crm")) needs.push("case-records");
  if (has(d, "whatsapp")) needs.push("whatsapp");
  if (has(d, "images")) needs.push("multimodal");
  if (has(d, "own-number")) needs.push("custom-telephony");
  put("needs", needs.length ? needs : ["standalone"]);

  put("peakConcurrency", has(d, "peak-gt500") ? "gt500" : "lt100");
  if (has(d, "live-transfer")) put("fallback", "live-transfer");
  else if (has(d, "callback")) put("fallback", "callback");
  else if (has(d, "redirect")) put("fallback", "redirect");

  if (d.topic === "survey") put("kbNeeded", has(d, "match"));
  if (d.topic !== "survey" || has(d, "match")) {
    readyVal(d.ready.knowledge, "approved", "none", "kbStatus");
    if (d.ready.knowledge !== "no") put("kbFiles", { count: d.kbCount, maxMB: d.kbMaxMB, formats: [d.kbTextFiles ? "Text" : "PDF"] });
  }
  readyVal(d.ready.script, "ready", "none", "scriptStatus");
  if (outbound) {
    readyVal(d.ready.phoneList, "ready", "to-collect", "phoneListStatus");
    readyVal(d.ready.permission, "confirmed", "not-confirmed", "consentStatus");
    put("campaignsPerMonth", has(d, "big-campaign") ? 12 : 2);
  }
  if (inbound) put("numberSource", has(d, "own-number") ? "own" : "new");
  readyVal(d.ready.testers, "ready", "no", "testResources");
  if (d.sensitivity === "unknown") unknown("dataSensitivity");
  else put("dataSensitivity", d.sensitivity);
  if (d.department.trim()) put("department", d.department.trim());
  return a;
}

export type NodeState = "ok" | "warn" | "blocked" | "pending";

export interface Verdict {
  answers: Answers;
  ev: Evaluation;
  /** Status of each block in the composition, from the rule engine. */
  blocks: Record<string, { state: NodeState; why?: string; dimension?: DimensionId }>;
  /** Blocks whose removal would clear a blocker or review item. */
  culprits: BlockId[];
  open: string[];
}

export function judge(d: Design, ctx: EvalContext = {}): Verdict | null {
  const answers = designToAnswers(d);
  const ev = evaluate(answers, ctx);
  if (!ev) return null;
  const dim = (id: DimensionId) => ev.dimensions.find((x) => x.id === id);
  const blocks: Verdict["blocks"] = {};
  const culprits: BlockId[] = [];
  for (const id of d.blocks) {
    const b = BLOCK_BY_ID[id];
    let state: NodeState = "ok";
    let why: string | undefined;
    if (b.causes) {
      const r = dim(b.causes);
      if (r) {
        if (b.risky && (r.result === "blocked" || r.result === "review")) {
          state = r.result === "blocked" ? "blocked" : "warn";
          why = r.consequence;
          culprits.push(id);
        } else if (!b.risky && (r.result === "blocked" || r.result === "review")) {
          state = r.result === "blocked" ? "blocked" : "warn";
          why = r.consequence;
        } else if (!b.risky && (r.result === "conditional" || r.result === "unresolved")) {
          state = "warn";
          why = r.consequence;
        }
      }
    }
    blocks[id] = { state, why, dimension: b.causes };
  }
  const open = ev.setupBlockers.slice();
  return { answers, ev, blocks, culprits, open };
}

/** Languages offered, split into documented and the rest, for the palette. */
export const LANGUAGE_CHOICES = [...DOCUMENTED_LANGUAGES, "Odia", "Urdu", "Konkani", "Maithili", "Nepali"];

/** A readable draft of the call, in the order the blocks run. */
export function scriptFor(d: Design): { block: BlockId; title: string; says: string }[] {
  const dept = d.department.trim() || "department";
  return ORDER.filter((id) => d.blocks.includes(id) && BLOCK_BY_ID[id].says).map((id) => ({
    block: id,
    title: BLOCK_BY_ID[id].label,
    says: BLOCK_BY_ID[id].says!.replace("{department}", dept),
  }));
}
