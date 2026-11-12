import test from "node:test";
import assert from "node:assert/strict";
import {
  MODULES, MODULE_BY_ID, TEMPLATES, LANES, newCanvas, applyTemplate, toggleModule, costFor, judgeCanvas, recommendForBudget,
  modelCategory, periodMinutes, volumeTable, unpricedFor, stagesFor, handoverFiles, scriptLines, RATES, VERIFY_ITEMS, addCustom, removeCustom,
  type Canvas,
  breakdownParts, monthlySeries,
} from "../canvas";

const withCosts = (c: ReturnType<typeof newCanvas>) => ({ c, cost: costFor(c), v: judgeCanvas(c) });

test("catalogue: every module sits in a known lane and has a cost line", () => {
  const lanes = new Set(LANES.map((l) => l.id));
  for (const m of MODULES) {
    assert.ok(lanes.has(m.lane), m.id);
    assert.ok(m.cost.length > 0, m.id);
  }
  assert.equal(new Set(MODULES.map((m) => m.id)).size, MODULES.length, "ids are unique");
});

test("templates only name modules that exist", () => {
  for (const t of TEMPLATES) for (const id of t.modules) assert.ok(MODULE_BY_ID[id], `${t.id}: ${id}`);
});

test("rates are exactly the documented ones", () => {
  assert.equal(RATES.setup, 50000);
  assert.equal(RATES.perNumber, 500);
  assert.equal(RATES.perMinuteOpen, 0.5);
});

test("budget too small for setup is reported as short, with the exact gap", () => {
  const c = { ...newCanvas("scheme"), budget: 30000, voiceModel: "open" as const, llmModel: "open" as const };
  const { cost } = withCosts(c);
  assert.equal(cost.fit.state, "short");
  assert.equal(cost.fit.headroom, 30000 - 50000 - 500);
});

test("open-source budget buys exactly headroom / 0.50 minutes", () => {
  const c = { ...newCanvas("scheme"), budget: 100000, months: 4, avgMinutes: 2, voiceModel: "open" as const, llmModel: "open" as const };
  const { cost } = withCosts(c);
  assert.equal(cost.fit.headroom, 100000 - 50000 - 500);
  assert.equal(cost.fit.affordableMinutes, 99000);
  assert.equal(cost.fit.affordableMinutesPerMonth, 24750);
  assert.equal(cost.fit.affordableCallsPerMonth, 12375);
  assert.equal(cost.fit.state, "fits");
});

test("planned volume above the headroom is short, not silently fine", () => {
  const c = { ...newCanvas("scheme"), budget: 60000, months: 1, callsPerMonth: 50000, avgMinutes: 2, voiceModel: "open" as const, llmModel: "open" as const };
  const { cost } = withCosts(c);
  assert.equal(periodMinutes(c), 100000);
  assert.equal(cost.fit.state, "short");
  assert.match(cost.fit.note, /planned volume/i);
});

test("proprietary models: usage is not priced and the budget cannot say what it buys", () => {
  const c = { ...newCanvas("scheme"), budget: 200000, voiceModel: "proprietary" as const, llmModel: "open" as const };
  const { cost } = withCosts(c);
  assert.equal(modelCategory(c), "proprietary");
  assert.equal(cost.fit.state, "open");
  assert.equal(cost.fit.affordableMinutes, null);
  assert.ok(cost.unpriced.some((u) => u.id === "proprietary-usage"));
  assert.equal(cost.grandIsComplete, false);
});

test("undecided models never assume the open-source rate", () => {
  const c = { ...newCanvas("scheme"), budget: 200000 };
  assert.equal(modelCategory(c), "unknown");
  assert.equal(costFor(c).fit.affordableMinutes, null);
});

test("no budget gives no verdict on money", () => {
  assert.equal(costFor(newCanvas("scheme")).fit.state, "none");
});

test("modules the package does not price are listed and never given a price", () => {
  let c = newCanvas("grievance");
  c = toggleModule(c, "cn-register");
  c = toggleModule(c, "ch-own");
  const u = unpricedFor(c);
  assert.ok(u.find((x) => x.id === "cn-register" && x.kind === "outside"));
  assert.ok(u.find((x) => x.id === "ch-own" && x.kind === "quote"));
  assert.ok(u.every((x) => x.figure === null));
  const cost = costFor({ ...c, voiceModel: "open", llmModel: "open", callsPerMonth: 100, avgMinutes: 2 });
  assert.equal(cost.core.knownTotal, 50000 + 500 + 100 * 2 * 3 * 0.5);
  assert.equal(cost.yourFigures, 0);
  assert.equal(cost.grandIsComplete, false);
});

