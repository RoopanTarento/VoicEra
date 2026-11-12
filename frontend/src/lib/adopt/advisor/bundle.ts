import { describeAnswer } from "./answers";
import {
  directionOf,
  fileReadiness,
  kbIsNeeded,
  needsIntegration,
  outboundOn,
  selectedLanguages,
  text,
  undocumentedLanguages,
  caseOf,
} from "./derive";
import { OUTCOME_EXPLANATION, OUTCOME_LABEL } from "./evaluate";
import { QUESTION_BY_ID } from "./questions";
import { CONFIRMATION_LINE, INTEGRATION_GAP_LINE, PLATINUM, type SourceId } from "./source";
import { USE_CASES, getValue } from "./usecases";
import type { Answers, DimensionOutcome, Evaluation } from "./types";

/* ---------------- Department checklist ---------------- */

export type CheckStatus = "ready" | "missing" | "review" | "na";

export interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Does the package document list this as something the department brings? */
  documentedAsBrought: boolean;
  source: SourceId;
}

export function buildChecklist(a: Answers, ev: Evaluation): CheckItem[] {
  const items: CheckItem[] = [];
  const out = outboundOn(a);
  const uc = caseOf(a);

  items.push({
    id: "use-case",
    label: "Use case and what success looks like",
    status: ev.outcome === "outside-scope" ? "review" : "ready",
    detail: ev.outcome === "outside-scope" ? "The use case or a requirement is outside the documented package. See the limitations." : `${uc ? USE_CASES[uc].label : "Chosen"}.`,
    documentedAsBrought: true,
    source: "PKG-BRING",
  });

  const script = getValue<string>(a, "scriptStatus");
  items.push({
    id: "script",
    label: "Conversation script flow",
    status: a.unknown.scriptStatus || !script ? "review" : script === "ready" ? "ready" : "missing",
    detail: a.unknown.scriptStatus || !script ? "Not confirmed." : script === "ready" ? "Ready." : script === "draft" ? "A draft exists. It needs finishing and approval." : "Not started.",
    documentedAsBrought: true,
    source: "PKG-BRING",
  });

  if (!kbIsNeeded(a)) {
    items.push({ id: "kb", label: "Knowledge base", status: "na", detail: "Not needed for this service.", documentedAsBrought: true, source: "PKG-KB" });
  } else {
    const kb = ev.dimensions.find((d) => d.id === "knowledge") as DimensionOutcome;
    const f = fileReadiness(a);
    const st = getValue<string>(a, "kbStatus");
    let status: CheckStatus = "review";
    if (kb.result === "fit") status = "ready";
    else if (st === "none" || st === "unapproved") status = "missing";
    items.push({
      id: "kb",
      label: "Knowledge base (up to 10 text files, up to 5 MB each)",
      status,
      detail: kb.consequence + (f.count != null ? ` You said ${f.count} file${f.count === 1 ? "" : "s"}.` : ""),
      documentedAsBrought: true,
      source: "PKG-KB",
    });
  }

  if (out) {
    const pl = getValue<string>(a, "phoneListStatus");
    items.push({
      id: "phones",
      label: "Citizens' phone numbers for the outbound campaign",
      status: a.unknown.phoneListStatus || !pl ? "review" : pl === "ready" ? "ready" : pl === "api" ? "review" : "missing",
      detail:
        pl === "ready"
          ? "Ready to share securely."
          : pl === "api"
            ? "You want the service to read the file through an API. That is an open question in the package document."
            : pl === "not-ready"
              ? "Exists, but is not ready to share."
              : pl === "to-collect"
                ? "Still to be collected."
                : "Not confirmed.",
      documentedAsBrought: true,
      source: "PKG-BRING",
    });
    const consent = getValue<string>(a, "consentStatus");
    items.push({
      id: "permission",
      label: "Permission to call these citizens",
      status: consent === "confirmed" ? "ready" : a.unknown.consentStatus || !consent ? "review" : "missing",
      detail: "Your department confirms this. We cannot confirm permissions or compliance for you.",
      documentedAsBrought: false,
      source: "ASSUMPTION",
    });
    items.push({
      id: "campaign-approver",
      label: "Who approves a campaign before it goes live",
      status: text(a, "prodApprover") ? "ready" : "missing",
      detail: text(a, "prodApprover") || "Name an approver.",
      documentedAsBrought: false,
      source: "ASSUMPTION",
    });
  }

  const tr = getValue<string>(a, "testResources");
  items.push({
    id: "test",
    label: "People to test calls after setup, before launch",
    status: a.unknown.testResources || !tr ? "review" : tr === "ready" ? "ready" : "missing",
    detail: tr === "ready" ? "People are available." : tr === "arrange" ? "Can be arranged. Not yet in place." : tr === "no" ? "Nobody available yet." : "Not confirmed.",
    documentedAsBrought: true,
    source: "PKG-BRING",
  });

  const langs = selectedLanguages(a);
  const bad = undocumentedLanguages(a);
  items.push({
    id: "languages",
    label: "Language wording approved",
    status: bad.length ? "review" : langs.length ? "review" : "missing",
    detail: bad.length
      ? `${bad.join(", ")} needs verifying first. Your department approves wording in every language.`
      : "Your department approves the script and knowledge wording in each language. We cannot tell whether that is done.",
    documentedAsBrought: false,
    source: "PKG-LANG",
  });

  const ns = getValue<string>(a, "numberSource");
  items.push({
    id: "telephony",
    label: "Telephony details",
    status: ns === "own" ? "review" : "ready",
    detail:
      ns === "own"
        ? "Name your provider and numbers. This is documented as 2 to 4 weeks, case by case."
        : "A new number comes with the package at Rs. 500 each. Say how many you want in the cost estimate.",
    documentedAsBrought: false,
    source: "PKG-TELEPHONY",
  });

  const gov = ev.dimensions.find((d) => d.id === "data-security") as DimensionOutcome;
  items.push({
    id: "governance",
    label: "Security and data-governance confirmation",
    status: gov.result === "fit" ? "ready" : "review",
    detail: gov.result === "fit" ? "No mandatory data requirement is outstanding." : gov.consequence,
    documentedAsBrought: false,
    source: "PKG-FAQ",
  });

  const apprs = getValue<string[]>(a, "approvalsNeeded") ?? [];
  items.push({
    id: "approvals",
    label: "Internal approvals before launch",
    status: apprs.length && !apprs.includes("none") ? "review" : apprs.includes("none") ? "ready" : "review",
    detail: apprs.length && !apprs.includes("none") ? `Needed: ${apprs.join(", ")}. Your department arranges these.` : apprs.includes("none") ? "None needed." : "Confirm which approvals you need.",
    documentedAsBrought: false,
    source: "ASSUMPTION",
  });

  if (needsIntegration(a)) {
    const have = ["integSystem", "integData", "integRW", "integSecurity", "integOwner"].filter((id) => getValue(a, id) !== undefined && getValue(a, id) !== "").length;
    items.push({
      id: "integration",
      label: "Integration requirements, for a separate assessment",
      status: "review",
      detail: `${INTEGRATION_GAP_LINE} ${have}/5 technical details captured.`,
      documentedAsBrought: false,
      source: "PKG-OOS",
    });
  } else {
    items.push({ id: "integration", label: "Integration requirements", status: "na", detail: "None.", documentedAsBrought: false, source: "PKG-OOS" });
  }

  items.push({
    id: "owner",
    label: "Service owner in the department",
    status: text(a, "serviceOwner") ? "ready" : "missing",
    detail: text(a, "serviceOwner") || "Name an owner.",
    documentedAsBrought: false,
    source: "ASSUMPTION",
  });

  return items;
}

