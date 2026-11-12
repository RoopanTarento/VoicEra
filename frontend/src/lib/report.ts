import { jsPDF } from "jspdf";
import { formatDuration } from "./format";
import type { CallAnalyticsResponse, ModelUsageEntry } from "./api-types";

export interface ReportMeta {
  orgName: string;
  email: string;
}

/** Quote one CSV cell. Text starting with =, +, -, @, tab or CR is prefixed
 * with ' so spreadsheet apps don't evaluate it as a formula; plain numbers
 * (including negatives) are left alone. */
export function csvCell(v: unknown): string {
  let text = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(text) && !/^[-+]?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function metaRow(label: string, value: string): string {
  return [label, value].map(csvCell).join(",");
}

/** Every exported CSV in the app opens with the same organisation/downloaded-by/
 * generated-at header before the real column header row, so a report can
 * always be traced back to who pulled it and from where. */
export function buildCsvReport(meta: ReportMeta, header: string[], rows: unknown[][]): string {
  const lines = [
    metaRow("Organisation", meta.orgName),
    metaRow("Downloaded by", meta.email),
    metaRow("Generated", new Date().toLocaleString()),
    "",
    header.map(csvCell).join(","),
    ...rows.map((r) => r.map(csvCell).join(",")),
  ];
  return lines.join("\n");
}

export function downloadBlob(content: BlobPart, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const PDF_MARGIN_X = 14;
const PDF_PAGE_RIGHT = 196;
const PDF_PAGE_BOTTOM = 280;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.padEnd(6, "0");
  const value = parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Every exported PDF in the app opens with the same title + organisation +
 * "downloaded by" + generated-at header, so a printed report is always
 * traceable back to who pulled it and from where. Returns small helpers that
 * track the vertical cursor and page-break for the caller's own sections. */
export function createPdfReport(title: string, meta: ReportMeta) {
  const doc = new jsPDF();
  let y = 20;

  function ensureRoom(next: number) {
    if (y + next > PDF_PAGE_BOTTOM) {
      doc.addPage();
      y = 20;
    }
  }

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(title, PDF_MARGIN_X, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(meta.orgName, PDF_MARGIN_X, y);
  y += 5;
  doc.text(`Downloaded by ${meta.email}`, PDF_MARGIN_X, y);
  y += 5;
  doc.text(`Generated ${new Date().toLocaleString()}`, PDF_MARGIN_X, y);
  doc.setTextColor(0);
  y += 6;
  doc.setDrawColor(210);
  doc.line(PDF_MARGIN_X, y, PDF_PAGE_RIGHT, y);
  y += 10;

  function heading(text: string) {
    ensureRoom(12);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(text, PDF_MARGIN_X, y);
    y += 8;
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
  }

  function row(label: string, value: string) {
    ensureRoom(6);
    doc.text(label, PDF_MARGIN_X, y);
    doc.text(value, PDF_MARGIN_X + 90, y);
    y += 6;
  }

  function paragraph(text: string) {
    ensureRoom(6);
    doc.text(text, PDF_MARGIN_X, y);
    y += 6;
  }

  const BAR_LABEL_MAX_WIDTH = 60;
  const BAR_X = PDF_MARGIN_X + BAR_LABEL_MAX_WIDTH + 3;
  const BAR_MAX_WIDTH = 90;
  const BAR_HEIGHT = 4;

  /** One horizontal bar-chart row: a label, a colored bar sized by `fraction`
   * (0-1) of the series' max value, and a value label after it — the actual
   * "graph" behind Overview/Agent Performance/Model Usage/Connection
   * Breakdown, drawn as real vector shapes (no image rasterization, so it
   * stays crisp and never fights CSS custom properties or embedded HTML). */
  function barRow(label: string, valueLabel: string, fraction: number, color: string) {
    ensureRoom(7);
    doc.setFontSize(9);
    doc.setTextColor(50);
    doc.text(label, PDF_MARGIN_X, y, { maxWidth: BAR_LABEL_MAX_WIDTH });

    doc.setFillColor(230, 230, 230);
    doc.rect(BAR_X, y - 3.2, BAR_MAX_WIDTH, BAR_HEIGHT, "F");
    const width = Math.max(0.6, Math.min(1, fraction) * BAR_MAX_WIDTH);
    doc.setFillColor(...hexToRgb(color));
    doc.rect(BAR_X, y - 3.2, width, BAR_HEIGHT, "F");

    if (valueLabel) {
      doc.setTextColor(50);
      doc.text(valueLabel, BAR_X + BAR_MAX_WIDTH + 3, y);
    }
    doc.setTextColor(0);
    doc.setFontSize(11);
    y += 7;
  }

  return {
    doc,
    heading,
    row,
    paragraph,
    barRow,
    ensureRoom,
    save(filename: string) {
      doc.save(filename);
    },
  };
}

export const MODEL_BAR_COLORS = ["#7b9aff", "#7df8c5", "#ffcf8d"];

const PDF_ACCENT = "#2f6fed";
const PDF_OK = "#22c55e";
const PDF_DANGER = "#ef4444";

export function modelUsageLine(entry: ModelUsageEntry | null | undefined): string {
  if (!entry) return "—";
  const name = [entry.provider, entry.model].filter(Boolean).join(" · ") || "—";
  return `${name} (${entry.call_count.toLocaleString()} calls)`;
}

/** Builds an actual downloadable PDF from real analytics data, including real
 * bar-chart graphs for Agent Performance, Model Usage, and Connection
 * Breakdown, drawn as vector rectangles rather than rasterizing on-screen
 * chart SVGs. Shared by the Analytics page and the Copilot's analytics card
 * so a report generated either way is identical. */
export function downloadAnalyticsPdf(data: CallAnalyticsResponse, meta: ReportMeta) {
  const report = createPdfReport("Analytics Report", meta);

  report.heading("Overview");
  report.row("Connection rate", `${data.connection_rate}%`);
  report.row("Calls attempted", data.calls_attempted.toLocaleString());
  report.row("Calls connected", data.calls_connected.toLocaleString());
  report.row("Calls failed", data.calls_failed.toLocaleString());
  report.row("Avg call duration", formatDuration(data.average_duration_seconds));
  report.row("Total minutes", Math.round(data.total_duration_seconds / 60).toLocaleString());
  if (data.trend_vs_last_week_pct !== null && data.trend_vs_last_week_pct !== undefined) {
    const trend = data.trend_vs_last_week_pct;
    report.row("Trend vs last week", `${trend >= 0 ? "+" : ""}${trend}%`);
  }

  report.heading("Agent Performance");
  if (data.agent_performance.length === 0) {
    report.paragraph("No calls yet.");
  } else {
    const maxCount = Math.max(...data.agent_performance.map((a) => a.call_count), 1);
    data.agent_performance.forEach((a, i) => {
      report.barRow(
        `${i + 1}. ${a.agent_name ?? "Unknown agent"}`,
        `${a.call_count.toLocaleString()} calls`,
        a.call_count / maxCount,
        PDF_ACCENT,
      );
    });
  }

  if (data.model_usage) {
    report.heading("Model Usage (by call volume)");
    const modelRows: { label: string; entry: ModelUsageEntry | null; color: string }[] = [
      { label: "STT", entry: data.model_usage.stt, color: MODEL_BAR_COLORS[0]! },
      { label: "TTS", entry: data.model_usage.tts, color: MODEL_BAR_COLORS[1]! },
      { label: "LLM", entry: data.model_usage.llm, color: MODEL_BAR_COLORS[2]! },
    ];
    const maxModelCount = Math.max(...modelRows.map((r) => r.entry?.call_count ?? 0), 1);
    modelRows.forEach((r) => {
      report.barRow(
        `${r.label} — ${modelUsageLine(r.entry)}`,
        "",
        (r.entry?.call_count ?? 0) / maxModelCount,
        r.color,
      );
    });
  }

  report.heading("Connection Breakdown");
  const attempted = Math.max(1, data.calls_attempted);
  report.barRow("Connected", data.calls_connected.toLocaleString(), data.calls_connected / attempted, PDF_OK);
  report.barRow("Failed", data.calls_failed.toLocaleString(), data.calls_failed / attempted, PDF_DANGER);

  report.save(`analytics-${new Date().toISOString().slice(0, 10)}.pdf`);
}
