import { apiFetch } from "./http";

/** Public preview (no sign-up): see apps/api/app/routers/try_agent.py. */

export interface TryScheme {
  id: string;
  name: string;
  category: string;
  summary: string;
  benefit: string;
}

export interface TryLanguage {
  code: string;
  name: string;
  native: string;
}

export interface TryCatalogue {
  schemes: TryScheme[];
  languages: TryLanguage[];
  max_schemes: number | null;
  facts_checked: string | null;
  max_call_seconds: number;
}

export interface TryStack {
  stt: string;
  llm: string;
  tts: string;
}

export interface TryAgent {
  name: string;
  /** Opening line in the chosen language. */
  greeting: string;
  /** The same line in English (null when the agent speaks English). */
  english: string | null;
  scheme_ids: string[];
  stack: TryStack | null;
  stack_error?: string;
}

export interface TryPrepared {
  org_id: string;
  agent_id: string;
  preview_token: string;
  expires_at: string;
  max_call_seconds: number;
  stack: TryStack;
}

export interface TryCallSummary {
  fit: string[];
  explained: string[];
  outcome: string;
}

const post = <T,>(path: string, body: unknown, auth = false) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, auth);

export function getTryCatalogue(): Promise<TryCatalogue> {
  return apiFetch<TryCatalogue>("/try/catalogue", {}, false);
}

export function buildTryAgent(schemeIds: string[], language: string): Promise<TryAgent> {
  return post<TryAgent>("/try/agent", { scheme_ids: schemeIds, language });
}

export function prepareTryCall(schemeIds: string[], language: string, greeting: string): Promise<TryPrepared> {
  return post<TryPrepared>("/try/prepare", { scheme_ids: schemeIds, language, greeting });
}

export function registerTryCall(agentId: string, previewToken: string): Promise<{ call_id: string }> {
  return post<{ call_id: string }>("/try/call", { agent_id: agentId, preview_token: previewToken });
}

export function translateLines(language: string, texts: string[]): Promise<{ english: (string | null)[] }> {
  return post<{ english: (string | null)[] }>("/try/translate", { language, texts });
}

export function summariseTryCall(
  schemeIds: string[],
  transcript: { role: "agent" | "user"; text: string }[],
): Promise<TryCallSummary> {
  return post<TryCallSummary>("/try/summary", { scheme_ids: schemeIds, transcript });
}

/** Signed in: create the tried agent in the active workspace. */
export function saveTriedAgent(draft: TryDraft): Promise<{ agent_id: string; name: string }> {
  return post<{ agent_id: string; name: string }>(
    "/try/save",
    { scheme_ids: draft.schemeIds, language: draft.language, greeting: draft.greeting ?? null },
    true,
  );
}

// --- sign in with an emailed code -----------------------------------------------------

export interface CodeSignInResult {
  access_token: string;
  org_id: string;
  role: string;
  is_first_login?: boolean;
}

export function requestLoginCode(email: string): Promise<{ message: string }> {
  return post<{ message: string }>("/users/login-code", { email });
}

export function verifyLoginCode(email: string, code: string): Promise<CodeSignInResult> {
  return post<CodeSignInResult>("/users/login-code/verify", { email, code });
}

// The agent a visitor tried, kept until they sign in so it can be saved to
// their workspace (by the sign-in step, or by the dashboard as a fallback).
const DRAFT_KEY = "voicera.tryDraft";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TryDraft {
  schemeIds: string[];
  language: string;
  greeting?: string;
  savedAt: number;
}

export function saveTryDraft(draft: Omit<TryDraft, "savedAt">): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: the visitor just starts fresh after sign-in */
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
