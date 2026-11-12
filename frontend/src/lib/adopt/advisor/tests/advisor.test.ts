import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { questionError, requiredRemaining, setUnknown, setValue, stepsFor, visibleQuestions } from "../answers";
import { buildChecklist, buildMeasures, buildPlan } from "../bundle";
import { calculateCost, inr } from "../cost";
import { evaluate, RULES, type EvalContext } from "../evaluate";
import { exportChecklistCsv, exportRecommendation } from "../export";
import { applyInterpretation, interpret } from "../interpret";
import { INTEGRATION_GAP_LINE, PLATINUM } from "../source";
import { emptyAnswers } from "../usecases";
import type { Answers } from "../types";

type Entry = [string, unknown];

/** Applies answers in order, the way the wizard does, so conditional questions behave as they would for a person. */
function build(entries: Entry[]): Answers {
  let a = emptyAnswers();
  for (const [k, v] of entries) a = v === "__unknown" ? setUnknown(a, k, true) : setValue(a, k, v);
  return a;
}

const OPEN_COST: EvalContext = { cost: { category: "open", minutes: 1000 } };

const schemeInbound = (over: Entry[] = []): Entry[] => [
  ["objective", "scheme-discover"],
  ["direction", "inbound"],
  ["eligibilityMode", "rules"],
  ["convDuration", "short"],
  ["languages", ["Hindi", "English"]],
  ["scriptStatus", "ready"],
  ["kbStatus", "approved"],
  ["kbFiles", { count: 4, maxMB: 2, formats: ["Text"] }],
  ["needs", ["standalone"]],
  ["peakConcurrency", "lt100"],
  ["numberSource", "new"],
  ["dataSensitivity", "public"],
  ["testResources", "ready"],
  ["hostingConstraint", "bhashini-ok"],
  ["procurementRoute", "yes"],
  ...over,
];

const feedbackOutbound = (over: Entry[] = []): Entry[] => [
  ["objective", "feedback-service"],
  ["surveyOutbound", "confirm"],
  ["convDuration", "short"],
  ["languages", ["Tamil", "English"]],
  ["scriptStatus", "ready"],
  ["kbNeeded", false],
  ["phoneListStatus", "ready"],
  ["consentStatus", "confirmed"],
  ["campaignsPerMonth", 2],
  ["needs", ["standalone"]],
  ["peakConcurrency", "lt100"],
  ["dataSensitivity", "public"],
  ["testResources", "ready"],
  ...over,
];

const dimOf = (ev: NonNullable<ReturnType<typeof evaluate>>, id: string) => ev.dimensions.find((d) => d.id === id)!;

describe("package configuration", () => {
  it("holds the documented limits and prices", () => {
    assert.equal(PLATINUM.limits.maxConcurrentCalls.value, 500);
    assert.equal(PLATINUM.limits.maxKnowledgeFiles.value, 10);
    assert.equal(PLATINUM.limits.maxKnowledgeFileMB.value, 5);
    assert.equal(PLATINUM.limits.maxCampaignOpsPerMonth.value, 10);
    assert.equal(PLATINUM.limits.setupSlaWorkingDays.value, 2);
    assert.equal(PLATINUM.commercial.oneTimeSetupInr.value, 50000);
    assert.equal(PLATINUM.commercial.perNumberInr.value, 500);
    assert.equal(PLATINUM.commercial.openSourcePerMinuteInr.value, 0.5);
    assert.equal(PLATINUM.commercial.proprietaryPerMinuteInr, null);
  });
});

