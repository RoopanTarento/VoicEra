import { SEGMENTS } from "../icp";
import {
  LANGUAGES, LIMITS, NOT_IN_PACKAGE, SEGMENT_CHOICES, USE_CASES, USE_CASE_BY_ID, DEPTHS, PACKAGE_NAME, depthRank, maxDepth, suggestedUseCases,
  type Depth, type UseCaseId,
} from "./catalog";
import { emptyHints, presetSelection, type Hints, type Selection } from "./canvas";
import { DOCUMENT_PRICES, inr } from "./pricing";

/**
 * The adopter's answers, the questions that gather them, and the package those answers point to.
 * The questions are adaptive: each one is asked only if the answers so far make it useful.
 * The recommendation is a short list of named rules, so the reason for it can always be shown.
 */

export type Scale = "hundreds" | "thousands" | "tens" | "lakhs" | "unsure";
export type Length = "short" | "medium" | "long" | "unsure";
export type Systems = "api" | "planned" | "none" | "unsure";
export type HandoffPref = "callback" | "office" | "live" | "unsure";
export type ContentState = "ready" | "partly" | "none";
export type Sensitivity = "public" | "personal" | "sensitive" | "unsure";
export type HostPref = "bhashini" | "gov" | "private" | "onprem" | "any";
export type TelPref = "new" | "own" | "browser" | "unsure";
export type ModelsPref = "auto" | "open-only" | "proprietary-ok" | "own" | "unsure";
export type Timeline = "days" | "weeks" | "months" | "unsure";
export type Direction = "in" | "out" | "both";

export interface Profile {
  sector: string | null;
  sectorText: string;
  department: string;
  useCases: UseCaseId[];
  direction: Direction | null;
  scale: Scale | null;
  length: Length | null;
  languages: string[] | null;
  otherLanguages: string;
  systems: Systems | null;
  handoff: HandoffPref | null;
  content: ContentState | null;
  sensitivity: Sensitivity | null;
  host: HostPref | null;
  telephony: TelPref | null;
  models: ModelsPref | null;
  timeline: Timeline | null;
  budget: number | null;
  budgetAsked: boolean;
  /** Questions the adopter put that the documents do not answer. Passed to the VoicERA team. */
  openQuestions: string[];
  answered: string[];
}

export const emptyProfile = (): Profile => ({
  sector: null, sectorText: "", department: "", useCases: [], direction: null, scale: null, length: null, languages: null, otherLanguages: "",
  systems: null, handoff: null, content: null, sensitivity: null, host: null, telephony: null, models: null, timeline: null,
  budget: null, budgetAsked: false, openQuestions: [], answered: [],
});

export const CALLS: Record<Exclude<Scale, "unsure">, number> = { hundreds: 500, thousands: 5000, tens: 50000, lakhs: 500000 };
export const MINUTES: Record<Exclude<Length, "unsure">, number> = { short: 1.5, medium: 2.5, long: 4 };

/* ------------------------------------------------------------------ small helpers */

const has = (p: Profile, u: UseCaseId) => p.useCases.includes(u);
const any = (p: Profile, ...us: UseCaseId[]) => us.some((u) => p.useCases.includes(u));

function impliedDirection(us: UseCaseId[]): Direction | null {
  if (!us.length) return null;
  const dirs = new Set(us.map((u) => USE_CASE_BY_ID[u].direction));
  if (dirs.size === 1) {
    const d = [...dirs][0];
    return d === "both" ? null : d;
  }
  // a mix of "in" and "out" use cases means both directions are in play
  if (dirs.has("in") && dirs.has("out")) return "both";
  return null;
}

export function inboundOutbound(p: Profile): { inbound: boolean; outbound: boolean } {
  const d = p.direction ?? impliedDirection(p.useCases) ?? "in";
  return { inbound: d === "in" || d === "both", outbound: d === "out" || d === "both" };
}

/** Parses "5 lakh", "50k", "1,50,000", "₹150000" into a number of rupees, or a plain count. */
export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/(\d),(?=\d)/g, "$1").replace(/[₹,]/g, " ").replace(/rs\.?/g, " ");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(crore|cr|lakhs?|lacs?|l|k|thousand|m|million)?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? "";
  const mult = /crore|^cr$/.test(unit) ? 1e7 : /lakh|lac|^l$/.test(unit) ? 1e5 : /^k$|thousand/.test(unit) ? 1e3 : /^m$|million/.test(unit) ? 1e6 : 1;
  return Math.round(n * mult * 100) / 100;
}

/* ------------------------------------------------------------------ questions */

