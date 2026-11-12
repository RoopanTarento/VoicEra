import test from "node:test";
import assert from "node:assert/strict";
import { applyUseCase, completeness, defaultHosting, emptyRequirements, requirementsIssues, usageFrom } from "../defaults";
import { priceOf } from "../pricing";
import { evaluateAll, inputHash, recommend } from "../recommend";
import { policyChecks, unresolvedChecks } from "../policy";
import { can, denial } from "../rbac";
import { PACKAGES } from "../catalog";
import type { Requirements } from "../types";

const sample = (over: Partial<Requirements> = {}): Requirements => ({
  ...applyUseCase(emptyRequirements(), "status"),
  serviceName: "Citizen Support Helpline", languages: ["hi", "en"], callsPerMonth: 50000, avgMinutes: 3, peakConcurrent: 40, growthPct: 20, latency: "1-2", monthlyBudget: 90000, ...over,
});
const ALL = ["requirements", "hosting", "recommendation"] as const;

test("recommendation is deterministic and stays inside the rules", () => {
  const r = sample(), h = defaultHosting();
  const a = recommend(r, h, [...ALL]), b = recommend(r, h, [...ALL]);
  assert.equal(a.status, "ok");
  assert.equal(a.recommended?.eval.pkg.id, b.recommended?.eval.pkg.id);
  assert.ok((a.recommended?.eval.fit ?? 0) > 0 && (a.recommended?.eval.fit ?? 101) <= 100);
  assert.ok((a.recommended?.confidence ?? 0) <= (a.recommended?.eval.fit ?? 0));
});

