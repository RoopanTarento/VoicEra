import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as api from "../api";
import { dropCache, resetDb } from "../db";
import { useMemoryStorage } from "../storage";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../seed";
import { buildQuote, quoteCsv } from "../quote";
import { diffConfig, hasUnsavedConfig, isStale } from "../packages";
import { passwordStrength } from "../auth";

const acct = (role: string) => DEMO_ACCOUNTS.find((a) => a.role === role)!;
const login = (role: string, remember = false) => api.signIn({ email: acct(role).email, password: DEMO_PASSWORD, remember });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as api.ApiError).code; } };

beforeEach(async () => { useMemoryStorage(); dropCache(); api.configureApi({ latency: 0, jitter: 0 }); await resetDb(); });

test("sign up: validates, rejects duplicates, requires verification, then signs in", async () => {
  const base = { name: "Priya Shah", email: "priya@dept.gov.in", password: "Strong-pass-77", confirm: "Strong-pass-77", org: "Dept of Test", terms: true };
  assert.equal(await code(api.signUp({ ...base, email: "nope" })), "validation");
  assert.equal(await code(api.signUp({ ...base, password: "short", confirm: "short" })), "validation");
  assert.equal(await code(api.signUp({ ...base, confirm: "different-pass-1" })), "validation");
  assert.equal(await code(api.signUp({ ...base, terms: false })), "validation");
  const ok = await api.signUp(base);
  assert.equal(ok.role, "admin");
  assert.equal(await code(api.signUp(base)), "duplicate");
  assert.equal(await code(api.signIn({ email: base.email, password: base.password, remember: false })), "unverified");
  await api.verifyEmail(ok.token);
  assert.equal(await code(api.verifyEmail(ok.token)), "ok", "opening the link twice is harmless");
  assert.equal(await code(api.verifyEmail("bogus-token")), "validation");
  await api.signIn({ email: base.email, password: base.password, remember: false });
  assert.equal((await api.getSession()).user.email, base.email);
  assert.equal((await api.listPackages()).length, 0);
});

test("sign in: wrong password, lockout after five, protected calls without a session", async () => {
  assert.equal(await code(api.listPackages()), "unauthorized");
  for (let i = 0; i < 4; i++) assert.equal(await code(api.signIn({ email: acct("admin").email, password: "wrong-wrong-1", remember: false })), "invalid_credentials");
  assert.equal(await code(api.signIn({ email: acct("admin").email, password: "wrong-wrong-1", remember: false })), "invalid_credentials");
  assert.equal(await code(login("admin")), "locked");
});

test("sessions expire and sign-out ends them", async () => {
  await login("admin");
  await api.expireMySession();
  assert.equal(await code(api.getSession()), "session_expired");
  assert.equal(await code(api.listPackages()), "session_expired", "every request sees the same answer");
  await login("admin");
  await api.signOut();
  assert.equal(await code(api.getSession()), "unauthorized");
});

test("password reset: unknown email gives no hint, token works once, old sessions end", async () => {
  assert.equal((await api.requestReset("ghost@nowhere.example")).token, null);
  const r = await api.requestReset(acct("viewer").email);
  assert.equal(await code(api.resetPassword(r.token!, "weak", "weak")), "validation");
  await api.resetPassword(r.token!, "Brand-new-pass-9", "Brand-new-pass-9");
  assert.equal(await code(api.resetPassword(r.token!, "Brand-new-pass-9", "Brand-new-pass-9")), "validation");
  assert.equal(await code(login("viewer")), "invalid_credentials");
  await api.signIn({ email: acct("viewer").email, password: "Brand-new-pass-9", remember: false });
});

test("password strength meter", () => {
  assert.equal(passwordStrength("abc").score <= 1, true);
  assert.equal(passwordStrength("Correct-horse-9").score >= 3, true);
});

test("role checks are enforced on the server side", async () => {
  await login("viewer");
  assert.equal(await code(api.createPackage("Should not work")), "forbidden");
  const [p] = await api.listPackages();
  assert.equal(await code(api.savePackage(p.id, { step: "hosting" })), "forbidden");
  assert.equal(await code(api.listAudit()), "forbidden");
  await api.signOut(); await login("reviewer");
  assert.equal(await code(api.createPackage("Should not work")), "forbidden");
  assert.equal(await code(api.setSimulation({ network: true })), "forbidden");
});

test("create package: duplicate names rejected, data saved between calls", async () => {
  await login("product_manager");
  const p = await api.createPackage("Pension helpline");
  assert.equal(await code(api.createPackage("pension HELPLINE")), "duplicate");
  await api.savePackage(p.id, { requirements: { ...p.requirements, languages: ["hi"] }, step: "hosting", reached: ["requirements", "hosting"] });
  const again = (await api.getPackage(p.id)).pkg;
  assert.deepEqual(again.requirements.languages, ["hi"]);
  assert.equal(again.step, "hosting");
});

