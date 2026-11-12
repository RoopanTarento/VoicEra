"use client";

import { Check, CircleAlert, Cloud, CloudOff, Lock, RefreshCw } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "@/lib/vani/api";
import { stateOf } from "@/lib/vani/status";
import { can as canDo, denial } from "@/lib/vani/rbac";
import { STEPS, stepIndex, type Hosting, type PackageRecord, type Requirements, type Simulation, type StepId } from "@/lib/vani/types";
import { Page, ErrorState, useAsync } from "./page";
import { messageOf, useVani } from "./provider";
import { useCrumb } from "./shell";
import { Alert, Badge, Button, Skeleton, Spinner, cx } from "./ui";
import { StateBadge } from "./pages";

type SaveState = "saved" | "dirty" | "saving" | "error";

interface WS {
  pkg: PackageRecord;
  readOnly: boolean;
  locked: boolean;
  role: string;
  saveState: SaveState;
  savedAt: number | null;
  ratesAsOf: string;
  simulation: Simulation;
  setRequirements: (f: (r: Requirements) => Requirements) => void;
  setHosting: (f: (h: Hosting) => Hosting) => void;
  /** Replace the package with what the server returned after an operation. */
  apply: (p: PackageRecord) => void;
  flush: (extra?: { step?: StepId; reached?: StepId[] }) => Promise<boolean>;
  go: (step: StepId) => Promise<void>;
  continueRef: React.MutableRefObject<(() => Promise<boolean> | boolean) | null>;
  refreshSim: () => void;
}
const Ctx = createContext<WS | null>(null);
export const usePackage = () => { const c = useContext(Ctx); if (!c) throw new Error("PackageWorkspace missing"); return c; };