test("alternatives are distinct from each other and from the recommendation", () => {
  const res = recommend(sample(), defaultHosting(), [...ALL]);
  const ids = [res.recommended!.eval.pkg.id, ...res.alternatives.map((a) => a.eval.pkg.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(res.alternatives.map((a) => a.variant), ["cost", "quality", "latency"]);
});

test("in-country rule excludes packages that run abroad, with a reason", () => {
  const set = evaluateAll(sample(), defaultHosting());
  const global = set.excluded.find((e) => e.pkg.id === "pkg-global");
  assert.ok(global);
  assert.ok(global!.excluded.some((x) => x.includes("India")));
  assert.ok(set.candidates.every((c) => c.excluded.length === 0));
});

test("an unsupported language excludes everything and says what to change", () => {
  const res = recommend(sample({ languages: ["hi", "xx"] }), defaultHosting(), [...ALL]);
  assert.equal(res.status, "none");
  assert.ok(res.suggestions.length > 0);
});

test("a peak above tested capacity excludes the package", () => {
  const set = evaluateAll(sample({ peakConcurrent: 280 }), defaultHosting());
  const eco = set.all.find((e) => e.pkg.id === "pkg-economy")!;
  assert.ok(eco.excluded.some((x) => x.startsWith("Tested up to")));
});

test("unavailable providers are excluded", () => {
  const first = PACKAGES[0];
  const set = evaluateAll(sample(), defaultHosting(), undefined, [first.selection.asr]);
  assert.ok(set.all.find((e) => e.pkg.id === first.id)!.excluded.some((x) => x.includes("unavailable")));
});

test("when every candidate is over budget the closest one is reported", () => {
  const res = recommend(sample({ monthlyBudget: 20000 }), defaultHosting(), [...ALL]);
  assert.ok(res.budgetNotice);
  assert.ok(res.budgetNotice!.overByPct > 0);
});

test("a changed requirement changes the input hash; a policy answer does not", () => {
  const r = sample(), h = defaultHosting();
  assert.notEqual(inputHash(r, h), inputHash(sample({ languages: ["hi"] }), h));
  assert.equal(inputHash(r, h), inputHash(r, { ...h, callerNotice: "Hello", support: "extended" }));
});

test("pricing: lines add up, budget meter and per-minute are consistent", () => {
  const r = sample(), h = defaultHosting();
  const rec = recommend(r, h, [...ALL]).recommended!.eval;
  const cost = priceOf(rec.selection, rec.usage, h, r);
  assert.equal(cost.lines.reduce((t, l) => t + (l.monthly ?? 0), 0), cost.recurring);
  assert.equal(cost.minutes, 150000);
  assert.ok(Math.abs(cost.perMinute - cost.recurring / 150000) < 1e-9);
  assert.equal(cost.overBudget, cost.recurring > 90000);
  assert.ok(cost.recurringAt12! > cost.recurring);
});

test("doubling calls does not double the fixed hosting cost", () => {
  const r = sample(), h = defaultHosting();
  const rec = recommend(r, h, [...ALL]).recommended!.eval;
  const a = priceOf(rec.selection, rec.usage, h, r);
  const b = priceOf(rec.selection, { ...rec.usage, callsPerMonth: rec.usage.callsPerMonth * 2 }, h, r);
  assert.equal(a.lines.find((l) => l.id === "hosting")!.monthly, b.lines.find((l) => l.id === "hosting")!.monthly);
  assert.ok(b.recurring > a.recurring && b.recurring < a.recurring * 2);
});

test("usage scales with call length", () => {
  const short = usageFrom(sample({ avgMinutes: 3 })), long = usageFrom(sample({ avgMinutes: 6 }));
  assert.ok(long.llmTokensPerCall > short.llmTokensPerCall);
});

test("completeness counts later groups only after the hosting step is reached", () => {
  const r = sample(), h = defaultHosting();
  const early = completeness(r, h, ["requirements"]);
  const later = completeness(r, h, ["requirements", "hosting"]);
  assert.ok(later.done >= early.done);
  assert.equal(early.total, later.total);
});

test("validation explains each problem in plain words", () => {
  const issues = requirementsIssues(sample({ callsPerMonth: 0, peakConcurrent: 99999999 }));
  assert.ok(issues.length >= 1);
  assert.ok(issues.every((i) => i.message.length > 5));
});

test("policy: missing notice and support model are open; accepting needs a decision record", () => {
  const r = sample(), h = defaultHosting();
  const sel = recommend(r, h, [...ALL]).recommended!.eval.selection;
  const checks = policyChecks(r, h, sel, {});
  assert.equal(checks.find((c) => c.id === "caller-notice")!.status, "open");
  assert.equal(checks.find((c) => c.id === "support-model")!.status, "open");
  const fixed = policyChecks(r, { ...h, callerNotice: "Notice", support: "extended", retentionConfirmedBy: "Asha" }, sel, {});
  assert.equal(fixed.find((c) => c.id === "caller-notice")!.status, "pass");
  const accepted = policyChecks(r, h, sel, { "caller-notice": { state: "accepted", note: "x" } });
  assert.equal(accepted.find((c) => c.id === "caller-notice")!.effective, "accepted");
  assert.ok(unresolvedChecks(checks).length > unresolvedChecks(accepted).length);
});

test("policy: 99.9% availability needs disaster recovery", () => {
  const r = sample(), h = { ...defaultHosting(), availability: 99.9 };
  const sel = recommend(r, h, [...ALL]).recommended!.eval.selection;
  assert.equal(policyChecks(r, h, sel).find((c) => c.id === "disaster-recovery")!.status, "open");
  assert.equal(policyChecks(r, { ...h, disasterRecovery: true }, sel).find((c) => c.id === "disaster-recovery")!.status, "pass");
});

test("roles: viewer reads only; reviewer approves but cannot edit; denial says who can", () => {
  assert.ok(can("viewer", "view") && !can("viewer", "edit") && !can("viewer", "export"));
  assert.ok(can("reviewer", "approve") && !can("reviewer", "edit") && !can("reviewer", "submit"));
  assert.ok(can("product_manager", "submit") && !can("product_manager", "approve"));
  assert.ok(can("operations", "agent") && !can("operations", "create"));
  assert.ok(can("admin", "users") && !can("product_manager", "users"));
  assert.match(denial("viewer", "edit"), /The viewer role can't edit packages\. Ask product manager, operations or an admin\./);
});
