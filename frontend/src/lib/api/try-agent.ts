import { apiFetch } from "./http";

/** No-login demo builder: see apps/api/app/routers/try_agent.py and app/services/demo/. */

export interface DemoTemplate {
  template_id: string;
  name: string;
  /** ANSWER, INFORM, GUIDE, REMIND, COLLECT or RESOLVE. */
  job: string;
  description: string;
  example_uses: string;
  q1: string;
  q2: string;
  q3: string;
}

export interface DemoSector {
  sector_id: string;
  name: string;
  description: string;
  example_topics: string;
}

export interface TryLanguage {
  code: string;
  name: string;
  native: string;
  beta?: boolean;
  /** A test call works in this language on this server right now. */
  call_ready?: boolean;
}

export function canCall(language: TryLanguage | undefined): boolean {
  return Boolean(language) && language?.call_ready !== false;
}

export interface TryCatalogue {
  kb_version: string;
  templates: DemoTemplate[];
  sectors: DemoSector[];
  languages: TryLanguage[];
  demo_language: string;
  max_call_seconds: number;
}

export interface DemoRole {
  role_id: string | null;
  you_are: string;
  try_asking: string;
}

export interface DemoService {
  card_id: string;
  title: string;
  steps: string;
  documents: string;
  fee_and_time: string;
  where_to_go: string;
  status: string;
}

/** What the first two questions show for a template and sector. */
export interface DemoSources {
  template_id: string;
  sector_id: string;
  kb_version: string;
  cards: {
    count: number;
    verified: number;
    partly_verified: number;
    preview: { card_id: string; title: string; type: string; status: string }[];
  };
  flows: { flow_id: string; name: string }[];
  record: { record_id: string; person: string; details: string; date_or_ref: string } | null;
  role: DemoRole;
  helpline: string | null;
  announcement?: string;
  audience?: string;
  reminder?: string;
  survey?: { flow_id: string | null; questions: string[] };
  complaints?: { flow_id: string; name: string; goes_to: string }[];
  services?: DemoService[];
  service_match?: string | null;
}

/** The visitor's answers; the server builds the agent from these ids only. */
export interface DemoAnswers {
  template_id: string;
  sector_id: string;
  language: string;
  topic?: string;
  sample_knowledge?: boolean;
  source_ids?: string[];
  announcement?: string;
  audience?: string;
  reminder?: string;
  if_cant_make_it?: "reschedule" | "helpline";
  survey_questions?: string[];
  complaint_flows?: string[];
  service_card_id?: string;
}

export interface RouteResult {
  template_id: string | null;
  sector_id: string | null;
  topic: string;
  language: string | null;
  confidence: number;
  ask_next: "q1" | "q2" | "q3" | null;
  reason: string;
  source: "model" | "keywords";
}

export interface AddedSource {
  source_id: string;
  kind: "upload" | "link";
  name: string;
  card_count: number;
  titles: string[];
}

export interface TryStack {
  stt: string;
  llm: string;
  tts: string;
}

export interface TryAgent {
  name: string;
  template: { template_id: string; name: string; job: string };
  sector: { sector_id: string; name: string };
  language: string;
  /** Opening greeting in the call language (editable). */
  greeting: string;
  /** The same greeting in English (null when the agent speaks English). */
  greeting_english: string | null;
  /** The AI and demo notice, always spoken with the greeting. */
  notice: string;
  opening: string;
  opening_english: string | null;
  cards: number;
  session_cards: number;
  flows: number;
  role: DemoRole;
  kb_version: string;
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
  opening: string;
}

export interface CallRecordField {
  key: string;
  label: string;
  kind: string;
  value: string | string[] | null;
}

export interface TryCallSummary {
  fields: CallRecordField[];
  recorded_by_agent: boolean;
  flows: { flow_id: string; name: string }[];
  cards: { card_id: string; title: string }[];
  gaps: string[];
  steps: { flow_id: string; step: number }[];
}

export interface CallProgress {
  active_flow: string | null;
  step: number | null;
  turns: { at: string; tool: string; flow_id: string | null; step: number | null }[];
}