test("full journey: recommend, choose alternative, version, undo, quote, approval gates, agent", async () => {
  await login("product_manager");
  const id = "pk-sample";
  const { pkg, result } = await api.runRecommendation(id);
  assert.equal(result.status, "ok");
  assert.equal(pkg.versions.length, 1);
  const alt = await api.chooseVariant(id, "cost");
  assert.equal(alt.versions.length, 2);
  assert.notEqual(alt.recommendation!.baseId, pkg.recommendation!.baseId);
  const changed = await api.saveConfiguration(id, { ...alt.selection!, llm: "llm-gemma27" }, alt.usage!);
  assert.ok(hasUnsavedConfig(changed));
  assert.ok(diffConfig(alt.versions[1], { selection: changed.selection!, usage: changed.usage! }).some((d) => d.layer === "Language model"));
  const restored = await api.restoreVersion(id, alt.versions[1].id);
  assert.equal(restored.selection!.llm, alt.selection!.llm);

  const q = await api.ensureQuote(id);
  assert.match(q.quote!.id, /^Q-\d{4}$/);
  assert.equal(q.quote!.state, "draft");
  const blockers = api.submitBlockers(q);
  assert.ok(blockers.length > 0, "open items block submission");
  assert.equal(await code(api.submitQuote(id)), "blocked");
  assert.equal(await code(api.decideCheck(id, "caller-notice", { state: "accepted", note: "" })), "validation");
  let cur = q;
  for (const c of ["caller-notice", "support-model", "retention"]) {
    cur = await api.decideCheck(id, c, { state: "accepted", note: "Reviewed with legal" });
  }
  cur = await api.decideCheck(id, "caller-notice", { state: "resolved", hosting: { callerNotice: "This call is handled by an assistant." } });
  const left = api.submitBlockers(cur);
  assert.ok(!left.some((x) => x.includes("open item")), left.join("; "));
  const submitted = await api.submitQuote(id, "Please review");
  assert.equal(submitted.quote!.state, "submitted");
  assert.equal(await code(api.savePackage(id, { step: "quote" })), "locked_quote");
  assert.equal(await code(api.decideQuote(id, "approved")), "forbidden");
  await api.signOut(); await login("reviewer");
  assert.equal(await code(api.decideQuote(id, "returned", "")), "validation");
  const approved = await api.decideQuote(id, "approved", "Looks right");
  assert.equal(approved.quote!.state, "approved");
  assert.equal(await code(api.setupAgent(id)), "forbidden");
  await api.signOut(); await login("operations");
  const agent = await api.setupAgent(id);
  assert.equal(agent.quoteId, approved.quote!.id);
  assert.equal((await api.setupAgent(id)).id, agent.id);
  const done = await api.updateAgent(agent.id, "Run test calls", true);
  assert.equal(done.status, "testing");
  const doc = buildQuote(approved, { name: "Org" })!;
  assert.equal(doc.state, "approved");
  assert.ok(doc.cost.rows.length === 7);
  const csv = quoteCsv(doc);
  assert.ok(csv.includes(approved.quote!.id) && csv.split("\r\n").length > 30);
  await api.signOut(); await login("admin");
  const audit = await api.listAudit();
  assert.ok(audit.some((a) => a.action === "Approved quote") && audit.some((a) => a.action === "Accepted open item"));
});

test("budget over the ceiling blocks submission with a plain message", async () => {
  await login("product_manager");
  const id = "pk-sample";
  const p = (await api.getPackage(id)).pkg;
  await api.runRecommendation(id);
  await api.savePackage(id, { requirements: { ...p.requirements, monthlyBudget: 10000 } });
  const fresh = (await api.getPackage(id)).pkg;
  assert.ok(isStale(fresh));
  const q = await api.ensureQuote(id);
  assert.ok(api.submitBlockers(q).some((x) => x.startsWith("Launch blocked")));
});

test("prototype failure switches: network, recommendation, pricing, pdf, stale prices", async () => {
  await login("admin");
  const id = "pk-sample";
  await api.setSimulation({ recommendationDown: true });
  assert.equal(await code(api.runRecommendation(id)), "recommendation_unavailable");
  await api.setSimulation({ recommendationDown: false, pricingDown: true });
  const p = (await api.getPackage(id)).pkg;
  assert.equal(await code(api.saveConfiguration(id, p.selection!, p.usage!)), "pricing_unavailable");
  await api.setSimulation({ pricingDown: false, pdfFails: true });
  assert.equal(await code(api.exportAllowed(id, "pdf")), "pdf_failed");
  assert.equal(await code(api.exportAllowed(id, "csv")), "ok");
  await api.setSimulation({ pdfFails: false, network: true });
  assert.equal(await code(api.listPackages()), "network");
  await api.setSimulation({ network: false });
  assert.equal(await code(api.listPackages()), "ok");
});

test("duplicate and archive", async () => {
  await login("product_manager");
  const copy = await api.duplicatePackage("pk-sample");
  assert.notEqual(copy.id, "pk-sample");
  assert.equal(copy.quote, null);
  await api.archivePackage(copy.id, true);
  assert.equal((await api.listPackages()).some((x) => x.id === copy.id), false);
  assert.equal((await api.listArchived()).some((x) => x.id === copy.id), true);
});

test("data is separated between organisations", async () => {
  const base = { name: "Other Person", email: "other@elsewhere.gov.in", password: "Strong-pass-77", confirm: "Strong-pass-77", org: "Elsewhere Dept", terms: true };
  const s = await api.signUp(base); await api.verifyEmail(s.token);
  await api.signIn({ email: base.email, password: base.password, remember: true });
  assert.equal((await api.listPackages()).length, 0);
  assert.equal(await code(api.getPackage("pk-sample")), "not_found");
});
