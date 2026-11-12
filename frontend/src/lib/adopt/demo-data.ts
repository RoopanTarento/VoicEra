import type { ApplicationDef } from "./types";

/**
 * Demonstration data for the Operations screen.
 *
 * Everything here is generated locally from a fixed seed so the screen looks
 * the same on every visit. It is NOT from a live deployment and the UI says so
 * wherever it is shown. It only appears after the deployment rehearsal.
 */

function rng(seedText: string) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DayPoint {
  label: string;
  calls: number;
  completed: number;
  handoffs: number;
}

export interface RecentCall {
  id: string;
  when: string;
  language: string;
  seconds: number;
  outcome: string;
  handoff: boolean;
}

export interface OpsData {
  days: DayPoint[];
  totals: { calls: number; completed: number; handoffs: number; avgSeconds: number };
  outcomes: { name: string; value: number }[];
  languages: { name: string; value: number }[];
  recent: RecentCall[];
  measures: { name: string; value: string; note: string }[];
}

// [outcome, relative weight]. "Handed to a person" is set from the handoff total instead, so the two agree.
const OUTCOMES: Record<string, [string, number][]> = {
  grievance: [["Case created", 3], ["Status given", 1.6], ["Resolution confirmed", 1.4], ["Reopened", 0.3], ["Handed to a person", 0], ["Dropped", 0.6]],
  "scheme-discovery": [["Scheme explained", 3], ["No match", 1], ["Follow-up requested", 1.2], ["Handed to a person", 0], ["Dropped", 0.7]],
  surveys: [["Survey completed", 3], ["Partly completed", 1], ["Opted out", 0.3], ["No answer", 1.4], ["Handed to a person", 0]],
  "form-filling": [["Form completed", 3], ["Held for review", 1.2], ["Missing field", 0.6], ["Handed to a person", 0], ["Dropped", 0.7]],
  "application-support": [["Status given", 3], ["Missing item named", 1.6], ["Follow-up set", 1.2], ["Handed to a person", 0], ["Dropped", 0.6]],
};

export function buildOpsData(app: ApplicationDef, languages: string[]): OpsData {
  const r = rng(`ops-${app.id}`);
  const base = app.outbound && !app.inbound ? 140 : 90;
  const days: DayPoint[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const ramp = 0.55 + (13 - i) * 0.035;
    const calls = Math.round((base * ramp * (weekend ? 0.55 : 1)) * (0.85 + r() * 0.3));
    const completed = Math.round(calls * (0.58 + r() * 0.14));
    const handoffs = Math.round(calls * (0.06 + r() * 0.05));
    days.push({
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      calls,
      completed,
      handoffs,
    });
  }
  const totals = days.reduce(
    (a, d) => ({ calls: a.calls + d.calls, completed: a.completed + d.completed, handoffs: a.handoffs + d.handoffs }),
    { calls: 0, completed: 0, handoffs: 0 },
  );
  const avgSeconds = Math.round(150 + r() * 70);

  const table = OUTCOMES[app.id] ?? OUTCOMES.grievance;
  const names = table.map(([n]) => n);
  const rest = Math.max(0, totals.calls - totals.handoffs);
  const wsum = table.reduce((a, [, w]) => a + w, 0) || 1;
  const outcomes = table.map(([name, w]) => ({
    name,
    value: name === "Handed to a person" ? totals.handoffs : Math.round((w / wsum) * rest),
  }));

  const langs = languages.length ? languages : ["Hindi", "English"];
  const lw = langs.map((_, i) => (i === 0 ? 3 : 1.2) + r());
  const ls = lw.reduce((a, b) => a + b, 0);
  const languagesOut = langs.map((name, i) => ({ name, value: Math.round((lw[i] / ls) * totals.calls) }));

  const recent: RecentCall[] = [];
  for (let i = 0; i < 8; i++) {
    const outcome = names[Math.floor(r() * names.length)];
    const hh = String(9 + Math.floor(r() * 9)).padStart(2, "0");
    const mm = String(Math.floor(r() * 60)).padStart(2, "0");
    recent.push({
      id: `DEMO-${3000 + i * 7 + Math.floor(r() * 5)}`,
      when: `${hh}:${mm}`,
      language: langs[Math.floor(r() * langs.length)],
      seconds: Math.round(60 + r() * 240),
      outcome,
      handoff: outcome === "Handed to a person",
    });
  }

  const pct = (n: number) => `${Math.round((n / Math.max(1, totals.calls)) * 100)}%`;
  const measures = app.measures.slice(0, 4).map((m, i) => ({
    name: m.name,
    value: [pct(totals.completed), pct(totals.handoffs), `${Math.round(40 + r() * 40)}%`, `${Math.round(8 + r() * 20)}%`][i],
    note: m.detail,
  }));

  return { days, totals: { ...totals, avgSeconds }, outcomes, languages: languagesOut, recent, measures };
}

export function alertsFor(opts: {
  handoffMissing: boolean;
  outboundUnsure: boolean;
  sampleContent: boolean;
  integrationsMissing: string[];
}): { level: "warning" | "info"; text: string }[] {
  const out: { level: "warning" | "info"; text: string }[] = [];
  if (opts.handoffMissing) out.push({ level: "warning", text: "No handoff number is set. Callers who ask for a person would not reach one." });
  if (opts.outboundUnsure) out.push({ level: "warning", text: "The basis for outbound calling is not settled." });
  if (opts.sampleContent) out.push({ level: "warning", text: "Sample content is still in the configuration." });
  opts.integrationsMissing.forEach((n) => out.push({ level: "info", text: `${n} is not set up. Steps that need it are described, not performed.` }));
  return out;
}
