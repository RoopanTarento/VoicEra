"use client";

import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import * as api from "@/lib/vani/api";
import { AVAILABILITY, PII_TYPES, SAMPLE_NOTICE, SUPPORT_MODELS } from "@/lib/vani/catalog";
import { policyChecks, policySummary, unresolvedChecks, type PolicyCheck } from "@/lib/vani/policy";
import { denial } from "@/lib/vani/rbac";
import type { Hosting, PiiType } from "@/lib/vani/types";
import { useEstimate } from "./estimate";
import { useVani } from "./provider";
import { Alert, Button, Checkbox, Drawer, Field, Input, Radio, Select, StatusBadge, Textarea, Tooltip, cx } from "./ui";
import { usePackage } from "./workspace";

export function usePolicy() {
  const { pkg } = usePackage();
  const est = useEstimate(pkg);
  const sel = pkg.selection ?? est.top?.eval.selection ?? null;
  const checks = useMemo(() => policyChecks(pkg.requirements, pkg.hosting, sel, pkg.openItems), [pkg.requirements, pkg.hosting, pkg.openItems, sel]);
  return { checks, summary: policySummary(checks), open: unresolvedChecks(checks) };
}

/** Saves everything pending, applies a decision on the server, and takes the result back. */
function useDecide() {
  const { pkg, flush, apply, readOnly } = usePackage();
  const { fail, toast, can, user } = useVani();
  const allowed = can("resolve") && !readOnly;
  const decide = async (checkId: string, d: Parameters<typeof api.decideCheck>[2], message: string) => {
    if (!(await flush())) return false;
    try { apply(await api.decideCheck(pkg.id, checkId, d)); toast(message, "pass"); return true; } catch (e) { fail(e); return false; }
  };
  return { decide, allowed, why: readOnly ? "This package is read only right now." : denial(user?.role, "resolve") };
}