export type QId = "who" | "use" | "dir" | "scale" | "length" | "lang" | "systems" | "handoff" | "content" | "sens" | "host" | "tel" | "models" | "time" | "budget" | "more";

export interface Choice {
  id: string;
  label: string;
  hint?: string;
  /** True when the answers so far make this a likely fit. */
  suggested?: boolean;
  /** Words that, typed by the adopter, select this choice. */
  keys?: string[];
}

export interface Question {
  id: QId;
  kind: "single" | "multi" | "number" | "text" | "done";
  when: (p: Profile) => boolean;
  prompt: (p: Profile) => string;
  /** Why we ask, in plain words. */
  why: string;
  choices?: (p: Profile) => Choice[];
  /** Shown on the chip history after answering. */
  summary: (p: Profile) => string;
}

const SECTOR_KEYS: Record<string, string[]> = {
  civic: ["municipal", "city", "urban", "ulb", "civic", "corporation", "ward", "pothole", "garbage"],
  highways: ["highway", "nhai", "road", "transport", "toll"],
  utilities: ["water", "power", "electric", "utility", "utilities", "sewage", "gas"],
  agriculture: ["agri", "farm", "farmer", "crop", "kisan"],
  welfare: ["welfare", "scheme", "social", "pension", "ration", "women", "child"],
  census: ["census", "statistic", "survey office"],
};

function sectorChoices(): Choice[] {
  return SEGMENTS.map((s) => ({ id: s.id, label: s.name, hint: s.adopters, keys: [s.name.toLowerCase(), ...(SECTOR_KEYS[s.id] ?? [])] }));
}

const LANGUAGE_KEYS: Record<string, string[]> = { English: ["english"], Hindi: ["hindi"], Marathi: ["marathi"], Tamil: ["tamil"], Telugu: ["telugu"], Kannada: ["kannada"], Gujarati: ["gujarati"], Bengali: ["bengali", "bangla"], Punjabi: ["punjabi"], Assamese: ["assamese"], Malayalam: ["malayalam"] };