describe("adaptive question engine", () => {
  it("asks nothing but the objective until one is chosen", () => {
    const qs = visibleQuestions(emptyAnswers());
    assert.deepEqual(qs.map((q) => q.id), ["objective"]);
  });

  it("skips outbound questions for an inbound scheme-discovery service", () => {
    const ids = visibleQuestions(build(schemeInbound())).map((q) => q.id);
    assert.ok(ids.includes("numberSource"));
    assert.ok(!ids.includes("phoneListStatus"));
    assert.ok(!ids.includes("campaignsPerMonth"));
    assert.ok(!ids.includes("surveyQuestionCount"));
  });

  it("shows outbound questions and survey questions for a feedback campaign, and not inbound ones", () => {
    const ids = visibleQuestions(build(feedbackOutbound())).map((q) => q.id);
    assert.ok(ids.includes("phoneListStatus"));
    assert.ok(ids.includes("consentStatus"));
    assert.ok(ids.includes("surveyQuestionCount"));
    assert.ok(!ids.includes("numberSource"));
    assert.ok(!ids.includes("eligibilityMode"));
  });

  it("only offers the technical section when something needs a connection", () => {
    const plain = visibleQuestions(build(schemeInbound())).map((q) => q.id);
    assert.ok(!plain.includes("integSystem"));
    const tech = visibleQuestions(build(schemeInbound([["needs", ["database"]]]))).map((q) => q.id);
    assert.ok(tech.includes("integSystem"));
    assert.ok(tech.includes("integOwner"));
  });

  it("asks for the topic of an information campaign before anything else", () => {
    const a = build([["objective", "outbound-info"]]);
    assert.deepEqual(visibleQuestions(a).map((q) => q.id), ["objective", "infoTopic"]);
    const b = setValue(a, "infoTopic", "schemes");
    assert.ok(visibleQuestions(b).some((q) => q.id === "eligibilityMode"), "scheme topic becomes scheme discovery");
  });

  it("drops answers that no longer apply when the objective changes", () => {
    let a = build(feedbackOutbound());
    assert.ok(a.values.phoneListStatus);
    a = setValue(a, "objective", "scheme-discover");
    assert.equal(a.values.phoneListStatus, undefined, "outbound-only answer removed");
    assert.equal(a.values.surveyOutbound, undefined);
  });

  it("keeps the required path short for scheme discovery", () => {
    const a = build(schemeInbound());
    const required = visibleQuestions(a).filter((q) => q.required);
    assert.ok(required.length <= 14, `required questions: ${required.length}`);
    assert.equal(requiredRemaining(a).length, 0);
  });

  it("only shows steps that have questions", () => {
    const steps = stepsFor(build(schemeInbound())).map((s) => s.id);
    assert.ok(!steps.includes("outbound"));
    assert.ok(steps.includes("inbound"));
  });

  it("accepts Not sure yet where it is allowed, and refuses it elsewhere", () => {
    const a = build([["objective", "scheme-discover"], ["convDuration", "__unknown"]]);
    const dur = visibleQuestions(a).find((q) => q.id === "convDuration")!;
    assert.equal(questionError(dur, a), null);
    const obj = visibleQuestions(emptyAnswers())[0];
    assert.ok(questionError(obj, emptyAnswers()));
  });

  it("validates numbers", () => {
    const a = build(feedbackOutbound([["campaignsPerMonth", -3]]));
    const q = visibleQuestions(a).find((x) => x.id === "campaignsPerMonth")!;
    assert.ok(questionError(q, a));
  });
});