export function PackageWorkspace({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const q = useAsync(() => api.getPackage(id), `pkg-${id}`);
  if (q.error) return <Page><ErrorState error={q.error} onRetry={q.reload} title={undefined} /></Page>;
  if (q.loading || !q.data) {
    return (
      <Page wide><Skeleton w={260} h={30} /><div className="mt-6"><Skeleton h={48} r={12} /></div><div className="mt-6 grid gap-4 lg:grid-cols-[1fr_340px]"><Skeleton h={420} r={12} /><Skeleton h={320} r={12} /></div></Page>
    );
  }
  return <Inner key={q.data.pkg.id} initial={q.data.pkg} role={q.data.role} ratesAsOf={q.data.ratesAsOf} simulation={q.data.simulation}>{children}</Inner>;
}

function Inner({ initial, role, ratesAsOf, simulation: sim0, children }: { initial: PackageRecord; role: string; ratesAsOf: string; simulation: Simulation; children: ReactNode }) {
  const router = useRouter();
  const { fail, toast, confirm } = useVani();
  const [pkg, setPkg] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [simulation, setSim] = useState(sim0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(pkg);
  const dirty = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const continueRef = useRef<(() => Promise<boolean> | boolean) | null>(null);
  useEffect(() => { latest.current = pkg; });
  useCrumb(pkg.name);

  const locked = !!pkg.quote && pkg.quote.state !== "draft";
  const readOnly = locked || !canDo(role as never, "edit");

  const save = useCallback(async (extra?: { step?: StepId; reached?: StepId[] }, silent = true): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inflight.current) await inflight.current;
    const cur = latest.current;
    if (!dirty.current && !extra) { if (!silent) toast("Draft saved.", "pass"); return true; }
    setSaveState("saving");
    const run = (async () => {
      try {
        const patch: api.Patch = { requirements: cur.requirements, hosting: cur.hosting, ...(extra ?? {}) };
        const saved = await api.savePackage(cur.id, patch, { silent });
        dirty.current = false;
        setPkg((p) => ({ ...p, name: saved.name, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy, ...(extra?.step ? { step: extra.step } : {}), ...(extra?.reached ? { reached: extra.reached } : {}) }));
        setSaveState("saved"); setSavedAt(Date.now());
        return true;
      } catch (e) {
        setSaveState("error");
        fail(e, "We couldn't save your changes.");
        return false;
      }
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    if (ok && !silent) toast("Draft saved.", "pass");
    return ok;
  }, [fail, toast]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 700);
  }, [save]);

  const setRequirements = useCallback((f: (r: Requirements) => Requirements) => { if (locked || !canDo(role as never, "edit")) return; setPkg((p) => { const next = { ...p, requirements: f(p.requirements) }; latest.current = next; return next; }); schedule(); }, [schedule, locked, role]);
  const setHosting = useCallback((f: (h: Hosting) => Hosting) => { if (locked || !canDo(role as never, "edit")) return; setPkg((p) => { const next = { ...p, hosting: f(p.hosting) }; latest.current = next; return next; }); schedule(); }, [schedule, locked, role]);
  const apply = useCallback((p: PackageRecord) => { setPkg(p); latest.current = p; }, []);

  const go = useCallback(async (step: StepId) => {
    const cur = latest.current;
    const reached = cur.reached.includes(step) ? cur.reached : [...cur.reached, step];
    if (readOnly) { router.push(`/vani/app/packages/${cur.id}/${step}`); return; }
    const ok = await save({ step, reached });
    if (!ok) {
      const leave = await confirm({ title: "Couldn't save your changes", body: "If you leave now, your latest edits on this step may be lost. Stay and try saving again?", confirmLabel: "Leave anyway", cancelLabel: "Stay" });
      if (!leave) return;
    }
    router.push(`/vani/app/packages/${cur.id}/${step}`);
  }, [save, router, confirm, readOnly]);

  // Never lose work: save on leaving, and warn if a save is outstanding when the tab closes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); if (dirty.current) void api.savePackage(latest.current.id, { requirements: latest.current.requirements, hosting: latest.current.hosting }, { silent: true }).catch(() => {}); };
  }, []);

  const refreshSim = useCallback(() => { void api.getSimulation().then(setSim).catch(() => {}); }, []);

  const value = useMemo<WS>(() => ({ pkg, readOnly, locked, role, saveState, savedAt, ratesAsOf, simulation, setRequirements, setHosting, apply, flush: (e) => save(e), go, continueRef, refreshSim }), [pkg, readOnly, locked, role, saveState, savedAt, ratesAsOf, simulation, setRequirements, setHosting, apply, save, go, refreshSim]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ chrome shared by every step */

function SaveIndicator() {
  const { saveState, savedAt, flush, readOnly } = usePackage();
  if (readOnly) return <span className="muted flex items-center gap-1.5" style={{ fontSize: 12.5 }}><Lock size={13} aria-hidden />Read only</span>;
  const t = savedAt ? new Date(savedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <span className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: saveState === "error" ? "var(--bad)" : "var(--muted)" }} role="status" aria-live="polite">
      {saveState === "saving" || saveState === "dirty" ? <Spinner size={13} /> : saveState === "error" ? <CloudOff size={14} aria-hidden /> : <Cloud size={14} aria-hidden />}
      {saveState === "saving" ? "Saving" : saveState === "dirty" ? "Unsaved changes" : saveState === "error" ? <>Not saved. <button className="va-link" onClick={() => void flush()}>Retry</button></> : t ? `Saved ${t}` : "All changes saved"}
    </span>
  );
}

