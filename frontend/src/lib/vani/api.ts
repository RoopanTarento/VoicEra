import { hashPassword, isEmail, passwordOk, randomHex } from "./auth";
import { DB_KEY, TOKEN_KEY, loadDb, mutate, resetDb, saveDb, setSeeder } from "./db";
import { can, denial, roleLabel, type Permission } from "./rbac";
import { buildSeed } from "./seed";
import { storage } from "./storage";
import { applyRecommendation, chooseEvaluation, costOf, duplicateRecord, hasUnsavedConfig, isStale, newPackageRecord, nextLabel, restoreVersion as restoreV, snapshotOf } from "./packages";
import { policyChecks, unresolvedChecks } from "./policy";
import { evaluateAll, recommend, type RecommendationResult, type Variant } from "./recommend";
import type { Agent, AuditEntry, Db, Hosting, Notice, OpenItemRecord, Org, PackageRecord, Role, Selection, Session, Simulation, StepId, Usage, User } from "./types";

setSeeder(buildSeed);

export type ErrorCode = "network" | "unauthorized" | "session_expired" | "forbidden" | "not_found" | "validation" | "duplicate" | "locked" | "unverified" | "invalid_credentials" | "recommendation_unavailable" | "pricing_unavailable" | "pdf_failed" | "locked_quote" | "blocked" | "stale";

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public field?: string) { super(message); this.name = "ApiError"; }
}

const cfg = { latency: 380, jitter: 220 };
export const configureApi = (c: Partial<typeof cfg>) => Object.assign(cfg, c);
const wait = () => (cfg.latency <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, cfg.latency + Math.random() * cfg.jitter)));
const nowIso = () => new Date().toISOString();
const uid = (p: string) => `${p}-${randomHex(4)}`;

const SESSION_HOURS = 8;
const REMEMBER_DAYS = 30;
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60_000;

/** Simulated outages skip the sign-in screens, so the prototype can never lock you out of its own switch. */
async function gate(opts: { exempt?: boolean } = {}) {
  await wait();
  if (!opts.exempt) {
    const db = await loadDb();
    if (db.simulation.network) throw new ApiError("network", "We couldn't reach the server. Check your connection and try again.");
  }
}

export interface Ctx { db: Db; user: User; org: Org; session: Session }

function tokenNow(): string | null { return storage.tab.get(TOKEN_KEY) ?? storage.persistent.get(TOKEN_KEY); }
function clearToken() { storage.tab.remove(TOKEN_KEY); storage.persistent.remove(TOKEN_KEY); }

async function ctx(): Promise<Ctx> {
  const db = await loadDb();
  const token = tokenNow();
  if (!token) throw new ApiError("unauthorized", "Sign in to continue.");
  const session = db.sessions.find((s) => s.token === token);
  if (!session) { clearToken(); throw new ApiError("unauthorized", "Sign in to continue."); }
  // The expired session stays on record until the next sign-in, so every request that races to find it gets the same answer.
  if (new Date(session.expiresAt).getTime() < Date.now()) throw new ApiError("session_expired", "Your session ended. Sign in again to continue. Your work is saved.");
  const user = db.users.find((u) => u.id === session.userId);
  const org = db.orgs.find((o) => o.id === user?.orgId);
  if (!user || !org) { clearToken(); throw new ApiError("unauthorized", "Sign in to continue."); }
  return { db, user, org, session };
}

function need(c: Ctx, p: Permission) {
  if (!can(c.user.role, p)) throw new ApiError("forbidden", denial(c.user.role, p));
}

function log(db: Db, c: { user: User; org: Org }, action: string, target: string, detail?: string) {
  const e: AuditEntry = { id: uid("a"), orgId: c.org.id, at: nowIso(), by: c.user.name, action, target, detail };
  db.audit.unshift(e);
  db.audit = db.audit.slice(0, 500);
}
function notify(db: Db, orgId: string, title: string, body: string, href?: string) {
  const n: Notice = { id: uid("n"), orgId, at: nowIso(), title, body, href, read: false };
  db.notices.unshift(n);
}

