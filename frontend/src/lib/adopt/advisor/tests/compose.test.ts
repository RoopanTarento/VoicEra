import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { BLOCKS, BLOCK_BY_ID, STARTERS, designToAnswers, emptyDesign, fromSentence, fromStarter, judge, scriptFor, setTopic, toggleBlock, type Design } from "../compose";

const helpline = () => fromStarter(STARTERS.find((s) => s.id === "helpline")!);
const withReady = (d: Design): Design => ({ ...d, ready: { script: "yes", knowledge: "yes", phoneList: "yes", permission: "yes", testers: "yes" }, sensitivity: "public", category: "open", numbers: 1, minutes: 1000 });

describe("composer: a composition becomes a verdict, with no questions asked", () => {
  it("judges a plain scheme helpline as fitting, with the unknowns left open", () => {
    const v = judge(helpline())!;
    assert.ok(["suitable-with-conditions", "suitable"].includes(v.ev.outcome));
    assert.equal(v.culprits.length, 0);
    assert.ok(v.open.length > 0, "script, knowledge and testers are unknown, so they stay open");
  });

  it("can reach a clean fit when the department says what it has", () => {
    const v = judge(withReady(helpline()), { cost: { category: "open", minutes: 1000 } })!;
    assert.equal(v.ev.outcome, "suitable");
  });

  it("flips to outside-scope the moment a risky block is added, and names it", () => {
    const d = toggleBlock(helpline(), "lookup");
    const v = judge(d)!;
    assert.equal(v.ev.outcome, "outside-scope");
    assert.deepEqual(v.culprits, ["lookup"]);
    assert.equal(v.blocks.lookup.state, "blocked");
    assert.ok(v.blocks.lookup.why!.includes("separate feasibility assessment"));
  });

  it("clears it again when the block is removed", () => {
    const d = toggleBlock(toggleBlock(helpline(), "lookup"), "lookup");
    assert.notEqual(judge(d)!.ev.outcome, "outside-scope");
  });

  it("treats each documented limit as a block you can add", () => {
    const cases: [string, string][] = [["long-calls", "outside-scope"], ["whatsapp", "outside-scope"], ["images", "outside-scope"], ["crm", "outside-scope"], ["submit", "outside-scope"], ["peak-gt500", "needs-review"], ["live-transfer", "needs-review"]];
    for (const [b, out] of cases) {
      const v = judge(withReady(toggleBlock(helpline(), b as never)), { cost: { category: "open", minutes: 1000 } })!;
      assert.equal(v.ev.outcome, out, b);
    }
  });

  it("an unverified language is a problem on the languages, not on a block", () => {
    const d = withReady({ ...helpline(), languages: ["Hindi", "Odia"] });
    const v = judge(d, { cost: { category: "open", minutes: 1000 } })!;
    assert.equal(v.ev.outcome, "needs-review");
  });

  it("more than 10 campaigns a month is flagged only when the call goes outbound", () => {
    const inboundOnly = judge(withReady(toggleBlock(helpline(), "big-campaign")))!;
    assert.ok(!inboundOnly.ev.dimensions.some((d) => d.id === "campaign-ops" && d.result === "review"));
    const out = judge(withReady(toggleBlock(toggleBlock(helpline(), "out-call"), "big-campaign")), { cost: { category: "open", minutes: 1000 } })!;
    assert.equal(out.ev.dimensions.find((d) => d.id === "campaign-ops")!.result, "review");
  });

  it("calls out a survey that citizens would call in to, as not documented", () => {
    const d = withReady({ ...emptyDesign("survey"), blocks: ["in-call", "survey-q", "capture"], languages: ["English"] });
    assert.equal(judge(d)!.ev.dimensions.find((x) => x.id === "direction")!.result, "review");
  });

  it("does not assume direction when no call is started", () => {
    const d = { ...emptyDesign("scheme"), blocks: ["hear-need" as const], languages: ["Hindi"] };
    assert.equal(judge(d)!.ev.dimensions.find((x) => x.id === "direction")!.result, "unresolved");
  });

  it("keeps fallback choices exclusive", () => {
    let d = helpline();
    assert.ok(d.blocks.includes("callback"));
    d = toggleBlock(d, "live-transfer");
    assert.ok(d.blocks.includes("live-transfer") && !d.blocks.includes("callback"));
  });

  it("drops blocks that do not belong to the topic", () => {
    const d = setTopic(helpline(), "survey");
    assert.ok(!d.blocks.includes("qualify") && !d.blocks.includes("explain"));
    assert.ok(BLOCKS.every((b) => !b.topics || Array.isArray(b.topics)));
  });
});

describe("composer: starting points", () => {
  it("reads one sentence into blocks, including a risky one", () => {
    const d = fromSentence("Citizens call, and we check their pension eligibility live against our database, in Hindi and Tamil.");
    assert.ok(d.blocks.includes("in-call") && d.blocks.includes("lookup"));
    assert.deepEqual(d.languages.sort(), ["Hindi", "Tamil"]);
    assert.equal(judge(d)!.ev.outcome, "outside-scope");
  });

  it("reads the brief's feedback sentence as an outbound survey", () => {
    const d = fromSentence("We want to call citizens after they visit a government office and collect feedback about their experience in Tamil and English.");
    assert.equal(d.topic, "survey");
    assert.ok(d.blocks.includes("out-call") && d.blocks.includes("survey-q"));
    assert.ok(!d.blocks.includes("in-call"));
  });

  it("every starter composes without error", () => {
    for (const s of STARTERS) assert.ok(judge(fromStarter(s)) !== null || s.blocks.length === 0, s.id);
  });

  it("builds a readable script in call order, using the department name", () => {
    const d = { ...helpline(), department: "Water Board" };
    const s = scriptFor(d);
    assert.ok(s[0].says.includes("Water Board"));
    assert.ok(s.findIndex((x) => x.block === "hear-need") < s.findIndex((x) => x.block === "explain"));
  });

  it("maps to engine answers without inventing any readiness", () => {
    const a = designToAnswers(helpline());
    assert.ok(a.unknown.scriptStatus && a.unknown.dataSensitivity);
    assert.equal(BLOCK_BY_ID["lookup"].risky, true);
  });
});