test("the person's own figures are kept apart and added only as theirs", () => {
  let c: Canvas = { ...newCanvas("grievance"), voiceModel: "open", llmModel: "open", callsPerMonth: 100, avgMinutes: 2 };
  c = toggleModule(c, "cn-register");
  c = { ...c, figures: { "cn-register": 150000 } };
  const cost = costFor(c);
  assert.equal(cost.yourFigures, 150000);
  assert.equal(cost.grand, cost.core.knownTotal! + 150000);
  assert.equal(cost.grandIsComplete, true);
});

test("custom additions are unpriced and removable", () => {
  let c = newCanvas("custom");
  c = addCustom(c, "connect", "Ward-office SMS", "send an SMS");
  assert.equal(c.custom.length, 1);
  assert.ok(unpricedFor(c).some((u) => u.kind === "custom"));
  c = removeCustom(c, c.custom[0].id);
  assert.equal(c.custom.length, 0);
  assert.equal(addCustom(c, "connect", "   ", "").custom.length, 0);
});

test("scheme template is judged against a documented use case", () => {
  const v = judgeCanvas(newCanvas("scheme"))!;
  assert.equal(v.ev.useCase, "scheme-discovery");
  assert.notEqual(v.ev.outcome, "outside-scope");
});

test("survey template is a documented use case", () => {
  assert.equal(judgeCanvas(newCanvas("survey"))!.ev.useCase, "survey-feedback");
});

test("grievance is not documented: it never comes back as simply suitable", () => {
  const v = judgeCanvas(newCanvas("grievance"))!;
  assert.notEqual(v.ev.outcome, "suitable");
});

test("adding a system link to the grievance build is flagged as needing integration", () => {
  let c = newCanvas("grievance");
  c = toggleModule(c, "cn-register");
  const v = judgeCanvas(c)!;
  assert.equal(v.ev.integrationNeeded, true);
});

test("callback, office pointer and live transfer exclude each other", () => {
  let c = newCanvas("scheme");
  c = toggleModule(c, "sf-redirect");
  assert.ok(c.modules.includes("sf-redirect") && !c.modules.includes("sf-callback"));
  c = toggleModule(c, "sf-transfer");
  assert.ok(c.modules.includes("sf-transfer") && !c.modules.includes("sf-redirect"));
});

test("removing the inbound number removes the number charge; adding it brings back one", () => {
  let c = newCanvas("scheme");
  assert.equal(c.numbers, 1);
  c = toggleModule(c, "ch-in");
  assert.equal(c.numbers, 0);
  c = toggleModule(c, "ch-in");
  assert.equal(c.numbers, 1);
});

test("changing template keeps budget and volume but resets the modules", () => {
  let c: Canvas = { ...newCanvas("scheme"), budget: 90000, callsPerMonth: 400, department: "Water Board" };
  c = toggleModule(c, "rn-bigcamp");
  const d = applyTemplate(c, "survey");
  assert.equal(d.budget, 90000);
  assert.equal(d.callsPerMonth, 400);
  assert.equal(d.department, "Water Board");
  assert.ok(!d.modules.includes("rn-bigcamp"));
  assert.ok(d.modules.includes("ch-out"));
});

test("recommendForBudget picks open-source models and one number for an inbound line", () => {
  const r = recommendForBudget(newCanvas("scheme"), 120000);
  assert.equal(r.voiceModel, "open");
  assert.equal(r.llmModel, "open");
  assert.equal(r.numbers, 1);
  assert.equal(r.budget, 120000);
});

test("volume table is exact arithmetic", () => {
  const c = { ...newCanvas("scheme"), budget: 60000 };
  const rows = volumeTable(c, [1000, 20000]);
  assert.equal(rows[0].total, 50000 + 500 + 500);
  assert.equal(rows[0].withinBudget, true);
  assert.equal(rows[1].total, 50000 + 500 + 10000);
  assert.equal(rows[1].withinBudget, false);
});