function pkgOf(c: Ctx, id: string): PackageRecord {
  const p = c.db.packages.find((x) => x.id === id && x.orgId === c.org.id);
  if (!p) throw new ApiError("not_found", "We couldn't find that package. It may have been archived or deleted.");
  return p;
}
const store = (c: Ctx, p: PackageRecord) => { c.db.packages = c.db.packages.map((x) => (x.id === p.id ? p : x)); saveDb(c.db); return p; };
const locked = (p: PackageRecord) => !!p.quote && p.quote.state !== "draft";
function editable(c: Ctx, p: PackageRecord) {
  need(c, "edit");
  if (locked(p)) throw new ApiError("locked_quote", `This package is ${p.quote?.state === "approved" ? "approved" : "waiting for approval"}. Reopen the quote as a draft to change it.`);
}

/* ------------------------------------------------------------------ auth */

export const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, verified: u.verified });
export type PublicUser = ReturnType<typeof publicUser>;

export async function signUp(input: { name: string; email: string; password: string; confirm: string; org: string; terms: boolean }) {
  await gate({ exempt: true });
  const name = input.name.trim(), email = input.email.trim().toLowerCase(), org = input.org.trim();
  if (name.length < 2) throw new ApiError("validation", "Enter your full name.", "name");
  if (!isEmail(email)) throw new ApiError("validation", "Enter a valid work email, like name@department.gov.in.", "email");
  if (!passwordOk(input.password)) throw new ApiError("validation", "Choose a stronger password: at least 10 characters with upper and lower case, a number or a symbol.", "password");
  if (input.password !== input.confirm) throw new ApiError("validation", "The two passwords don't match.", "confirm");
  if (org.length < 2) throw new ApiError("validation", "Enter your organisation's name.", "org");
  if (!input.terms) throw new ApiError("validation", "Accept the terms to create an account.", "terms");
  return mutate(async (db) => {
    if (db.users.some((u) => u.email === email)) throw new ApiError("duplicate", "An account with this email already exists. Sign in instead, or reset your password.", "email");
    let o = db.orgs.find((x) => x.name.toLowerCase() === org.toLowerCase());
    const joined = !!o;
    if (!o) { o = { id: uid("org"), name: org, environment: "Sandbox", createdAt: nowIso() }; db.orgs.push(o); }
    const salt = randomHex(8);
    const user: User = { id: uid("u"), orgId: o.id, name, email, role: joined ? "viewer" : "admin", verified: false, hash: await hashPassword(input.password, salt), salt, createdAt: nowIso(), lastSignIn: null, status: "active" };
    db.users.push(user);
    const token = randomHex(12);
    db.tokens.push({ token, kind: "verify", userId: user.id, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(), used: false });
    log(db, { user, org: o }, "Created account", user.email);
    return { email, token, joinedExisting: joined, role: user.role };
  });
}

export async function verifyEmail(token: string) {
  await gate({ exempt: true });
  return mutate((db) => {
    const t = db.tokens.find((x) => x.token === token && x.kind === "verify");
    const owner = t ? db.users.find((x) => x.id === t.userId) : undefined;
    if (t?.used && owner?.verified) return { email: owner.email };
    if (!t || t.used || new Date(t.expiresAt).getTime() < Date.now()) throw new ApiError("validation", "This verification link has expired or was already used. Ask for a new one.");
    const u = owner;
    if (!u) throw new ApiError("not_found", "We couldn't find that account.");
    t.used = true; u.verified = true;
    return { email: u.email };
  });
}

export async function resendVerification(email: string) {
  await gate({ exempt: true });
  return mutate((db) => {
    const u = db.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u || u.verified) return { token: null as string | null };
    const token = randomHex(12);
    db.tokens.push({ token, kind: "verify", userId: u.id, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(), used: false });
    return { token };
  });
}

