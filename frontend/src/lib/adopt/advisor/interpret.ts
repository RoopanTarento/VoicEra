import { OTHER_LANGUAGES, DOCUMENTED_LANGUAGES, isDocumentedLanguage } from "./source";
import { OBJECTIVE_BY_ID, USE_CASES, emptyAnswers } from "./usecases";
import { setValue } from "./answers";
import type { Answers, Direction, UseCaseId } from "./types";

/**
 * Reads a plain-English description and proposes an interpretation.
 *
 * This is a rule-based reading: keywords and patterns, no AI service. It only proposes.
 * The person sees what was understood, corrects it, and only then does it become answers.
 */

export interface Interpretation {
  text: string;
  objectiveId: string | null;
  useCase: UseCaseId | null;
  direction: Direction | null;
  languages: string[];
  undocumentedLanguages: string[];
  needs: string[];
  eligibilityMode: "live-check" | null;
  duration: "short" | "long" | null;
  contactCount: number | null;
  sector: string | null;
  infoTopic: "schemes" | "other" | null;
  /** Short plain-English lines saying what we understood and from what. */
  understood: { label: string; value: string; because: string }[];
  /** What we still need to ask. */
  missing: string[];
}

const LANG_PATTERNS: [string, RegExp][] = [
  ...DOCUMENTED_LANGUAGES.map((l): [string, RegExp] => [l, new RegExp(`\\b${l}\\b`, "i")]),
  ...OTHER_LANGUAGES.map((l): [string, RegExp] => [l, new RegExp(`\\b${l}\\b`, "i")]),
  ["Bengali", /\bbangla\b/i],
  ["Odia", /\boriya\b/i],
];

const SECTOR_RULES: [string, RegExp][] = [
  ["agriculture", /\b(farm|farmer|agri|crop|kisan|rural)\w*/i],
  ["welfare", /\b(pension|welfare|beneficiar|ration|subsid)\w*/i],
  ["health-edu", /\b(health|hospital|clinic|school|education|student|vaccin)\w*/i],
  ["highways", /\b(highway|toll|road transport|nhai)\w*/i],
  ["utilities", /\b(electric|power supply|water supply|utility|utilities|discom)\w*/i],
  ["civic", /\b(municipal|ward|city|urban local|garbage|streetlight)\w*/i],
  ["census", /\bcensus\b/i],
  ["revenue", /\b(revenue|land record|district admin|tehsil|collector)\w*/i],
  ["safety", /\b(police|safety|regulat|licen[cs]e)\w*/i],
];

