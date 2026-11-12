import { LIMITS, OPTION_BY_ID, LAYERS, PACKAGE_CARDS, PACKAGE_NAME, USE_CASE_BY_ID, type Depth } from "./catalog";
import { capsOf, classify, notesFor, type Selection } from "./canvas";
import { inr, rate, type Cost, type PriceBook } from "./pricing";
import { pitchToMarkdown, type Pitch } from "./pitch";
import type { Profile, Recommendation } from "./profile";

/**
 * What happens after a package is chosen: who does what, in what order, and what to download.
 * Only two timings are documented for the packaged offer (set-up in 2 working days once everything
 * is handed over, and 24-hour troubleshooting). Everything else is described as depending on your approvals.
 */

export type Who = "you" | "voicera" | "it" | "both";

export interface Stage {
  id: string;
  title: string;
  who: Who;
  plain: string;
  /** What the documents say about its timing, or why it depends on you. */
  timing: string;
  /** True when the timing is a documented figure. */
  documented: boolean;
  deliverable: string;
}

export const WHO_LABEL: Record<Who, string> = { you: "You", voicera: "VoicERA team", it: "Your IT team", both: "You and VoicERA" };

export function stagesFor(sel: Selection): Stage[] {
  const cls = classify(sel);
  const needs: Depth = cls.needs;
  const out: Stage[] = [];
  out.push({ id: "scope", title: "Confirm the scope", who: "both", plain: "Agree the package, what is on the canvas, and the cost.", timing: "Your call", documented: false, deliverable: "An agreed canvas and cost sheet" });
  out.push({ id: "bring", title: "Hand over what you bring", who: "you", plain: `Approved content, the script flow and a named approver${sel.outbound ? ", and a phone list with permission to call" : ""}.`, timing: "Depends on your approvals", documented: false, deliverable: sel.outbound ? "Content, script, approver, phone list" : "Content, script, approver" });
  if (needs !== "deploy") {
    out.push({ id: "connect", title: "Prepare the connection", who: "it", plain: "Share API documentation, a test environment and credentials. Your IT team reviews the security of the connection.", timing: "Depends on your IT approvals", documented: false, deliverable: "A test endpoint and an approved integration" });
  }
  if (needs === "orchestrate") {
    out.push({ id: "rules", title: "Agree the workflow rules", who: "both", plain: "Grievance categories, routing, service levels, escalation owners, and the staff who take handoffs, with their hours.", timing: "Depends on your operations team", documented: false, deliverable: "A routing matrix and escalation plan" });
  }
  if (sel.channel === "ch-own") {
    out.push({ id: "tel", title: "Connect your own telephony", who: "both", plain: "VoicERA connects your provider and numbers.", timing: `${LIMITS.ownTelephonyWeeks[0]} to ${LIMITS.ownTelephonyWeeks[1]} weeks, case by case`, documented: true, deliverable: "Your numbers live on the platform" });
  }
  if (sel.host !== "host-bhashini") {
    out.push({ id: "env", title: "Prepare the environment", who: "both", plain: `${OPTION_BY_ID[sel.host]?.name ?? "Your environment"} is listed in the ICP but not described in the package document.`, timing: "To be confirmed with the VoicERA team", documented: false, deliverable: "A confirmed environment plan" });
  }
  out.push({ id: "setup", title: "VoicERA sets up your agent", who: "voicera", plain: "The team builds the agent and campaign from what you handed over.", timing: needs === "deploy" ? `${LIMITS.setupDays} working days once all requirements are provided (documented)` : "Depends on the integration scope", documented: needs === "deploy", deliverable: "A working agent in a test setting" });
  out.push({ id: "test", title: "Test before launch", who: "you", plain: "Make real test calls in your languages. Check it answers from your content, says so when it does not know, and sends emergencies to 112.", timing: "Your testers, your pace", documented: false, deliverable: "A signed-off test round" });
  out.push({ id: "launch", title: "Launch", who: "both", plain: needs === "orchestrate" ? "Go live in stages, agreed with your operations team." : "Open the number or start the campaign.", timing: `Campaign set-up and monitoring support, up to ${LIMITS.campaignsPerMonth} a month (documented)`, documented: true, deliverable: "Live service" });
  out.push({ id: "run", title: "Run and improve", who: "both", plain: "Watch the dashboard, read the analysis, and tune the script and content.", timing: `Analysis within ${LIMITS.analysisDays} working days of a campaign, ${LIMITS.troubleshootHours}-hour troubleshooting (documented)`, documented: true, deliverable: "A dashboard and regular analysis" });
  return out;
}

