import test from "node:test";
import assert from "node:assert/strict";
import { OFFER_TILES, PRICES, NOT_COVERED, STILL_OPEN, SCALE, LENGTH, emptyProfile, firstOpenQuestion, canvasFromProfile, planFor, type Profile } from "../pitch";
import { PLATINUM, DOCUMENTED_LANGUAGES } from "../source";

const full = (over: Partial<Profile> = {}): Profile => ({ ...emptyProfile(), template: "scheme", scale: "thousands", length: "medium", budget: 150000, budgetAsked: true, department: "Water Board", ...over });

test("offer tiles quote the package document numbers, not their own", () => {
  const text = OFFER_TILES.map((t) => `${t.title} ${t.line}`).join(" ");
  assert.match(text, new RegExp(`${DOCUMENTED_LANGUAGES.length} languages`));
  assert.match(text, new RegExp(`${PLATINUM.limits.maxConcurrentCalls.value} calls at once`));
  assert.match(text, /under 1\.5 seconds/);
  assert.match(text, /99\.8% uptime as stated/);
  assert.match(text, /2 working days/);
  assert.match(text, /24-hour support/);
  assert.match(text, /10 text files of up to 5 MB/);
});

test("the latency figure is a target, never a guarantee", () => {
  const text = OFFER_TILES.map((t) => t.line).join(" ").toLowerCase();
  assert.ok(text.includes("target"));
  assert.ok(!text.includes("guarantee"));
});

test("prices are exactly the three documented ones", () => {
  assert.deepEqual(PRICES.map((p) => p.amount), ["₹50,000", "₹500", "₹0.50"]);
});

test("the pitch says out loud what is not covered and what is still open", () => {
  assert.ok(NOT_COVERED.some((x) => /department's own systems/i.test(x)));
  assert.ok(NOT_COVERED.some((x) => /WhatsApp/i.test(x)));
  assert.equal(STILL_OPEN.length, 3);
});

test("questions are asked in order and the first open one is found", () => {
  let p = emptyProfile();
  assert.equal(firstOpenQuestion(p), 0);
  p = { ...p, template: "grievance" };
  assert.equal(firstOpenQuestion(p), 1);
  p = { ...p, scale: "hundreds" };
  assert.equal(firstOpenQuestion(p), 2);
  p = { ...p, length: "short" };
  assert.equal(firstOpenQuestion(p), 3);
  p = { ...p, budgetAsked: true };
  assert.equal(firstOpenQuestion(p), 4);
});

test("answers become planning figures on the canvas", () => {
  const c = canvasFromProfile(full());
  assert.equal(c.template, "scheme");
  assert.equal(c.callsPerMonth, 5000);
  assert.equal(c.avgMinutes, 2.5);
  assert.equal(c.budget, 150000);
  assert.equal(c.department, "Water Board");
  assert.equal(c.voiceModel, "open");
});

test("not sure leaves volume and length open instead of guessing", () => {
  const c = canvasFromProfile(full({ scale: "unsure", length: "unsure" }));
  assert.equal(c.callsPerMonth, null);
  assert.equal(c.avgMinutes, null);
  assert.equal(SCALE.find((s) => s.id === "unsure")!.calls, null);
  assert.equal(LENGTH.find((l) => l.id === "unsure")!.minutes, null);
});

test("long calls add the not-recommended module and the plan warns about it", () => {
  const plan = planFor(full({ length: "long" }));
  assert.ok(plan.canvas.modules.includes("tk-long"));
  assert.ok(plan.beware.some((b) => /does not recommend/i.test(b)));
});

test("a grievance plan states it is not a documented use case and never claims suitable", () => {
  const plan = planFor(full({ template: "grievance" }));
  assert.ok(plan.beware[0].toLowerCase().includes("not one of the two documented"));
  assert.notEqual(plan.verdict!.ev.outcome, "suitable");
});

test("every plan lists the open items and names the department when given", () => {
  const plan = planFor(full());
  assert.ok(plan.beware.some((b) => /where call data is stored/i.test(b)));
  assert.ok(plan.title.includes("Water Board"));
  assert.equal(planFor(full({ department: "" })).title.includes(" for "), false);
});

test("the cost headline is the same figure the builder will show", () => {
  const plan = planFor(full({ budget: 200000 }));
  assert.equal(plan.cost.grand, 50000 + 500 + 5000 * 2.5 * 3 * 0.5);
  assert.match(plan.headline[0].value, /₹/);
  assert.equal(plan.headline[1].value, "Within");
});

test("budget over the plan is reported as over, not hidden", () => {
  const plan = planFor(full({ budget: 60000 }));
  assert.equal(plan.headline[1].value, "Over");
});

test("outbound plans ask for the phone list, inbound ones do not", () => {
  assert.ok(planFor(full({ template: "survey" })).brings.some((b) => /phone numbers/i.test(b)));
  assert.ok(!planFor(full({ template: "scheme" })).brings.some((b) => /phone numbers/i.test(b)));
});