function parseCount(text: string): number | null {
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?)?\s*(?:\+\s*)?(?:citizens|people|beneficiaries|farmers|households|respondents|residents|persons)/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1000;
  else if (unit.startsWith("lakh") || unit.startsWith("lac")) n *= 100000;
  else if (unit.startsWith("crore")) n *= 10000000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function interpret(textIn: string): Interpretation {
  const text = textIn.trim();
  const t = text.toLowerCase();
  const understood: Interpretation["understood"] = [];

  const survey = /\b(feedback|survey|satisfaction|opinion|poll|rate (their|the) experience|how was)\b/.test(t);
  const scheme = /\b(scheme|yojana|benefit|eligib|subsid|pension|entitlement|welfare)\w*/.test(t);
  const complaint = /\b(complain|grievance|pothole|report (an )?issue|raise (an )?issue)\w*/.test(t);
  const form = /\b(fill (in |out )?(a |the )?form|application form|registration|register (for|them)|submit (an )?application)\w*/.test(t);
  const infoOut = /\b(information campaign|awareness|inform citizens|notify|remind|announce)\w*/.test(t);
  const infoIn = /\b(helpline|information (line|service)|answer questions|faq)\b/.test(t);

  let objectiveId: string | null = null;
  let because = "";
  if (survey && !scheme) {
    const afterService = /\bafter (they|people|citizens|a|the|their)\b.*\b(visit|visited|use|used|service|office|interaction)/.test(t) || /\bafter (visit|using|the service)/.test(t);
    objectiveId = afterService || /\bfeedback\b/.test(t) ? "feedback-service" : "citizen-survey";
    because = afterService ? "You mentioned collecting feedback after a service." : "You mentioned a survey or feedback.";
  } else if (scheme && !complaint) {
    const q = /\b(question|ask|answer|enquir|inquir)\w*/.test(t);
    objectiveId = infoOut && !q ? "outbound-info" : q ? "scheme-questions" : "scheme-discover";
    because = "You mentioned schemes, benefits or eligibility.";
  } else if (complaint) {
    objectiveId = "complaints";
    because = "You mentioned complaints or reporting an issue.";
  } else if (form) {
    objectiveId = "forms";
    because = "You mentioned filling in or submitting a form.";
  } else if (infoOut) {
    objectiveId = "outbound-info";
    because = "You mentioned an information or awareness campaign.";
  } else if (infoIn) {
    objectiveId = "inbound-info";
    because = "You mentioned a helpline or information service.";
  }

  const obj = objectiveId ? OBJECTIVE_BY_ID[objectiveId] : null;
  const infoTopic: Interpretation["infoTopic"] = obj?.needsTopic ? (scheme ? "schemes" : "other") : null;
  let useCase: UseCaseId | null = obj ? obj.useCase : null;
  if (obj?.needsTopic) useCase = infoTopic === "schemes" ? "scheme-discovery" : "info-service";
  if (objectiveId && useCase) understood.push({ label: "What you want", value: obj ? obj.label : "", because });

  // Direction
  const outCue = /\b(call(ing)? (the )?(citizens|people|beneficiar\w*|farmers|them|residents|families)|we (will )?call|outbound|outreach|reach out to|ring)\b|\bafter (they|people|citizens)\b.*\b(visit|visited)/.test(t);
  const inCue = /\b(citizens? (can |will )?call|callers?|inbound|helpline|call (us|the department|a number)|dial)\b/.test(t);
  let direction: Direction | null = null;
  if (outCue && inCue) direction = "both";
  else if (outCue) direction = "outbound";
  else if (inCue) direction = "inbound";
  else if (obj?.defaultDirection) direction = obj.defaultDirection;
  if (direction) {
    const stated = outCue || inCue;
    understood.push({
      label: "Who starts the call",
      value: direction === "both" ? "Both" : direction === "outbound" ? "The department calls citizens" : "Citizens call the department",
      because: stated ? "From how you described the calls." : "The usual direction for this kind of service. Please check.",
    });
  }

  // Languages
  const languages = LANG_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);
  const uniqueLangs = Array.from(new Set(languages));
  const undocumented = uniqueLangs.filter((l) => !isDocumentedLanguage(l));
  if (uniqueLangs.length) understood.push({ label: "Languages", value: uniqueLangs.join(", "), because: "Named in your description." });

  // Integration hints
  const needs: string[] = [];
  if (/\b(database|data ?base)\b/.test(t)) needs.push("database");
  if (/\b(crm|portal|existing system|our system|department system|backend)\b/.test(t)) needs.push("existing-system");
  if (/\b(api|webhook)\b/.test(t)) needs.push("api-webhook");
  if (/\b(case (records|management)|update (the )?records?|update their record)\b/.test(t)) needs.push("case-records");
  if (/\bwhatsapp\b/.test(t)) needs.push("whatsapp");
  if (/\b(image|photo|video)\w*/.test(t)) needs.push("multimodal");
  const eligibilityMode: Interpretation["eligibilityMode"] =
    useCase === "scheme-discovery" && /\b(live|real[- ]time|against (our |the )?(records|database)|check (their )?(eligibility|status) (in|against|from))\b/.test(t) ? "live-check" : null;
  if (eligibilityMode && !needs.includes("database")) needs.push("database");
  if (needs.length) understood.push({ label: "Connections", value: needs.join(", ").replace(/-/g, " "), because: "You mentioned systems, data or channels the package may not cover." });

  // Duration
  let duration: Interpretation["duration"] = null;
  const mins = t.match(/(\d+)\s*(?:-|to)?\s*(\d+)?\s*(?:min|minute)/);
  if (mins) {
    const hi = Number(mins[2] ?? mins[1]);
    duration = hi > 3 ? "long" : "short";
    understood.push({ label: "Call length", value: `${mins[2] ? `${mins[1]} to ${mins[2]}` : mins[1]} minutes`, because: "A length you stated." });
  } else if (/\b(long|lengthy|detailed|in[- ]depth)\b.*\b(conversation|call)\b|\b(conversation|call)s?\b.*\b(long|lengthy|detailed)\b/.test(t)) {
    duration = "long";
    understood.push({ label: "Call length", value: "Long", because: "You described long calls." });
  } else if (/\b(short|quick|brief|few questions)\b/.test(t)) {
    duration = "short";
    understood.push({ label: "Call length", value: "Short", because: "You described short calls." });
  }

  const contactCount = parseCount(text);
  if (contactCount) understood.push({ label: "People to reach", value: contactCount.toLocaleString("en-IN"), because: "A number you gave." });

  const sectorHit = SECTOR_RULES.find(([, re]) => re.test(text));
  const sector = sectorHit ? sectorHit[0] : null;

  const missing: string[] = [];
  if (!objectiveId) missing.push("What you want the service to do");
  if (!direction) missing.push("Whether you call citizens or they call you");
  if (!uniqueLangs.length) missing.push("Which languages citizens speak");
  if (!duration) missing.push("How long a typical conversation will be");
  missing.push("Whether your script and knowledge material are ready");
  if (!needs.length) missing.push("Whether it has to connect to any of your systems");

  return {
    text,
    objectiveId,
    useCase,
    direction,
    languages: uniqueLangs,
    undocumentedLanguages: undocumented,
    needs,
    eligibilityMode,
    duration,
    contactCount,
    sector,
    infoTopic,
    understood,
    missing,
  };
}

/** Turns an agreed interpretation into answers, marked as coming from the description so they can be checked. */
export function applyInterpretation(base: Answers | null, i: Interpretation): Answers {
  let a = base ?? emptyAnswers();
  const put = (id: string, v: unknown) => {
    a = setValue(a, id, v, "interpreted");
  };
  if (i.objectiveId) put("objective", i.objectiveId);
  if (i.infoTopic) put("infoTopic", i.infoTopic);
  if (i.sector) put("sector", i.sector);
  // Direction is asked for every use case except surveys, where outbound is the documented default.
  if (i.direction && i.useCase !== "survey-feedback") put("direction", i.direction);
  if (i.useCase === "survey-feedback" && i.direction === "outbound") put("surveyOutbound", "confirm");
  if (i.useCase === "survey-feedback" && i.direction && i.direction !== "outbound") {
    put("surveyOutbound", "not-correct");
    put("direction", i.direction);
  }
  if (i.languages.length) put("languages", i.languages);
  if (i.needs.length) put("needs", i.needs);
  if (i.eligibilityMode) put("eligibilityMode", i.eligibilityMode);
  if (i.duration) put("convDuration", i.duration === "long" ? "long" : "short");
  if (i.contactCount && (i.direction === "outbound" || i.direction === "both" || i.useCase === "survey-feedback")) put("contactCount", i.contactCount);
  return a;
}

export function useCaseLabel(id: UseCaseId | null): string {
  return id ? USE_CASES[id].label : "Not identified yet";
}