test("deployment stages are derived from real state and never marked done by default", () => {
  const c = newCanvas("scheme");
  const cost = costFor(c);
  const stages = stagesFor({ canvas: c, verdict: judgeCanvas(c), cost, verify: {}, signedOff: false, handedOver: false });
  assert.equal(stages.length, 7);
  assert.ok(stages.every((s) => s.state !== "done" || s.id === "design"));
  assert.notEqual(stages.find((s) => s.id === "launch")!.state, "done");
  assert.match(stages.find((s) => s.id === "setup")!.documented ?? "", /2 working days/);
});

test("launch opens only when every check is ticked", () => {
  const c = { ...newCanvas("scheme"), department: "Water Board" };
  const verify = Object.fromEntries(VERIFY_ITEMS.map((x) => [x.id, true]));
  const s = stagesFor({ canvas: c, verdict: judgeCanvas(c), cost: costFor(c), verify, signedOff: true, handedOver: true });
  assert.equal(s.find((x) => x.id === "verify")!.state, "done");
  assert.equal(s.find((x) => x.id === "launch")!.state, "now");
  const partial = stagesFor({ canvas: c, verdict: judgeCanvas(c), cost: costFor(c), verify: { langs: true }, signedOff: true, handedOver: true });
  assert.equal(partial.find((x) => x.id === "launch")!.state, "waiting");
});

test("handover pack has the four files and states the cost caveats", () => {
  const c = { ...newCanvas("scheme"), department: "Water Board", voiceModel: "open" as const, llmModel: "open" as const, budget: 100000 };
  const files = handoverFiles(c, costFor(c), judgeCanvas(c));
  assert.deepEqual(files.map((f) => f.name), ["README.md", "agent-config.json", "script-draft.txt", "department-brings.csv"]);
  const readme = files[0].content;
  assert.match(readme, /No tax, number rental/);
  assert.match(readme, /Not an order|planning assumption/i);
  JSON.parse(files[1].content);
});

test("script uses the department name and only modules on the canvas", () => {
  const c = { ...newCanvas("scheme"), department: "Water Board" };
  const lines = scriptLines(c);
  assert.ok(lines[0].says.includes("Water Board"));
  assert.ok(lines.every((l) => c.modules.includes(l.moduleId)));
});

test("grievance intake without a system link is judged as another use case; with a link it is registration", () => {
  const intake = judgeCanvas(newCanvas("grievance"))!;
  assert.equal(intake.ev.useCase, "other");
  assert.equal(intake.ev.integrationNeeded, false);
  assert.equal(intake.ev.outcome, "needs-review");
  const linked = judgeCanvas(toggleModule(newCanvas("grievance"), "cn-register"))!;
  assert.equal(linked.ev.useCase, "grievance");
  assert.equal(linked.ev.outcome, "outside-scope");
});

test("breakdown parts add up to the known total and leave out unknowns", () => {
  const c: Canvas = { ...newCanvas("scheme"), voiceModel: "open", llmModel: "open", callsPerMonth: 1000, avgMinutes: 2, months: 3, numbers: 2 };
  const b = breakdownParts(c, costFor(c));
  assert.deepEqual(b.parts.map((p) => p.id), ["setup", "numbers", "calls"]);
  assert.equal(b.total, 50000 + 1000 + 3000);
  assert.equal(b.total, costFor(c).core.knownTotal);
  assert.equal(b.callsUnknown, false);
  const open = breakdownParts({ ...c, callsPerMonth: null }, costFor({ ...c, callsPerMonth: null }));
  assert.equal(open.callsUnknown, true);
  assert.ok(!open.parts.some((p) => p.id === "calls"));
});

test("monthly series starts at the one-time charges and adds exactly the monthly call cost", () => {
  const c: Canvas = { ...newCanvas("scheme"), voiceModel: "open", llmModel: "open", callsPerMonth: 10000, avgMinutes: 2, months: 4, budget: 80000 };
  const m = monthlySeries(c, costFor(c))!;
  assert.equal(m.points.length, 5);
  assert.equal(m.points[0].cumulative, 50500);
  assert.equal(m.points[1].cumulative, 60500);
  assert.equal(m.points[4].cumulative, 90500);
  assert.equal(m.points[3].cumulative, 80500);
  assert.equal(m.runsOutMonth, 3);
  assert.equal(monthlySeries({ ...c, voiceModel: "proprietary" }, costFor({ ...c, voiceModel: "proprietary" })), null);
  assert.equal(monthlySeries({ ...c, callsPerMonth: null }, costFor({ ...c, callsPerMonth: null })), null);
});