export interface BringItem {
  id: string;
  label: string;
  detail: string;
}

export function bringList(sel: Selection, p: Profile): BringItem[] {
  const needs = classify(sel).needs;
  const items: BringItem[] = [
    { id: "content", label: "Approved content", detail: "Scheme details, FAQs or survey questions, as text files." },
    { id: "script", label: "A script flow and a named approver", detail: "Someone who signs off what the agent may say." },
    { id: "testers", label: "People to test calls", detail: "They test after set-up and before launch." },
  ];
  if (sel.outbound) items.push({ id: "phones", label: "A phone list, with permission to call", detail: "Permission is yours to confirm. VoicERA cannot do it for you." });
  if (sel.channel === "ch-own") items.push({ id: "provider", label: "Your telephony provider's details", detail: "Who bills the line and which technology it uses." });
  if (needs !== "deploy") items.push({ id: "api", label: "API documentation, a test environment and credentials", detail: "Handled by your IT team. Never use real citizen records for testing." }, { id: "review", label: "An IT security review of the connection", detail: "Before anything touches live records." });
  if (needs === "orchestrate") items.push({ id: "matrix", label: "Categories, routing, service levels and escalation owners", detail: "The rules VoicERA follows." }, { id: "staff", label: "Named staff for handoffs, and their hours", detail: "People who take a live handover." });
  void p;
  return items;
}

export const CHECKS = [
  { id: "langs", label: "Every chosen language was tested on a real call", detail: "Speak and listen in each language, not only English." },
  { id: "kb", label: "Answers match your approved content", detail: "Ask ten real questions. Note anything it invents." },
  { id: "unknown", label: "It says so when it does not know", detail: "Ask something outside your files. It should not guess." },
  { id: "emergency", label: "An emergency is pointed to 112", detail: "It cannot send help, and should not promise to." },
  { id: "handoff", label: "The handover you chose works", detail: "Callback, office pointer or live transfer, as chosen." },
  { id: "speed", label: "Response time felt acceptable", detail: `The document gives a target under ${LIMITS.latency} seconds. Judge it on real calls.` },
  { id: "privacy", label: "It never asked for identity numbers, bank details or one-time codes", detail: "Read the transcripts of your test calls." },
];

/* ------------------------------------------------------------------ the hand-over pack */

export interface PackInput {
  profile: Profile;
  sel: Selection;
  pb: PriceBook;
  cost: Cost;
  rec: Recommendation;
  pitch: Pitch;
}