export const QUESTIONS: Question[] = [
  {
    id: "who", kind: "single", when: () => true,
    prompt: () => "Welcome. I will help you work out which VoicERA package fits, and build it with you. First, which kind of department are you?",
    why: "Departments in the same sector tend to need the same things, so I can start from what usually works for them.",
    choices: () => [...sectorChoices(), { id: "other", label: "Something else", hint: "Tell me in your own words", keys: ["other", "something else"] }],
    summary: (p) => (p.sector === "other" ? p.sectorText || "Another department" : SEGMENT_CHOICES.find((s) => s.id === p.sector)?.name ?? "Not said"),
  },
  {
    id: "use", kind: "multi", when: () => true,
    prompt: (p) => (p.sector && p.sector !== "other" ? "What would you like citizens to be able to do by voice? Choose every one that applies. I have marked the ones that usually fit your kind of department." : "What would you like citizens to be able to do by voice? Choose every one that applies."),
    why: "The use cases decide how deeply VoicERA has to connect to your systems, which is what separates the three packages.",
    choices: (p) => {
      const sug = suggestedUseCases(p.sector);
      return USE_CASES.map((u) => ({ id: u.id, label: u.label, hint: u.plain, suggested: sug.includes(u.id), keys: USE_KEYS[u.id] }));
    },
    summary: (p) => p.useCases.map((u) => USE_CASE_BY_ID[u].label).join(", ") || "None yet",
  },
  {
    id: "dir", kind: "single", when: (p) => p.useCases.length > 0 && p.direction === null && impliedDirection(p.useCases) === null,
    prompt: () => "Who starts the conversation?",
    why: "Calls you place need a phone list and permission to call. Calls you receive need a number citizens know.",
    choices: () => [
      { id: "in", label: "Citizens call us", hint: "An inbound line", keys: ["inbound", "they call", "citizens call", "call us"] },
      { id: "out", label: "We call citizens", hint: "Campaigns and reminders", keys: ["outbound", "we call", "call them", "campaign"] },
      { id: "both", label: "Both", hint: "Inbound and outbound", keys: ["both"] },
    ],
    summary: (p) => ({ in: "Citizens call us", out: "We call citizens", both: "Both directions" })[p.direction ?? "in"],
  },
  {
    id: "scale", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: () => "Roughly how many calls a month do you expect?",
    why: "Volume drives the cost of calls, and very large volumes bring up how many calls arrive at the same moment.",
    choices: () => [
      { id: "hundreds", label: "A few hundred", hint: "A pilot or one office", keys: ["hundred", "pilot", "few hundred"] },
      { id: "thousands", label: "A few thousand", hint: "A district", keys: ["thousand", "district"] },
      { id: "tens", label: "Tens of thousands", hint: "A state service", keys: ["ten thousand", "tens of thousand", "state"] },
      { id: "lakhs", label: "Lakhs", hint: "Population scale", keys: ["lakh", "million", "lac", "population"] },
      { id: "unsure", label: "Not sure yet", keys: ["not sure", "unsure", "dont know", "don't know"] },
    ],
    summary: (p) => ({ hundreds: "A few hundred a month", thousands: "A few thousand a month", tens: "Tens of thousands a month", lakhs: "Lakhs a month", unsure: "Volume not sure yet" })[p.scale ?? "unsure"],
  },
  {
    id: "length", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: () => "How long would a typical conversation last?",
    why: "The package document does not recommend conversations longer than 3 minutes, and length affects cost when calls are charged by the minute.",
    choices: () => [
      { id: "short", label: "A minute or two", keys: ["minute or two", "short", "quick", "1 min", "2 min"] },
      { id: "medium", label: "Two to three minutes", keys: ["two to three", "3 min"] },
      { id: "long", label: "More than three minutes", hint: "Not recommended in the package", keys: ["longer", "more than three", "long", "5 min", "10 min"] },
      { id: "unsure", label: "Not sure yet", keys: ["not sure", "unsure", "dont know", "don't know"] },
    ],
    summary: (p) => ({ short: "A minute or two", medium: "Two to three minutes", long: "More than three minutes", unsure: "Length not sure yet" })[p.length ?? "unsure"],
  },
  {
    id: "lang", kind: "multi", when: (p) => p.useCases.length > 0,
    prompt: () => "Which languages should it speak? Choose all that apply. You can also type a language that is not listed.",
    why: "Languages decide which speech and voice models fit. The package document lists eleven; others need confirming.",
    choices: () => LANGUAGES.map((l) => ({ id: l, label: l, keys: LANGUAGE_KEYS[l] })),
    summary: (p) => [...(p.languages ?? []), ...(p.otherLanguages ? [p.otherLanguages] : [])].join(", ") || "None chosen",
  },
  {
    id: "systems", kind: "single", when: (p) => any(p, "grievance", "forms", "status", "scheme", "other"),
    prompt: (p) =>
      has(p, "grievance")
        ? "Should complaints be filed straight into a system you already run, such as a grievance or ticketing portal?"
        : any(p, "forms", "status")
          ? "Does your form or application portal have an API that VoicERA can connect to?"
          : "Should it look up each citizen's record or application status in a system of yours, or just talk about schemes?",
    why: "This is the single biggest thing that separates the packages: how far VoicERA connects into your own systems.",
    choices: (p) =>
      !any(p, "grievance", "forms", "status")
        ? [
            { id: "none", label: "Just talk about schemes", hint: "No connection needed", keys: ["just talk", "no connection", "no", "talk only"] },
            { id: "api", label: "Yes, check records live", hint: "We have an API", keys: ["yes", "live", "api", "check record"] },
            { id: "planned", label: "Yes, but we have no API yet", keys: ["no api", "not yet", "planned", "later"] },
            { id: "unsure", label: "Not sure", keys: ["not sure", "unsure", "dont know", "don't know"] },
          ]
        : [
            { id: "api", label: "Yes, and it has an API", hint: "Ready to connect", keys: ["yes", "has an api", "api", "ready"] },
            { id: "planned", label: "Yes, but there is no API yet", hint: "We would build one", keys: ["no api", "not yet", "planned", "later", "build"] },
            { id: "none", label: "No, staff will work from what is captured", hint: "No system to connect", keys: ["no", "staff", "table", "spreadsheet", "none"] },
            { id: "unsure", label: "Not sure", keys: ["not sure", "unsure", "dont know", "don't know"] },
          ],
    summary: (p) => ({ api: "A system with an API", planned: "A system, no API yet", none: "No system to connect", unsure: "Not sure about systems" })[p.systems ?? "unsure"],
  },
  {
    id: "handoff", kind: "single", when: (p) => any(p, "grievance", "forms", "status", "helpline", "scheme", "other"),
    prompt: () => "When the agent cannot help, what should happen?",
    why: "A safe exit protects citizens and staff. Passing a call to a person live, with the conversation attached, is a feature of the top package.",
    choices: () => [
      { id: "callback", label: "Staff call the citizen back", hint: "Simple, no live staffing", keys: ["call back", "callback", "ring back"] },
      { id: "office", label: "Point to an office", hint: "Says where to go", keys: ["office", "visit", "point"] },
      { id: "live", label: "Pass the call to a person right away", hint: "With the conversation attached", keys: ["live", "transfer", "person", "right away", "human"] },
      { id: "unsure", label: "Not sure", keys: ["not sure", "unsure", "dont know", "don't know"] },
    ],
    summary: (p) => ({ callback: "Staff call back", office: "Point to an office", live: "Live handover to a person", unsure: "Handover not sure yet" })[p.handoff ?? "unsure"],
  },
  {
    id: "content", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: () => "Do you have approved content ready: scheme details, FAQs, scripts?",
    why: "VoicERA answers from your approved content. It is the one thing only you can bring.",
    choices: () => [
      { id: "ready", label: "Yes, ready to share", keys: ["yes", "ready"] },
      { id: "partly", label: "Partly", hint: "Some of it", keys: ["partly", "some", "partial"] },
      { id: "none", label: "Not yet", keys: ["not yet", "no", "none"] },
    ],
    summary: (p) => ({ ready: "Content ready", partly: "Content partly ready", none: "No content yet" })[p.content ?? "none"],
  },
  {
    id: "sens", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: () => "What kind of information will callers share?",
    why: "Personal or sensitive information raises questions about where data is stored and for how long.",
    choices: () => [
      { id: "public", label: "Public information only", hint: "Schemes, opening hours", keys: ["public"] },
      { id: "personal", label: "Personal details", hint: "Name, phone number, address", keys: ["personal", "name", "address"] },
      { id: "sensitive", label: "Sensitive details", hint: "Health, income, caste, identity numbers", keys: ["sensitive", "health", "income", "caste", "aadhaar", "identity"] },
      { id: "unsure", label: "Not sure", keys: ["not sure", "unsure", "dont know", "don't know"] },
    ],
    summary: (p) => ({ public: "Public information", personal: "Personal details", sensitive: "Sensitive details", unsure: "Not sure about the data" })[p.sensitivity ?? "unsure"],
  },
  {
    id: "host", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: () => "Where must the service run?",
    why: "It decides where call data lives and who can reach it. The package document describes one option, hosting on Bhashini.",
    choices: () => [
      { id: "bhashini", label: "Hosted on Bhashini", hint: "The package as documented", keys: ["bhashini"] },
      { id: "gov", label: "A government cloud", keys: ["government cloud", "gov cloud", "meity", "nic"] },
      { id: "private", label: "Our private cloud", keys: ["private"] },
      { id: "onprem", label: "Our own data centre", hint: "On-premise", keys: ["on-prem", "onprem", "premise", "data centre", "data center", "our own"] },
      { id: "any", label: "No preference", keys: ["no preference", "any", "dont mind", "don't mind"] },
    ],
    summary: (p) => ({ bhashini: "Hosted on Bhashini", gov: "Government cloud", private: "Private cloud", onprem: "Own data centre", any: "No hosting preference" })[p.host ?? "any"],
  },
  {
    id: "tel", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: (p) => (inboundOutbound(p).inbound ? "How will citizens reach it?" : "Which number should the calls come from?"),
    why: "A new number is fastest. Using your own provider and numbers is documented as 2 to 4 weeks.",
    choices: (p) => [
      { id: "new", label: "A new number from VoicERA's partners", hint: "Fastest", keys: ["new", "partner", "voicera", "fast"] },
      { id: "own", label: "Our own provider and numbers", hint: "2 to 4 weeks, case by case", keys: ["own", "existing", "our provider", "our number"] },
      ...(inboundOutbound(p).inbound ? [{ id: "browser", label: "A web link, no phone line", keys: ["web", "browser", "link", "kiosk"] }] : []),
      { id: "unsure", label: "Not sure", keys: ["not sure", "unsure", "dont know", "don't know"] },
    ],
    summary: (p) => ({ new: "A new number", own: "Own provider and numbers", browser: "A web link", unsure: "Phone line not decided" })[p.telephony ?? "unsure"],
  },
  {
    id: "models", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: () => "Do you have a view on the AI models behind it?",
    why: "Open-source models are covered by the standard price. Commercial models and your own models cost differently.",
    choices: () => [
      { id: "auto", label: "Leave it to VoicERA", hint: "Open-source, the simplest start", keys: ["leave it", "voicera", "you choose", "dont mind", "don't mind"] },
      { id: "open-only", label: "Open-source only", keys: ["open source", "open-source", "sovereign"] },
      { id: "proprietary-ok", label: "Allow a commercial model if it is better", hint: "Such as OpenAI", keys: ["openai", "commercial", "proprietary", "gpt"] },
      { id: "own", label: "We will bring our own model or API", keys: ["own model", "our own", "our api", "bring"] },
      { id: "unsure", label: "I would like to understand more first", keys: ["not sure", "unsure", "dont know", "don't know", "explain"] },
    ],
    summary: (p) => ({ auto: "Leave models to VoicERA", "open-only": "Open-source only", "proprietary-ok": "Commercial allowed if better", own: "Bring our own model", unsure: "Models not decided" })[p.models ?? "unsure"],
  },
  {
    id: "time", kind: "single", when: (p) => p.useCases.length > 0,
    prompt: () => "When would you like to go live?",
    why: "The packages have different typical timings, and your own approvals set the real date.",
    choices: () => [
      { id: "days", label: "Within days", keys: ["day", "asap", "immediately", "this week"] },
      { id: "weeks", label: "Within weeks", keys: ["week"] },
      { id: "months", label: "In a few months", keys: ["month", "quarter"] },
      { id: "unsure", label: "No date yet", keys: ["no date", "not sure", "unsure", "dont know", "don't know"] },
    ],
    summary: (p) => ({ days: "Go live in days", weeks: "Go live in weeks", months: "Go live in months", unsure: "No date yet" })[p.timeline ?? "unsure"],
  },
  {
    id: "budget", kind: "number", when: (p) => p.useCases.length > 0,
    prompt: () => "Do you have a budget in mind? Type an amount, like 2 lakh, or choose not sure.",
    why: "I will show what fits, and what the next package up would add.",
    summary: (p) => (p.budget === null ? "No budget yet" : `Budget ${inr(p.budget)}`),
  },
  {
    id: "more", kind: "done", when: (p) => p.useCases.length > 0,
    prompt: () => "Is there anything you would like to ask before I show your package? Pick a question below, or type your own.",
    why: "Your own questions matter most. Anything the documents do not answer goes on a list for the VoicERA team.",
    summary: () => "Ready for the package",
  },
];