export async function signIn(input: { email: string; password: string; remember: boolean }) {
  await gate({ exempt: true });
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) throw new ApiError("validation", "Enter a valid email address.", "email");
  if (!input.password) throw new ApiError("validation", "Enter your password.", "password");
  return mutate(async (db) => {
    const att = db.attempts[email];
    if (att && att.until > Date.now()) throw new ApiError("locked", `Too many attempts. Try again in ${Math.ceil((att.until - Date.now()) / 60000)} minute(s), or reset your password.`);
    const u = db.users.find((x) => x.email === email);
    const ok = u ? (await hashPassword(input.password, u.salt)) === u.hash : false;
    if (!u || !ok) {
      const count = (att && !(att.until && att.until <= Date.now()) ? att.count : 0) + 1;
      db.attempts[email] = { count, until: count >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 };
      saveDb(db);
      throw new ApiError("invalid_credentials", count >= LOCK_AFTER ? "Too many attempts. This account is locked for 5 minutes." : "That email and password don't match. Check both and try again.");
    }
    delete db.attempts[email];
    if (!u.verified) throw new ApiError("unverified", "Verify your email before signing in. Check your inbox for the link.");
    const org = db.orgs.find((o) => o.id === u.orgId) as Org;
    const hours = input.remember ? REMEMBER_DAYS * 24 : SESSION_HOURS;
    const session: Session = { token: randomHex(16), userId: u.id, createdAt: nowIso(), expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(), remember: input.remember };
    db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
    db.sessions.push(session);
    u.lastSignIn = nowIso();
    clearToken();
    (input.remember ? storage.persistent : storage.tab).set(TOKEN_KEY, session.token);
    log(db, { user: u, org }, "Signed in", u.email);
    return { user: publicUser(u), org };
  });
}

export async function signOut() {
  const token = tokenNow();
  clearToken();
  if (!token) return;
  await mutate((db) => { db.sessions = db.sessions.filter((s) => s.token !== token); });
}

export async function getSession() {
  await wait();
  const c = await ctx();
  return { user: publicUser(c.user), org: c.org, expiresAt: c.session.expiresAt, remember: c.session.remember, environment: c.org.environment };
}

export async function requestReset(email: string) {
  await gate({ exempt: true });
  if (!isEmail(email)) throw new ApiError("validation", "Enter a valid email address.", "email");
  return mutate((db) => {
    const u = db.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u) return { sent: true, token: null as string | null };
    const token = randomHex(12);
    db.tokens.push({ token, kind: "reset", userId: u.id, expiresAt: new Date(Date.now() + 3600_000).toISOString(), used: false });
    return { sent: true, token };
  });
}

export async function resetPassword(token: string, password: string, confirm: string) {
  await gate({ exempt: true });
  if (!passwordOk(password)) throw new ApiError("validation", "Choose a stronger password: at least 10 characters with upper and lower case, a number or a symbol.", "password");
  if (password !== confirm) throw new ApiError("validation", "The two passwords don't match.", "confirm");
  return mutate(async (db) => {
    const t = db.tokens.find((x) => x.token === token && x.kind === "reset");
    if (!t || t.used || new Date(t.expiresAt).getTime() < Date.now()) throw new ApiError("validation", "This reset link has expired or was already used. Request a new one.");
    const u = db.users.find((x) => x.id === t.userId);
    if (!u) throw new ApiError("not_found", "We couldn't find that account.");
    u.salt = randomHex(8); u.hash = await hashPassword(password, u.salt);
    t.used = true; delete db.attempts[u.email];
    db.sessions = db.sessions.filter((s) => s.userId !== u.id);
    return { email: u.email };
  });
}

export async function listPeople() {
  await gate();
  const c = await ctx();
  return c.db.users.filter((u) => u.orgId === c.org.id).map(publicUser);
}
export async function setRole(userId: string, role: Role) {
  await gate();
  const c = await ctx();
  need(c, "users");
  const u = c.db.users.find((x) => x.id === userId && x.orgId === c.org.id);
  if (!u) throw new ApiError("not_found", "We couldn't find that person.");
  if (u.id === c.user.id && role !== "admin" && c.db.users.filter((x) => x.orgId === c.org.id && x.role === "admin").length === 1) throw new ApiError("blocked", "You are the only admin. Make someone else an admin first.");
  log(c.db, c, "Changed role", u.name, `${roleLabel(u.role)} to ${roleLabel(role)}`);
  u.role = role; saveDb(c.db);
}

/* ------------------------------------------------------------------ packages */

