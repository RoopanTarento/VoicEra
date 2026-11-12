import { PACKAGE_NAME, LIMITS, OPTION_BY_ID } from "./catalog";
import { classify, type Selection } from "./canvas";
import { costFor, inr, rate, round2, type Cost, type PriceBook, type Source } from "./pricing";

/**
 * The itemised quote: every line of the cost laid out the way a quotation reads.
 * Three sections (one-time, usage over the planning period, ongoing), a quantity, a rate and an amount on every
 * row, and a status on each: priced, your own figure, or not priced yet. Not-priced rows stay in their section,
 * with no amount, so the quote is complete and nothing is hidden.
 */

export type RowStatus = "priced" | "yours" | "open";

export interface QuoteRow {
  id: string;
  item: string;
  detail: string;
  qty: number | null;
  unit: string;
  rate: number | null;
  amount: number | null;
  status: RowStatus;
  source: Source;
}

export interface QuoteSection {
  id: "once" | "usage" | "ongoing";
  title: string;
  blurb: string;
  rows: QuoteRow[];
  /** Sum of the rows that have an amount. */
  subtotal: number;
  /** Rows in this section with no price yet. */
  open: number;
}

export interface Scenario {
  callsPerMonth: number;
  units: number | null;
  usage: number;
  total: number;
  planned: boolean;
}

export interface Quote {
  date: string;
  packageLabel: string;
  period: number;
  callsPerMonth: number | null;
  sections: QuoteSection[];
  knownTotal: number;
  yourTotal: number;
  grand: number;
  openRows: number;
  complete: boolean;
  /** What one call costs at the standard rate, when charged per call. */
  perCall: number | null;
  per1000: number | null;
  /** Usage and ongoing charges per month, once volume is known. */
  monthlyRun: number | null;
  scenarios: Scenario[];
  covered: string[];
  included: string[];
  rules: string[];
}

const SECTION_META: Record<QuoteSection["id"], { title: string; blurb: string }> = {
  once: { title: "One-time charges", blurb: "Paid once, at the start." },
  usage: { title: "Usage", blurb: "Charged as calls happen, over the planning period." },
  ongoing: { title: "Ongoing services", blurb: "Annual services, shown for the planning period." },
};

function groupOfRow(id: string, kind?: "one-time" | "usage" | "period"): QuoteSection["id"] {
  if (kind === "period" || id === "managed-ops" || id === "licence") return "ongoing";
  if (kind === "usage" || id === "volume" || id === "usage-rate" || id.startsWith("model-") || id.startsWith("own-") && id !== "own-telephony" || id.startsWith("ownfee-")) return "usage";
  return "once";
}

const ID_ITEM: Record<string, string> = { setup: "Setup and implementation", numbers: "Phone numbers", usage: "Calls" };