describe("recommendation outcomes", () => {
  it("returns suitable when every documented requirement is met and nothing is open", () => {
    const ev = evaluate(build(schemeInbound([["serviceOwner", "A. Rao"], ["approvalsNeeded", ["none"]]])), OPEN_COST)!;
    assert.equal(ev.outcome, "suitable");
    assert.equal(ev.setupCanStart, true);
    assert.equal(ev.pendingGovernance, false);
  });

  it("Scenario 1: outbound feedback in Tamil and English fits with conditions and known costs", () => {
    const a = build(feedbackOutbound());
    const ev = evaluate(a)!;
    assert.equal(dimOf(ev, "use-case").result, "fit");
    assert.equal(dimOf(ev, "direction").result, "fit");
    assert.equal(dimOf(ev, "languages").result, "fit");
    assert.equal(dimOf(ev, "usage").result, "fit");
    assert.equal(ev.outcome, "suitable-with-conditions", "model type and minutes not chosen yet");
    const c = calculateCost({ numbers: 2, minutes: 4000, category: "open" });
    assert.equal(c.knownTotal, 50000 + 1000 + 2000);
    assert.equal(c.totalIsComplete, true);
  });

  it("Scenario 2: inbound scheme discovery with approved text material fits and produces a checklist", () => {
    const a = build(schemeInbound());
    const ev = evaluate(a)!;
    assert.equal(dimOf(ev, "use-case").result, "fit");
    assert.equal(dimOf(ev, "knowledge").result, "fit");
    assert.equal(dimOf(ev, "languages").result, "fit");
    assert.equal(dimOf(ev, "integration").result, "fit");
    assert.ok(["suitable", "suitable-with-conditions"].includes(ev.outcome));
    const list = buildChecklist(a, ev);
    assert.ok(list.find((i) => i.id === "kb" && i.status === "ready"));
    assert.ok(list.find((i) => i.id === "phones" === false));
    assert.ok(buildPlan(a, ev, list).length === 9);
  });

  it("Scenario 3: live eligibility checks are outside scope and name the integration gap", () => {
    const a = build(schemeInbound([["eligibilityMode", "live-check"]]));
    const ev = evaluate(a)!;
    assert.equal(ev.outcome, "outside-scope");
    assert.equal(ev.integrationNeeded, true);
    assert.equal(dimOf(ev, "integration").result, "blocked");
    assert.ok(dimOf(ev, "integration").consequence.includes(INTEGRATION_GAP_LINE));
    assert.ok(ev.integrationReasons.some((r) => r.includes("eligibility")));
  });

  it("Scenario 3b: a database or API need is also outside scope", () => {
    for (const need of ["database", "existing-system", "case-records", "api-webhook"]) {
      const ev = evaluate(build(schemeInbound([["needs", [need]]])))!;
      assert.equal(ev.outcome, "outside-scope", need);
    }
  });

  it("Scenario 4: conversations longer than three minutes are not recommended", () => {
    const ev = evaluate(build(schemeInbound([["convDuration", "long"]])))!;
    assert.equal(ev.outcome, "outside-scope");
    assert.equal(dimOf(ev, "duration").result, "blocked");
    assert.ok(dimOf(ev, "duration").consequence.includes("3 minutes"));
  });

  it("treats about three minutes as a condition, not a block", () => {
    const ev = evaluate(build(schemeInbound([["convDuration", "about"]])))!;
    assert.equal(dimOf(ev, "duration").result, "conditional");
    assert.notEqual(ev.outcome, "outside-scope");
  });

  it("Scenario 5: more than 500 concurrent calls needs technical validation, not a yes", () => {
    const ev = evaluate(build(schemeInbound([["peakConcurrency", "gt500"]])), OPEN_COST)!;
    assert.equal(dimOf(ev, "usage").result, "review");
    assert.equal(ev.outcome, "needs-review");
  });

  it("Scenario 6: a language outside the documented list is unverified and blocks an unconditional fit", () => {
    const ev = evaluate(build(schemeInbound([["languages", ["Hindi", "Odia"]]])), OPEN_COST)!;
    assert.equal(dimOf(ev, "languages").result, "review");
    assert.ok(dimOf(ev, "languages").consequence.includes("Odia"));
    assert.notEqual(ev.outcome, "suitable");
    assert.equal(ev.outcome, "needs-review");
  });

  it("Scenario 7: more than ten files, or a file over 5 MB, is flagged for review", () => {
    const many = evaluate(build(schemeInbound([["kbFiles", { count: 12, maxMB: 2, formats: ["Text"] }]])), OPEN_COST)!;
    assert.equal(dimOf(many, "knowledge").result, "review");
    assert.ok(dimOf(many, "knowledge").consequence.includes("10"));
    const big = evaluate(build(schemeInbound([["kbFiles", { count: 3, maxMB: 8, formats: ["Text"] }]])), OPEN_COST)!;
    assert.equal(dimOf(big, "knowledge").result, "review");
    const pdf = evaluate(build(schemeInbound([["kbFiles", { count: 3, maxMB: 2, formats: ["PDF"] }]])), OPEN_COST)!;
    assert.equal(dimOf(pdf, "knowledge").result, "review");
    assert.equal(many.outcome, "needs-review");
  });

  it("Scenario 8: a mandatory retention period leaves the recommendation pending governance", () => {
    const ev = evaluate(build(schemeInbound([["retentionRequirement", "mandatory"]])), OPEN_COST)!;
    assert.equal(ev.pendingGovernance, true);
    assert.equal(dimOf(ev, "data-security").result, "review");
    assert.equal(ev.outcome, "needs-review");
    assert.ok(dimOf(ev, "data-security").consequence.includes("needs confirmation from the responsible VoicEra/Bhashini team"));
    assert.equal(ev.setupCanStart, false);
  });

  it("flags storage location, model training and sensitive data the same way", () => {
    for (const over of [["dataLocation", "yes"], ["trainingConcern", "yes"], ["dataSensitivity", "sensitive"], ["auditability", "needed"]] as Entry[]) {
      const ev = evaluate(build(schemeInbound([over])), OPEN_COST)!;
      assert.equal(ev.pendingGovernance, true, String(over[0]));
    }
  });

  it("Scenario 9: proprietary models leave usage cost unresolved but show the known costs", () => {
    const c = calculateCost({ numbers: 1, minutes: 5000, category: "proprietary" });
    assert.equal(c.usageTotal, null);
    assert.equal(c.totalIsComplete, false);
    assert.equal(c.knownTotal, 50500);
    assert.equal(c.unresolvedNote, "Usage cost requires model selection and confirmation of the applicable pricing.");
    const ev = evaluate(build(schemeInbound()), { cost: { category: "proprietary", minutes: 5000 } })!;
    assert.equal(dimOf(ev, "commercial").result, "conditional");
    assert.equal(ev.outcome, "suitable-with-conditions");
  });

  it("Scenario 10: no script, knowledge base or test resources means setup cannot start", () => {
    const a = build(schemeInbound([["scriptStatus", "none"], ["kbStatus", "none"], ["testResources", "no"]]));
    const ev = evaluate(a, OPEN_COST)!;
    assert.equal(ev.setupCanStart, false);
    assert.ok(ev.setupBlockers.length >= 3);
    assert.equal(ev.outcome, "suitable-with-conditions");
    const plan = buildPlan(a, ev, buildChecklist(a, ev));
    assert.equal(plan.find((s) => s.n === 5)!.status, "pending");
    assert.ok(plan.find((s) => s.n === 5)!.detail.includes("starts only after all requirements are provided"));
  });

  it("does not assume compatibility when an answer is unknown", () => {
    const a = build(schemeInbound([["convDuration", "__unknown"], ["peakConcurrency", "__unknown"]]));
    const ev = evaluate(a, OPEN_COST)!;
    assert.equal(dimOf(ev, "duration").result, "unresolved");
    assert.equal(dimOf(ev, "usage").result, "unresolved");
    assert.notEqual(ev.outcome, "suitable");
  });
});

