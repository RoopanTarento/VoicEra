import { describeAnswer } from "./answers";
import {
  directionOf,
  fileReadiness,
  inboundOn,
  integrationReasons,
  kbIsNeeded,
  num,
  outboundOn,
  selectedLanguages,
  selectedNeeds,
  undocumentedLanguages,
  caseOf,
} from "./derive";
import { QUESTION_BY_ID } from "./questions";
import { CONFIRMATION_LINE, INTEGRATION_GAP_LINE, PLATINUM, type SourceId } from "./source";
import { USE_CASES, getValue } from "./usecases";
import type {
  Answers,
  DimensionId,
  DimensionOutcome,
  DimResult,
  Evaluation,
  Finding,
  Outcome,
} from "./types";

/** Optional cost inputs from the estimator, so "commercial completeness" reflects what the person has entered. */
export interface EvalContext {
  cost?: { category: "open" | "proprietary" | "unknown"; minutes: number | null };
}

/**
 * Every rule, with its reason and where it comes from.
 * Shown under "How we arrived at this recommendation" and checked by tests.
 */
export const RULES: Record<string, { rationale: string; sources: SourceId[] }> = {
  "R-USE-1": { rationale: "Citizen feedback and surveys, and scheme discovery, are the two documented use cases.", sources: ["PKG-SUITED"] },
  "R-USE-2": { rationale: "A use case that is not one of the two documented ones cannot be treated as supported.", sources: ["PKG-SUITED"] },
  "R-DIR-1": { rationale: "Surveys and feedback are documented as outbound.", sources: ["PKG-SUITED"] },
  "R-DIR-2": { rationale: "Inbound surveys are not documented, so they need confirming.", sources: ["PKG-SUITED"] },
  "R-DIR-3": { rationale: "Scheme discovery is documented for inbound and outbound.", sources: ["PKG-SUITED"] },
  "R-DIR-4": { rationale: "Without the direction we cannot check what the department must bring.", sources: ["PKG-BRING"] },
  "R-DUR-1": { rationale: "Conversations beyond 3 minutes are not recommended.", sources: ["PKG-NOTREC"] },
  "R-LANG-1": { rationale: "English and ten Indian languages are documented.", sources: ["PKG-LANG"] },
  "R-LANG-2": { rationale: "A language outside the documented list is unverified, not unsupported.", sources: ["PKG-LANG"] },
  "R-KB-1": { rationale: "The knowledge base takes up to 10 text files, up to 5 MB each.", sources: ["PKG-KB"] },
  "R-KB-2": { rationale: "The department brings a basic knowledge base. Only approved content should be spoken to citizens.", sources: ["PKG-BRING"] },
  "R-TEL-1": { rationale: "Telephony with numbers is included. Your own provider and numbers is documented as a 2 to 4 week, case-by-case piece of work.", sources: ["PKG-INCLUDES", "PKG-TELEPHONY"] },
  "R-TEL-2": { rationale: "Live transfer to a person is not listed, so it is unverified.", sources: ["PKG-FEATURES"] },
  "R-INT-1": { rationale: "Custom integration to any department system is out of scope.", sources: ["PKG-OOS"] },
  "R-INT-2": { rationale: "WhatsApp calling is out of scope.", sources: ["PKG-OOS"] },
  "R-INT-3": { rationale: "Multi-modality and partial-stack use are not recommended.", sources: ["PKG-NOTREC"] },
  "R-INT-4": { rationale: "Whether a caller-number file can be read through an API is an open FAQ.", sources: ["PKG-FAQ"] },
  "R-USAGE-1": { rationale: "Up to 500 concurrent calls are documented.", sources: ["PKG-SCALE"] },
  "R-OPS-1": { rationale: "Campaign setup and monitoring support is documented as up to 10 a month.", sources: ["PKG-SUPPORT"] },
  "R-HOST-1": { rationale: "The package is hosted on Bhashini and billed to Bhashini.", sources: ["PKG-SUMMARY", "PKG-BILLING"] },
  "R-DATA-1": { rationale: "Where call data is stored, whether it trains models, and how long it is kept are blank in the package document.", sources: ["PKG-FAQ"] },
  "R-COM-1": { rationale: "Setup, number and open-source per-minute prices are documented. Proprietary model pricing is not.", sources: ["PKG-COST"] },
  "R-READY-1": { rationale: "The department brings the use case, script, knowledge base, phone numbers and test resources. The setup SLA starts after all requirements are provided.", sources: ["PKG-BRING", "PKG-SLA"] },
  "R-DEP-1": { rationale: "Open items in the package document only affect a department that depends on them.", sources: ["PKG-FAQ", "PKG-MODELS"] },
};