/* ---------------- Implementation plan ---------------- */

export interface PlanStage {
  n: number;
  title: string;
  owner: "Department" | "VoicEra package support" | "Both";
  status: "ready" | "pending" | "blocked" | "review";
  detail: string;
  /** An input the 2-working-day setup SLA waits for. */
  slaPrerequisite: boolean;
  sources: SourceId[];
}

export function buildPlan(a: Answers, ev: Evaluation, checklist: CheckItem[]): PlanStage[] {
  const get = (id: string) => checklist.find((c) => c.id === id);
  const st = (id: string): CheckItem["status"] => get(id)?.status ?? "na";
  const out = outboundOn(a);
  const outside = ev.outcome === "outside-scope";
  const stage = (s: PlanStage) => s;
  const mapStatus = (x: CheckItem["status"]): PlanStage["status"] => (x === "ready" || x === "na" ? "ready" : x === "missing" ? "pending" : "review");

  const scope = stage({
    n: 1,
    title: "Confirm the service objective and scope",
    owner: "Department",
    status: outside ? "blocked" : ev.outcome === "needs-review" ? "review" : "ready",
    detail: outside
      ? "A requirement is outside the documented package. Revise it or request a separate assessment before going on."
      : ev.outcome === "needs-review"
        ? "Some requirements need a technical or governance review first."
        : "The use case is within the documented package.",
    slaPrerequisite: true,
    sources: ["PKG-BRING"],
  });
  const script = stage({
    n: 2,
    title: "Collect and approve the conversation script",
    owner: "Department",
    status: mapStatus(st("script")),
    detail: get("script")?.detail ?? "",
    slaPrerequisite: true,
    sources: ["PKG-BRING"],
  });
  const prepItems = [get("kb"), out ? get("phones") : null, get("telephony")].filter(Boolean) as CheckItem[];
  const prepStatus: PlanStage["status"] = prepItems.some((i) => i.status === "missing") ? "pending" : prepItems.some((i) => i.status === "review") ? "review" : "ready";
  const prep = stage({
    n: 3,
    title: "Prepare knowledge material and telephony requirements",
    owner: "Department",
    status: prepStatus,
    detail: prepItems.map((i) => `${i.label}: ${i.detail}`).join(" "),
    slaPrerequisite: true,
    sources: ["PKG-KB", "PKG-BRING", "PKG-TELEPHONY"],
  });
  const govStatus: PlanStage["status"] = ev.pendingGovernance ? "review" : mapStatus(st("governance"));
  const gov = stage({
    n: 4,
    title: "Confirm security, privacy and procurement dependencies",
    owner: "Department",
    status: govStatus === "ready" && st("approvals") === "review" ? "review" : govStatus,
    detail: ev.pendingGovernance
      ? `Pending security and data-governance confirmation. ${CONFIRMATION_LINE}`
      : "Arrange the approvals you listed. The package document does not set approvals, so your department decides when they are needed. They are not listed as a prerequisite for the setup SLA, but may gate you internally.",
    slaPrerequisite: false,
    sources: ["PKG-FAQ", "PKG-BILLING"],
  });
  const inputsReady = [scope, script, prep].every((s) => s.status === "ready");
  const config = stage({
    n: 5,
    title: "Configure the voice agent",
    owner: "VoicEra package support",
    status: outside ? "blocked" : inputsReady ? "ready" : "pending",
    detail: `The documented setup SLA is ${PLATINUM.limits.setupSlaWorkingDays.value} working days, and it starts only after all requirements are provided. It covers voice-agent setup, not the whole project.`,
    slaPrerequisite: false,
    sources: ["PKG-SLA"],
  });
  const test = stage({
    n: 6,
    title: "Conduct department test calls",
    owner: "Department",
    status: mapStatus(st("test")),
    detail: "After the agent is set up, your people test it before any launch. This is where real call length and language quality become visible.",
    slaPrerequisite: false,
    sources: ["PKG-BRING"],
  });
  const approve = stage({
    n: 7,
    title: out ? "Review and approve the campaign" : "Review and approve going live",
    owner: "Department",
    status: out ? mapStatus(st("campaign-approver") === "ready" && st("permission") === "ready" ? "ready" : "missing") : "pending",
    detail: out ? "Named approver signs off the campaign and your department confirms permission to call." : "A named person signs off before citizens are given the number.",
    slaPrerequisite: false,
    sources: ["ASSUMPTION"],
  });
  const launch = stage({
    n: 8,
    title: "Launch, where supported and approved",
    owner: "Both",
    status: outside ? "blocked" : "pending",
    detail: outside ? "Not possible within the documented package as requested." : "Only after test calls and approvals. Up to 10 campaign setups and monitoring activities a month are supported.",
    slaPrerequisite: false,
    sources: ["PKG-SUPPORT"],
  });
  const monitor = stage({
    n: 9,
    title: "Monitor performance and review the results",
    owner: "Both",
    status: "pending",
    detail: `The dashboard shows campaigns and calls attempted, connected, dropped and completed, with average call length. Post-campaign analysis is shared within ${PLATINUM.limits.postCampaignAnalysisWorkingDays.value} working days, and issues are troubleshot within ${PLATINUM.limits.troubleshootingHours.value} hours.`,
    slaPrerequisite: false,
    sources: ["PKG-DASH", "PKG-SLA"],
  });
  return [scope, script, prep, gov, config, test, approve, launch, monitor];
}