describe("scope boundaries", () => {
  it("WhatsApp calling is out of scope", () => {
    const ev = evaluate(build(schemeInbound([["needs", ["whatsapp"]]])))!;
    assert.equal(ev.outcome, "outside-scope");
  });

  it("multi-modality and partial-stack use are not recommended and no alternative package is invented", () => {
    for (const need of ["multimodal", "partial-stack"]) {
      const ev = evaluate(build(schemeInbound([["needs", [need]]])))!;
      assert.equal(ev.outcome, "outside-scope", need);
      const text = JSON.stringify(ev.dimensions);
      assert.ok(!/gold|silver|bronze/i.test(text));
    }
  });

  it("an inbound survey is not documented and needs review", () => {
    const ev = evaluate(build([["objective", "citizen-survey"], ["surveyOutbound", "not-correct"], ["direction", "inbound"], ["convDuration", "short"], ["languages", ["English"]], ["needs", ["standalone"]]]))!;
    assert.equal(dimOf(ev, "direction").result, "review");
  });

  it("a use case that is not documented needs review, and complaints and forms are outside scope", () => {
    const other = evaluate(build([["objective", "other"], ["direction", "inbound"], ["convDuration", "short"], ["languages", ["English"]], ["needs", ["standalone"]]]))!;
    assert.equal(dimOf(other, "use-case").result, "review");
    assert.equal(other.outcome, "needs-review");
    for (const o of ["complaints", "forms"]) {
      const ev = evaluate(build([["objective", o], ["direction", "inbound"], ["convDuration", "short"], ["languages", ["English"]], ["needs", ["standalone"]]]))!;
      assert.equal(ev.outcome, "outside-scope", o);
      assert.equal(ev.integrationNeeded, true);
    }
  });

  it("more than ten campaigns a month is above the documented allowance", () => {
    const ev = evaluate(build(feedbackOutbound([["campaignsPerMonth", 14]])), OPEN_COST)!;
    assert.equal(dimOf(ev, "campaign-ops").result, "review");
  });

  it("needing your own infrastructure or your own procurement conflicts with hosting and billing on Bhashini", () => {
    assert.equal(dimOf(evaluate(build(schemeInbound([["hostingConstraint", "own"]])))!, "hosting").result, "review");
    assert.equal(dimOf(evaluate(build(schemeInbound([["procurementRoute", "own-tender"]])))!, "hosting").result, "review");
  });

  it("live transfer to a person is unverified, and your own telephony provider is documented but conditional", () => {
    assert.equal(dimOf(evaluate(build(schemeInbound([["fallback", "live-transfer"]])))!, "telephony").result, "review");
    assert.equal(dimOf(evaluate(build(schemeInbound([["numberSource", "own"]])))!, "telephony").result, "conditional");
  });

  it("reading a number file through an API is an open question", () => {
    const ev = evaluate(build(feedbackOutbound([["phoneListStatus", "api"]])))!;
    assert.equal(dimOf(ev, "integration").result, "review");
  });

  it("never concludes the outcome is outside scope without a documented reason", () => {
    const ev = evaluate(build(schemeInbound()), OPEN_COST)!;
    assert.ok(!ev.findings.some((f) => f.severity === "blocker"));
  });
});