export const QUESTION_BY_ID: Record<QId, Question> = Object.fromEntries(QUESTIONS.map((q) => [q.id, q])) as Record<QId, Question>;

const USE_KEYS: Record<UseCaseId, string[]> = {
  scheme: ["scheme", "discover", "eligib", "benefit", "welfare"],
  helpline: ["helpline", "faq", "question", "information", "enquiry", "inquiry"],
  grievance: ["grievance", "complaint", "complain", "issue", "report"],
  survey: ["survey", "feedback", "poll"],
  forms: ["form", "fill"],
  status: ["status", "application", "track"],
  alerts: ["alert", "reminder", "notice", "notify"],
  other: ["other", "something else"],
};

/** The next question to ask, or null when everything useful has been asked. */
export function nextQuestion(p: Profile): Question | null {
  for (const q of QUESTIONS) {
    if (p.answered.includes(q.id)) continue;
    if (q.when(p)) return q;
  }
  return null;
}

/** Questions that are in play for this adopter, answered or not, for the progress bar. */
export function plannedQuestions(p: Profile): Question[] {
  return QUESTIONS.filter((q) => q.id !== "more" && (q.when(p) || p.answered.includes(q.id)));
}

/* ------------------------------------------------------------------ applying an answer */

export type AnswerValue = string | string[] | number | null;