/* ---------------- Success measures ---------------- */

export interface Measure {
  label: string;
  documented: boolean;
  note: string;
}

export function buildMeasures(a: Answers): Measure[] {
  const documented: Measure[] = [
    { label: "Number of campaigns", documented: true, note: "Dashboard, with a date selector." },
    { label: "Calls attempted", documented: true, note: "Overall and per campaign." },
    { label: "Calls connected", documented: true, note: "Overall and per campaign." },
    { label: "Calls dropped", documented: true, note: "Overall and per campaign." },
    { label: "Calls completed", documented: true, note: "Overall and per campaign." },
    { label: "Average call length", documented: true, note: "Dashboard." },
  ];
  if (caseOf(a) === "survey-feedback") documented.push({ label: "Collected answers as a table (columns and rows)", documented: true, note: "Downloadable. Documented for surveys and feedback." });
  const extra = (getValue<string[]>(a, "reportsNeeded") ?? []).filter((x) => x === "other");
  const proposed: Measure[] = extra.length
    ? [{ label: "Other measures you asked for", documented: false, note: "Proposed. Not listed in the package, so confirm before relying on them." }]
    : [];
  if (!outboundOn(a)) {
    return [
      { label: "Inbound call reporting", documented: false, note: "The documented dashboard describes campaigns. Inbound reporting is not described, so confirm what you would see." },
      ...proposed,
    ];
  }
  return [...documented, ...proposed];
}