function answerText(a: Answers, ids: string[]): string {
  const parts: string[] = [];
  for (const id of ids) {
    const q = QUESTION_BY_ID[id];
    if (!q) continue;
    const t = describeAnswer(q, a);
    if (t !== "Not answered") parts.push(t);
  }
  return parts.join("; ") || "Not answered";
}

function dim(
  id: DimensionId,
  label: string,
  p: Omit<DimensionOutcome, "id" | "label" | "ruleIds" | "questionIds" | "sources"> & {
    ruleIds?: string[];
    questionIds?: string[];
    sources?: SourceId[];
  },
): DimensionOutcome {
  const ruleIds = p.ruleIds ?? [];
  const fromRules = Array.from(new Set(ruleIds.flatMap((r) => RULES[r]?.sources ?? [])));
  return {
    id,
    label,
    answer: p.answer,
    requirement: p.requirement,
    result: p.result,
    consequence: p.consequence,
    nextAction: p.nextAction,
    sources: p.sources ?? fromRules,
    ruleIds,
    questionIds: p.questionIds ?? [],
  };
}

const L = PLATINUM.limits;

export function evaluate(a: Answers, ctx: EvalContext = {}): Evaluation | null {
  const uc = caseOf(a);
  if (!uc) return null;
  const dir = directionOf(a);
  const info = USE_CASES[uc];
  const needs = selectedNeeds(a);
  const reasons = integrationReasons(a);
  const dims: DimensionOutcome[] = [];

  /* 1. Use case */
  {
    const ok = info.documented;
    dims.push(
      dim("use-case", "Use-case fit", {
        answer: answerText(a, ["objective", "infoTopic"]),
        requirement: "Documented for citizen feedback and surveys, and for scheme discovery.",
        result: ok ? "fit" : "review",
        consequence: ok
          ? `${info.label} is one of the two documented use cases.`
          : `${info.label} is not one of the two documented use cases, so it cannot be treated as supported.`,
        nextAction: ok ? "Continue." : "Ask the VoicEra/Bhashini team to assess this use case before you decide.",
        ruleIds: [ok ? "R-USE-1" : "R-USE-2"],
        questionIds: ["objective", "infoTopic"],
      }),
    );
  }

  /* 2. Direction */
  {
    let result: DimResult = "fit";
    let consequence = "";
    let next = "Continue.";
    let rule = "R-DIR-3";
    if (!dir) {
      result = "unresolved";
      consequence = "We do not yet know whether the department or the citizen starts the call.";
      next = "Answer who starts the call.";
      rule = "R-DIR-4";
    } else if (uc === "survey-feedback") {
      if (dir === "outbound") {
        consequence = "Surveys and feedback are documented as outbound.";
        rule = "R-DIR-1";
      } else {
        result = "review";
        consequence = "Inbound surveys are not documented for this package.";
        next = "Confirm with the team whether an inbound survey is possible.";
        rule = "R-DIR-2";
      }
    } else if (uc === "scheme-discovery") {
      consequence = "Scheme discovery is documented for inbound and outbound.";
    } else {
      result = "review";
      consequence = "Direction cannot be checked against a documented use case.";
      next = "Raise it in the use-case review.";
      rule = "R-USE-2";
    }
    dims.push(
      dim("direction", "Inbound and outbound", {
        answer: dir ? (dir === "both" ? "Inbound and outbound" : dir === "inbound" ? "Citizens call the department" : "The department calls citizens") : "Not answered",
        requirement: "Surveys: outbound. Scheme discovery: inbound and outbound.",
        result,
        consequence,
        nextAction: next,
        ruleIds: [rule],
        questionIds: ["direction", "surveyOutbound"],
      }),
    );
  }

  /* 3. Duration */
  {
    const d = getValue<string>(a, "convDuration");
    let result: DimResult;
    let consequence: string;
    let next: string;
    if (a.unknown.convDuration || !d) {
      result = "unresolved";
      consequence = "Conversation length is unconfirmed. The package is not recommended beyond 3 minutes.";
      next = "Check the script length. Test calls will show the real duration.";
    } else if (d === "long") {
      result = "blocked";
      consequence = "Conversations beyond 3 minutes are not recommended for this package.";
      next = "Shorten the conversation, or ask the team how a longer conversation could be handled.";
    } else if (d === "about") {
      result = "conditional";
      consequence = "A conversation of about 3 minutes sits at the documented limit.";
      next = "Time the script in test calls before launch.";
    } else {
      result = "fit";
      consequence = "Within the 3-minute guidance.";
      next = "Confirm in test calls.";
    }
    dims.push(
      dim("duration", "Conversation length", {
        answer: answerText(a, ["convDuration"]),
        requirement: `Not recommended beyond ${L.maxConversationMinutes.value} minutes.`,
        result,
        consequence,
        nextAction: next,
        ruleIds: ["R-DUR-1"],
        questionIds: ["convDuration", "surveyQuestionCount"],
      }),
    );
  }

  /* 4. Languages */
  {
    const langs = selectedLanguages(a);
    const bad = undocumentedLanguages(a);
    let result: DimResult;
    let consequence: string;
    let next: string;
    let rule: string;
    if (langs.length === 0) {
      result = "unresolved";
      consequence = "No language chosen yet.";
      next = "Choose the languages citizens will use.";
      rule = "R-LANG-1";
    } else if (bad.length) {
      result = "review";
      consequence = `${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} not in the documented list. That means unverified, not unsupported.`;
      next = "Ask the team to verify these languages, including quality, before you rely on them.";
      rule = "R-LANG-2";
    } else {
      result = "fit";
      consequence = "All chosen languages are in the documented list. The document does not claim equal quality across languages, so test each one.";
      next = "Test each language in your test calls.";
      rule = "R-LANG-1";
    }
    dims.push(
      dim("languages", "Language coverage", {
        answer: langs.length ? langs.join(", ") : "Not answered",
        requirement: "English, Hindi, Marathi, Tamil, Telugu, Kannada, Gujarati, Bengali, Punjabi, Assamese, Malayalam.",
        result,
        consequence,
        nextAction: next,
        ruleIds: [rule],
        questionIds: ["languages", "languageSwitch"],
      }),
    );
  }

  /* 5. Knowledge base */
  {
    if (!kbIsNeeded(a)) {
      dims.push(
        dim("knowledge", "Knowledge-base readiness", {
          answer: "Not needed for this service",
          requirement: "Up to 10 text files, up to 5 MB each.",
          result: "na",
          consequence: "A survey can run from the script alone.",
          nextAction: "None.",
          ruleIds: ["R-KB-1"],
          questionIds: ["kbNeeded"],
        }),
      );
    } else {
      const f = fileReadiness(a);
      const status = getValue<string>(a, "kbStatus");
      const reasonsReview: string[] = [];
      const maxFiles = L.maxKnowledgeFiles.value;
      const maxMB = L.maxKnowledgeFileMB.value;
      if (f.count != null && f.count > maxFiles) reasonsReview.push(`${f.count} files is more than the ${maxFiles}-file limit.`);
      if (f.maxMB != null && f.maxMB > maxMB) reasonsReview.push(`A ${f.maxMB} MB file is over the ${maxMB} MB limit.`);
      const nonText = (f.formats ?? []).filter((x) => x.toLowerCase() !== "text");
      if (nonText.length) reasonsReview.push(`${nonText.join(", ")} ${nonText.length === 1 ? "is" : "are"} not the documented text file type.`);
      let result: DimResult;
      let consequence: string;
      let next: string;
      if (reasonsReview.length) {
        result = "review";
        consequence = reasonsReview.join(" ");
        next = "Reduce or convert the material to fit, or ask the team to review the limit.";
      } else if (a.unknown.kbStatus || !status) {
        result = "unresolved";
        consequence = "We do not know whether the knowledge material exists or is approved.";
        next = "Confirm what exists and who approves it.";
      } else if (status !== "approved") {
        result = "conditional";
        consequence = status === "none" ? "No knowledge material exists yet. Setup cannot start without a basic knowledge base." : "The material is not approved yet. Only approved content should be spoken to citizens.";
        next = status === "none" ? "Write the knowledge material as text files within the limits." : "Get the material approved.";
      } else if (a.unknown.kbFiles || (f.count == null && f.maxMB == null && !(f.formats?.length))) {
        result = "conditional";
        consequence = "The material is approved, but we have not checked it against the file limits.";
        next = `Confirm it fits ${maxFiles} text files of ${maxMB} MB or less each.`;
      } else {
        result = "fit";
        consequence = "Approved, and within the documented file limits.";
        next = "Provide the files at setup.";
      }
      dims.push(
        dim("knowledge", "Knowledge-base readiness", {
          answer: answerText(a, ["kbStatus", "kbFiles"]),
          requirement: `Up to ${maxFiles} text files, up to ${maxMB} MB each, in a documented language.`,
          result,
          consequence,
          nextAction: next,
          ruleIds: ["R-KB-1", "R-KB-2"],
          questionIds: ["kbStatus", "kbFiles"],
        }),
      );
    }
  }

  /* 6. Telephony */
  {
    const ns = getValue<string>(a, "numberSource");
    const ownTel = needs.includes("custom-telephony") || ns === "own";
    const live = getValue<string>(a, "fallback") === "live-transfer";
    const wa = needs.includes("whatsapp");
    let result: DimResult = "fit";
    const cons: string[] = [];
    const next: string[] = [];
    const rules = ["R-TEL-1"];
    if (wa) {
      result = "blocked";
      cons.push("WhatsApp calling is out of scope for this package.");
      next.push("Plan voice on a normal phone line or browser instead, or ask the team about WhatsApp separately.");
      rules.push("R-INT-2");
    }
    if (ownTel) {
      if (result !== "blocked") result = "conditional";
      cons.push("Using your own telephony provider and numbers is documented, as 2 to 4 weeks of work, case by case. The partners listed in the document are samples.");
      next.push("Name your provider and ask the team to confirm the integration.");
    }
    if (live) {
      if (result === "fit") result = "review";
      cons.push("Passing a call to a person is not listed in the package, so it is unverified.");
      next.push("Ask whether live transfer is possible, or choose a callback or redirect.");
      rules.push("R-TEL-2");
    }
    if (inboundOn(a) && !ns) {
      if (result === "fit") result = "unresolved";
      cons.push("We do not yet know which number citizens will call.");
      next.push("Choose a new package number or your own.");
    }
    if (!cons.length) {
      cons.push("Telephony and phone numbers are included, delivered by browser or telephony.");
      next.push("Confirm how many numbers you want in the cost estimate.");
    }
    dims.push(
      dim("telephony", "Telephony compatibility", {
        answer: inboundOn(a)
          ? answerText(a, ["numberSource", "channel", "fallback"]) + (needs.includes("custom-telephony") ? "; own provider" : "")
          : `Outbound calls use the package's telephony${needs.includes("custom-telephony") ? "; own provider requested" : ""}`,
        requirement: "Telephony with numbers included. Own provider and numbers: 2 to 4 weeks, case by case.",
        result,
        consequence: cons.join(" "),
        nextAction: next.join(" "),
        ruleIds: rules,
        questionIds: ["numberSource", "channel", "fallback", "needs"],
      }),
    );
  }

  /* 7. Integration */
  {
    const nots: string[] = [];
    const rules: string[] = [];
    let result: DimResult = "fit";
    let consequence: string;
    let next: string;
    if (reasons.length) {
      result = "blocked";
      rules.push("R-INT-1");
      nots.push(...reasons);
    }
    if (needs.includes("multimodal")) {
      result = "blocked";
      rules.push("R-INT-3");
      nots.push("Non-voice input (multi-modality) is not recommended for this package.");
    }
    if (needs.includes("partial-stack")) {
      result = "blocked";
      rules.push("R-INT-3");
      nots.push("Using only part of the stack is not recommended. The document points to other packages, which are not defined in the material supplied.");
    }
    if (needs.includes("whatsapp")) {
      result = "blocked";
      rules.push("R-INT-2");
      nots.push("WhatsApp calling is out of scope.");
    }
    if (getValue<string>(a, "phoneListStatus") === "api") {
      if (result === "fit") result = "review";
      rules.push("R-INT-4");
      nots.push("Reading the number list through an API is an open question in the package document.");
    }
    if (a.unknown.needs || !getValue(a, "needs")) {
      if (result === "fit") result = "unresolved";
      consequence = reasons.length ? `${INTEGRATION_GAP_LINE} ${nots.join(" ")}` : nots.length ? nots.join(" ") : "We do not yet know whether this needs to connect to anything of yours.";
      next = "Say whether it must connect to a system. If it does, a separate feasibility assessment is needed.";
    } else if (result === "fit") {
      consequence = "It can work on its own, which is what the package covers.";
      next = "None.";
      rules.push("R-INT-1");
    } else {
      consequence = reasons.length ? `${INTEGRATION_GAP_LINE} ${nots.join(" ")}` : nots.join(" ");
      next = reasons.length
        ? "Request a separate technical feasibility assessment, naming the system, the data exchanged and the owner."
        : "Revise the requirement, or request an assessment.";
    }
    dims.push(
      dim("integration", "Integration requirements", {
        answer: answerText(a, ["needs", "eligibilityMode"]),
        requirement: "No custom integration with department systems. No WhatsApp calling. No multi-modality. Not as a partial stack.",
        result,
        consequence,
        nextAction: next,
        ruleIds: rules.length ? Array.from(new Set(rules)) : ["R-INT-1"],
        questionIds: ["needs", "eligibilityMode", "phoneListStatus"],
      }),
    );
  }

  /* 8. Usage and concurrency */
  {
    const c = getValue<string>(a, "peakConcurrency");
    let result: DimResult;
    let consequence: string;
    let next: string;
    if (a.unknown.peakConcurrency || !c) {
      result = "unresolved";
      consequence = "Peak concurrency is not known. The package documents up to 500 concurrent calls.";
      next = "Estimate your busiest moment, or confirm capacity with the team.";
    } else if (c === "gt500") {
      result = "review";
      consequence = "More than 500 concurrent calls is above the documented limit.";
      next = "Ask for technical validation. Do not assume more than 500 is supported.";
    } else {
      result = "fit";
      consequence = "Within the documented 500 concurrent calls. Latency and uptime figures are targets, not guarantees for every case.";
      next = "None.";
    }
    dims.push(
      dim("usage", "Expected usage and concurrency", {
        answer: answerText(a, ["peakConcurrency", "callsPerMonth", "avgMinutes"]),
        requirement: `Up to ${L.maxConcurrentCalls.value} concurrent calls. Latency target under ${L.latencyTargetSeconds.value} seconds. Uptime ${L.uptimePercent.value}% (stated).`,
        result,
        consequence,
        nextAction: next,
        ruleIds: ["R-USAGE-1"],
        questionIds: ["peakConcurrency", "callsPerMonth", "avgMinutes"],
      }),
    );
  }

  /* 9. Campaign operations */
  {
    if (!outboundOn(a)) {
      dims.push(
        dim("campaign-ops", "Campaign operations", {
          answer: "No outbound campaigns",
          requirement: `Campaign setup and monitoring support, up to ${L.maxCampaignOpsPerMonth.value} a month.`,
          result: "na",
          consequence: "Campaign support applies to outbound calling.",
          nextAction: "None.",
          ruleIds: ["R-OPS-1"],
        }),
      );
    } else {
      const n = num(a, "campaignsPerMonth");
      let result: DimResult;
      let consequence: string;
      let next: string;
      if (a.unknown.campaignsPerMonth || n === null) {
        result = "unresolved";
        consequence = "The number of campaigns a month is not known. Support is documented as up to 10 a month.";
        next = "Estimate how many campaigns you will run.";
      } else if (n > L.maxCampaignOpsPerMonth.value) {
        result = "review";
        consequence = `${n} campaigns a month is above the documented allowance of ${L.maxCampaignOpsPerMonth.value}.`;
        next = "Ask the team whether the allowance can be extended. Do not assume it.";
      } else {
        result = "fit";
        consequence = `Within the documented ${L.maxCampaignOpsPerMonth.value} a month, with one dedicated campaign operator and one shared programme manager.`;
        next = "None.";
      }
      dims.push(
        dim("campaign-ops", "Campaign operations", {
          answer: answerText(a, ["campaignsPerMonth", "campaignFrequency"]),
          requirement: `Up to ${L.maxCampaignOpsPerMonth.value} campaign setups and monitoring activities a month.`,
          result,
          consequence,
          nextAction: next,
          ruleIds: ["R-OPS-1"],
          questionIds: ["campaignsPerMonth", "campaignFrequency"],
        }),
      );
    }
  }

  /* 10. Hosting and procurement */
  {
    const h = getValue<string>(a, "hostingConstraint");
    const p = getValue<string>(a, "procurementRoute");
    const issues: string[] = [];
    if (h === "own") issues.push("You need to run it on your own infrastructure. The package is hosted on Bhashini.");
    if (p === "own-tender") issues.push("You need your own procurement. The package is billed to Bhashini.");
    // No stated conflict is a fit: the package is hosted and billed on Bhashini, and a department flags a conflict if it has one.
    const result: DimResult = issues.length ? "review" : "fit";
    dims.push(
      dim("hosting", "Hosting and procurement", {
        answer: answerText(a, ["hostingConstraint", "procurementRoute"]),
        requirement: "Hosted on Bhashini. Billed to Bhashini.",
        result,
        consequence: issues.length
          ? issues.join(" ")
          : h || p
            ? "No conflict with hosting on Bhashini or billing through Bhashini."
            : "The package is hosted on Bhashini and billed to Bhashini. You have not flagged a conflict, so none is assumed.",
        nextAction: issues.length ? "Raise the conflict with the team before going further." : "If your rules require otherwise, say so in the questions.",
        ruleIds: ["R-HOST-1"],
        questionIds: ["hostingConstraint", "procurementRoute"],
      }),
    );
  }

  /* 11. Data security and governance */
  let pendingGovernance = false;
  {
    const flags: string[] = [];
    if (getValue<string>(a, "retentionRequirement") === "mandatory") flags.push("You need a mandatory retention period. How long call data is kept is not stated in the package document.");
    if (getValue<string>(a, "dataLocation") === "yes") flags.push("You must know where call data is stored. The package document does not say.");
    if (getValue<string>(a, "trainingConcern") === "yes") flags.push("You must know whether call data trains models. The package document does not say.");
    if (getValue<string>(a, "auditability") === "needed") flags.push("You need an audit trail. Auditability is not described in the package document.");
    if (getValue<string>(a, "dataSensitivity") === "sensitive") flags.push("Sensitive personal details will be discussed. Data handling has to be confirmed first.");
    pendingGovernance = flags.length > 0;
    const sens = getValue<string>(a, "dataSensitivity");
    let result: DimResult;
    let consequence: string;
    if (pendingGovernance) {
      result = "review";
      consequence = `${flags.join(" ")} ${CONFIRMATION_LINE}`;
    } else if (a.unknown.dataSensitivity || !sens) {
      result = "unresolved";
      consequence = "We do not yet know how sensitive the information is.";
    } else if (sens === "personal") {
      result = "conditional";
      consequence = "Some personal details will be discussed. The package document leaves storage location, model training and retention open, so confirm they are acceptable.";
    } else {
      result = "fit";
      consequence = "Only public information, and no mandatory data requirement is outstanding. The open storage, training and retention questions still exist in the package document.";
    }
    dims.push(
      dim("data-security", "Data security and governance", {
        answer: answerText(a, ["dataSensitivity", "retentionRequirement", "dataLocation", "trainingConcern", "auditability"]),
        requirement: "Storage location, model training and retention are not stated in the package document.",
        result,
        consequence,
        nextAction: pendingGovernance
          ? "Ask the responsible VoicEra/Bhashini team to answer these in writing before approval."
          : result === "fit"
            ? "None."
            : "Confirm your data requirements.",
        ruleIds: ["R-DATA-1"],
        questionIds: ["dataSensitivity", "retentionRequirement", "dataLocation", "trainingConcern", "auditability"],
      }),
    );
  }

  /* 12. Commercial completeness */
  {
    const cost = ctx.cost;
    const minutes = cost?.minutes ?? (num(a, "callsPerMonth") !== null && num(a, "avgMinutes") !== null ? (num(a, "callsPerMonth") as number) * (num(a, "avgMinutes") as number) : null);
    const cat = cost?.category ?? "unknown";
    let result: DimResult;
    let consequence: string;
    let next: string;
    if (cat === "proprietary") {
      result = "conditional";
      consequence = "Setup and number costs are known. Usage cost with a proprietary model needs the model chosen and its price confirmed, and the pricing table has not been supplied.";
      next = "Choose a model and ask the team for its rate.";
    } else if (cat === "open" && minutes !== null) {
      result = "fit";
      consequence = "Setup, number and open-source usage costs can all be estimated from documented rates.";
      next = "Review the estimate.";
    } else if (cat === "open") {
      result = "conditional";
      consequence = "Setup and number costs are known. Usage cost needs your expected minutes.";
      next = "Enter expected billable minutes, or leave usage out of the estimate.";
    } else {
      result = "unresolved";
      consequence = "Setup and number costs are known. The model type and expected minutes are not chosen yet, so usage cost is open.";
      next = "Choose open-source or proprietary, and enter expected minutes, in the cost estimate.";
    }
    dims.push(
      dim("commercial", "Commercial completeness", {
        answer: `${cat === "open" ? "Open-source models" : cat === "proprietary" ? "Proprietary models" : "Model type not chosen"}${minutes !== null ? `; about ${Math.round(minutes).toLocaleString("en-IN")} billable minutes` : "; minutes not entered"}`,
        requirement: "Setup Rs. 50,000. Rs. 500 per number. Open-source models Rs. 0.50 a minute, end to end including telephony. Proprietary: not supplied.",
        result,
        consequence,
        nextAction: next,
        ruleIds: ["R-COM-1"],
        questionIds: ["callsPerMonth", "avgMinutes"],
      }),
    );
  }

  /* 13. Readiness */
  const setupBlockers: string[] = [];
  {
    const script = getValue<string>(a, "scriptStatus");
    if (a.unknown.scriptStatus || !script) setupBlockers.push("Confirm the conversation script is ready.");
    else if (script !== "ready") setupBlockers.push(script === "draft" ? "Finish and approve the conversation script." : "Write the conversation script.");
    if (kbIsNeeded(a)) {
      const st = getValue<string>(a, "kbStatus");
      if (a.unknown.kbStatus || !st) setupBlockers.push("Confirm the knowledge base is ready.");
      else if (st === "none") setupBlockers.push("Write the knowledge base.");
      else if (st === "unapproved") setupBlockers.push("Get the knowledge base approved.");
    }
    if (outboundOn(a)) {
      const pl = getValue<string>(a, "phoneListStatus");
      if (a.unknown.phoneListStatus || !pl) setupBlockers.push("Confirm the citizen phone-number list is available.");
      else if (pl === "not-ready") setupBlockers.push("Prepare the phone-number list so it can be shared securely.");
      else if (pl === "to-collect") setupBlockers.push("Collect the citizen phone numbers.");
      else if (pl === "api") setupBlockers.push("Confirm whether the number file can be read through an API, or supply the list.");
      if (getValue<string>(a, "consentStatus") !== "confirmed") setupBlockers.push("Confirm your department has permission to call these citizens.");
    }
    const tr = getValue<string>(a, "testResources");
    if (a.unknown.testResources || !tr) setupBlockers.push("Confirm who will make the test calls.");
    else if (tr === "no") setupBlockers.push("Arrange people to make test calls before launch.");
    const ready = setupBlockers.length === 0;
    dims.push(
      dim("readiness", "Department readiness", {
        answer: answerText(a, ["scriptStatus", "kbStatus", "phoneListStatus", "consentStatus", "testResources"]),
        requirement: "The department brings a use case, a script flow, a basic knowledge base, phone numbers for outbound, and test resources.",
        result: ready ? "fit" : "conditional",
        consequence: ready
          ? "Everything the package asks the department to bring is in hand."
          : `Setup cannot begin until these are supplied: ${setupBlockers.join(" ")}`,
        nextAction: ready ? "Share the inputs to start the 2-working-day setup clock." : "Work through the checklist. The 2-working-day setup SLA starts only after all requirements are provided.",
        ruleIds: ["R-READY-1"],
        questionIds: ["scriptStatus", "kbStatus", "phoneListStatus", "consentStatus", "testResources"],
      }),
    );
  }

  /* 14. Unresolved dependencies */
  {
    // Items that need an answer before a decision are "review". Items that only leave a figure open are "conditional".
    const reviewDeps: string[] = [];
    const condDeps: string[] = [];
    if (pendingGovernance) reviewDeps.push("Data storage, model training and retention answers you have said you need.");
    if (getValue<string>(a, "phoneListStatus") === "api") reviewDeps.push("Whether a number file can be read through an API.");
    if (undocumentedLanguages(a).length) reviewDeps.push("Verification of languages outside the documented list.");
    if (ctx.cost?.category === "proprietary") condDeps.push("Proprietary model choice and pricing.");
    if (needs.includes("custom-telephony") || getValue<string>(a, "numberSource") === "own") condDeps.push("Confirmation of your own telephony provider.");
    const all = [...reviewDeps, ...condDeps];
    dims.push(
      dim("dependencies", "Unresolved dependencies", {
        answer: all.length ? `${all.length} open` : "None that you depend on",
        requirement: "Open items in the package document only matter if you depend on them.",
        result: reviewDeps.length ? "review" : condDeps.length ? "conditional" : "fit",
        consequence: all.length
          ? `${all.join(" ")} ${CONFIRMATION_LINE}`
          : "None of the open items in the package document affect your stated requirements. They still exist, and are listed below.",
        nextAction: all.length ? "Ask the team to confirm each in writing." : "None.",
        ruleIds: ["R-DEP-1"],
      }),
    );
  }

  /* Outcome */
  const has = (r: DimResult) => dims.some((d) => d.result === r);
  let outcome: Outcome;
  if (has("blocked")) outcome = "outside-scope";
  else if (pendingGovernance || has("review")) outcome = "needs-review";
  else if (has("conditional") || has("unresolved")) outcome = "suitable-with-conditions";
  else outcome = "suitable";

  const findings: Finding[] = [];
  for (const d of dims) {
    if (d.result === "fit" || d.result === "na") continue;
    findings.push({
      id: `F-${d.id}`,
      severity: d.result === "blocked" ? "blocker" : d.result === "review" ? "review" : "condition",
      title: d.label,
      detail: d.consequence,
      dimension: d.id,
      sources: d.sources,
    });
  }

  const unknownCount = Object.values(a.unknown).filter(Boolean).length;
  return {
    useCase: uc,
    direction: dir,
    outcome,
    pendingGovernance,
    dimensions: dims,
    findings,
    integrationNeeded: reasons.length > 0,
    integrationReasons: reasons,
    setupCanStart: outcome !== "outside-scope" && outcome !== "needs-review" && setupBlockers.length === 0,
    setupBlockers,
    answeredCount: Object.keys(a.values).length,
    unknownCount,
  };
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  suitable: "Suitable based on supplied requirements",
  "suitable-with-conditions": "Suitable with conditions",
  "needs-review": "Needs technical or governance review",
  "outside-scope": "Outside documented Platinum scope",
};

export const OUTCOME_EXPLANATION: Record<Outcome, string> = {
  suitable:
    "Your requirements appear to fit what the package documents. This is not a production approval. Approvals, test calls and confirmation of the open items still apply.",
  "suitable-with-conditions":
    "The use case appears to fit, but some prerequisites or details are still incomplete. Setup starts only after they are provided.",
  "needs-review":
    "At least one requirement cannot be verified from the package document, or needs an assessment. Do not treat this as a yes yet.",
  "outside-scope":
    "At least one requirement is something the package document excludes or says it is not recommended for. We have not suggested a different package, because none is defined in the material supplied.",
};