export async function listPackages() {
  await gate();
  const c = await ctx();
  return c.db.packages.filter((p) => p.orgId === c.org.id && !p.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function listArchived() {
  await gate();
  const c = await ctx();
  return c.db.packages.filter((p) => p.orgId === c.org.id && p.archived);
}
export async function getPackage(id: string) {
  await gate();
  const c = await ctx();
  return { pkg: pkgOf(c, id), role: c.user.role, user: c.user.name, ratesAsOf: c.db.ratesAsOf, simulation: c.db.simulation };
}

export async function createPackage(name: string) {
  await gate();
  const c = await ctx();
  need(c, "create");
  const n = name.trim();
  if (n.length < 3) throw new ApiError("validation", "Give the package a name of at least 3 characters.", "name");
  if (c.db.packages.some((p) => p.orgId === c.org.id && !p.archived && p.name.toLowerCase() === n.toLowerCase())) throw new ApiError("duplicate", "A package with this name already exists. Pick another name, or open the existing one.", "name");
  const p = newPackageRecord(c.org.id, c.user.name, n, nowIso());
  c.db.packages.push(p);
  log(c.db, c, "Created package", p.name);
  saveDb(c.db);
  return p;
}

export type Patch = Partial<Pick<PackageRecord, "requirements" | "hosting" | "step" | "reached" | "name">>;
/** Save any change to the working draft. Never loses data: it is called on every step and on Save draft. */
export async function savePackage(id: string, patch: Patch, opts: { silent?: boolean } = {}) {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  editable(c, p);
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (n.length < 3) throw new ApiError("validation", "Give the package a name of at least 3 characters.", "name");
    if (c.db.packages.some((x) => x.id !== p.id && x.orgId === c.org.id && !x.archived && x.name.toLowerCase() === n.toLowerCase())) throw new ApiError("duplicate", "A package with this name already exists.", "name");
    patch = { ...patch, name: n };
  }
  const next: PackageRecord = { ...p, ...patch, updatedAt: nowIso(), updatedBy: c.user.name };
  if (patch.requirements && patch.requirements.serviceName !== undefined && patch.name === undefined && patch.requirements.serviceName.trim().length >= 3 && patch.requirements.serviceName !== p.requirements.serviceName) {
    const n = patch.requirements.serviceName.trim();
    if (!c.db.packages.some((x) => x.id !== p.id && x.orgId === c.org.id && !x.archived && x.name.toLowerCase() === n.toLowerCase())) next.name = n;
  }
  if (!opts.silent) log(c.db, c, "Saved draft", next.name);
  return store(c, next);
}

export async function duplicatePackage(id: string) {
  await gate();
  const c = await ctx();
  need(c, "create");
  const src = pkgOf(c, id);
  const p = duplicateRecord(src, c.user.name, nowIso(), c.db.packages.filter((x) => x.orgId === c.org.id).map((x) => x.name));
  c.db.packages.push(p);
  log(c.db, c, "Duplicated package", src.name, `as ${p.name}`);
  saveDb(c.db);
  return p;
}
export async function archivePackage(id: string, archived: boolean) {
  await gate();
  const c = await ctx();
  need(c, "archive");
  const p = pkgOf(c, id);
  log(c.db, c, archived ? "Archived package" : "Restored package", p.name);
  return store(c, { ...p, archived, updatedAt: nowIso(), updatedBy: c.user.name });
}

/** Run the recommendation. Pure engine; this layer adds the availability check and records the result. */
export async function runRecommendation(id: string): Promise<{ pkg: PackageRecord; result: RecommendationResult }> {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  editable(c, p);
  if (c.db.simulation.recommendationDown) throw new ApiError("recommendation_unavailable", "The recommendation service isn't responding. Your answers are saved. Try again in a moment.");
  const reached: StepId[] = p.reached.includes("recommendation") ? p.reached : [...p.reached, "recommendation"];
  const result = recommend(p.requirements, p.hosting, reached, undefined, c.db.simulation.unavailableProviders);
  let next = { ...p, reached };
  if (result.recommended) next = applyRecommendation(next, result, c.user.name, nowIso());
  if (result.recommended && !p.selection) log(c.db, c, "Generated recommendation", p.name, result.recommended.eval.pkg.name);
  return { pkg: store(c, next), result };
}

export async function chooseVariant(id: string, variant: Variant): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  editable(c, p);
  const result = recommend(p.requirements, p.hosting, p.reached, undefined, c.db.simulation.unavailableProviders);
  const target = variant === "recommended" ? result.recommended?.eval : result.alternatives.find((a) => a.variant === variant)?.eval;
  if (!target) throw new ApiError("not_found", "That option is no longer available. Refresh the recommendation.");
  const next = chooseEvaluation(p, target, variant, c.user.name, nowIso());
  log(c.db, c, "Selected package", p.name, target.pkg.name);
  return store(c, next);
}