/* ---------------- Explanation ---------------- */

export interface Explanation {
  headline: string;
  status: string;
  summary: string;
  whyItFits: string[];
  answersThatMattered: { question: string; answer: string }[];
  requirementsSatisfied: string[];
  assumptions: string[];
  missing: string[];
  blockers: string[];
  departmentProvides: string[];
  packageProvides: string[];
  needsConfirmation: string[];
  nextSteps: string[];
}

export function buildExplanation(a: Answers, ev: Evaluation, checklist: CheckItem[]): Explanation {
  const uc = USE_CASES[ev.useCase];
  const dims = ev.dimensions;
  const by = (id: string) => dims.find((d) => d.id === id) as DimensionOutcome;
  const fit = dims.filter((d) => d.result === "fit");
  const blockers = ev.findings.filter((f) => f.severity === "blocker").map((f) => `${f.title}: ${f.detail}`);
  const reviews = ev.findings.filter((f) => f.severity === "review").map((f) => `${f.title}: ${f.detail}`);
  const conds = ev.findings.filter((f) => f.severity === "condition").map((f) => `${f.title}: ${f.detail}`);

  const matter: { question: string; answer: string }[] = [];
  for (const id of ["objective", "infoTopic", "direction", "surveyOutbound", "eligibilityMode", "convDuration", "languages", "needs", "peakConcurrency", "scriptStatus", "kbStatus", "phoneListStatus", "dataSensitivity"]) {
    const q = QUESTION_BY_ID[id];
    if (!q) continue;
    if (a.values[id] === undefined && !a.unknown[id]) continue;
    matter.push({ question: q.label, answer: describeAnswer(q, a) });
  }

  const assumptions: string[] = [];
  if (uc.id === "survey-feedback" && getValue<string>(a, "surveyOutbound") !== "not-correct") assumptions.push("We assumed your department calls citizens, which is how the package documents surveys and feedback.");
  for (const [id, v] of Object.entries(a.origin)) if (v === "interpreted") {
    const q = QUESTION_BY_ID[id];
    if (q) assumptions.push(`"${q.label}" was pre-filled for you, from your written description or your proof of concept. Please check it.`);
  }
  for (const [id, on] of Object.entries(a.unknown)) if (on) {
    const q = QUESTION_BY_ID[id];
    if (q) assumptions.push(`You were not sure about "${q.label}". ${q.onUnknown ?? "We treated it as unconfirmed, not as a yes."}`);
  }
  assumptions.push("Latency, uptime and capacity figures in the package are stated targets and limits. They are not guarantees for every case.");

  const missing = checklist.filter((c) => c.status === "missing" || c.status === "review").map((c) => `${c.label}: ${c.detail}`);

  const needsConfirmation: string[] = [];
  if (ev.pendingGovernance) needsConfirmation.push(`Data storage location, model training and retention. ${CONFIRMATION_LINE}`);
  if (by("languages").result === "review") needsConfirmation.push(by("languages").consequence);
  if (by("telephony").result === "conditional" || by("telephony").result === "review") needsConfirmation.push(by("telephony").consequence);
  needsConfirmation.push("Which voice and LLM models are actually available. The document lists samples only.");
  needsConfirmation.push("Per-minute pricing for any proprietary model.");

  const dir = directionOf(a);
  const next: string[] = [];
  if (ev.outcome === "outside-scope") {
    next.push("Revise the requirement that is outside the package, or ask for a separate technical assessment.");
    next.push("Do not plan a launch date until that is settled.");
  } else {
    if (ev.outcome === "needs-review") next.push("Ask the VoicEra/Bhashini team to review the flagged items in writing.");
    if (ev.setupBlockers.length) next.push(`Provide the missing inputs: ${ev.setupBlockers.join(" ")}`);
    next.push("Download the requirements checklist and work through it with your team.");
    next.push("Request an implementation discussion once the review items are answered.");
  }

  const fits: string[] = [];
  if (uc.documented) fits.push(`${uc.label} is one of the two use cases the package document is suited for.`);
  else fits.push(`${uc.label} is not one of the two documented use cases, so this is a check, not a match.`);
  if (dir) fits.push(`You described ${dir === "both" ? "inbound and outbound" : dir} calling. ${by("direction").consequence}`);
  fits.push(by("languages").consequence);
  fits.push(by("duration").consequence);

  return {
    headline: ev.outcome === "outside-scope" ? "Not a fit for the documented package as described" : `${PLATINUM.name} for ${uc.label.toLowerCase()}`,
    status: OUTCOME_LABEL[ev.outcome],
    summary: OUTCOME_EXPLANATION[ev.outcome],
    whyItFits: fits,
    answersThatMattered: matter,
    requirementsSatisfied: fit.map((d) => `${d.label}: ${d.consequence}`),
    assumptions,
    missing,
    blockers: [...blockers, ...reviews, ...conds],
    departmentProvides: PLATINUM.departmentBrings.map((x) => x.label),
    packageProvides: PLATINUM.included.flatMap((g) => g.items.map((i) => i.label)).slice(0, 12),
    needsConfirmation,
    nextSteps: next,
  };
}