describe("transparency", () => {
  it("every rule that fires is defined with a rationale and a source", () => {
    const evs = [
      evaluate(build(schemeInbound())),
      evaluate(build(schemeInbound([["eligibilityMode", "live-check"], ["convDuration", "long"], ["languages", ["Odia"]]]))),
      evaluate(build(feedbackOutbound([["campaignsPerMonth", 20], ["phoneListStatus", "api"]]))),
    ];
    for (const ev of evs) {
      for (const d of ev!.dimensions) {
        assert.ok(d.ruleIds.length > 0, d.id);
        for (const r of d.ruleIds) {
          assert.ok(RULES[r], `${d.id} uses undefined rule ${r}`);
          assert.ok(RULES[r].sources.length > 0);
        }
        assert.ok(d.sources.length > 0, `${d.id} has no source`);
        assert.ok(d.nextAction.length > 0);
      }
    }
  });

  it("evaluates all fourteen dimensions", () => {
    assert.equal(evaluate(build(schemeInbound()))!.dimensions.length, 14);
  });
});

describe("cost estimator", () => {
  it("uses the documented formula: 50,000 plus 500 a number plus 0.50 a minute", () => {
    const c = calculateCost({ numbers: 3, minutes: 12000, category: "open" });
    assert.equal(c.oneTimeTotal, 51500);
    assert.equal(c.usageTotal, 6000);
    assert.equal(c.knownTotal, 57500);
    assert.equal(inr(c.knownTotal), "₹57,500");
  });

  it("keeps one-time and usage costs separate", () => {
    const c = calculateCost({ numbers: 1, minutes: 100, category: "open" });
    assert.equal(c.lines.filter((l) => l.kind === "one-time").length, 2);
    assert.equal(c.lines.filter((l) => l.kind === "usage").length, 1);
  });

  it("does not invent a figure when minutes or the model type are missing", () => {
    const a = calculateCost({ numbers: 1, minutes: null, category: "open" });
    assert.equal(a.usageTotal, null);
    assert.equal(a.totalIsComplete, false);
    assert.equal(a.knownTotal, 50500);
    const b = calculateCost({ numbers: 1, minutes: 100, category: "unknown" });
    assert.equal(b.usageTotal, null);
    assert.equal(b.ifOpenSourceUsage, 50);
  });

  it("is exact with fractions of a rupee", () => {
    assert.equal(calculateCost({ numbers: 0, minutes: 0.3, category: "open" }).usageTotal, 0.15);
    assert.equal(calculateCost({ numbers: 0, minutes: 3, category: "open" }).knownTotal, 50001.5);
  });

  it("rejects negative or fractional inputs and labels planning assumptions", () => {
    assert.equal(calculateCost({ numbers: -1, minutes: 1, category: "open" }).valid, false);
    assert.equal(calculateCost({ numbers: 1.5, minutes: 1, category: "open" }).valid, false);
    assert.equal(calculateCost({ numbers: 1, minutes: -5, category: "open" }).valid, false);
    const c = calculateCost({ numbers: 1, minutes: 1000, minutesIsAssumption: true, category: "open" });
    assert.ok(c.assumptions.some((s) => s.includes("planning assumption")));
  });

  it("adds no tax or recurring fee", () => {
    const c = calculateCost({ numbers: 1, minutes: 0, category: "open" });
    assert.equal(c.knownTotal, 50500);
    assert.ok(c.assumptions[0].includes("No tax"));
  });
});