export interface CallRef {
  agent_id: string;
  preview_token: string;
  call_id: string;
}

const post = <T,>(path: string, body: unknown, auth = false) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, auth);

export function getTryCatalogue(): Promise<TryCatalogue> {
  return apiFetch<TryCatalogue>("/try/catalogue", {}, false);
}

export function getDemoSources(templateId: string, sectorId: string, topic = ""): Promise<DemoSources> {
  const q = new URLSearchParams({ template_id: templateId, sector_id: sectorId, topic });
  return apiFetch<DemoSources>(`/try/sources?${q}`, {}, false);
}

export function routeDescription(text: string): Promise<RouteResult> {
  return post<RouteResult>("/try/route", { text });
}

export function uploadSource(file: File): Promise<AddedSource> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<AddedSource>("/try/sources/upload", { method: "POST", body }, false);
}

export function addLinkSource(url: string): Promise<AddedSource> {
  return post<AddedSource>("/try/sources/link", { url });
}

export function buildTryAgent(answers: DemoAnswers): Promise<TryAgent> {
  return post<TryAgent>("/try/agent", { answers });
}

export function prepareTryCall(answers: DemoAnswers, greeting: string | null): Promise<TryPrepared> {
  return post<TryPrepared>("/try/prepare", { answers, greeting });
}

export function registerTryCall(agentId: string, previewToken: string): Promise<{ call_id: string }> {
  return post<{ call_id: string }>("/try/call", { agent_id: agentId, preview_token: previewToken });
}

export function translateLines(language: string, texts: string[]): Promise<{ english: (string | null)[] }> {
  return post<{ english: (string | null)[] }>("/try/translate", { language, texts });
}

export function getCallProgress(ref: CallRef): Promise<CallProgress> {
  return post<CallProgress>("/try/progress", ref);
}

export function summariseTryCall(
  ref: CallRef,
  transcript: { role: "agent" | "user"; text: string }[],
): Promise<TryCallSummary> {
  return post<TryCallSummary>("/try/summary", { ...ref, transcript });
}

/** Signed in: create the tried agent in the active workspace. */
export function saveTriedAgent(draft: DemoDraft): Promise<{ agent_id: string; name: string }> {
  return post<{ agent_id: string; name: string }>("/try/save", { answers: draft.answers, greeting: draft.greeting ?? null }, true);
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

// --- the agent a visitor built, kept until they sign in -------------------------------
// Saved to their workspace by the sign-in step, or by the dashboard as a fallback.

const DEMO_DRAFT_KEY = "voicera.demoDraft";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface DemoDraft {
  answers: DemoAnswers;
  greeting?: string;
  label: string;
  savedAt: number;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function saveDemoDraft(draft: Omit<DemoDraft, "savedAt">): void {
  try {
    localStorage.setItem(DEMO_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: the visitor just starts fresh after sign-in */
  }
}

export function readDemoDraft(): DemoDraft | null {
  const d = readJson<DemoDraft>(DEMO_DRAFT_KEY);
  if (!d || !d.answers?.template_id || !d.answers?.sector_id || !d.answers?.language) return null;
  if (Date.now() - (d.savedAt ?? 0) > DRAFT_TTL_MS) return null;
  return d;
}

export function clearDemoDraft(): void {
  remove(DEMO_DRAFT_KEY);
}

// The earlier scheme-discovery preview kept a different draft; visitors who
// tried it before this release still finish it in the quick setup.
const LEGACY_DRAFT_KEY = "voicera.tryDraft";

export interface TryDraft {
  schemeIds: string[];
  language: string;
  greeting?: string;
  savedAt: number;
}

export function readTryDraft(): TryDraft | null {
  const d = readJson<TryDraft>(LEGACY_DRAFT_KEY);
  if (!d || !Array.isArray(d.schemeIds) || !d.schemeIds.length || typeof d.language !== "string") return null;
  if (Date.now() - (d.savedAt ?? 0) > DRAFT_TTL_MS) return null;
  return d;
}

export function clearTryDraft(): void {
  remove(LEGACY_DRAFT_KEY);
}