export function applyAnswer(p: Profile, qid: QId, v: AnswerValue, extra?: { text?: string }): Profile {
  const next: Profile = { ...p, answered: p.answered.includes(qid) ? p.answered : [...p.answered, qid] };
  switch (qid) {
    case "who": {
      const id = String(v);
      next.sector = id;
      next.sectorText = id === "other" ? extra?.text ?? "" : "";
      next.department = id === "other" ? (extra?.text ?? "") : (SEGMENT_CHOICES.find((s) => s.id === id)?.name ?? "");
      break;
    }
    case "use": {
      next.useCases = (v as string[]).filter((x): x is UseCaseId => x in USE_CASE_BY_ID);
      next.direction = impliedDirection(next.useCases);
      // Changing use cases can make later answers stale: drop the ones that no longer apply.
      if (!any(next, "grievance", "forms", "status", "scheme", "other")) next.systems = null;
      break;
    }
    case "dir": next.direction = v as Direction; break;
    case "scale": next.scale = v as Scale; break;
    case "length": next.length = v as Length; break;
    case "lang": {
      const list = (v as string[]) ?? [];
      next.languages = list.filter((l) => (LANGUAGES as string[]).includes(l));
      next.otherLanguages = list.filter((l) => !(LANGUAGES as string[]).includes(l)).join(", ");
      break;
    }
    case "systems": next.systems = v as Systems; break;
    case "handoff": next.handoff = v as HandoffPref; break;
    case "content": next.content = v as ContentState; break;
    case "sens": next.sensitivity = v as Sensitivity; break;
    case "host": next.host = v as HostPref; break;
    case "tel": next.telephony = v as TelPref; break;
    case "models": next.models = v as ModelsPref; break;
    case "time": next.timeline = v as Timeline; break;
    case "budget": next.budget = typeof v === "number" && v > 0 ? v : null; next.budgetAsked = true; break;
    case "more": break;
  }
  return next;
}

