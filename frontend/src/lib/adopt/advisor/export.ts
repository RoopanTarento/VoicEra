import { visibleQuestions, describeAnswer } from "./answers";
import { buildChecklist, buildExplanation, buildMeasures, buildPlan, FAQ } from "./bundle";
import { calculateCost, inr, type CostInput } from "./cost";
import { OUTCOME_LABEL, type EvalContext } from "./evaluate";
import { evaluate } from "./evaluate";
import { PLATINUM, SOURCES } from "./source";
import type { Answers } from "./types";

/** Plain-text exports. Generated in the browser. Nothing is uploaded. */

export function exportRecommendation(a: Answers, cost: CostInput, department?: string): string | null {
  const ctx: EvalContext = { cost: { category: cost.category, minutes: cost.minutes } };
  const ev = evaluate(a, ctx);
  if (!ev) return null;
  const checklist = buildChecklist(a, ev);
  const plan = buildPlan(a, ev, checklist);
  const ex = buildExplanation(a, ev, checklist);
  const c = calculateCost(cost);
  const L: string[] = [];
  const h = (t: string) => L.push("", `## ${t}`);
  L.push(`# ${PLATINUM.name}: recommendation${department ? ` for ${department}` : ""}`);
  L.push("", `Status: ${OUTCOME_LABEL[ev.outcome]}${ev.pendingGovernance ? " (Pending security and data-governance confirmation)" : ""}`);
  L.push("", ex.summary);
  L.push("", "Generated in the browser from your answers, using fixed rules. No AI service was used and nothing was sent anywhere. This is not an approval.");

  h("Requirement to package mapping");
  L.push("| Requirement | Your answer | Result | Why |", "|---|---|---|---|");
  for (const d of ev.dimensions) L.push(`| ${d.label} | ${d.answer.replace(/\|/g, "/")} | ${d.result} | ${d.consequence.replace(/\|/g, "/")} |`);

  h("Limitations and things to resolve");
  if (!ev.findings.length) L.push("None found against the documented package.");
  for (const f of ev.findings) L.push(`- [${f.severity}] ${f.title}: ${f.detail}`);

  h("What the department needs to provide");
  for (const i of checklist) L.push(`- [${i.status}] ${i.label}: ${i.detail}`);

  h("What the package provides");
  for (const g of PLATINUM.included) {
    L.push(`### ${g.group}`);
    for (const i of g.items) L.push(`- ${i.label}`);
  }

  h("Implementation plan");
  for (const s of plan) L.push(`${s.n}. ${s.title} (${s.owner}, ${s.status}${s.slaPrerequisite ? ", input the setup SLA waits for" : ""}): ${s.detail}`);
  L.push("", `The ${PLATINUM.limits.setupSlaWorkingDays.value}-working-day SLA applies to voice-agent setup after all requirements are provided. It is not a promise for the whole project.`);

  h("Cost estimate (documented rates only)");
  for (const line of c.lines) L.push(`- ${line.label}: ${inr(line.amount)} (${line.basis})`);
  L.push(`- ${c.totalLabel}: ${inr(c.knownTotal)}`);
  if (c.unresolvedNote) L.push(`- Note: ${c.unresolvedNote}`);
  for (const t of c.assumptions) L.push(`- Assumption: ${t}`);

  h("Success measures");
  for (const m of buildMeasures(a)) L.push(`- ${m.label}${m.documented ? "" : " (proposed, needs confirming)"}: ${m.note}`);

  h("What needs confirmation");
  for (const t of ex.needsConfirmation) L.push(`- ${t}`);

  h("Your answers");
  for (const q of visibleQuestions(a)) {
    const t = describeAnswer(q, a);
    if (t !== "Not answered") L.push(`- ${q.label} ${t}`);
  }

  h("Open items in the package document");
  for (const u of PLATINUM.unresolved) L.push(`- ${u.label} (${SOURCES[u.src].label})`);
  h("FAQ answers we can give");
  for (const f of FAQ) L.push(`- ${f.q} ${f.a ?? "This needs confirmation from the responsible VoicEra/Bhashini team before the department can make a decision."}`);
  return L.join("\n");
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportChecklistCsv(a: Answers, cost: CostInput): string | null {
  const ev = evaluate(a, { cost: { category: cost.category, minutes: cost.minutes } });
  if (!ev) return null;
  const rows = buildChecklist(a, ev);
  const out = [["Item", "Status", "Detail", "Listed in package document as brought by the department", "Source"].map(csvCell).join(",")];
  for (const r of rows) out.push([r.label, r.status, r.detail, r.documentedAsBrought ? "Yes" : "No", SOURCES[r.source].label].map(csvCell).join(","));
  return out.join("\n");
}

/** A short message the person could send. It is only prepared locally. */
export function exportRequestSummary(a: Answers, cost: CostInput, department?: string): string | null {
  const ev = evaluate(a, { cost: { category: cost.category, minutes: cost.minutes } });
  if (!ev) return null;
  const checklist = buildChecklist(a, ev);
  const lines = [
    `Subject: Implementation discussion: ${PLATINUM.name}${department ? `, ${department}` : ""}`,
    "",
    `We used the package advisor and the result was: ${OUTCOME_LABEL[ev.outcome]}${ev.pendingGovernance ? ", pending security and data-governance confirmation" : ""}.`,
    "",
    "Items we need confirmed:",
    ...ev.findings.map((f) => `- ${f.title}: ${f.detail}`),
    "",
    "What we still have to provide:",
    ...checklist.filter((c) => c.status === "missing" || c.status === "review").map((c) => `- ${c.label}`),
    "",
    "This summary was prepared in the advisor. It has not been sent.",
  ];
  return lines.join("\n");
}
