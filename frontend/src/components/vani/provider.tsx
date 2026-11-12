"use client";

import { AlertCircle, CheckCircle2, Info, LogIn, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "@/lib/vani/api";
import type { Org, Role } from "@/lib/vani/types";
import { can, type Permission } from "@/lib/vani/rbac";
import { Button, Dialog } from "./ui";

export interface SessionUser { id: string; name: string; email: string; role: Role; orgId: string; verified: boolean }
type Status = "loading" | "authed" | "anon" | "expired" | "error";

interface Toast { id: number; tone: "info" | "pass" | "bad"; message: string; action?: { label: string; run: () => void } }
interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }

interface Ctx {
  status: Status;
  /** True right after a deliberate sign-out, so screens don't treat it as an access error. */
  loggedOut: boolean;
  user: SessionUser | null;
  org: Org | null;
  expiresAt: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  toast: (message: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  /** Report an error from the API: expired sessions open the sign-in prompt, everything else becomes a toast. */
  fail: (e: unknown, fallback?: string) => string;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  can: (p: Permission) => boolean;
  theme: "light" | "dark" | "system";
  setTheme: (t: "light" | "dark" | "system") => void;
}
const C = createContext<Ctx | null>(null);
export const useVani = () => { const v = useContext(C); if (!v) throw new Error("VaniProvider missing"); return v; };

export const THEME_KEY = "vani.theme";
function applyTheme(t: "light" | "dark" | "system") {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.vaTheme = dark ? "dark" : "light";
}

export function messageOf(e: unknown, fallback = "Something went wrong. Try again."): string {
  if (e instanceof api.ApiError) return e.message;
  return fallback;
}

export function VaniProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>("loading");
  const [loggedOut, setLoggedOut] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [conf, setConf] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [theme, setThemeState] = useState<"light" | "dark" | "system">("system");
  const nextId = useRef(1);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getSession();
      setUser(s.user); setOrg(s.org); setExpiresAt(s.expiresAt); setStatus("authed"); setLoggedOut(false);
    } catch (e) {
      setUser(null); setOrg(null);
      setStatus(e instanceof api.ApiError ? (e.code === "session_expired" ? "expired" : e.code === "network" ? "error" : "anon") : "error");
    }
  }, []);

  useEffect(() => {
    // Load the session once on mount; this is syncing with external storage, not deriving state.
    let live = true;
    void (async () => { if (live) await refresh(); })();
    return () => { live = false; };
  }, [refresh]);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
    const t = saved === "light" || saved === "dark" ? saved : "system";
    const id = requestAnimationFrame(() => setThemeState(t));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if ((localStorage.getItem(THEME_KEY) ?? "system") === "system") applyTheme("system"); };
    mq.addEventListener("change", onChange);
    return () => { cancelAnimationFrame(id); mq.removeEventListener("change", onChange); };
  }, []);

  const setTheme = useCallback((t: "light" | "dark" | "system") => {
    setThemeState(t);
    try { if (t === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
    applyTheme(t);
  }, []);

  // Notice a session that ends while the page is open.
  useEffect(() => {
    if (status !== "authed" || !expiresAt) return;
    const check = () => { if (new Date(expiresAt).getTime() < Date.now()) setStatus("expired"); };
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [status, expiresAt]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info", action?: Toast["action"]) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, tone, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 9000 : 5000);
  }, []);

  const fail = useCallback((e: unknown, fallback?: string) => {
    const msg = messageOf(e, fallback);
    if (e instanceof api.ApiError && (e.code === "session_expired" || e.code === "unauthorized")) { setStatus((prev) => (prev === "expired" || e.code === "session_expired" ? "expired" : "anon")); return msg; }
    toast(msg, "bad");
    return msg;
  }, [toast]);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConf({ ...o, resolve })), []);
  const closeConf = (v: boolean) => { conf?.resolve(v); setConf(null); };

  const signOut = useCallback(async () => {
    setLoggedOut(true);
    await api.signOut();
    setUser(null); setOrg(null); setStatus("anon");
    router.push("/vani/signin?signedout=1");
  }, [router]);

  const value = useMemo<Ctx>(() => ({ status, loggedOut, user, org, expiresAt, refresh, signOut, toast, fail, confirm, can: (p) => can(user?.role, p), theme, setTheme }), [status, loggedOut, user, org, expiresAt, refresh, signOut, toast, fail, confirm, theme, setTheme]);

  return (
    <C.Provider value={value}>
      {children}
      <div className="va-toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className="va-toast va-rise" role={t.tone === "bad" ? "alert" : "status"}>
            {t.tone === "bad" ? <AlertCircle size={17} className="ic" aria-hidden /> : t.tone === "pass" ? <CheckCircle2 size={17} className="ic" aria-hidden /> : <Info size={17} className="ic" aria-hidden />}
            <div className="flex-1 min-w-0">{t.message}{t.action && <> <button onClick={() => { t.action?.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button></>}</div>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} style={{ textDecoration: "none" }}><X size={15} aria-hidden /></button>
          </div>
        ))}
      </div>
      <Dialog open={!!conf} onClose={() => closeConf(false)} title={conf?.title ?? ""} description={conf?.body}
        footer={<><Button onClick={() => closeConf(false)}>{conf?.cancelLabel ?? "Cancel"}</Button><Button variant={conf?.danger ? "danger" : "primary"} onClick={() => closeConf(true)} data-autofocus>{conf?.confirmLabel ?? "Confirm"}</Button></>} />
      <Dialog open={status === "expired" && pathname.startsWith("/vani/app")} onClose={() => {}} dismissable={false} title="Your session ended"
        description="For your security you were signed out. Everything you saved is still here."
        footer={<><Button variant="primary" icon={<LogIn size={15} />} data-autofocus onClick={() => { setStatus("anon"); router.push(`/vani/signin?expired=1&next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/vani/app")}`); }}>Sign in again</Button></>} />
    </C.Provider>
  );
}
