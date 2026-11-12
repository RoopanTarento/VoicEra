import { ACCESS_GROUPS, COMPONENT_BY_ID, HOSTING_OPTIONS, LANGUAGE_BY_ID, LATENCIES, PACKAGE_BY_ID, PROFILE_BY_ID, SUPPORT_MODELS, compLabel } from "./catalog";
import { dateLong, inr, num } from "./format";
import { costOf, atVersion } from "./packages";
import { policyChecks, unresolvedChecks, type PolicyCheck } from "./policy";
import { turnLatencyFor } from "./pricing";
import type { Org, PackageRecord } from "./types";

export interface Row { label: string; value: string; note?: string }

export interface QuoteDoc {
  id: string;
  state: "draft" | "submitted" | "approved";
  version: string;
  packageName: string;
  org: string;
  createdBy: string;
  createdAt: string;
  validUntil: string;
  deployment: Row[];
  configuration: Row[];
  usage: Row[];
  performance: Row[];
  cost: { rows: { label: string; rate: string; usage: string; monthly: string; note?: string }[]; recurring: string; oneTime: string; budget: string; perMinute: string; month12: string };
  excluded: string[];
  governance: Row[];
  openItems: { title: string; status: string; what: string; how: string }[];
  approvals: { action: string; by: string; at: string; note?: string }[];
  notice: string;
  numbers: { recurring: number; oneTime: number; budget: number | null; usedPct: number | null; perMinute: number };
}

const labelOf = (id: string) => (COMPONENT_BY_ID[id] ? compLabel(COMPONENT_BY_ID[id]) : id);