function ResolveBody({ check, onDone }: { check: PolicyCheck; onDone: () => void }) {
  const { pkg } = usePackage();
  const h = pkg.hosting;
  const { decide } = useDecide();
  const [notice, setNotice] = useState(h.callerNotice);
  const [by, setBy] = useState(h.retentionConfirmedBy);
  const [checked, setChecked] = useState(false);
  const [support, setSupport] = useState<Hosting["support"]>(h.support === "unset" ? "extended" : h.support);
  const [dr, setDr] = useState<"add" | "lower">("add");
  const [avail, setAvail] = useState(99.5);
  const [pii, setPii] = useState<PiiType[]>(h.pii.length ? h.pii : ["phone", "name", "govid"]);
  const [recording, setRecording] = useState<"off" | "consent">("consent");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (id: string, d: Parameters<typeof api.decideCheck>[2], msg: string) => { setBusy(true); setErr(null); const ok = await decide(id, d, msg); setBusy(false); if (ok) onDone(); };
  const c = check;
  if (c.resolve === "notice") return (
    <div className="grid gap-4">
      <Field label="Notice read to every caller" help="Plain words, short, in the language callers speak. Legal should review the final text."
        error={err}>{(p) => <Textarea {...p} rows={6} value={notice} onChange={(e) => { setNotice(e.target.value); setErr(null); }} />}</Field>
      <div><Button size="sm" onClick={() => setNotice(SAMPLE_NOTICE)}>Use the sample text</Button></div>
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => { if (notice.trim().length < 20) { setErr("Write at least a sentence so callers know what is happening."); return; } void run(c.id, { state: "resolved", hosting: { callerNotice: notice.trim() } }, "Caller notice saved."); }}>Save notice</Button></div>
    </div>
  );
  if (c.resolve === "retention") return (
    <div className="grid gap-4">
      <p>Retention periods are a records-policy decision. Someone accountable should confirm them.</p>
      <Field label="Confirmed by" help="Name and role." error={err}>{(p) => <Input {...p} value={by} onChange={(e) => { setBy(e.target.value); setErr(null); }} placeholder="Asha Verma, Records Officer" />}</Field>
      <Checkbox checked={checked} onChange={setChecked} label="I have checked these periods against our records policy" />
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => { if (!by.trim()) { setErr("Enter who confirmed this."); return; } if (!checked) { setErr("Tick the box to confirm you checked the periods."); return; } void run(c.id, { state: "resolved", hosting: { retentionConfirmedBy: by.trim() } }, "Retention confirmed."); }}>Confirm retention</Button></div>
    </div>
  );
  if (c.resolve === "support") return (
    <div className="grid gap-4">
      <div role="radiogroup" aria-label="Support model" className="grid gap-3">{SUPPORT_MODELS.filter((m) => m.id !== "unset").map((m) => <Radio key={m.id} name="sup" label={`${m.label} (₹${m.fee.toLocaleString("en-IN")} a month)`} description={m.help} checked={support === m.id} onChange={() => setSupport(m.id)} />)}</div>
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => void run(c.id, { state: "resolved", hosting: { support } }, "Support model chosen.")}>Choose</Button></div>
    </div>
  );
  if (c.resolve === "dr") return (
    <div className="grid gap-4">
      <p>{c.what}</p>
      <Radio name="dr" label="Add a recovery site" description="Adds a monthly cost and a one-time setup. Keeps the availability target." checked={dr === "add"} onChange={() => setDr("add")} />
      <Radio name="dr" label="Lower the availability target" description="Cheaper, with a single site." checked={dr === "lower"} onChange={() => setDr("lower")} />
      {dr === "lower" && <Field label="New target">{(p) => <Select {...p} value={avail} onChange={(e) => setAvail(Number(e.target.value))}>{AVAILABILITY.filter((a) => a < 99.9).map((a) => <option key={a} value={a}>{a}%</option>)}</Select>}</Field>}
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => void run(c.id, { state: "resolved", hosting: dr === "add" ? { disasterRecovery: true } : { availability: avail } }, dr === "add" ? "Recovery site added." : "Availability target lowered.")}>Apply</Button></div>
    </div>
  );
  if (c.resolve === "pii") return (
    <div className="grid gap-4">
      <p>Choose what to detect and redact before transcripts are stored.</p>
      <div className="grid gap-3">{PII_TYPES.filter((t) => t.id !== "custom").map((t) => <Checkbox key={t.id} label={t.label} checked={pii.includes(t.id)} onChange={(v) => setPii((x) => (v ? [...x, t.id] : x.filter((y) => y !== t.id)))} />)}</div>
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => { if (!pii.length) { setErr("Choose at least one type."); return; } void run(c.id, { state: "resolved", hosting: { pii } }, "PII types saved."); }}>Save</Button></div>
      {err && <p className="va-error" role="alert">{err}</p>}
    </div>
  );
  if (c.resolve === "recording") return (
    <div className="grid gap-4">
      <p>{c.why}</p>
      <Radio name="rec" label="Record only when the caller agrees" description="The notice asks for consent. Callers who decline are not recorded." checked={recording === "consent"} onChange={() => setRecording("consent")} />
      <Radio name="rec" label="Don't record calls" description="No audio is kept." checked={recording === "off"} onChange={() => setRecording("off")} />
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => void run(c.id, { state: "resolved", hosting: { recording } }, "Recording policy updated.")}>Apply</Button></div>
      <hr className="va-divider" />
      <p className="muted" style={{ fontSize: 13 }}>Or keep recording every call and accept the risk, with a reason.</p>
      <Field label="Reason" error={err}>{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} />}</Field>
      <div className="flex justify-end"><Button loading={busy} onClick={() => { if (!reason.trim()) { setErr("Write a short reason. It goes in the audit log."); return; } void run(c.id, { state: "accepted", note: reason }, "Accepted, with your reason on record."); }}>Accept risk</Button></div>
    </div>
  );
  if (c.resolve === "accept") return (
    <div className="grid gap-4">
      <div><p className="eyebrow mb-1">What we found</p><p>{c.what}</p></div>
      <div><p className="eyebrow mb-1">Why it matters</p><p>{c.why}</p></div>
      <div><p className="eyebrow mb-1">How to clear it</p><p>{c.how}</p></div>
      <Field label="Your decision and reason" help="Recorded in the audit log with your name." error={err}>{(p) => <Textarea {...p} rows={4} value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} placeholder="For example: Pilot of 500 real calls planned for week 2." />}</Field>
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => { if (!reason.trim()) { setErr("Write a short reason. It goes in the audit log."); return; } void run(c.id, { state: "accepted", note: reason }, "Accepted, with your reason on record."); }}>Accept and continue</Button></div>
    </div>
  );
  return <p>{c.how}</p>;
}