export async function saveConfiguration(id: string, selection: Selection, usage: Usage): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  editable(c, p);
  if (c.db.simulation.pricingDown) throw new ApiError("pricing_unavailable", "Pricing isn't available right now, so this change can't be priced. Nothing was lost. Try again shortly.");
  if (usage.callsPerMonth < 0 || usage.avgMinutes <= 0 || usage.peakConcurrency < 0) throw new ApiError("validation", "Usage numbers must be positive.");
  const reached: StepId[] = p.reached.includes("configure") ? p.reached : [...p.reached, "configure"];
  return store(c, { ...p, reached, selection, usage, updatedAt: nowIso(), updatedBy: c.user.name });
}

export async function saveVersion(id: string, note: string): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  editable(c, p);
  if (!p.selection || !p.usage) throw new ApiError("validation", "Choose a package before saving a version.");
  const label = nextLabel(p.versions);
  const next = { ...p, versions: [...p.versions, snapshotOf(p, label, note.trim() || "Saved snapshot", c.user.name, nowIso())], updatedAt: nowIso(), updatedBy: c.user.name };
  log(c.db, c, "Saved version", p.name, label);
  return store(c, next);
}
export async function restoreVersion(id: string, versionId: string): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  editable(c, p);
  const v = p.versions.find((x) => x.id === versionId);
  if (!v) throw new ApiError("not_found", "That version no longer exists.");
  const next = restoreV(p, v, c.user.name, nowIso());
  log(c.db, c, "Restored version", p.name, v.label);
  return store(c, next);
}

export async function decideCheck(id: string, checkId: string, decision: { state: OpenItemRecord["state"]; note?: string; hosting?: Partial<Hosting> }): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  editable(c, p);
  need(c, "resolve");
  if (decision.state === "accepted" && !(decision.note ?? "").trim()) throw new ApiError("validation", "Write a short reason. It goes in the audit log.", "note");
  const hosting = decision.hosting ? { ...p.hosting, ...decision.hosting } : p.hosting;
  const rec: OpenItemRecord = { state: decision.state, note: decision.note?.trim(), by: c.user.name, at: nowIso() };
  const next = { ...p, hosting, openItems: { ...p.openItems, [checkId]: rec }, updatedAt: nowIso(), updatedBy: c.user.name };
  log(c.db, c, decision.state === "accepted" ? "Accepted open item" : "Resolved open item", p.name, `${checkId}${rec.note ? `: ${rec.note}` : ""}`);
  return store(c, next);
}

/* ------------------------------------------------------------------ quote and approval */

export const QUOTE_VALID_DAYS = 30;

export async function ensureQuote(id: string): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  const p = pkgOf(c, id);
  if (!p.selection || !p.usage) throw new ApiError("validation", "Choose a package before opening the quote.");
  const reached: StepId[] = p.reached.includes("quote") ? p.reached : [...p.reached, "quote"];
  if (p.quote) return store(c, { ...p, reached });
  need(c, "edit");
  const next: PackageRecord = { ...p, reached };
  if (p.versions.length === 0 || hasUnsavedConfig(p)) next.versions = [...p.versions, snapshotOf(p, nextLabel(p.versions), "Saved for the quote", c.user.name, nowIso())];
  c.db.counters.quote += 1;
  const created = nowIso();
  next.quote = { id: `Q-${String(c.db.counters.quote).padStart(4, "0")}`, createdAt: created, validUntil: new Date(Date.now() + QUOTE_VALID_DAYS * 86400_000).toISOString(), state: "draft", versionLabel: next.versions[next.versions.length - 1].label, events: [{ action: "created", by: c.user.name, at: created }] };
  log(c.db, c, "Created quote", p.name, next.quote.id);
  return store(c, next);
}