/* ---------------- FAQ ---------------- */

export interface FaqItem {
  q: string;
  /** Null when the package document gives no answer. */
  a: string | null;
  src: SourceId;
}

export const FAQ: FaqItem[] = [
  { q: "Is my call data secure, and where is it stored?", a: null, src: "PKG-FAQ" },
  { q: "Is call data used to train models?", a: null, src: "PKG-FAQ" },
  { q: "How long is call data retained?", a: null, src: "PKG-FAQ" },
  { q: "Can the service read a caller-number file from an API instead of receiving a supplied phone-number list?", a: null, src: "PKG-FAQ" },
  {
    q: "Which model choices are actually available?",
    a: "The package includes three pre-integrated voice model choices and two pre-integrated LLM choices. The document lists sample providers for speech recognition (AI4Bharat, Sarvam, Eleven Labs), language models (Gemma, Llama, Qwen, OpenAI) and speech synthesis (AI4Bharat, Bodhan, Sarvam, Google Chirp), and marks the lists as samples, not the actual list. The actual options are not confirmed.",
    src: "PKG-MODELS",
  },
  {
    q: "What are the proprietary-model rates?",
    a: "The document says proprietary model pricing depends on model choice and refers to a table that has not been supplied. Open-source models are Rs. 0.50 a minute, end to end including telephony.",
    src: "PKG-COST",
  },
  {
    q: "What happens if we require a custom government-system integration?",
    a: `${INTEGRATION_GAP_LINE} The package document does not define a price or package for it.`,
    src: "PKG-OOS",
  },
  {
    q: "What approvals must the department complete before launch?",
    a: "The package document does not list approvals. It asks the department to bring a use case, a conversation script flow, a basic knowledge base, citizens' phone numbers for outbound campaigns, and people to test calls before launch. Security, privacy and procurement approvals are your department's own, and you should confirm them against your internal rules.",
    src: "PKG-BRING",
  },
];

export const MODEL_READINESS = [
  { label: "Documented model choices", value: "3 voice model choices and 2 LLM choices", status: "documented" as const, src: "PKG-INCLUDES" as SourceId },
  { label: "Actual approved model options", value: "Pending confirmation. The listed providers are samples, not the actual list.", status: "pending" as const, src: "PKG-MODELS" as SourceId },
  { label: "Model-specific pricing", value: "Open-source: Rs. 0.50 a minute. Proprietary: pending, table not supplied.", status: "pending" as const, src: "PKG-COST" as SourceId },
  { label: "Voice and language compatibility", value: "Needs verification for each model and language.", status: "verify" as const, src: "PKG-LANG" as SourceId },
  { label: "Model quality", value: "Refer to the Voice Arena report when it is supplied. No scores are shown here.", status: "pending" as const, src: "PKG-QUALITY" as SourceId },
  { label: "Output quality commitment", value: "VoicERA does not independently claim or commit model output quality.", status: "documented" as const, src: "PKG-QUALITY" as SourceId },
];
