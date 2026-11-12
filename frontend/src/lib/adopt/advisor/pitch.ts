import {
  MODULES, TEMPLATE_BY_ID, TEMPLATES, costFor, judgeCanvas, newCanvas, toggleModule,
  type Canvas, type CanvasCost, type CanvasVerdict, type TemplateId,
} from "./canvas";
import { DOCUMENTED_LANGUAGES, PLATINUM } from "./source";

/**
 * The elevated pitch and the short set of questions that tailor it.
 * Every figure is read from the package document constants, so the pitch cannot drift from the facts.
 * Nothing here is a promise: targets are called targets, and open items are called open.
 */

/* ------------------------------------------------------------------ the pitch */

export interface OfferTile {
  id: string;
  title: string;
  line: string;
}

const L = PLATINUM.limits;

export const OFFER_TILES: OfferTile[] = [
  { id: "languages", title: `${DOCUMENTED_LANGUAGES.length} languages`, line: "English and ten Indian languages, with the caller able to switch language mid-call." },
  { id: "channels", title: "Phone or browser", line: "Citizens ring a number or talk from a web page. You can also use your own telephony provider." },
  { id: "scale", title: `Up to ${L.maxConcurrentCalls.value} calls at once`, line: `A response-time target under ${L.latencyTargetSeconds.value} seconds, and ${L.uptimePercent.value}% uptime as stated in the package document.` },
  { id: "content", title: "Only your content", line: `It answers from the approved files you give it: up to ${L.maxKnowledgeFiles.value} text files of up to ${L.maxKnowledgeFileMB.value} MB each.` },
  { id: "watch", title: "See what happens", line: `A dashboard of calls attempted, connected, dropped and completed, and an analysis within ${L.postCampaignAnalysisWorkingDays.value} working days of a campaign.` },
  { id: "people", title: "People to help", line: `A dedicated campaign operator and a shared programme manager. Set up in ${L.setupSlaWorkingDays.value} working days once you have handed over what is needed, and ${L.troubleshootingHours.value}-hour support for issues.` },
];

export interface PricePoint {
  id: string;
  amount: string;
  unit: string;
  line: string;
}

export const PRICES: PricePoint[] = [
  { id: "setup", amount: `₹${PLATINUM.commercial.oneTimeSetupInr.value.toLocaleString("en-IN")}`, unit: "once", line: "Setup of your agent and campaign." },
  { id: "number", amount: `₹${PLATINUM.commercial.perNumberInr.value}`, unit: "per phone number", line: "For each number citizens call." },
  { id: "minute", amount: `₹${PLATINUM.commercial.openSourcePerMinuteInr.value.toFixed(2)}`, unit: "per minute", line: "Open-source models, everything included, even the phone line." },
];

export const PRICE_CAVEATS = [
  "Proprietary models are not priced in the package document, so we cannot give you a figure for them.",
  "No tax, number rental or recurring fee is added, because none is in the document.",
];

/** What the package does not do, in plain words. Each line maps to the package document. */
export const NOT_COVERED = [
  "Connecting to your department's own systems. That needs a separate assessment.",
  "WhatsApp calling.",
  `Calls longer than ${L.maxConversationMinutes.value} minutes. They are not recommended.`,
  "Photos and video, which the document does not recommend.",
];

/** Answers the package document leaves open. Said out loud, not hidden. */
export const STILL_OPEN = ["Where call data is stored", "Whether call data is used to train models", "How long call data is kept"];

export const HOW_STEPS = [
  { id: "bring", title: "You bring", line: "The script, your approved content, and a phone list for outbound calls." },
  { id: "run", title: "VoicERA runs the call", line: "It listens, thinks using your content, and speaks back in the citizen's language." },
  { id: "see", title: "You see the result", line: "A dashboard and an analysis, so you know what worked." },
];

/* ------------------------------------------------------------------ the questions */

export type ScaleId = "hundreds" | "thousands" | "tens" | "unsure";
export type LengthId = "short" | "medium" | "long" | "unsure";

export interface Profile {
  template: TemplateId | null;
  scale: ScaleId | null;
  length: LengthId | null;
  /** Rupees. null with `budgetAsked` true means "not sure yet". */
  budget: number | null;
  budgetAsked: boolean;
  department: string;
}

export const emptyProfile = (): Profile => ({ template: null, scale: null, length: null, budget: null, budgetAsked: false, department: "" });

export interface Option<T extends string> {
  id: T;
  label: string;
  hint?: string;
}

export const SCALE: { id: ScaleId; label: string; hint: string; calls: number | null }[] = [
  { id: "hundreds", label: "A few hundred a month", hint: "About 500 calls. A pilot or one office.", calls: 500 },
  { id: "thousands", label: "A few thousand a month", hint: "About 5,000 calls. A district.", calls: 5000 },
  { id: "tens", label: "Tens of thousands a month", hint: "About 50,000 calls. A state service.", calls: 50000 },
  { id: "unsure", label: "Not sure yet", hint: "We will leave volume open.", calls: null },
];

export const LENGTH: { id: LengthId; label: string; hint: string; minutes: number | null }[] = [
  { id: "short", label: "A minute or two", hint: "About 1.5 minutes.", minutes: 1.5 },
  { id: "medium", label: "Two to three minutes", hint: "About 2.5 minutes.", minutes: 2.5 },
  { id: "long", label: "More than three minutes", hint: "Not recommended in the package.", minutes: 4 },
  { id: "unsure", label: "Not sure yet", hint: "We will leave it open.", minutes: null },
];