export interface Blockers { reasons: string[] }
export function submitBlockers(p: PackageRecord): string[] {
  const out: string[] = [];
  if (!p.selection || !p.usage) return ["No package selected."];
  const cost = costOf(p);
  if (cost?.overBudget) out.push(`Launch blocked: ${Math.round((cost.budgetUsedPct ?? 0))}% of the budget ceiling. Lower the cost or raise the ceiling.`);
  if (isStale(p)) out.push("Your requirements changed since the recommendation. Refresh it first.");
  const open = unresolvedChecks(policyChecks(p.requirements, p.hosting, p.selection, p.openItems));
  if (open.length) out.push(`${open.length} open item${open.length === 1 ? "" : "s"} still need${open.length === 1 ? "s" : ""} a decision.`);
  return out;
}

export async function submitQuote(id: string, note?: string): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  need(c, "submit");
  const p = pkgOf(c, id);
  if (!p.quote) throw new ApiError("validation", "Open the quote first.");
  if (p.quote.state !== "draft") throw new ApiError("locked_quote", "This quote has already been submitted.");
  const reasons = submitBlockers(p);
  if (reasons.length) throw new ApiError("blocked", reasons[0]);
  const stale = c.db.simulation.stalePricing;
  if (stale) throw new ApiError("stale", "Prices were updated since this quote was built. Review the new totals, then submit again.");
  const at = nowIso();
  const quote = { ...p.quote, state: "submitted" as const, events: [...p.quote.events, { action: "submitted" as const, by: c.user.name, at, note }] };
  notify(c.db, c.org.id, "Quote waiting for approval", `${p.name} (${quote.id}) was submitted by ${c.user.name}.`, `/vani/app/packages/${p.id}/quote`);
  log(c.db, c, "Submitted quote", p.name, quote.id);
  return store(c, { ...p, quote, updatedAt: at, updatedBy: c.user.name });
}

export async function decideQuote(id: string, action: "approved" | "returned", note?: string): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  need(c, action === "approved" ? "approve" : "return");
  const p = pkgOf(c, id);
  if (!p.quote || p.quote.state !== "submitted") throw new ApiError("validation", "This quote isn't waiting for approval.");
  if (action === "returned" && !(note ?? "").trim()) throw new ApiError("validation", "Say what needs to change.", "note");
  const at = nowIso();
  const quote = { ...p.quote, state: action === "approved" ? ("approved" as const) : ("draft" as const), events: [...p.quote.events, { action, by: c.user.name, at, note }] };
  notify(c.db, c.org.id, action === "approved" ? "Quote approved" : "Quote returned", `${p.name} (${quote.id}) was ${action} by ${c.user.name}.`, `/vani/app/packages/${p.id}/quote`);
  log(c.db, c, action === "approved" ? "Approved quote" : "Returned quote", p.name, quote.id + (note ? `: ${note}` : ""));
  return store(c, { ...p, quote, updatedAt: at });
}

export async function reopenQuote(id: string): Promise<PackageRecord> {
  await gate();
  const c = await ctx();
  need(c, "edit");
  const p = pkgOf(c, id);
  if (!p.quote || p.quote.state === "draft") return p;
  const at = nowIso();
  const quote = { ...p.quote, state: "draft" as const, events: [...p.quote.events, { action: "withdrawn" as const, by: c.user.name, at, note: "Reopened for changes" }] };
  log(c.db, c, "Reopened quote", p.name, quote.id);
  return store(c, { ...p, quote, updatedAt: at, updatedBy: c.user.name });
}

