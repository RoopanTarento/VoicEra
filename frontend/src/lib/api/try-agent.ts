import { apiFetch } from "./http";

/** Public preview (no sign-up): see apps/api/app/routers/try_agent.py. */

export interface TryScheme {
  id: string;
  name: string;
  category: string;
  summary: string;
  benefit: string;
}

export interface TryCatalogue {
  schemes: TryScheme[];
  languages: { code: string; name: string }[];
  max_schemes: number | null;
  facts_checked: string | null;
}

export interface TryAgent {
  name: string;
  purpose: string;
  welcome: string;
}

export interface TryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TryReply {
  reply: string;
  /** English line under a reply in another language. */
  english: string | null;
}

export function getTryCatalogue(): Promise<TryCatalogue> {
  return apiFetch<TryCatalogue>("/try/catalogue", {}, false);
}

export function buildTryAgent(schemeIds: string[], language: string): Promise<TryAgent> {
  return apiFetch<TryAgent>(
    "/try/agent",
    { method: "POST", body: JSON.stringify({ scheme_ids: schemeIds, language }) },
    false,
  );
}

/** The agent's next reply; with no messages, its opening line. */
export function tryChat(schemeIds: string[], language: string, messages: TryTurn[]): Promise<TryReply> {
  return apiFetch<TryReply>(
    "/try/chat",
    { method: "POST", body: JSON.stringify({ scheme_ids: schemeIds, language, messages }) },
    false,
  );
}

// The agent a visitor tried, kept until they sign in so it can be created
// in their workspace (read by QuickAgentFlow).
const DRAFT_KEY = "voicera.tryDraft";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TryDraft {
  schemeIds: string[];
  language: string;
  savedAt: number;
}

export function saveTryDraft(schemeIds: string[], language: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ schemeIds, language, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: the visitor just starts fresh after sign-up */
  }
}

export function readTryDraft(): TryDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as TryDraft;
    if (!Array.isArray(d.schemeIds) || !d.schemeIds.length || typeof d.language !== "string") return null;
    if (Date.now() - (d.savedAt ?? 0) > DRAFT_TTL_MS) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearTryDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