describe("free-text interpretation", () => {
  const text = "We want to call citizens after they visit a government office and collect feedback about their experience in Tamil and English.";

  it("reads the brief's example", () => {
    const i = interpret(text);
    assert.equal(i.objectiveId, "feedback-service");
    assert.equal(i.useCase, "survey-feedback");
    assert.equal(i.direction, "outbound");
    assert.deepEqual(i.languages.sort(), ["English", "Tamil"]);
    assert.ok(i.missing.length > 0);
  });

  it("turns an agreed reading into answers marked as interpreted", () => {
    const a = applyInterpretation(null, interpret(text));
    assert.equal(a.values.objective, "feedback-service");
    assert.deepEqual((a.values.languages as string[]).sort(), ["English", "Tamil"]);
    assert.equal(a.origin.languages, "interpreted");
  });

  it("spots a live database requirement for scheme discovery", () => {
    const i = interpret("Citizens will call and ask about pension schemes, and we need to check their eligibility live against our database.");
    assert.equal(i.useCase, "scheme-discovery");
    assert.equal(i.direction, "inbound");
    assert.equal(i.eligibilityMode, "live-check");
    const ev = evaluate(applyInterpretation(null, i))!;
    assert.equal(ev.integrationNeeded, true);
  });

  it("flags an undocumented language and WhatsApp", () => {
    const i = interpret("We will call farmers about a scheme in Odia over WhatsApp.");
    assert.deepEqual(i.undocumentedLanguages, ["Odia"]);
    assert.ok(i.needs.includes("whatsapp"));
  });

  it("reads call length and audience size", () => {
    const i = interpret("Call 50,000 beneficiaries for a 5 minute survey about the scheme.");
    assert.equal(i.contactCount, 50000);
    assert.equal(i.duration, "long");
  });

  it("does not pretend to understand nonsense", () => {
    const i = interpret("hello");
    assert.equal(i.objectiveId, null);
    assert.ok(i.missing.includes("What you want the service to do"));
  });
});

describe("exports and measures", () => {
  it("builds a recommendation and a checklist without calling anything", () => {
    const a = build(schemeInbound());
    const md = exportRecommendation(a, { numbers: 1, minutes: 1000, category: "open" }, "Test Dept")!;
    assert.ok(md.includes("Requirement to package mapping"));
    assert.ok(md.includes("This is not an approval"));
    assert.ok(md.includes("₹51,000"));
    const csv = exportChecklistCsv(a, { numbers: 1, minutes: 1000, category: "open" })!;
    assert.ok(csv.split("\n").length > 5);
  });

  it("labels measures the package does not document as proposed", () => {
    const a = build(feedbackOutbound([["reportsNeeded", ["other"]]]));
    const m = buildMeasures(a);
    assert.ok(m.some((x) => x.documented === false));
    assert.ok(m.some((x) => x.label.includes("Collected answers")));
    const inbound = buildMeasures(build(schemeInbound()));
    assert.ok(inbound.every((x) => !x.documented));
  });
});

describe("interpretation pre-fills the outbound assumption for surveys", () => {
  it("confirms outbound when the description says the department calls citizens", () => {
    const a = applyInterpretation(null, interpret("We want to call citizens after they visit an office and collect feedback in Tamil and English."));
    assert.equal(a.values.surveyOutbound, "confirm");
    assert.equal(a.origin.surveyOutbound, "interpreted");
  });
});