export const QUESTION_COUNT = 4;

/** The index of the first question not yet answered, or QUESTION_COUNT when all are. */
export function firstOpenQuestion(p: Profile): number {
  if (p.template === null) return 0;
  if (p.scale === null) return 1;
  if (p.length === null) return 2;
  if (!p.budgetAsked) return 3;
  return QUESTION_COUNT;
}

/** The canvas the answers imply. Planning figures, labelled as such wherever they are shown. */
export function canvasFromProfile(p: Profile): Canvas {
  let c: Canvas = newCanvas(p.template ?? "grievance");
  const calls = SCALE.find((s) => s.id === p.scale)?.calls ?? null;
  const minutes = LENGTH.find((l) => l.id === p.length)?.minutes ?? null;
  c = {
    ...c,
    department: p.department,
    budget: p.budget,
    callsPerMonth: calls,
    avgMinutes: minutes,
    // Open-source is the only priced option, so the plan starts there. It can be changed on the canvas.
    voiceModel: "open",
    llmModel: "open",
  };
  if (p.length === "long" && !c.modules.includes("tk-long")) c = toggleModule(c, "tk-long");
  return c;
}

/* ------------------------------------------------------------------ the tailored plan */

const DOES: Record<TemplateId, string[]> = {
  grievance: [
    "A citizen calls and describes a complaint in their own words and language.",
    "It asks what, where and since when, and reads it back to confirm.",
    "Each complaint is recorded as a row your staff can work from, and emergencies are sent to 112.",
  ],
  scheme: [
    "A citizen says what they need in their own words and language.",
    "It asks a few questions and names the schemes that may apply, from your approved files.",
    "It explains the documents and where to apply, and says so when it does not know.",
  ],
  survey: [
    "VoicERA calls citizens after they used a service, in their language.",
    "It asks your survey questions one at a time.",
    "Answers land in a downloadable table, with a dashboard of how the calls went.",
  ],
  info: [
    "A citizen calls with a common question about your service.",
    "It answers from your approved files: hours, documents, fees, where to go.",
    "It points to an office, or offers a staff callback, when it cannot help.",
  ],
  forms: [
    "A citizen is guided through a form by voice.",
    "It collects the details one question at a time.",
    "Passing them into your form system is outside the package, so that part would need a separate assessment.",
  ],
  custom: [
    "A citizen calls and says what they need.",
    "It answers from your approved files, or says it does not know.",
    "You add the steps you need on the canvas.",
  ],
};

export interface Plan {
  title: string;
  does: string[];
  canvas: Canvas;
  cost: CanvasCost;
  verdict: CanvasVerdict | null;
  /** Plain points to be aware of, most important first. */
  beware: string[];
  /** What the department brings. */
  brings: string[];
  headline: { label: string; value: string; sub: string }[];
}

export function planFor(p: Profile): Plan {
  const c = canvasFromProfile(p);
  const t = TEMPLATE_BY_ID[c.template];
  const cost = costFor(c);
  const verdict = judgeCanvas(c);
  const dept = p.department.trim();
  const beware: string[] = [t.stance];
  for (const m of MODULES) if (c.modules.includes(m.id) && m.status === "outside") beware.push(`${m.label} is not in the package.`);
  if (p.length === "long") beware.push(`You said calls run past ${L.maxConversationMinutes.value} minutes. The package document does not recommend that.`);
  if (p.scale === "tens" && c.callsPerMonth !== null && c.avgMinutes !== null) {
    // 50,000 calls a month is far below 500 at once, but say what the figure rests on.
    beware.push("The volume is a planning figure. Peak calls at the same moment matter more than the monthly total, and the limit is 500 at once.");
  }
  beware.push(`Still to be confirmed by the VoicEra team: ${STILL_OPEN.map((x) => x.toLowerCase()).join("; ")}.`);

  const f = cost.fit;
  const known = cost.grand;
  const headline = [
    { label: cost.grandIsComplete ? "Indicative cost" : "Known so far", value: known === null ? "Open" : `₹${known.toLocaleString("en-IN")}`, sub: cost.grandIsComplete ? "Setup, numbers and planned calls" : "Setup, numbers and any planned calls" },
    f.state === "none"
      ? { label: "Budget", value: "Not set", sub: "Add one on the next screens" }
      : f.state === "short"
        ? { label: "Budget", value: "Over", sub: f.note || "The plan costs more than your budget" }
        : f.state === "fits"
          ? { label: "Budget", value: "Within", sub: f.affordableMinutes !== null ? `Covers about ${f.affordableMinutes.toLocaleString("en-IN")} call minutes` : "Fits" }
          : { label: "Budget", value: "Open", sub: f.note },
    { label: "Set up in", value: `${L.setupSlaWorkingDays.value} working days`, sub: "After you hand over what is needed" },
  ];

  return {
    title: `${t.title}${dept ? ` for ${dept}` : ""}`,
    does: DOES[c.template],
    canvas: c,
    cost,
    verdict,
    beware,
    brings: PLATINUM.departmentBrings.filter((b) => (c.modules.includes("ch-out") ? true : b.id !== "phone-numbers")).map((b) => b.label),
    headline,
  };
}

export const QUESTION_TEMPLATES = TEMPLATES.map((t) => ({ id: t.id, label: t.title, hint: t.plain }));
