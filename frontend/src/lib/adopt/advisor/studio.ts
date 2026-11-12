import { isAnswered, setValue, visibleQuestions } from "./answers";
import { directionOf, fileReadiness, inboundOn, integrationReasons, num, selectedLanguages, selectedNeeds, undocumentedLanguages, caseOf } from "./derive";
import { evaluate, type EvalContext } from "./evaluate";
import { getValue, USE_CASES } from "./usecases";
import type { Answers, DimensionId, DimResult, Evaluation, Outcome, Question } from "./types";

/**
 * Logic behind the Studio experience: which question to ask next, how to react to an answer,
 * and the live call-flow blueprint. Pure functions. The package rules stay in evaluate.ts.
 */

/**
 * The order in which to ask. Things that can rule the idea in or out come first, so a
 * department finds out early rather than after twenty questions.
 */
export const ASK_ORDER = [
  "objective",
  "infoTopic",
  "surveyOutbound",
  "direction",
  "eligibilityMode",
  "needs",
  "convDuration",
  "languages",
  "peakConcurrency",
  "scriptStatus",
  "kbNeeded",
  "kbStatus",
  "kbFiles",
  "phoneListStatus",
  "consentStatus",
  "campaignsPerMonth",
  "numberSource",
  "dataSensitivity",
  "testResources",
];

const rank = (id: string) => {
  const i = ASK_ORDER.indexOf(id);
  return i === -1 ? 1000 : i;
};

/** The next question to put to the person, or null when enough is known. */
export function nextQuestion(a: Answers, opts: { deepen?: boolean } = {}): Question | null {
  const pending = visibleQuestions(a).filter((q) => !isAnswered(q, a) && (q.required || opts.deepen));
  if (!pending.length) return null;
  pending.sort((x, y) => Number(y.required) - Number(x.required) || rank(x.id) - rank(y.id));
  return pending[0];
}

/** How many questions are still to come, so the person can see the end. */
export function remaining(a: Answers): number {
  return visibleQuestions(a).filter((q) => q.required && !isAnswered(q, a)).length;
}

const WEIGHT: Record<DimResult, number> = { blocked: 5, review: 4, unresolved: 3, conditional: 2, fit: 1, na: 0 };

const first = (s: string) => {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
};

/**
 * One short reaction to the answer just given, taken from the rule engine's own words.
 * It speaks up when something got worse, and stays quiet otherwise.
 */
export function reactTo(before: Evaluation | null, after: Evaluation | null, q: Question, a: Answers): string {
  if (a.unknown[q.id]) return "Noted as not confirmed. I will not assume it.";
  if (!after) return "";
  const changed = after.dimensions.filter((d) => {
    const b = before?.dimensions.find((x) => x.id === d.id);
    return !b || b.result !== d.result || (d.result !== "fit" && d.result !== "na" && b.consequence !== d.consequence);
  });
  const worst = [...changed].sort((x, y) => WEIGHT[y.result] - WEIGHT[x.result])[0];
  if (worst && worst.result === "blocked") return `That is outside what Platinum documents. ${first(worst.consequence)}`;
  if (worst && worst.result === "review") return `That needs a review. ${first(worst.consequence)}`;
  if (worst && worst.result === "conditional" && q.affects.fit) return first(worst.consequence);
  const fit = changed.find((d) => d.result === "fit" && ["duration", "languages", "knowledge", "usage", "integration"].includes(d.id));
  if (fit && q.affects.fit) return first(fit.consequence);
  return "";
}

/* ---------------- the live blueprint ---------------- */

export type NodeStatus = "ok" | "warn" | "blocked" | "pending" | "off";

export interface FlowNode {
  id: string;
  title: string;
  detail: string;
  status: NodeStatus;
  dimension?: DimensionId;
  /** A connection to a department system. Shown dashed. */
  system?: boolean;
  /** Short plain reason, shown on hover and to screen readers. */
  note?: string;
}

