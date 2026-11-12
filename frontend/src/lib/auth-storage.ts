import { clearActivityTracking, touchActivity } from "@/lib/session-timeout";

const TOKEN_KEY = "voicera_access_token";
const SESSION_KEY = "voicera_session";

export interface AuthSession {
  accessToken: string;
  email: string;
  name?: string;
  orgId: string;
  orgName?: string;
  role: string;
}

/** Local-only token for the dev "demo mode" sign-in. It never leaves the
 * browser: the API client refuses to send it anywhere (see lib/api/http.ts). */
export const DEMO_TOKEN = "voicera-demo-local";

export function isDemoToken(token: string | null | undefined): boolean {
  return token === DEMO_TOKEN;
}

export const DEMO_MESSAGE =
  "Demo mode: no backend is connected, so this action is unavailable. Sign in with a real account to use it.";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession) {
  localStorage.setItem(TOKEN_KEY, session.accessToken);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // Fresh login / session write starts the active-session inactivity clock.
  touchActivity();
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  clearActivityTracking();
}
