"use client";

import { Bot, Download, FileSpreadsheet, FileText, Printer, Save, Send, ThumbsUp, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/vani/api";
import { ago, dateLong, dateTime } from "@/lib/vani/format";
import { isStale } from "@/lib/vani/packages";
import { unresolvedChecks } from "@/lib/vani/policy";
import { buildQuote, quoteCsv, quotePdf, type QuoteDoc } from "@/lib/vani/quote";
import { denial } from "@/lib/vani/rbac";
import { costOf } from "@/lib/vani/packages";
import { PolicyList, usePolicy } from "./policy-ui";
import { useVani } from "./provider";
import { Alert, Badge, Button, Dialog, Field, Skeleton, Textarea, Tooltip } from "./ui";
import { ReadOnlyNotice, StepFooter, Stepper, WorkspaceHeader, usePackage } from "./workspace";

const STATE_TONE = { draft: "neutral", submitted: "info", approved: "pass" } as const;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return <div className="row"><div className="k">{k}</div><div className="v">{v}{note && <span style={{ color: "#6b6e77", fontSize: 12 }}> ({note})</span>}</div></div>;
}

function QuoteDocument({ d }: { d: QuoteDoc }) {
  return (
    <article className="va-doc print-area p-6 sm:p-10" aria-label={`Quote ${d.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 pb-6" style={{ borderBottom: "2px solid #17181c" }}>
        <div><p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b6e77", fontWeight: 600 }}>Vani Anuvaad · Quote</p><h2 className="serif" style={{ fontSize: 34, lineHeight: 1.1, marginTop: 8, color: "#17181c" }}>{d.packageName}</h2><p style={{ marginTop: 8, color: "#4b4e57", fontSize: 13.5 }}>{d.org}</p></div>
        <div className="text-right"><span className="inline-block px-2.5 py-1" style={{ border: "1.5px solid #17181c", borderRadius: 4, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", color: "#17181c" }}>{d.state.toUpperCase()}</span></div>
      </header>
      <section className="sec"><h3>Quote</h3><Row k="Quote ID" v={d.id} /><Row k="Package version" v={d.version} /><Row k="Created" v={`${dateLong(d.createdAt)} by ${d.createdBy}`} /><Row k="Valid until" v={dateLong(d.validUntil)} /></section>
      <section className="sec"><h3>Deployment</h3>{d.deployment.map((r) => <Row key={r.label} k={r.label} v={r.value} />)}</section>
      <section className="sec"><h3>Configuration</h3>{d.configuration.map((r) => <Row key={r.label} k={r.label} v={r.value} />)}</section>
      <section className="sec"><h3>Usage assumptions</h3>{d.usage.map((r) => <Row key={r.label} k={r.label} v={r.value} />)}</section>
      {d.performance.length > 0 && <section className="sec"><h3>Performance evidence</h3>{d.performance.map((r) => <Row key={r.label} k={r.label} v={r.value} note={r.note} />)}</section>}
      <section className="sec">
        <h3>Cost breakdown</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 520 }}>
            <thead><tr style={{ textAlign: "left", color: "#6b6e77", fontSize: 11.5 }}><th style={{ padding: "6px 0", fontWeight: 600 }}>Line</th><th style={{ fontWeight: 600 }}>Rate</th><th style={{ fontWeight: 600 }}>Usage</th><th style={{ textAlign: "right", fontWeight: 600 }}>Per month</th></tr></thead>
            <tbody>
              {d.cost.rows.map((r) => <tr key={r.label} style={{ borderTop: "1px solid #ece9e1" }}><td style={{ padding: "8px 0", color: "#17181c", fontWeight: 500 }}>{r.label}{r.note && <div style={{ color: "#6b6e77", fontSize: 11.5, fontWeight: 400 }}>{r.note}</div>}</td><td style={{ color: "#4b4e57" }}>{r.rate}</td><td style={{ color: "#4b4e57" }}>{r.usage}</td><td style={{ textAlign: "right", color: "#17181c" }} className="tnum">{r.monthly}</td></tr>)}
              <tr style={{ borderTop: "2px solid #17181c" }}><td colSpan={3} style={{ padding: "10px 0", fontWeight: 700, color: "#17181c" }}>Recurring per month</td><td style={{ textAlign: "right", fontWeight: 700, fontSize: 16, color: "#17181c" }} className="tnum">{d.cost.recurring}</td></tr>
              <tr><td colSpan={3} style={{ padding: "4px 0", color: "#4b4e57" }}>One-time implementation</td><td style={{ textAlign: "right", color: "#17181c" }} className="tnum">{d.cost.oneTime}</td></tr>
            </tbody>
          </table>
        </div>
        <Row k="Budget" v={d.cost.budget} /><Row k="Per minute" v={d.cost.perMinute} /><Row k="At month 12" v={d.cost.month12} />
        <p style={{ marginTop: 10, fontSize: 12.5, color: "#6b6e77" }}>Not included: {d.excluded.join("; ")}.</p>
      </section>
      <section className="sec"><h3>Governance assumptions</h3>{d.governance.map((r) => <Row key={r.label} k={r.label} v={r.value} />)}</section>
      <section className="sec"><h3>Open items</h3>{d.openItems.length === 0 ? <p style={{ fontSize: 13.5, color: "#4b4e57" }}>None. Every policy check is clear or accepted with a reason.</p> : d.openItems.map((o) => <div key={o.title} className="row"><div className="k">{o.status}</div><div className="v"><b>{o.title}</b>. {o.what}</div></div>)}</section>
      {d.approvals.length > 0 && <section className="sec"><h3>Approval history</h3>{d.approvals.map((a, i) => <Row key={i} k={a.action[0].toUpperCase() + a.action.slice(1)} v={`${a.by}, ${dateTime(a.at)}${a.note ? `. ${a.note}` : ""}`} />)}</section>}
      <footer style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid #e3dfd6", fontSize: 11.5, color: "#6b6e77" }}>{d.notice}</footer>
    </article>
  );
}

export function QuoteStep() {
  const { pkg, apply, readOnly, simulation, ratesAsOf, refreshSim, go } = usePackage();
  const { fail, toast, can, user, org } = useVani();
  const router = useRouter();
  const { checks, open } = usePolicy();
  const [boot, setBoot] = useState<"loading" | "ready" | "none">(pkg.quote ? "ready" : "loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [dlg, setDlg] = useState<"submit" | "approve" | "return" | "snapshot" | "stale" | null>(null);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    refreshSim();
    if (pkg.quote || started.current) return;
    started.current = true;
    api.ensureQuote(pkg.id).then((p) => { apply(p); setBoot("ready"); }).catch((e) => { setBoot("none"); if (!(e instanceof api.ApiError && e.code === "forbidden")) fail(e); });
    // create the quote once on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const d = useMemo(() => (pkg.quote ? buildQuote(pkg, { name: org?.name ?? "" }) : null), [pkg, org]);
  const cost = costOf(pkg);
  const blockers = useMemo(() => api.submitBlockers(pkg), [pkg]);
  const state = pkg.quote?.state ?? "draft";
  const last = pkg.quote?.events[pkg.quote.events.length - 1];
  const returnedNote = state === "draft" && last && (last.action === "returned" || last.action === "withdrawn") ? last : null;

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { if (e instanceof api.ApiError && e.code === "stale") setDlg("stale"); else fail(e); } finally { setBusy(null); } };
  const file = (k: "pdf" | "csv") => run(k, async () => {
    setExportErr(null);
    if (!d) return;
    try { await api.exportAllowed(pkg.id, k); } catch (e) { if (e instanceof api.ApiError && (e.code === "pdf_failed")) { setExportErr(e.message); return; } throw e; }
    const base = `${d.id}-${d.packageName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    if (k === "csv") { download(new Blob(["\uFEFF", quoteCsv(d)], { type: "text/csv;charset=utf-8" }), `${base}.csv`); toast("CSV downloaded.", "pass"); return; }
    try { download(await quotePdf(d), `${base}.pdf`); toast("PDF downloaded.", "pass"); } catch { setExportErr("We couldn't create the PDF. Try again, or download the CSV instead."); }
  });

  const closeDlg = () => { setDlg(null); setNote(""); setNoteErr(null); };
  const submit = () => run("submit", async () => { apply(await api.submitQuote(pkg.id, note.trim() || undefined)); closeDlg(); toast("Submitted for approval. Reviewers have been notified.", "pass"); });
  const decide = (action: "approved" | "returned") => run(action, async () => {
    if (action === "returned" && !note.trim()) { setNoteErr("Say what needs to change."); return; }
    apply(await api.decideQuote(pkg.id, action, note.trim() || undefined)); closeDlg(); toast(action === "approved" ? "Approved." : "Returned to the author with your note.", "pass");
  });
  const agent = () => run("agent", async () => { await api.setupAgent(pkg.id); toast("Agent created. Finish the setup checklist next.", "pass"); router.push("/vani/app/agents"); });

  if (boot === "loading") return <><div className="grid gap-4"><WorkspaceHeader /><Stepper /></div><div className="mt-8 grid gap-4"><Skeleton w={240} h={28} /><Skeleton h={420} r={8} /></div></>;
  if (boot === "none" || !pkg.quote || !d) return <><div className="grid gap-4"><WorkspaceHeader /><Stepper /></div><div className="mt-8"><Alert tone="info" title="No quote yet">{!can("edit") ? "A person who can edit this package needs to open the quote first. " + denial(user?.role, "edit") : "Choose a package in the earlier steps first."}</Alert></div><StepFooter stepId="quote" hideNext /></>;

  const canSubmit = can("submit") && !readOnly && state === "draft";
  const submitWhy = !can("submit") ? denial(user?.role, "submit") : state !== "draft" ? "Already submitted." : blockers[0] ?? "";
  return (
    <>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)]"><WorkspaceHeader /><Stepper /></div>
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="min-w-0 grid grid-cols-[minmax(0,1fr)] gap-6">
          <div className="va-noprint"><p className="eyebrow mb-2">Step 5 of 5</p><h2 className="serif" style={{ fontSize: 30, lineHeight: 1.12, color: "var(--ink)" }}>Your quote.</h2><p className="mt-2" style={{ maxWidth: 580 }}>Everything in one document you can download, send for approval, and keep on record.</p></div>
          <div className="va-noprint grid gap-3"><ReadOnlyNotice />
            {returnedNote && <Alert tone="warn" title={returnedNote.action === "returned" ? "Returned with a note" : "Reopened for changes"}>{returnedNote.note ? `"${returnedNote.note}" ` : ""}{returnedNote.by}, {ago(returnedNote.at)}.</Alert>}
            {isStale(pkg) && <Alert tone="warn" title="Your requirements changed after the recommendation" action={<Button size="sm" onClick={() => void go("recommendation")}>Refresh recommendation</Button>}>The quote reflects the older recommendation.</Alert>}
          </div>
          <QuoteDocument d={d} />
        </div>

        <aside className="grid gap-5 xl:sticky va-noprint max-xl:order-first" style={{ top: 120 }} aria-label="Quote actions">
          <div className="va-card va-card--pad grid gap-4">
            <div className="flex items-center justify-between"><span className="eyebrow">Approval</span><Badge tone={STATE_TONE[state]}>{state.toUpperCase()}</Badge></div>
            <ol className="m-0 p-0 list-none grid gap-3" aria-label="Approval history">
              {pkg.quote.events.slice(-4).map((e, i) => <li key={i} className="flex gap-3" style={{ fontSize: 13 }}><span className="va-dot mt-1.5" style={{ background: "var(--ink)" }} /><span><b className="ink" style={{ textTransform: "capitalize" }}>{e.action}</b> by {e.by}<span className="muted block" style={{ fontSize: 12 }}>{dateTime(e.at)}{e.note ? ` · ${e.note}` : ""}</span></span></li>)}
            </ol>
            {state === "draft" && (canSubmit && blockers.length === 0 ? <Button variant="primary" size="lg" icon={<Send size={16} />} onClick={() => setDlg("submit")}>Submit for approval</Button> : <Tooltip text={submitWhy || "Not available"}><span className="block"><Button variant="primary" size="lg" className="w-full" disabled icon={<Send size={16} />}>Submit for approval</Button></span></Tooltip>)}
            {state === "draft" && blockers.length > 0 && can("submit") && <ul className="m-0 pl-4 grid gap-1.5" style={{ fontSize: 13, color: "var(--bad)" }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            {state === "submitted" && (can("approve") ? <div className="grid gap-2"><Button variant="primary" size="lg" icon={<ThumbsUp size={16} />} onClick={() => setDlg("approve")}>Approve</Button><Button onClick={() => setDlg("return")} icon={<Undo2 size={15} />}>Return with a note</Button></div> : <Alert tone="info">Waiting for a reviewer. {denial(user?.role, "approve")}</Alert>)}
            {state !== "draft" && can("edit") && <Button variant="ghost" size="sm" loading={busy === "reopen"} onClick={() => void run("reopen", async () => { apply(await api.reopenQuote(pkg.id)); toast("Reopened as a draft.", "pass"); })}>Reopen as draft</Button>}
            {state === "approved" && (can("agent") ? <Button variant="accent" size="lg" icon={<Bot size={16} />} loading={busy === "agent"} onClick={() => void agent()}>Set up an agent with this package</Button> : <Tooltip text={denial(user?.role, "agent")}><span className="block"><Button size="lg" className="w-full" disabled icon={<Bot size={16} />}>Set up an agent with this package</Button></span></Tooltip>)}
            {state !== "approved" && <p className="muted" style={{ fontSize: 12.5 }}>After approval you can set up an agent with this package.</p>}
          </div>

          <div className="va-card va-card--pad grid gap-3">
            <span className="eyebrow">Export</span>
            {can("export") ? (<div className="grid grid-cols-2 gap-2">
              <Button icon={<FileText size={15} />} loading={busy === "pdf"} onClick={() => void file("pdf")}>PDF</Button>
              <Button icon={<FileSpreadsheet size={15} />} loading={busy === "csv"} onClick={() => void file("csv")}>CSV</Button>
              <Button icon={<Printer size={15} />} onClick={() => window.print()}>Print</Button>
              <Button icon={<Save size={15} />} disabled={readOnly} onClick={() => setDlg("snapshot")}>Snapshot</Button></div>) : <p className="muted" style={{ fontSize: 13 }}>{denial(user?.role, "export")}</p>}
            {exportErr && <Alert tone="bad" title="Download failed" action={<><Button size="sm" onClick={() => void file("pdf")}>Try again</Button><Button size="sm" onClick={() => void file("csv")}>Download CSV instead</Button></>}>{exportErr}</Alert>}
          </div>

          <div className="va-card va-card--pad grid gap-3">
            <div className="flex items-center justify-between"><span className="eyebrow">Open items</span><span className="ink tnum" style={{ fontWeight: 600 }}>{unresolvedChecks(checks).length}</span></div>
            {open.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>All policy checks are clear or accepted.</p> : <PolicyList checks={checks} onlyOpen />}
            {cost && <p className="muted" style={{ fontSize: 11.5 }}>Rates as of {ratesAsOf}.{simulation.stalePricing ? " Prices have changed since." : ""}</p>}
          </div>
        </aside>
      </div>

      <Dialog open={dlg === "submit"} onClose={closeDlg} title="Submit for approval?" description="Reviewers will be notified. The quote locks until it is approved or returned."
        footer={<><Button onClick={closeDlg}>Cancel</Button><Button variant="primary" loading={busy === "submit"} onClick={() => void submit()} data-autofocus>Submit</Button></>}>
        <Field label="Note to the reviewer" optional>{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Dialog>
      <Dialog open={dlg === "approve"} onClose={closeDlg} title="Approve this quote?" description={`${d.id} for ${d.packageName}, ${d.cost.recurring} a month.`}
        footer={<><Button onClick={closeDlg}>Cancel</Button><Button variant="primary" loading={busy === "approved"} onClick={() => void decide("approved")} data-autofocus>Approve</Button></>}>
        <Field label="Comment" optional>{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Dialog>
      <Dialog open={dlg === "return"} onClose={closeDlg} title="Return with a note" description="The author can fix it and submit again."
        footer={<><Button onClick={closeDlg}>Cancel</Button><Button variant="primary" loading={busy === "returned"} onClick={() => void decide("returned")}>Return</Button></>}>
        <Field label="What needs to change?" error={noteErr}>{(p) => <Textarea {...p} rows={4} value={note} onChange={(e) => { setNote(e.target.value); setNoteErr(null); }} data-autofocus />}</Field>
      </Dialog>
      <Dialog open={dlg === "snapshot"} onClose={closeDlg} title="Save a snapshot" description="Keeps this configuration as a version you can restore."
        footer={<><Button onClick={closeDlg}>Cancel</Button><Button variant="primary" loading={busy === "snap"} onClick={() => void run("snap", async () => { apply(await api.saveVersion(pkg.id, note)); closeDlg(); toast("Snapshot saved.", "pass"); })}>Save snapshot</Button></>}>
        <Field label="Note" optional>{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />}</Field>
      </Dialog>
      <Dialog open={dlg === "stale"} onClose={closeDlg} title="Prices have changed" description="Rates were updated since this quote was built. Review the new totals before submitting."
        footer={<><Button onClick={closeDlg}>Close</Button><Button variant="primary" onClick={() => void run("prices", async () => { await api.refreshPrices(); refreshSim(); closeDlg(); toast("Prices refreshed. Check the totals, then submit.", "pass"); })}>Refresh prices</Button></>}><p>Nothing was submitted.</p></Dialog>
      <StepFooter stepId="quote" hideNext />
    </>
  );
}

export { Download };
