import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { setUnknown, setValue } from "../answers";
import { evaluate } from "../evaluate";
import { buildFlow, nextQuestion, reactTo, remaining } from "../studio";
import { emptyAnswers } from "../usecases";
import { QUESTION_BY_ID } from "../questions";
import type { Answers, Question } from "../types";

const build = (entries: [string, unknown][]): Answers => {
  let a = emptyAnswers();
  for (const [k, v] of entries) a = v === "__unknown" ? setUnknown(a, k, true) : setValue(a, k, v);
  return a;
};

/** Gives an acceptable answer for any kind of question. */
function answerFor(a: Answers, q: Question): Answers {
  switch (q.kind) {
    case "multi": return setValue(a, q.id, ["standalone"]);
    case "language": return setValue(a, q.id, ["English"]);
    case "yesno": return setValue(a, q.id, false);
    case "number": return setValue(a, q.id, 1);
    case "table": return setValue(a, q.id, [{ name: "A scheme", audience: "Someone" }]);
    case "fileReadiness": return setValue(a, q.id, { count: 2, maxMB: 1, formats: ["Text"] });
    case "shorttext": case "longtext": return setValue(a, q.id, "text");
    default: return setValue(a, q.id, q.options?.[0]?.value ?? "x");
  }
}

describe("studio: choosing the next question", () => {
  it("starts with the objective, then asks what can decide the outcome first", () => {
    assert.equal(nextQuestion(emptyAnswers())!.id, "objective");
    const a = build([["objective", "scheme-discover"]]);
    assert.equal(nextQuestion(a)!.id, "direction");
    const b = setValue(a, "direction", "inbound");
    assert.equal(nextQuestion(b)!.id, "eligibilityMode");
    const c = setValue(b, "eligibilityMode", "rules");
    assert.equal(nextQuestion(c)!.id, "needs", "integration is asked before readiness details");
  });

  it("never asks an outbound question of an inbound service", () => {
    let a = build([["objective", "scheme-discover"], ["direction", "inbound"]]);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const q = nextQuestion(a);
      if (!q) break;
      seen.push(q.id);
      a = answerFor(a, q);
    }
    assert.ok(!seen.includes("phoneListStatus"));
    assert.ok(!seen.includes("consentStatus"));
    assert.ok(seen.length <= 14, `asked ${seen.length}`);
  });

  it("stops asking when every needed answer is in, and optional ones only when asked to deepen", () => {
    let a = emptyAnswers();
    for (let i = 0; i < 40; i++) {
      const q = nextQuestion(a);
      if (!q) break;
      a = answerFor(a, q);
    }
    assert.equal(nextQuestion(a), null);
    assert.equal(remaining(a), 0);
    assert.ok(nextQuestion(a, { deepen: true }));
  });
});

describe("studio: reacting to an answer", () => {
  it("speaks up when an answer is outside the package, using the rule engine's own words", () => {
    const base = build([["objective", "scheme-discover"], ["direction", "inbound"]]);
    const before = evaluate(base);
    const a = setValue(base, "eligibilityMode", "live-check");
    const msg = reactTo(before, evaluate(a), QUESTION_BY_ID.eligibilityMode, a);
    assert.ok(msg.startsWith("That is outside what Platinum documents."), msg);
    assert.ok(msg.includes("custom integration"));
  });

  it("flags a long conversation, and stays quiet about an unremarkable answer", () => {
    const base = build([["objective", "scheme-discover"], ["direction", "inbound"]]);
    const a = setValue(base, "convDuration", "long");
    assert.ok(reactTo(evaluate(base), evaluate(a), QUESTION_BY_ID.convDuration, a).includes("3 minutes"));
    const b = setValue(base, "department", "Some Dept");
    assert.equal(reactTo(evaluate(base), evaluate(b), QUESTION_BY_ID.department, b), "");
  });

  it("does not assume anything when someone is not sure", () => {
    const a = setUnknown(build([["objective", "scheme-discover"]]), "convDuration", true);
    assert.ok(reactTo(null, evaluate(a), QUESTION_BY_ID.convDuration, a).includes("not confirmed"));
  });
});