export interface Flow {
  main: FlowNode[];
  branches: FlowNode[];
  base: FlowNode[];
}

function status(ev: Evaluation, id: DimensionId, answered: boolean): NodeStatus {
  if (!answered) return "pending";
  const d = ev.dimensions.find((x) => x.id === id);
  if (!d) return "pending";
  if (d.result === "fit") return "ok";
  if (d.result === "blocked") return "blocked";
  if (d.result === "na") return "off";
  if (d.result === "unresolved") return "pending";
  return "warn";
}

const known = (a: Answers, id: string) => a.values[id] !== undefined || !!a.unknown[id];

export function buildFlow(a: Answers, ev: Evaluation | null, schemeCount = 0, questionCount = 0): Flow {
  const empty: Flow = { main: [], branches: [], base: [] };
  const uc = caseOf(a);
  if (!uc || !ev) return empty;
  const dir = directionOf(a);
  const langs = selectedLanguages(a);
  const dimNote = (id: DimensionId) => ev.dimensions.find((d) => d.id === id)?.consequence;
  const main: FlowNode[] = [];

  main.push({
    id: "start",
    title: dir === "outbound" ? "We call the citizen" : dir === "inbound" ? "Citizen calls" : dir === "both" ? "A call starts" : "A call starts",
    detail: dir ? (inboundOn(a) ? (getValue<string>(a, "numberSource") === "own" ? "Your own number and provider" : "A package phone number") : "From the package's telephony") : "Direction not chosen yet",
    status: status(ev, "direction", !!dir),
    dimension: "direction",
    note: dimNote("direction"),
  });
  main.push({
    id: "language",
    title: "Language",
    detail: langs.length ? `${langs.slice(0, 4).join(", ")}${langs.length > 4 ? ` +${langs.length - 4}` : ""}${langs.length > 1 ? ". Switches mid-call" : ""}` : "Not chosen yet",
    status: status(ev, "languages", langs.length > 0),
    dimension: "languages",
    note: dimNote("languages"),
  });
  main.push({
    id: "intro",
    title: "Introduction and notice",
    detail: "Custom intro, plus who is speaking",
    status: known(a, "scriptStatus") ? (getValue<string>(a, "scriptStatus") === "ready" ? "ok" : "warn") : "pending",
    dimension: "readiness",
    note: getValue<string>(a, "scriptStatus") === "ready" ? "Your script is ready." : "The script still needs to be finished and approved.",
  });

  if (uc === "scheme-discovery") {
    main.push({ id: "need", title: "Understand the need", detail: "The citizen says it in their own words", status: "ok" });
    main.push({
      id: "ask",
      title: "Narrow it down",
      detail: questionCount ? `${questionCount} qualifying question${questionCount === 1 ? "" : "s"}` : "A few qualifying questions",
      status: known(a, "eligibilityMode") ? (getValue<string>(a, "eligibilityMode") === "live-check" || getValue<string>(a, "eligibilityMode") === "application" ? "blocked" : "ok") : "pending",
      dimension: "integration",
      note: "Eligibility is explained from rules written in the knowledge base.",
    });
    const kb = fileReadiness(a);
    main.push({
      id: "match",
      title: "Match schemes",
      detail: schemeCount ? `${schemeCount} scheme${schemeCount === 1 ? "" : "s"} in the knowledge base` : kb.count != null ? `${kb.count} knowledge file${kb.count === 1 ? "" : "s"}` : "From your knowledge base",
      status: known(a, "kbStatus") ? status(ev, "knowledge", true) : "pending",
      dimension: "knowledge",
      note: dimNote("knowledge"),
    });
    main.push({ id: "apply", title: "Explain how to apply", detail: "Documents and where to go", status: "ok" });
  } else if (uc === "survey-feedback") {
    main.push({
      id: "ask",
      title: "Ask the questions",
      detail: num(a, "surveyQuestionCount") ? `${num(a, "surveyQuestionCount")} questions, one at a time` : "One at a time",
      status: status(ev, "duration", known(a, "convDuration")),
      dimension: "duration",
      note: dimNote("duration"),
    });
    main.push({ id: "capture", title: "Capture the answers", detail: "A structured dataset you can download", status: "ok", dimension: "use-case" });
  } else {
    main.push({ id: "convo", title: "The conversation", detail: USE_CASES[uc].label, status: status(ev, "use-case", true), dimension: "use-case", note: dimNote("use-case") });
  }

  const reasons = integrationReasons(a);
  if (reasons.length) {
    main.push({
      id: "system",
      title: "Department system",
      detail: "Look up or write a record",
      status: "blocked",
      system: true,
      dimension: "integration",
      note: "Platinum does not include custom integration with departmental systems. This needs a separate feasibility assessment.",
    });
  }
  main.push({
    id: "close",
    title: "Close and follow up",
    detail: dir === "inbound" ? "Dashboard of calls" : "Analysis shared within 3 working days",
    status: "ok",
  });

  const fb = getValue<string>(a, "fallback");
  const branches: FlowNode[] = [
    { id: "unsure", title: "The agent does not know", detail: "Says so, and does not guess", status: "ok" },
    {
      id: "person",
      title: "Asks for a person",
      detail: fb === "live-transfer" ? "Live transfer: not listed in the package" : fb === "callback" ? "Staff call back" : fb === "redirect" ? "Points to an office" : fb === "decline" ? "Politely declines" : "Decide what happens",
      status: fb === "live-transfer" ? "warn" : fb ? "ok" : "pending",
      note: fb === "live-transfer" ? "Passing a call to a person is not listed in the package, so it is unverified." : undefined,
    },
    {
      id: "length",
      title: "Stay within 3 minutes",
      detail: getValue<string>(a, "convDuration") === "long" ? "Your calls run longer" : "The documented guidance",
      status: status(ev, "duration", known(a, "convDuration")),
      dimension: "duration",
      note: dimNote("duration"),
    },
  ];

  const base: FlowNode[] = [
    {
      id: "capacity",
      title: "Capacity",
      detail: getValue<string>(a, "peakConcurrency") === "gt500" ? "Above 500 calls at once" : "Up to 500 calls at once",
      status: status(ev, "usage", known(a, "peakConcurrency")),
      dimension: "usage",
      note: dimNote("usage"),
    },
    {
      id: "hosting",
      title: "Hosting",
      detail: "Hosted and billed on Bhashini",
      status: status(ev, "hosting", true),
      dimension: "hosting",
      note: dimNote("hosting"),
    },
    {
      id: "data",
      title: "Data",
      detail: ev.pendingGovernance ? "Needs confirmation first" : "Storage, training and retention are open",
      status: ev.pendingGovernance ? "warn" : known(a, "dataSensitivity") ? status(ev, "data-security", true) : "pending",
      dimension: "data-security",
      note: dimNote("data-security"),
    },
  ];
  return { main, branches, base };
}