export async function exportAllowed(id: string, kind: "pdf" | "csv") {
  await gate();
  const c = await ctx();
  need(c, "export");
  const p = pkgOf(c, id);
  if (kind === "pdf" && c.db.simulation.pdfFails) throw new ApiError("pdf_failed", "We couldn't create the PDF. Try again, or download the CSV instead.");
  log(c.db, c, kind === "pdf" ? "Downloaded PDF" : "Downloaded CSV", p.name, p.quote?.id);
  saveDb(c.db);
}

/* ------------------------------------------------------------------ agents */

export const AGENT_STEPS = ["Connect telephony number", "Load knowledge and scripts", "Run test calls", "Review caller notice with legal", "Go-live review"];

export async function setupAgent(id: string): Promise<Agent> {
  await gate();
  const c = await ctx();
  need(c, "agent");
  const p = pkgOf(c, id);
  if (p.quote?.state !== "approved") throw new ApiError("blocked", "Set up an agent after the quote is approved.");
  const existing = c.db.agents.find((a) => a.packageId === p.id && a.orgId === c.org.id);
  if (existing) return existing;
  const a: Agent = { id: uid("ag"), orgId: c.org.id, packageId: p.id, quoteId: p.quote.id, name: `${p.name} agent`, versionLabel: p.quote.versionLabel, createdAt: nowIso(), createdBy: c.user.name, status: "setup", checklist: Object.fromEntries(AGENT_STEPS.map((s) => [s, false])) };
  c.db.agents.push(a);
  log(c.db, c, "Set up agent", a.name, p.quote.id);
  saveDb(c.db);
  return a;
}
export async function listAgents() { await gate(); const c = await ctx(); return c.db.agents.filter((a) => a.orgId === c.org.id); }
export async function updateAgent(id: string, step: string, done: boolean) {
  await gate();
  const c = await ctx();
  need(c, "agent");
  const a = c.db.agents.find((x) => x.id === id && x.orgId === c.org.id);
  if (!a) throw new ApiError("not_found", "We couldn't find that agent.");
  a.checklist[step] = done;
  const n = Object.values(a.checklist).filter(Boolean).length;
  a.status = n === 0 ? "setup" : n === AGENT_STEPS.length ? "live" : "testing";
  saveDb(c.db);
  return a;
}

/* ------------------------------------------------------------------ audit, notices, simulation */

export async function listAudit() { await gate(); const c = await ctx(); need(c, "audit"); return c.db.audit.filter((a) => a.orgId === c.org.id); }
export async function listNotices() { await gate(); const c = await ctx(); return c.db.notices.filter((n) => n.orgId === c.org.id); }
export async function markNoticesRead() { const c = await ctx(); c.db.notices.forEach((n) => { if (n.orgId === c.org.id) n.read = true; }); saveDb(c.db); }

export async function getSimulation() { await wait(); const db = await loadDb(); return db.simulation; }
export async function setSimulation(patch: Partial<Simulation>) {
  await gate({ exempt: true });
  const c = await ctx();
  need(c, "simulate");
  c.db.simulation = { ...c.db.simulation, ...patch };
  saveDb(c.db);
  return c.db.simulation;
}
/** Bring prices up to date after a rate change. Anyone who can edit may do this. */
export async function refreshPrices() {
  await gate();
  const c = await ctx();
  need(c, "edit");
  c.db.simulation = { ...c.db.simulation, stalePricing: false };
  c.db.ratesAsOf = nowIso().slice(0, 10);
  log(c.db, c, "Refreshed prices", c.org.name);
  saveDb(c.db);
  return { ratesAsOf: c.db.ratesAsOf };
}
export async function expireMySession() {
  const c = await ctx();
  c.session.expiresAt = new Date(Date.now() - 1000).toISOString();
  saveDb(c.db);
}
export async function resetDemo() { await resetDb(); }

/** Peek at a pending email token. Stands in for the inbox, since no real email is sent. */
export async function demoInbox(email: string) {
  const db = await loadDb();
  const u = db.users.find((x) => x.email === email.trim().toLowerCase());
  if (!u) return [];
  return db.tokens.filter((t) => t.userId === u.id && !t.used && new Date(t.expiresAt).getTime() > Date.now()).map((t) => ({ kind: t.kind, token: t.token }));
}

export { DB_KEY, evaluateAll };