export function buildQuote(p: PackageRecord, org: Pick<Org, "name">): QuoteDoc | null {
  const cost = costOf(p);
  const q = p.quote;
  if (!cost || !q || !p.selection || !p.usage) return null;
  const sel = p.selection;
  const h = p.hosting;
  const r = p.requirements;
  const hostOpt = HOSTING_OPTIONS.find((o) => o.id === h.kind);
  const prof = PROFILE_BY_ID[sel.hostingProfile];
  const ver = atVersion(p);
  const base = PACKAGE_BY_ID[p.recommendation?.baseId ?? ""];
  const latency = turnLatencyFor(base?.id ?? "", sel);
  const target = LATENCIES.find((l) => l.id === r.latency);
  const checks = policyChecks(r, h, sel, p.openItems);
  const open: PolicyCheck[] = unresolvedChecks(checks);
  const accessOf = (id: string) => ACCESS_GROUPS.find((a) => a.id === id)?.label ?? id;
  const days = (d: number | null) => (d === null ? "Not kept" : `${d} days`);
  return {
    id: q.id, state: q.state, version: q.versionLabel || ver?.label || "v1.0", packageName: p.name, org: org.name, createdBy: p.createdBy, createdAt: q.createdAt, validUntil: q.validUntil,
    deployment: [
      { label: "Hosting", value: hostOpt?.label ?? h.kind },
      { label: "Region", value: h.region },
      { label: "Operated by", value: h.operator },
      { label: "Data in India", value: h.inCountry ? "Required" : "Not required" },
      { label: "Hosting profile", value: prof ? prof.name : sel.hostingProfile },
      { label: "Availability target", value: `${h.availability}%${h.disasterRecovery ? ", with recovery site" : ""}` },
      { label: "Support", value: h.support === "unset" ? "Not chosen (business hours assumed)" : SUPPORT_MODELS.find((m) => m.id === h.support)?.label ?? h.support },
    ],
    configuration: [
      { label: "Speech recognition", value: labelOf(sel.asr) }, { label: "Language model", value: labelOf(sel.llm) }, { label: "Voice", value: labelOf(sel.tts) },
      { label: "Telephony", value: labelOf(sel.telephony) }, { label: "Language adapter", value: labelOf(sel.adapter) },
      { label: "Languages", value: r.languages.map((l) => LANGUAGE_BY_ID[l]?.name ?? l).join(", ") || "None chosen" },
    ],
    usage: [
      { label: "Calls per month", value: num(p.usage.callsPerMonth) }, { label: "Average call length", value: `${p.usage.avgMinutes} min` },
      { label: "Peak concurrent calls", value: num(p.usage.peakConcurrency) }, { label: "Model tokens per call", value: num(p.usage.llmTokensPerCall) },
      { label: "Voice characters per call", value: num(p.usage.ttsCharsPerCall) }, { label: "12-month growth", value: r.growthPct === null ? "Not given" : `${r.growthPct}%` },
    ],
    performance: base ? [
      { label: "Started from", value: `${base.name} ${base.version}`, note: "Sample catalogue" },
      { label: "Turn latency", value: `${latency.toFixed(1)} s${target?.maxS ? ` (target under ${target.maxS} s)` : ""}`, note: "Estimate for this stack, adjusted from the measured figure" },
      { label: "Task completion", value: `${base.metrics.taskCompletion}%`, note: `${base.metrics.testCalls} test calls, ${dateLong(base.metrics.testDate)}` },
      { label: "Voice quality", value: `${base.metrics.voiceQuality} / 5` }, { label: "Tested up to", value: `${base.metrics.maxPeak} calls at once` },
    ] : [],
    cost: {
      rows: cost.lines.map((l) => ({ label: l.label, rate: l.unitRate, usage: l.usage, monthly: l.monthly === null ? "Not included" : inr(l.monthly), note: l.note })),
      recurring: inr(cost.recurring), oneTime: inr(cost.oneTime),
      budget: r.monthlyBudget ? `${inr(r.monthlyBudget)} ceiling, ${(cost.budgetUsedPct ?? 0).toFixed(0)}% used` : "No ceiling set",
      perMinute: `${inr(cost.perMinute, { decimals: 2 })} per minute`,
      month12: cost.recurringAt12 === null ? "Not projected" : inr(cost.recurringAt12),
    },
    excluded: cost.excluded,
    governance: [
      { label: "Recordings", value: h.recording === "off" ? "Not recorded" : h.recording === "consent" ? `With consent, kept ${days(h.retention.recordings.days)}, ${accessOf(h.retention.recordings.access)}` : `Always, kept ${days(h.retention.recordings.days)}` },
      { label: "Transcripts", value: h.transcripts === "none" ? "Not kept" : `${h.transcripts === "redacted" ? "Redacted" : "Full"}, ${days(h.retention.transcripts.days)}, ${accessOf(h.retention.transcripts.access)}` },
      { label: "Logs", value: `${days(h.retention.logs.days)}, ${accessOf(h.retention.logs.access)}` },
      { label: "Agent memory", value: h.retention.memory.days === null ? "Not kept" : `${days(h.retention.memory.days)}, ${accessOf(h.retention.memory.access)}` },
      { label: "PII detected", value: h.pii.length ? h.pii.map((x) => (x === "govid" ? "Government IDs" : x === "custom" ? `Custom (${h.piiCustom || "pattern"})` : x[0].toUpperCase() + x.slice(1) + "s")).join(", ") : "None selected" },
      { label: "Caller notice", value: h.callerNotice.trim() ? "Written" : "Not written" },
      { label: "Retention confirmed by", value: h.retentionConfirmedBy || "Not yet confirmed" },
    ],
    openItems: open.map((c) => ({ title: c.title, status: c.effective.toUpperCase(), what: c.what, how: c.how })),
    approvals: q.events.map((e) => ({ action: e.action, by: e.by, at: e.at, note: e.note })),
    notice: "Prototype quote. Rates and benchmarks are sample figures, not an offer. Rates are as of the sample catalogue date.",
    numbers: { recurring: cost.recurring, oneTime: cost.oneTime, budget: r.monthlyBudget, usedPct: cost.budgetUsedPct, perMinute: cost.perMinute },
  };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function quoteCsv(d: QuoteDoc): string {
  const rows: string[][] = [["Section", "Item", "Value", "Note"]];
  const add = (s: string, items: Row[]) => items.forEach((x) => rows.push([s, x.label, x.value, x.note ?? ""]));
  rows.push(["Quote", "Quote ID", d.id, ""], ["Quote", "Status", d.state.toUpperCase(), ""], ["Quote", "Package", d.packageName, ""], ["Quote", "Version", d.version, ""], ["Quote", "Organisation", d.org, ""], ["Quote", "Created", dateLong(d.createdAt), ""], ["Quote", "Valid until", dateLong(d.validUntil), ""]);
  add("Deployment", d.deployment); add("Configuration", d.configuration); add("Usage", d.usage); add("Performance", d.performance);
  d.cost.rows.forEach((x) => rows.push(["Cost per month", x.label, x.monthly.replace(/[₹,]/g, ""), `${x.rate}; ${x.usage}${x.note ? `; ${x.note}` : ""}`]));
  rows.push(["Cost per month", "Recurring total", d.cost.recurring.replace(/[₹,]/g, ""), ""], ["Cost one-time", "Implementation", d.cost.oneTime.replace(/[₹,]/g, ""), ""], ["Cost", "Budget", d.cost.budget, ""], ["Cost", "Per minute", d.cost.perMinute, ""]);
  d.excluded.forEach((x) => rows.push(["Not included", x, "", ""]));
  add("Governance", d.governance);
  d.openItems.forEach((x) => rows.push(["Open items", x.title, x.status, x.what]));
  d.approvals.forEach((x) => rows.push(["Approval", x.action, `${x.by}, ${dateLong(x.at)}`, x.note ?? ""]));
  rows.push(["Notice", "", d.notice, ""]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** jsPDF's built-in fonts have no rupee sign. */
const pdfMoney = (s: string) => s.replace(/₹\s?/g, "Rs ").replace(/−/g, "-");

export async function quotePdf(d: QuoteDoc): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = 595, M = 48, CW = W - M * 2;
  let y = M;
  const ensure = (h: number) => { if (y + h > 800) { doc.addPage(); y = M; } };
  const lines = (t: string, size: number, bold: boolean, width: number) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); return doc.splitTextToSize(pdfMoney(t), width) as string[]; };
  /** Height of a block of text, so a row is never split across pages. */
  const measure = (t: string, size: number, bold: boolean, width: number) => lines(t, size, bold, width).length * (size + 3);
  const text = (t: string, x: number, size = 10, bold = false, color = 30, width?: number) => {
    const ls = lines(t, size, bold, width ?? CW - (x - M));
    doc.setTextColor(color);
    ls.forEach((ln, i) => doc.text(ln, x, y + i * (size + 3)));
    return ls.length * (size + 3);
  };
  /** Draw a paragraph, then move down. */
  const put = (t: string, x: number, size = 10, bold = false, color = 30, width?: number) => { ensure(measure(t, size, bold, width ?? CW - (x - M)) + 2); const h = text(t, x, size, bold, color, width); y += h; return h; };
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(110); doc.text("VANI ANUVAAD  |  QUOTE", M, y); y += 22;
  put(d.packageName, M, 20, true);
  y += 4; put(`${d.id}  |  ${d.version}  |  ${d.state.toUpperCase()}`, M, 10, true, 70);
  put(`${d.org}. Created ${dateLong(d.createdAt)} by ${d.createdBy}. Valid until ${dateLong(d.validUntil)}.`, M, 9, false, 90);
  y += 8;
  doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 18;
  const section = (title: string, rows: Row[]) => {
    if (!rows.length) return;
    ensure(40); put(title.toUpperCase(), M, 8, true, 120); y += 4;
    for (const r of rows) {
      const val = r.value + (r.note ? `  (${r.note})` : "");
      ensure(Math.max(measure(r.label, 9.5, false, 150), measure(val, 9.5, false, CW - 160)) + 4);
      const a = text(r.label, M, 9.5, false, 90, 150);
      const b = text(val, M + 160, 9.5, false, 20, CW - 160);
      y += Math.max(a, b) + 3;
    }
    y += 10;
  };
  section("Deployment", d.deployment); section("Configuration", d.configuration); section("Usage assumptions", d.usage); section("Performance evidence", d.performance);
  ensure(60); put("COST PER MONTH", M, 8, true, 120); y += 4;
  for (const r of d.cost.rows) {
    const mid = `${r.rate}  |  ${r.usage}${r.note ? `  |  ${r.note}` : ""}`;
    ensure(Math.max(measure(r.label, 9.5, true, 140), measure(mid, 8.5, false, 260)) + 6);
    const a = text(r.label, M, 9.5, true, 30, 140);
    const b = text(mid, M + 150, 8.5, false, 90, 260);
    const c = text(r.monthly, M + 420, 9.5, false, 20, 80);
    y += Math.max(a, b, c) + 4;
  }
  doc.line(M, y, W - M, y); y += 14;
  put(`Recurring per month: ${d.cost.recurring}`, M, 12, true);
  put(`One-time implementation: ${d.cost.oneTime}`, M, 10, false, 60);
  put(`${d.cost.budget}. ${d.cost.perMinute}. Month 12 projection: ${d.cost.month12}.`, M, 9, false, 90); y += 6;
  put(`Not included: ${d.excluded.join("; ")}.`, M, 8.5, false, 110); y += 10;
  section("Governance assumptions", d.governance);
  if (d.openItems.length) { ensure(40); put("OPEN ITEMS", M, 8, true, 120); y += 4; for (const o of d.openItems) { put(`${o.status}  ${o.title}: ${o.what}`, M, 9.5); y += 3; } y += 10; }
  if (d.approvals.length) section("Approval history", d.approvals.map((a) => ({ label: a.action, value: `${a.by}, ${dateLong(a.at)}${a.note ? `. ${a.note}` : ""}` })));
  ensure(40); put(d.notice, M, 8, false, 120);
  return doc.output("blob");
}