/* ---------------- what would make it fit ---------------- */

export interface WhatIf {
  id: string;
  label: string;
  detail: string;
  apply: (a: Answers) => Answers;
  outcome: Outcome;
  /** Findings that would remain after the change. */
  remaining: number;
}

const OUTCOME_RANK: Record<Outcome, number> = { "outside-scope": 0, "needs-review": 1, "suitable-with-conditions": 2, suitable: 3 };

/**
 * Changes the person could make that would move the result, each re-checked by the rule engine.
 * Only changes that actually improve the outcome, or clear a finding, are offered.
 */
export function whatIfs(a: Answers, ctx: EvalContext = {}): WhatIf[] {
  const now = evaluate(a, ctx);
  if (!now) return [];
  const out: WhatIf[] = [];
  const needs = selectedNeeds(a);
  const integrationNeeds = needs.filter((n) => ["existing-system", "database", "case-records", "api-webhook"].includes(n));
  const bad = undocumentedLanguages(a);

  const add = (id: string, label: string, detail: string, apply: (x: Answers) => Answers) => {
    const next = apply(a);
    const ev = evaluate(next, ctx);
    if (!ev) return;
    const better = OUTCOME_RANK[ev.outcome] > OUTCOME_RANK[now.outcome] || ev.findings.length < now.findings.length;
    if (better) out.push({ id, label, detail, apply, outcome: ev.outcome, remaining: ev.findings.length });
  };

  const mode = getValue<string>(a, "eligibilityMode");
  const wantsLookup = mode === "live-check" || mode === "application";
  if (wantsLookup || integrationNeeds.length) {
    add(
      "no-system",
      wantsLookup ? "Explain eligibility from written rules, with no system connection" : "Run it on its own, without connecting a system",
      wantsLookup
        ? "The agent explains who may qualify from rules in the knowledge base. It does not check anyone's record or take an application. Connecting a system would be a separate assessment."
        : "The agent works from your script and knowledge base only. Connecting a system would be a separate assessment.",
      (x) => {
        let next = x;
        if (wantsLookup) next = setValue(next, "eligibilityMode", "rules");
        if (integrationNeeds.length) {
          const kept = needs.filter((n) => !integrationNeeds.includes(n));
          next = setValue(next, "needs", kept.length ? kept : ["standalone"]);
        }
        return next;
      },
    );
  }
  if (needs.includes("whatsapp")) add("no-whatsapp", "Use a phone line or browser instead of WhatsApp", "WhatsApp calling is out of scope for this package.", (x) => setValue(x, "needs", needs.filter((n) => n !== "whatsapp").concat(needs.length === 1 ? ["standalone"] : [])));
  if (needs.includes("multimodal") || needs.includes("partial-stack")) add("voice-only", "Keep it to voice, using the full package", "Multi-modality and partial-stack use are not recommended.", (x) => setValue(x, "needs", needs.filter((n) => n !== "multimodal" && n !== "partial-stack").concat(needs.every((n) => n === "multimodal" || n === "partial-stack") ? ["standalone"] : [])));
  if (getValue<string>(a, "convDuration") === "long") add("short-calls", "Keep each call under 3 minutes", "Cut the script to what fits. Long journeys can be split across a follow-up call.", (x) => setValue(x, "convDuration", "short"));
  if (getValue<string>(a, "peakConcurrency") === "gt500") add("cap-500", "Cap the busiest moment at 500 calls", "Spread a campaign over a longer window so it never goes above the documented 500 concurrent calls.", (x) => setValue(x, "peakConcurrency", "100-500"));
  if (bad.length) add("documented-languages", "Start with the documented languages only", `Launch without ${bad.join(", ")} first, and have the team verify ${bad.length === 1 ? "it" : "them"} separately.`, (x) => setValue(x, "languages", selectedLanguages(a).filter((l) => !bad.includes(l))));
  if (caseOf(a) === "survey-feedback" && directionOf(a) === "inbound") add("call-out", "Call citizens instead of having them call", "Surveys and feedback are documented as outbound.", (x) => setValue(x, "surveyOutbound", "confirm"));
  const campaigns = num(a, "campaignsPerMonth");
  if (campaigns !== null && campaigns > 10) add("ten-campaigns", "Run no more than 10 campaigns a month", "Campaign setup and monitoring support is documented as up to 10 a month. Combine smaller campaigns.", (x) => setValue(x, "campaignsPerMonth", 10));
  if (out.length >= 2) {
    const parts = [...out];
    const apply = (x: Answers) => parts.reduce((acc, w) => w.apply(acc), x);
    const ev = evaluate(apply(a), ctx);
    if (ev) {
      out.unshift({
        id: "all",
        label: "Make all of these changes",
        detail: parts.map((w) => w.label).join(". ") + ".",
        apply,
        outcome: ev.outcome,
        remaining: ev.findings.length,
      });
    }
  }
  return out;
}