/** Re-open one question so the adopter can change that answer. Other answers are kept. */
export function reopen(p: Profile, qid: QId): Profile {
  return { ...p, answered: p.answered.filter((a) => a !== qid) };
}

/* ------------------------------------------------------------------ the agent's reaction */

/** One or two sentences after an answer. Only facts from the documents, or a plain consequence of the answer. */
export function reactTo(p: Profile, qid: QId): string[] {
  switch (qid) {
    case "who": {
      const seg = SEGMENTS.find((s) => s.id === p.sector);
      if (!seg) return ["Thank you. Tell me what you want to solve and I will place it."];
      return [`${seg.adopters} is a typical adopter. The usual pattern for this kind of department: ${seg.workflow.toLowerCase()}.`];
    }
    case "use": {
      if (!p.useCases.length) return ["Choose at least one, or tell me in your own words."];
      const depth = p.useCases.reduce<Depth>((d, u) => maxDepth(d, USE_CASE_BY_ID[u].depth), "deploy");
      const lines = p.useCases.slice(0, 3).map((u) => USE_CASE_BY_ID[u].note);
      return [...lines, `On their own, these point to ${PACKAGE_NAME[depth]}. Your answers about systems can change that.`];
    }
    case "dir": return p.direction !== "in" ? ["Calls you place need a phone list and permission to call, which is yours to confirm."] : ["Inbound calls need a number citizens know. We will sort that out below."];
    case "scale":
      return p.scale === "lakhs" || p.scale === "tens"
        ? [`At that size, what matters is how many calls arrive at the same moment. The documented limit is ${LIMITS.concurrent} at once.`]
        : p.scale === "unsure" ? ["No problem. I will leave volume open and show cost per call."] : ["That is comfortably within what one setup handles."];
    case "length":
      return p.length === "long" ? [`The package document does not recommend conversations longer than ${LIMITS.callMinutes} minutes. Shorter calls are cheaper and keep callers on the line.`] : ["Good. Short, focused calls work best on the phone."];
    case "lang": {
      const other = p.otherLanguages.trim();
      return other
        ? [`${other} is not among the eleven documented languages, so I will mark it to confirm. The rest are covered.`]
        : [`All of these are among the ${LANGUAGES.length} documented languages, and callers can switch language mid-call.`];
    }
    case "systems":
      if (p.systems === "api") return has(p, "grievance") ? ["That is the Orchestrate pattern: file the case in your system and follow it to closure."] : ["That puts you at Connect or above: VoicERA reads and writes through your API."];
      if (p.systems === "planned") return ["We can start without it and connect later. That is exactly what the upgrade path is for."];
      if (p.systems === "none") return ["Then the Deploy package can do the talking and capture the details for your staff."];
      return ["That is fine. I will show you both the starting point and where you could grow."];
    case "handoff":
      return p.handoff === "live" ? ["Passing a call to a person with the conversation attached is part of Orchestrate."] : ["That works at every package, with no live staffing needed."];
    case "content":
      return p.content === "none" ? ["Content is the one thing only you can bring. A good start is the ten questions citizens ask most."] : p.content === "partly" ? ["Good. You can add the rest while we set up."] : ["Good. That is the most important thing you bring."];
    case "sens":
      return p.sensitivity === "sensitive" || p.sensitivity === "personal"
        ? ["Where call data is stored, and for how long, is not yet stated in the documents. I will list it as something to confirm before you launch."]
        : ["Public information keeps this simple."];
    case "host":
      return p.host && p.host !== "bhashini" && p.host !== "any" ? ["The package document only describes hosting on Bhashini. The ICP lists other options, so I will mark yours to confirm."] : ["Hosting on Bhashini is the option the package document describes."];
    case "tel":
      return p.telephony === "own" ? [`Using your own provider is documented as ${LIMITS.ownTelephonyWeeks[0]} to ${LIMITS.ownTelephonyWeeks[1]} weeks, case by case.`] : p.telephony === "browser" ? ["A web link needs no number, but citizens with a basic phone cannot use it."] : ["A number from VoicERA's partners is the quickest route."];
    case "models":
      return p.models === "proprietary-ok" ? ["Commercial models are priced separately. The documents give no price, so I will show them as not set until a price is given."]
        : p.models === "own" ? ["You will pay your provider directly. VoicERA's fee for connecting your model is not defined yet, so I will show it as open."]
        : p.models === "unsure" ? ["On the canvas, every model has a plain-words reason attached, so you can choose with confidence."]
        : ["Open-source models are covered by the standard per-call price."];
    case "time": return ["Typical ranges: Deploy takes days, Connect weeks, Orchestrate weeks to months. They are not commitments. Your approvals set the real date."];
    case "budget":
      return p.budget === null ? ["No problem. I will show you what each package costs."] : p.budget < DOCUMENT_PRICES.setupDeploy ? [`The documented one-time setup alone is ${inr(DOCUMENT_PRICES.setupDeploy)}, so I will flag that.`] : ["Noted. I will show how the plan sits against it."];
    default: return [];
  }
}