export function PolicyRow({ check, defaultOpen }: { check: PolicyCheck; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [drawer, setDrawer] = useState(false);
  const { allowed, why } = useDecide();
  const needs = check.effective === "check" || check.effective === "open";
  const canResolve = check.resolve !== "none";
  const status = check.effective;
  return (
    <li className="va-prow">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button type="button" aria-expanded={open} className="flex items-center gap-3 flex-1 min-w-0 text-left" style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
          <StatusBadge status={status} />
          <span className="min-w-0 flex-1"><span className="ink block" style={{ fontWeight: 600 }}>{check.title}</span><span className="muted block truncate" style={{ fontSize: 12.5 }}>{check.what}</span></span>
          <ChevronDown size={16} className="muted flex-none" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} aria-hidden />
        </button>
        {needs && canResolve && (allowed ? <Button size="sm" onClick={() => setDrawer(true)}>Resolve</Button> : <Tooltip text={why}><span><Button size="sm" disabled>Resolve</Button></span></Tooltip>)}
      </div>
      {open && (
        <div className="px-4 pb-4 va-fade grid gap-3 sm:grid-cols-3" style={{ fontSize: 13 }}>
          <div><p className="eyebrow mb-1">What</p><p>{check.what}</p></div>
          <div><p className="eyebrow mb-1">Why it matters</p><p>{check.why}</p></div>
          <div><p className="eyebrow mb-1">{status === "accepted" ? "Decision" : "How to clear it"}</p><p>{status === "accepted" ? `${check.record?.by ?? "Someone"} accepted this${check.record?.note ? `: "${check.record.note}"` : ""}.` : check.how}</p></div>
        </div>
      )}
      <Drawer open={drawer} onClose={() => setDrawer(false)} title={`Resolve: ${check.title}`} description={<span className="inline-flex items-center gap-2"><StatusBadge status={status} /></span>}>
        <ResolveBody check={check} onDone={() => setDrawer(false)} />
      </Drawer>
    </li>
  );
}

export function PolicyList({ checks, onlyOpen, className }: { checks: PolicyCheck[]; onlyOpen?: boolean; className?: string }) {
  const rows = onlyOpen ? checks.filter((c) => c.effective === "check" || c.effective === "open") : checks;
  const order = { open: 0, check: 1, accepted: 2, pass: 3 } as const;
  return <ul className={cx("m-0 p-0 list-none va-card overflow-hidden", className)}>{[...rows].sort((a, b) => order[a.effective] - order[b.effective]).map((c) => <PolicyRow key={c.id} check={c} />)}</ul>;
}

export function PolicySummary({ summary }: { summary: ReturnType<typeof policySummary> }) {
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 13 }}>
      <span><b className="ink">{summary.pass}</b> pass</span>
      {summary.accepted > 0 && <span><b className="ink">{summary.accepted}</b> accepted</span>}
      <span><b className="ink" style={{ color: summary.check ? "var(--warn)" : undefined }}>{summary.check}</b> to check</span>
      <span><b className="ink" style={{ color: summary.open ? "var(--bad)" : undefined }}>{summary.open}</b> open</span>
    </p>
  );
}

export { Alert };