export function handoverFiles(i: PackInput): { name: string; content: string }[] {
  const { profile: p, sel, pb, cost, rec, pitch } = i;
  const cls = classify(sel);
  const stages = stagesFor(sel);
  const bring = bringList(sel, p);

  const canvas: string[] = [`# Package and canvas`, "", `Package: **${cls.key === "custom" ? cls.label : PACKAGE_NAME[cls.key]}**${cls.key === "custom" ? ` (needs at least ${PACKAGE_NAME[cls.needs]} depth)` : ""}`, ""];
  for (const l of LAYERS) {
    if (l.id === "watch") { canvas.push(`- **${l.name}**: ${OPTION_BY_ID["w-dash"].name}${sel.managedOps ? ", managed operations" : ""}${sel.evaluation ? ", conversation and language testing" : ""}`); continue; }
    const id = ({ channel: sel.channel, listen: sel.listen, think: sel.think, speak: sel.speak, know: sel.know, act: sel.act, handoff: sel.handoff, host: sel.host } as Record<string, string>)[l.id];
    const o = OPTION_BY_ID[id];
    canvas.push(`- **${l.name}** (${l.tech}): ${o?.name ?? id}${o?.maker ? `, ${o.maker}` : ""}`);
  }
  canvas.push("", `Languages: ${sel.languages.join(", ") || "none chosen"}`, `Directions: ${[sel.inbound ? "citizens call" : "", sel.outbound ? "we call citizens" : ""].filter(Boolean).join(" and ") || "not set"}`, "", "Model names are placeholders: the documents list samples only, and the actual options are to be confirmed.");

  const costMd: string[] = ["# Cost sheet", "", `Usage price: ${rate(pb.usageRate, pb.usageUnit)} (covers the platform, the phone line and open-source models).`, ""];
  for (const l of cost.lines) costMd.push(`- ${l.label}: ${inr(l.amount)} (${l.basis}; ${l.source === "document" ? "from the package document" : l.source === "provider" ? "set by VoicERA" : "your figure"})`);
  costMd.push("", `Known so far: ${inr(cost.knownTotal)}`);
  if (cost.adopter) costMd.push(`Your own figures: ${inr(cost.adopter)}`);
  if (cost.unresolved.length) { costMd.push("", "Not priced yet, so not in the total:"); for (const u of cost.unresolved) costMd.push(`- ${u.label}: ${u.why}${u.figure !== null ? ` Your figure: ${inr(u.figure)}.` : ""}`); }
  costMd.push("", ...cost.notes.map((n) => `- ${n}`), "", "Indicative. Not a quote, an order or an offer.");

  const plan = ["# Execution plan", "", `Typical timing: ${PACKAGE_CARDS[cls.needs].launch}. A range, not a commitment.`, ""];
  stages.forEach((s, n) => plan.push(`${n + 1}. **${s.title}** (${WHO_LABEL[s.who]}): ${s.plain}\n   Timing: ${s.timing}. Delivers: ${s.deliverable}.`));

  const confirm = ["# Questions to confirm", "", "## Open in the documents", ...["Where call data is stored", "Whether call data is used to train models", "How long call data is kept", "The actual list of voice and language models", "Prices for commercial models and for connecting your own model", "Prices for Connect and Orchestrate implementation"].map((x) => `- ${x}`)];
  if (p.openQuestions.length) confirm.push("", "## Your own questions the documents do not answer", ...p.openQuestions.map((q) => `- ${q}`));
  if (rec.cautions.length) confirm.push("", "## Points raised while we built this", ...rec.cautions.map((c) => `- ${c.text}`));
  const notes = notesFor(sel, p.useCases).filter((n) => n.tone !== "ok");
  if (notes.length) confirm.push("", "## On the canvas", ...notes.map((n) => `- ${n.text}`));

  const cfg = {
    package: cls.key, needsDepth: cls.needs, label: cls.label, department: p.department || null,
    useCases: p.useCases.map((u) => USE_CASE_BY_ID[u].label), selection: sel,
    capabilities: capsOf(sel), note: "Generated in the browser. Not an order and not a quote. Model names are placeholders until the actual list is confirmed.",
  };
  const csv = ["Item,Detail", ...bring.map((b) => `"${b.label}","${b.detail}"`)].join("\n");

  return [
    { name: "01-pitch.md", content: pitchToMarkdown(pitch) },
    { name: "02-package-and-canvas.md", content: canvas.join("\n") },
    { name: "03-cost-sheet.md", content: costMd.join("\n") },
    { name: "04-execution-plan.md", content: plan.join("\n") },
    { name: "05-bring-checklist.csv", content: csv },
    { name: "06-questions-to-confirm.md", content: confirm.join("\n") },
    { name: "canvas-config.json", content: JSON.stringify(cfg, null, 2) },
  ];
}