/* ------------------------------------------------------------------ the recommendation */

export interface Reason {
  rule: string;
  text: string;
}
export interface Caution {
  rule: string;
  text: string;
  tone: "info" | "warn";
}
export interface Recommendation {
  /** The package that matches what the adopter wants to achieve. */
  want: Depth;
  /** The quickest sensible place to start. */
  startAt: Depth;
  path: Depth[];
  reasons: Reason[];
  cautions: Caution[];
  confidence: "clear" | "leaning" | "open";
  unknowns: string[];
}

export function recommend(p: Profile): Recommendation {
  const reasons: Reason[] = [];
  const cautions: Caution[] = [];
  const unknowns: string[] = [];

  if (!p.useCases.length) return { want: "deploy", startAt: "deploy", path: ["deploy"], reasons: [], cautions: [], confidence: "open", unknowns: ["What you want to solve"] };

  // R1: the use cases
  let want: Depth = "deploy";
  for (const u of p.useCases) {
    const uc = USE_CASE_BY_ID[u];
    want = maxDepth(want, uc.depth);
    reasons.push({ rule: "R1", text: `${uc.label}: ${uc.note}` });
  }

  // R2: connecting to systems
  const needsSystem = any(p, "grievance", "forms", "status");
  if (p.systems === "api") {
    if (has(p, "grievance")) { want = maxDepth(want, "orchestrate"); reasons.push({ rule: "R2", text: "Your system has an API and you want complaints filed into it, so the full workflow applies." }); }
    else { want = maxDepth(want, "connect"); reasons.push({ rule: "R2", text: "You want VoicERA to read or write in a system of yours through an API." }); }
  } else if (p.systems === "none" && has(p, "grievance") && p.handoff !== "live") {
    // Grievance with nothing to file into is an intake line: take the complaint and capture it for staff.
    want = p.useCases.filter((u) => u !== "grievance").reduce<Depth>((d, u) => maxDepth(d, USE_CASE_BY_ID[u].depth), "deploy");
    reasons.push({ rule: "R2", text: "With no system to file complaints into, VoicERA can take the complaint and capture it for your staff. That is an intake line, which sits at Deploy." });
    cautions.push({ rule: "C-grievance-intake", tone: "info", text: "A complaint intake line without a system link is possible to design but is not one of the two use cases the package document names. Confirm it with the VoicERA team." });
  } else if (p.systems === "planned") {
    reasons.push({ rule: "R2", text: "You have a system but no API yet, so you can start without the connection and add it when it is ready." });
  } else if (p.systems === "unsure" && needsSystem) {
    unknowns.push("Whether a system of yours can be connected");
  }

  // R3: handover
  if (p.handoff === "live") { want = maxDepth(want, "orchestrate"); reasons.push({ rule: "R3", text: "You want calls passed to a person with the conversation attached, which is part of Orchestrate." }); }
  if (p.handoff === "unsure") unknowns.push("What should happen when the agent cannot help");

  // Where to start: with a working API we can start at the full depth. Otherwise start with the conversation
  // alone at Deploy and connect later, except where the use case itself cannot work without a connection.
  let startAt: Depth = want;
  const cannotWithoutLink = any(p, "forms", "status") && p.systems === "none";
  if (depthRank(want) > 0 && p.systems !== "api" && !cannotWithoutLink) startAt = "deploy";
  if (cannotWithoutLink) cautions.push({ rule: "C-endpoint", tone: "warn", text: "Form filling and status checks need something that can accept and return data. Without a system to connect to, only the conversation can be built." });
  const path = DEPTHS.filter((d) => depthRank(d) >= depthRank(startAt) && depthRank(d) <= depthRank(want));
  if (startAt !== want) reasons.push({ rule: "R4", text: `Start with ${PACKAGE_NAME[startAt]} and move up to ${PACKAGE_NAME[want]} when your system is ready. It is the same platform, so nothing is thrown away.` });

  // Cautions
  if (p.timeline === "days" && depthRank(startAt) > 0) cautions.push({ rule: "C-time", tone: "warn", text: `You want to go live in days. ${PACKAGE_NAME[startAt]} typically takes ${startAt === "connect" ? "weeks" : "weeks to months"}. Deploy takes days.` });
  if (p.timeline === "weeks" && startAt === "orchestrate") cautions.push({ rule: "C-time", tone: "warn", text: "Orchestrate typically takes weeks to months, because of the integration and approvals. Timings are typical ranges, not commitments." });
  if (p.budget !== null && p.budget < DOCUMENT_PRICES.setupDeploy) cautions.push({ rule: "C-budget", tone: "warn", text: `The documented one-time setup alone is ${inr(DOCUMENT_PRICES.setupDeploy)}.` });
  if (p.otherLanguages.trim()) cautions.push({ rule: "C-lang", tone: "info", text: `${p.otherLanguages} is not among the eleven documented languages. Confirm it.` });
  if (p.length === "long") cautions.push({ rule: "C-length", tone: "warn", text: `Conversations over ${LIMITS.callMinutes} minutes are not recommended in the package document.` });
  if (p.scale === "lakhs" || p.scale === "tens") cautions.push({ rule: "C-scale", tone: "info", text: `The documented limit is ${LIMITS.concurrent} calls at once. At your volume, what matters is the peak.` });
  if (p.sensitivity === "sensitive" || p.sensitivity === "personal") cautions.push({ rule: "C-data", tone: "warn", text: "Where call data is stored and for how long is not stated in the documents. Confirm both before launch." });
  if (p.host && p.host !== "bhashini" && p.host !== "any") cautions.push({ rule: "C-host", tone: "info", text: "Only hosting on Bhashini is described in the package document. Your choice is listed in the ICP, so confirm availability and cost." });
  if (p.telephony === "own") cautions.push({ rule: "C-tel", tone: "info", text: `Using your own telephony provider adds ${LIMITS.ownTelephonyWeeks[0]} to ${LIMITS.ownTelephonyWeeks[1]} weeks, case by case.` });
  if (p.models === "proprietary-ok" || p.models === "own") cautions.push({ rule: "C-models", tone: "info", text: p.models === "own" ? "Bringing your own model: you pay your provider, and VoicERA's connection fee is not defined yet." : "Commercial models are priced separately and the documents give no price." });
  if (p.content === "none") cautions.push({ rule: "C-content", tone: "info", text: "You will need approved content before launch. It is the one thing only you can bring." });
  if (has(p, "grievance") || has(p, "helpline")) cautions.push({ rule: "C-emergency", tone: "info", text: "VoicERA cannot send help in an emergency. Callers in danger are pointed to 112." });
  if (p.scale === "unsure") unknowns.push("How many calls a month");

  const confidence: Recommendation["confidence"] = unknowns.length === 0 && (p.systems !== null || !needsSystem) ? "clear" : p.answered.length >= 3 ? "leaning" : "open";
  return { want, startAt, path, reasons, cautions, confidence, unknowns };
}

