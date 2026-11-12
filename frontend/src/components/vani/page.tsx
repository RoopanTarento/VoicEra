"use client";

import { AlertCircle, Lock, RefreshCw, ServerCrash, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/vani/api";
import { useVani } from "./provider";
import { Alert, Button, cx } from "./ui";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="serif" style={{ fontSize: "clamp(26px, 3vw, 34px)", lineHeight: 1.12, color: "var(--ink)" }}>{title}</h1>
        {description && <p className="mt-2" style={{ maxWidth: 620 }}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const Page = ({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) => (
  <div className={cx("mx-auto px-4 sm:px-8 py-8 sm:py-10", className)} style={{ maxWidth: wide ? 1320 : 1120 }}>{children}</div>
);

/** Loads data. Loading is derived, so there is no setState in the effect body. */
export function useAsync<T>(fn: () => Promise<T>, key: string) {
  const [v, setV] = useState(0);
  const [res, setRes] = useState<{ k: string; data?: T; error?: unknown } | null>(null);
  const { fail } = useVani();
  const k = `${key}#${v}`;
  useEffect(() => {
    let live = true;
    fn().then((data) => { if (live) setRes({ k, data }); }).catch((error) => { if (live) { setRes({ k, error }); if (error instanceof ApiError && (error.code === "session_expired" || error.code === "unauthorized")) fail(error); } });
    return () => { live = false; };
    // fn is recreated each render; the key identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  const reload = useCallback(() => setV((x) => x + 1), []);
  const current = res && res.k === k ? res : null;
  const stale = res?.data;
  return { data: current?.data ?? stale, error: current?.error, loading: !current, reload, set: (d: T) => setRes({ k, data: d }) };
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const e = error instanceof ApiError ? error : null;
  const Icon = e?.code === "network" ? WifiOff : e?.code === "forbidden" ? Lock : e?.code === "not_found" ? AlertCircle : ServerCrash;
  const heading = title ?? (e?.code === "network" ? "You're offline" : e?.code === "forbidden" ? "You don't have access" : e?.code === "not_found" ? "We couldn't find that" : "Something went wrong");
  return (
    <div className="mx-auto text-center" style={{ maxWidth: 440, padding: "56px 16px" }} role="alert">
      <div className="mx-auto mb-4 grid place-content-center" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--bad-soft)", color: "var(--bad)" }}><Icon size={20} aria-hidden /></div>
      <h2 style={{ fontSize: 18 }}>{heading}</h2>
      <p className="mt-2">{e?.message ?? "We hit a problem loading this. Your saved work is safe."}</p>
      {onRetry && e?.code !== "forbidden" && <Button className="mt-5" icon={<RefreshCw size={15} />} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Meta({ k, children }: { k: string; children: ReactNode }) {
  return <div><dt className="eyebrow" style={{ fontSize: 10.5 }}>{k}</dt><dd className="m-0 mt-1 ink" style={{ fontWeight: 500 }}>{children}</dd></div>;
}

export { Alert };