describe("studio: the live blueprint", () => {
  it("draws nothing until there is a use case, then grows as answers come in", () => {
    assert.equal(buildFlow(emptyAnswers(), null).main.length, 0);
    const a = build([["objective", "scheme-discover"]]);
    const f1 = buildFlow(a, evaluate(a));
    const a2 = setValue(setValue(a, "direction", "inbound"), "languages", ["Hindi", "English"]);
    const f2 = buildFlow(a2, evaluate(a2));
    assert.ok(f1.main.length >= 6);
    assert.equal(f1.main.find((n) => n.id === "language")!.status, "pending");
    assert.equal(f2.main.find((n) => n.id === "language")!.status, "ok");
    assert.equal(f2.main.find((n) => n.id === "start")!.title, "Citizen calls");
  });

  it("adds a dashed, blocked system node only when a system connection is wanted", () => {
    const plain = build([["objective", "scheme-discover"], ["direction", "inbound"], ["needs", ["standalone"]]]);
    assert.ok(!buildFlow(plain, evaluate(plain)).main.some((n) => n.system));
    const live = setValue(plain, "eligibilityMode", "live-check");
    const node = buildFlow(live, evaluate(live)).main.find((n) => n.system)!;
    assert.equal(node.status, "blocked");
    assert.ok(node.note!.includes("separate feasibility assessment"));
  });

  it("marks an unverified language and a long conversation on the nodes they affect", () => {
    const a = build([["objective", "citizen-survey"], ["surveyOutbound", "confirm"], ["languages", ["Odia"]], ["convDuration", "long"]]);
    const f = buildFlow(a, evaluate(a));
    assert.equal(f.main.find((n) => n.id === "language")!.status, "warn");
    assert.equal(f.main.find((n) => n.id === "ask")!.status, "blocked");
    assert.equal(f.branches.find((n) => n.id === "length")!.status, "blocked");
  });
});

import { whatIfs } from "../studio";

describe("studio: what would make it fit", () => {
  it("offers written-rules eligibility when a live check is wanted, and the change really clears the blocker", () => {
    const a = build([["objective", "scheme-discover"], ["direction", "inbound"], ["eligibilityMode", "live-check"], ["needs", ["standalone"]]]);
    const opts = whatIfs(a);
    const o = opts.find((x) => x.id === "no-system")!;
    assert.ok(o);
    assert.equal(evaluate(a)!.outcome, "outside-scope");
    assert.notEqual(evaluate(o.apply(a))!.outcome, "outside-scope");
  });

  it("offers a fix for each documented limit that was crossed", () => {
    const a = build([["objective", "scheme-discover"], ["direction", "inbound"], ["convDuration", "long"], ["languages", ["Hindi", "Odia"]], ["peakConcurrency", "gt500"], ["needs", ["standalone"]]]);
    const ids = whatIfs(a).map((x) => x.id);
    for (const id of ["short-calls", "cap-500", "documented-languages"]) assert.ok(ids.includes(id), id);
    const db = build([["objective", "scheme-discover"], ["direction", "inbound"], ["needs", ["database"]]]);
    assert.ok(whatIfs(db).some((x) => x.id === "no-system"));
    const wa = build([["objective", "scheme-discover"], ["direction", "inbound"], ["needs", ["whatsapp"]]]);
    assert.ok(whatIfs(wa).some((x) => x.id === "no-whatsapp"));
    // Two blockers at once: removing one alone does not help, so it is not offered as a fix.
    const both = build([["objective", "scheme-discover"], ["direction", "inbound"], ["needs", ["database", "whatsapp"]]]);
    assert.ok(!whatIfs(both).some((x) => x.id === "no-system"));
  });

  it("offers nothing when there is nothing to fix, and never offers a change that does not help", () => {
    const ok = build([["objective", "scheme-discover"], ["direction", "inbound"], ["convDuration", "short"], ["languages", ["Hindi"]], ["needs", ["standalone"]]]);
    assert.deepEqual(whatIfs(ok), []);
    for (const w of whatIfs(build([["objective", "scheme-discover"], ["direction", "inbound"], ["eligibilityMode", "application"], ["needs", ["standalone"]]]))) {
      assert.ok(w.outcome);
    }
  });

  it("clears the system connection even when it is asked for in two different answers", () => {
    const a = build([["objective", "scheme-discover"], ["direction", "inbound"], ["eligibilityMode", "live-check"], ["needs", ["database"]]]);
    const w = whatIfs(a).find((x) => x.id === "no-system")!;
    assert.ok(w);
    const next = w.apply(a);
    assert.equal(next.values.eligibilityMode, "rules");
    assert.deepEqual(next.values.needs, ["standalone"]);
    assert.equal(evaluate(next)!.integrationNeeded, false);
  });

  it("does not leave the person with an empty needs answer after removing a connection", () => {
    const a = build([["objective", "scheme-discover"], ["direction", "inbound"], ["needs", ["database"]]]);
    const next = whatIfs(a).find((x) => x.id === "no-system")!.apply(a);
    assert.deepEqual(next.values.needs, ["standalone"]);
  });
});

describe("studio: fixing several blockers together", () => {
  it("offers all fixes at once, and that actually clears every blocker when each alone does not", () => {
    const a = build([["objective", "scheme-discover"], ["direction", "inbound"], ["eligibilityMode", "live-check"], ["needs", ["database"]], ["convDuration", "long"], ["languages", ["Hindi"]]]);
    const opts = whatIfs(a);
    const all = opts.find((x) => x.id === "all")!;
    assert.ok(all, "a combined option is offered");
    assert.equal(evaluate(a)!.outcome, "outside-scope");
    const after = evaluate(all.apply(a))!;
    assert.notEqual(after.outcome, "outside-scope");
    assert.ok(!after.findings.some((f) => f.severity === "blocker"));
  });
});