export function buildQuote(sel: Selection, pb: PriceBook, now: Date = new Date()): Quote {
  const cost: Cost = costFor(sel, pb);
  const cls = classify(sel);
  const map: Record<QuoteSection["id"], QuoteRow[]> = { once: [], usage: [], ongoing: [] };

  for (const l of cost.lines) {
    const status: RowStatus = l.source === "adopter" ? "yours" : "priced";
    map[groupOfRow(l.id, l.kind)].push({
      id: l.id, item: l.label, detail: l.basis, qty: l.qty ?? null, unit: l.unit ?? "", rate: l.rate ?? null, amount: l.amount, status, source: l.source,
    });
  }
  for (const u of cost.unresolved) {
    const typed = u.figure !== null;
    map[groupOfRow(u.id)].push({
      id: u.id, item: ID_ITEM[u.id] ?? u.label, detail: typed ? `${u.why} Your own figure is used.` : u.why, qty: null, unit: "", rate: null,
      amount: typed ? u.figure : null, status: typed ? "yours" : "open", source: typed ? "adopter" : "unset",
    });
  }

  const sections: QuoteSection[] = (["once", "usage", "ongoing"] as const).map((id) => {
    const rows = map[id];
    return { id, ...SECTION_META[id], rows, subtotal: round2(rows.reduce((t, r) => t + (r.amount ?? 0), 0)), open: rows.filter((r) => r.status === "open").length };
  }).filter((s) => s.rows.length > 0);

  const unit = pb.usageUnit;
  const units = cost.units;
  const perCall = unit === "call" && pb.usageRate !== null ? pb.usageRate : null;
  const months = sel.workload.months;
  const run = units === null ? null : round2((cost.usage + sections.filter((s) => s.id === "ongoing").reduce((t, s) => t + s.subtotal, 0)) / months);

  const planned = sel.workload.callsPerMonth;
  const ladder = Array.from(new Set([500, 5000, 50000, 500000, ...(planned ? [planned] : [])])).sort((a, b) => a - b);
  const scenarios: Scenario[] = ladder.map((v) => {
    const c = costFor({ ...sel, workload: { ...sel.workload, callsPerMonth: v } }, pb);
    return { callsPerMonth: v, units: c.units, usage: c.usage, total: c.grand, planned: v === planned };
  });

  const covered = [
    "The platform and the orchestration of every call.",
    "The phone line, for calls on a number from VoicERA's telephony partners.",
    "Open-source speech, language and voice models, end to end.",
  ];
  const included = [
    "The dashboard, and an analysis within " + LIMITS.analysisDays + " working days of a campaign.",
    "A dedicated campaign operator and a shared programme manager.",
    `Campaign set-up and monitoring support, up to ${LIMITS.campaignsPerMonth} a month.`,
    `${LIMITS.troubleshootHours}-hour support to troubleshoot an issue.`,
    `A knowledge base of up to ${LIMITS.kbFiles} text files of up to ${LIMITS.kbMB} MB each.`,
  ];

  return {
    date: now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
    packageLabel: cls.key === "custom" ? cls.label : PACKAGE_NAME[cls.key],
    period: months,
    callsPerMonth: planned,
    sections,
    knownTotal: cost.knownTotal,
    yourTotal: cost.adopter,
    grand: cost.grand,
    openRows: sections.reduce((t, s) => t + s.open, 0),
    complete: cost.complete,
    perCall,
    per1000: perCall === null ? null : round2(perCall * 1000),
    monthlyRun: run,
    scenarios,
    covered,
    included,
    rules: [
      "Only prices set in the package documents or by VoicERA are in the total. No tax, number rental or other charge is added.",
      "A row with no price is not free and not zero. It is waiting for a quote from VoicERA.",
      "Your own figures are labelled as yours and are never presented as VoicERA prices.",
      "Whether the phone number charge repeats is not stated, so it is counted once.",
      `Usage is ${rate(pb.usageRate, pb.usageUnit)}. ${pb.usageUnit === "call" ? "It does not change with how long a call lasts." : "It changes with how long a call lasts."}`,
    ],
  };
}

/** The quote as a spreadsheet. */
export function quoteToCsv(q: Quote): string {
  const rows = ["Section,Item,Detail,Quantity,Unit,Rate (INR),Amount (INR),Status,Source"];
  for (const s of q.sections) {
    for (const r of s.rows) {
      const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
      rows.push([cell(s.title), cell(r.item), cell(r.detail), r.qty ?? "", cell(r.unit), r.rate ?? "", r.amount ?? "", r.status === "open" ? "Not priced yet" : r.status === "yours" ? "Your figure" : "Priced", r.source].join(","));
    }
  }
  rows.push("", `Known total (INR),${q.knownTotal}`, `Your own figures (INR),${q.yourTotal}`, `Grand total (INR),${q.grand}`, `Rows not priced yet,${q.openRows}`);
  return rows.join("\n");
}

export function quoteToMarkdown(q: Quote, department: string): string {
  const out = [`# Quotation (indicative)`, "", `${department ? `Prepared for: ${department}\n` : ""}Package: ${q.packageLabel}\nDate: ${q.date}\nPlanning period: ${q.period} month${q.period === 1 ? "" : "s"}${q.callsPerMonth ? `, ${q.callsPerMonth.toLocaleString("en-IN")} calls a month` : ""}`, ""];
  for (const s of q.sections) {
    out.push(`## ${s.title}`, `${s.blurb}`, "");
    out.push("| Item | Basis | Amount |", "| --- | --- | --- |");
    for (const r of s.rows) out.push(`| ${r.item} | ${r.qty !== null && r.rate !== null ? `${r.qty.toLocaleString("en-IN")} ${r.unit} × ${inr(r.rate)}` : r.detail} | ${r.amount === null ? "To be quoted" : inr(r.amount)} |`);
    out.push(`| **Subtotal${s.open ? " (known)" : ""}** | | **${inr(s.subtotal)}** |`, "");
  }
  out.push(`**Known total: ${inr(q.knownTotal)}**`, q.yourTotal ? `Your own figures: ${inr(q.yourTotal)}` : "", q.yourTotal ? `**Grand total: ${inr(q.grand)}**` : "", q.openRows ? `\n${q.openRows} row${q.openRows === 1 ? "" : "s"} not priced yet, shown above as "To be quoted".` : "", "", "## Notes", ...q.rules.map((r) => `- ${r}`), "", "Indicative. Not an order and not an offer.");
  return out.filter((l) => l !== undefined).join("\n");
}

export { OPTION_BY_ID };