/* ------------------------------------------------------------------ from answers to a canvas */

export function hintsFrom(p: Profile): Hints {
  const h = emptyHints();
  const { inbound, outbound } = inboundOutbound(p);
  h.inbound = inbound;
  h.outbound = outbound;
  h.languages = [...(p.languages ?? [])];
  h.scriptOnly = p.useCases.length > 0 && p.useCases.every((u) => u === "survey" || u === "alerts");
  h.handoff = p.handoff === "callback" || p.handoff === "office" || p.handoff === "live" ? p.handoff : null;
  h.host = p.host === "any" || p.host === null ? null : p.host;
  h.telephony = p.telephony === "unsure" ? null : p.telephony;
  h.models = p.models === "unsure" ? null : p.models;
  h.workload = {
    callsPerMonth: p.scale && p.scale !== "unsure" ? CALLS[p.scale] : null,
    avgMinutes: p.length && p.length !== "unsure" ? MINUTES[p.length] : null,
    months: 3,
    budget: p.budget,
  };
  return h;
}

export function selectionFor(p: Profile, depth: Depth): Selection {
  return presetSelection(depth, hintsFrom(p));
}

export const SEGMENT_NAME = (id: string): string => SEGMENT_CHOICES.find((x) => x.id === id)?.name ?? "";

export const labelsOfUseCases = (p: Profile) => p.useCases.map((u) => USE_CASE_BY_ID[u].label);

/** Everything the documents say is outside the packaged offer, for the "good to know" list. */
export const OUTSIDE = NOT_IN_PACKAGE;
