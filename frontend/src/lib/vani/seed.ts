import { hashPassword, randomHex } from "./auth";
import { RATES_AS_OF_DEFAULT } from "./catalog";
import { emptyDb } from "./db";
import { applyUseCase, defaultHosting, emptyRequirements } from "./defaults";
import { applyRecommendation, newPackageRecord } from "./packages";
import { recommend } from "./recommend";
import type { Db, Role, User } from "./types";

/**
 * Demo accounts for the prototype. They exist only in this browser's storage.
 * The shared password is recorded in VANI_ANUVAAD.md, not shown in the app.
 */
export const DEMO_PASSWORD = "Vani-demo-2026!";
export const DEMO_ORG = "Directorate of Citizen Services (sample)";
export const DEMO_ACCOUNTS: { name: string; email: string; role: Role }[] = [
  { name: "Asha Verma", email: "asha.verma@sample.example", role: "admin" },
  { name: "Rohan Iyer", email: "rohan.iyer@sample.example", role: "product_manager" },
  { name: "Meera Nair", email: "meera.nair@sample.example", role: "operations" },
  { name: "Karan Bose", email: "karan.bose@sample.example", role: "reviewer" },
  { name: "Divya Rao", email: "divya.rao@sample.example", role: "viewer" },
];

export async function buildSeed(): Promise<Db> {
  const db = emptyDb();
  const now = new Date().toISOString();
  db.orgs.push({ id: "org-sample", name: DEMO_ORG, environment: "Sandbox", createdAt: now });
  for (const [i, a] of DEMO_ACCOUNTS.entries()) {
    const salt = randomHex(8);
    const u: User = { id: `u-${i + 1}`, orgId: "org-sample", name: a.name, email: a.email, role: a.role, verified: true, hash: await hashPassword(DEMO_PASSWORD, salt), salt, createdAt: now, lastSignIn: null, status: "active" };
    db.users.push(u);
  }
  // A sample package, part-way through, so the product is not empty on first sign-in.
  const owner = DEMO_ACCOUNTS[1].name;
  let p = newPackageRecord("org-sample", owner, "Citizen Support Helpline", now);
  p.id = "pk-sample";
  p.requirements = {
    ...applyUseCase(emptyRequirements(), "status"),
    serviceName: "Citizen Support Helpline", languages: ["hi", "en"], channel: "pstn", complexity: "transactional",
    callsPerMonth: 50000, avgMinutes: 3, peakConcurrent: 40, growthPct: 20, priority: "balanced", latency: "1-2", monthlyBudget: 90000, costPerMinute: null,
  };
  p.hosting = { ...defaultHosting() };
  p.reached = ["requirements", "hosting", "recommendation", "configure"];
  p.step = "recommendation";
  const result = recommend(p.requirements, p.hosting, p.reached);
  p = applyRecommendation(p, result, owner, now);
  db.packages.push(p);
  db.audit.push({ id: "a-1", orgId: "org-sample", at: now, by: owner, action: "Created package", target: p.name, detail: "Sample data for the prototype" });
  db.notices.push({ id: "n-1", orgId: "org-sample", at: now, title: "Welcome to Vani Anuvaad", body: "This is a prototype with sample data. Rates and benchmarks are illustrative.", read: false });
  db.ratesAsOf = RATES_AS_OF_DEFAULT;
  return db;
}