export function Stepper() {
  const { pkg, go, continueRef } = usePackage();
  const cur = stepIndex(pkg.step);
  const highest = Math.max(...pkg.reached.map(stepIndex), 0);
  const params = useParams<{ step?: string }>();
  const viewing = stepIndex((params.step ?? pkg.step) as StepId);
  return (
    <nav aria-label="Package steps" className="va-noprint">
      <ol className="flex items-center m-0 p-0 list-none gap-1 sm:gap-2" style={{ overflowX: "auto" }}>
        {STEPS.map((s, i) => {
          const state = i === viewing ? "current" : pkg.reached.includes(s.id) || i < highest ? "done" : "todo";
          const enabled = pkg.reached.includes(s.id) || i === highest + 1;
          return (
            <li key={s.id} className="flex items-center flex-1 last:flex-none min-w-0" style={i === viewing ? { flex: "0 0 auto" } : undefined}>
              <button type="button" className="va-step" data-state={state} disabled={!enabled} aria-current={i === viewing ? "step" : undefined} onClick={async () => { if (i > viewing && continueRef.current && !(await continueRef.current())) return; void go(s.id); }} title={s.label}>
                <span className="n">{state === "done" ? <Check size={13} strokeWidth={3} aria-hidden /> : s.n}</span>
                <span className={cx("truncate", i !== viewing && "hidden xl:inline")} style={{ fontSize: 13, fontWeight: i === viewing ? 600 : 500 }}>{s.label}<span className="sr-only">{state === "done" ? ", completed" : ""}</span></span>
              </button>
              {i < STEPS.length - 1 && <span className="va-stepline mx-1 hidden sm:block" aria-hidden><i style={{ transform: `scaleX(${i < viewing || (pkg.reached.includes(STEPS[i + 1].id) && i < cur) ? 1 : 0})` }} /></span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WorkspaceHeader() {
  const { pkg, locked, role } = usePackage();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 va-noprint">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="truncate" style={{ fontSize: 20 }}>{pkg.name}</h1>
        <StateBadge p={pkg} />
        {pkg.quote && <Badge>{pkg.quote.id}</Badge>}
        {pkg.versions.length > 0 && <Badge tone="info">{pkg.versions[pkg.versions.length - 1].label}</Badge>}
      </div>
      <div className="flex items-center gap-4"><SaveIndicator />{locked && <span className="sr-only">{role}</span>}</div>
    </div>
  );
}

export function ReadOnlyNotice() {
  const { pkg, readOnly, locked, role, apply } = usePackage();
  const { user, fail, toast } = useVani();
  const [busy, setBusy] = useState(false);
  if (!readOnly) return null;
  const canEditRole = canDo(role as never, "edit");
  return (
    <Alert tone="info" className="mb-5" title={locked ? (stateOf(pkg) === "approved" ? "This quote is approved" : "This quote is waiting for approval") : "View only"}
      action={locked && canEditRole ? <Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { apply(await api.reopenQuote(pkg.id)); toast("Reopened as a draft. You can edit again.", "pass"); } catch (e) { fail(e); } finally { setBusy(false); } }}>Reopen as draft</Button> : undefined}>
      {locked ? "Changes are locked so the quote stays accurate." + (canEditRole ? "" : " " + denial(user?.role, "edit")) : denial(user?.role, "edit")}
    </Alert>
  );
}

export function StepFooter({ stepId, nextLabel, hideNext }: { stepId: StepId; nextLabel?: string; hideNext?: boolean }) {
  const { pkg, go, flush, continueRef, readOnly } = usePackage();
  const router = useRouter();
  const { toast } = useVani();
  const [busy, setBusy] = useState<"next" | "save" | null>(null);
  const i = stepIndex(stepId);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  return (
    <div className="va-noprint sticky bottom-0 z-20 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 mt-8 flex flex-wrap items-center justify-between gap-3" style={{ background: "color-mix(in srgb, var(--bg) 92%, transparent)", backdropFilter: "blur(10px)", borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center gap-2">
        {prev ? <Button onClick={() => void go(prev.id)}>Back</Button> : <Button onClick={() => router.push("/vani/app/packages")}>Packages</Button>}
        {!readOnly && <Button variant="ghost" loading={busy === "save"} onClick={async () => { setBusy("save"); const ok = await flush({ step: stepId, reached: pkg.reached.includes(stepId) ? pkg.reached : [...pkg.reached, stepId] }); setBusy(null); if (ok) toast("Draft saved.", "pass"); }}>Save draft</Button>}
        {!readOnly && <Button variant="ghost" onClick={async () => { setBusy("save"); const ok = await flush({ step: stepId, reached: pkg.reached.includes(stepId) ? pkg.reached : [...pkg.reached, stepId] }); setBusy(null); if (ok) { toast(`Saved. Resume "${pkg.name}" from Packages whenever you're ready.`, "pass"); router.push("/vani/app/packages"); } }}>Resume later</Button>}
      </div>
      {!hideNext && next && (
        <Button variant="primary" size="lg" loading={busy === "next"} iconRight={<span aria-hidden>→</span>} onClick={async () => {
          setBusy("next");
          const ok = continueRef.current ? await continueRef.current() : true;
          if (ok) await go(next.id);
          setBusy(null);
        }}>{nextLabel ?? `Continue to ${next.label.toLowerCase()}`}</Button>
      )}
    </div>
  );
}

export function useContinue(fn: () => Promise<boolean> | boolean) {
  const { continueRef } = usePackage();
  useEffect(() => { continueRef.current = fn; return () => { continueRef.current = null; }; });
}

export { RefreshCw, CircleAlert, messageOf };
