/** Number, money and date formatting. Indian digit grouping, rupees, plain words. */

export const inr = (n: number | null | undefined, opts: { decimals?: number } = {}): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "₹ —";
  const d = opts.decimals ?? (Math.abs(n) < 100 && !Number.isInteger(n) ? 2 : 0);
  const s = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${n < 0 ? "−" : ""}₹${s}`;
};

/** +₹1,200 or −₹800, for a change. */
export const inrDelta = (n: number): string => (n === 0 ? "no change" : `${n > 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`);

export const num = (n: number | null | undefined): string => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

/** 1,50,000 becomes 1.5 lakh, 125,000,000 becomes 12.5 crore. */
export const compact = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e7) return `${+(n / 1e7).toFixed(2)} crore`;
  if (a >= 1e5) return `${+(n / 1e5).toFixed(2)} lakh`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

/** 125M tokens, 60M chars. */
export const millions = (n: number): string => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

export const pct = (n: number, digits = 0): string => `${n.toFixed(digits)}%`;

export const dateLong = (iso: string | number | Date): string => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const dateTime = (iso: string | number | Date): string => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ago(iso: string | number | Date, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

/** Hide most of an email, for people who do not need to see it. */
export const maskEmail = (e: string): string => {
  const [u, d] = e.split("@");
  if (!d) return e;
  return `${u.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(5, u.length - 1)))}@${d}`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
