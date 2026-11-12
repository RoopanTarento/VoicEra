"use client";

import { Archive, ArrowRight, Copy, FilePlus2, MoreHorizontal, Package, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import * as api from "@/lib/vani/api";
import { inr, ago, dateLong } from "@/lib/vani/format";
import { costOf } from "@/lib/vani/packages";
import { STATE_LABEL, returned, stateOf, stepLabel, stepProgress } from "@/lib/vani/status";
import { denial } from "@/lib/vani/rbac";
import type { PackageRecord } from "@/lib/vani/types";
import { ErrorState, Page, PageHeader, useAsync } from "./page";
import { messageOf, useVani } from "./provider";
import { Alert, Badge, Button, Empty, Field, Input, Menu, MenuItem, Progress, Segmented, Skeleton } from "./ui";

export function StateBadge({ p }: { p: PackageRecord }) {
  const s = stateOf(p);
  if (p.archived) return <Badge>Archived</Badge>;
  if (returned(p)) return <Badge tone="warn">Returned</Badge>;
  return <Badge tone={s === "approved" ? "pass" : s === "submitted" ? "info" : "neutral"}>{STATE_LABEL[s].toUpperCase()}</Badge>;
}

/* ------------------------------------------------------------------ overview */

export function Overview() {
  const { user, can, org } = useVani();
  const pk = useAsync(() => api.listPackages(), "pk");
  const au = useAsync(() => (can("audit") ? api.listAudit() : Promise.resolve([])), `au-${user?.role}`);
  const list = pk.data ?? [];
  const latest = list.find((p) => stateOf(p) === "draft") ?? list[0];
  const waiting = list.filter((p) => stateOf(p) === "submitted");
  const approved = list.filter((p) => stateOf(p) === "approved");
  const drafts = list.filter((p) => stateOf(p) === "draft");
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  if (pk.error) return <Page><ErrorState error={pk.error} onRetry={pk.reload} /></Page>;
  return (
    <Page>
      <PageHeader eyebrow={org?.name} title={<>{greet}, {user?.name.split(" ")[0]}.</>} description={list.length ? "Pick up where you left off, or start a new package." : "You have no packages yet. Start one and we'll guide you through it."}
        actions={can("create") ? <Link href="/vani/app/packages/new" className="va-btn va-btn--primary"><FilePlus2 size={16} aria-hidden />Create a package</Link> : undefined} />
      {pk.loading ? <div className="grid gap-4"><Skeleton h={150} r={12} /><Skeleton h={90} r={12} /></div> : list.length === 0 ? (
        <div className="va-card"><Empty icon={<Package size={20} />} title="Your workspace is empty" action={can("create") ? <Link href="/vani/app/packages/new" className="va-btn va-btn--primary">Create your first package</Link> : undefined}>
          {can("create") ? "A package is a Voice AI setup for one service: its languages, hosting, stack and price. It takes about ten minutes." : denial(user?.role, "create")}</Empty></div>
      ) : (
        <div className="grid gap-10">
          {latest && (
            <section aria-labelledby="continue">
              <h2 id="continue" className="eyebrow mb-3">{stateOf(latest) === "draft" ? "Continue" : "Latest package"}</h2>
              <div className="va-card va-card--pad flex flex-wrap items-center justify-between gap-6">
                <div className="min-w-0" style={{ flex: "1 1 320px" }}>
                  <div className="flex items-center gap-2.5 flex-wrap"><h3 style={{ fontSize: 20 }}>{latest.name}</h3><StateBadge p={latest} /></div>
                  <p className="mt-1.5 muted" style={{ fontSize: 13 }}>Step {Math.max(1, ["requirements", "hosting", "recommendation", "configure", "quote"].indexOf(latest.step) + 1)} of 5: {stepLabel(latest)}. Updated {ago(latest.updatedAt)} by {latest.updatedBy}.</p>
                  <div className="mt-4" style={{ maxWidth: 360 }}><Progress value={stepProgress(latest)} label={`${latest.name} progress`} /></div>
                </div>
                <Link href={`/vani/app/packages/${latest.id}/${latest.step}`} className="va-btn va-btn--primary va-btn--lg">{stateOf(latest) === "draft" ? "Continue" : "Open"}<ArrowRight size={16} aria-hidden /></Link>
              </div>
            </section>
          )}
          <section aria-labelledby="state">
            <h2 id="state" className="eyebrow mb-3">Where things stand</h2>
            <dl className="m-0 grid grid-cols-3 gap-0" style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
              {[["In progress", drafts.length], ["Waiting for approval", waiting.length], ["Approved", approved.length]].map(([k, v], i) => (
                <div key={k as string} className="p-4 sm:p-5" style={{ borderLeft: i ? "1px solid var(--line)" : 0 }}><dt className="muted" style={{ fontSize: 12.5 }}>{k}</dt><dd className="m-0 serif tnum" style={{ fontSize: 34, color: "var(--ink)", lineHeight: 1.1 }}>{v}</dd></div>
              ))}
            </dl>
          </section>
          {waiting.length > 0 && (
            <section aria-labelledby="wait">
              <h2 id="wait" className="eyebrow mb-3">{can("approve") ? "Waiting for your review" : "Waiting for approval"}</h2>
              <ul className="m-0 p-0 list-none va-card">{waiting.map((p, i) => (
                <li key={p.id} className="flex items-center justify-between gap-4 p-4" style={{ borderTop: i ? "1px solid var(--line)" : 0 }}>
                  <div className="min-w-0"><div className="ink truncate" style={{ fontWeight: 500 }}>{p.name}</div><div className="muted" style={{ fontSize: 12.5 }}>{p.quote?.id} submitted {ago(p.quote?.events[p.quote.events.length - 1]?.at ?? p.updatedAt)}</div></div>
                  <Link href={`/vani/app/packages/${p.id}/quote`} className="va-btn va-btn--secondary va-btn--sm">{can("approve") ? "Review" : "View"}</Link>
                </li>))}</ul>
            </section>
          )}
          {can("audit") && (
            <section aria-labelledby="act">
              <div className="flex items-baseline justify-between"><h2 id="act" className="eyebrow mb-3">Recent activity</h2><Link href="/vani/app/governance" style={{ fontSize: 12.5 }}>Audit log</Link></div>
              {au.loading ? <Skeleton h={120} r={12} /> : (
                <ul className="m-0 p-0 list-none va-card">{(au.data ?? []).slice(0, 5).map((a, i) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-4 px-4 py-3" style={{ borderTop: i ? "1px solid var(--line)" : 0, fontSize: 13.5 }}>
                    <span className="min-w-0"><span className="ink" style={{ fontWeight: 500 }}>{a.by}</span> {a.action.toLowerCase()} <span className="ink">{a.target}</span></span><span className="muted flex-none" style={{ fontSize: 12 }}>{ago(a.at)}</span>
                  </li>))}</ul>
              )}
            </section>
          )}
        </div>
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------ packages list */

export function PackagesList() {
  const router = useRouter();
  const { can, toast, fail, confirm, user } = useVani();
  const [tab, setTab] = useState<"all" | "draft" | "submitted" | "approved" | "archived">("all");
  const [q, setQ] = useState("");
  const live = useAsync(() => api.listPackages(), "pk");
  const arch = useAsync(() => api.listArchived(), "arch");
  const rows = useMemo(() => {
    const base = tab === "archived" ? arch.data ?? [] : (live.data ?? []).filter((p) => tab === "all" || stateOf(p) === tab);
    const t = q.trim().toLowerCase();
    return t ? base.filter((p) => p.name.toLowerCase().includes(t)) : base;
  }, [live.data, arch.data, tab, q]);
  const reloadAll = () => { live.reload(); arch.reload(); };
  const dup = async (p: PackageRecord) => { try { const c = await api.duplicatePackage(p.id); toast(`Duplicated as "${c.name}".`, "pass"); reloadAll(); } catch (e) { fail(e); } };
  const archive = async (p: PackageRecord, on: boolean) => {
    if (on && !(await confirm({ title: `Archive "${p.name}"?`, body: "It moves out of your list but is kept. You can restore it any time.", confirmLabel: "Archive" }))) return;
    try { await api.archivePackage(p.id, on); toast(on ? "Archived." : "Restored.", "pass", { label: "Undo", run: () => { void api.archivePackage(p.id, !on).then(reloadAll).catch(fail); } }); reloadAll(); } catch (e) { fail(e); }
  };
  if (live.error) return <Page><ErrorState error={live.error} onRetry={reloadAll} /></Page>;
  const loading = live.loading || (tab === "archived" && arch.loading);
  return (
    <Page wide>
      <PageHeader title="Packages" description="Every Voice AI package your team is designing, with where it stands." actions={can("create") ? <Link href="/vani/app/packages/new" className="va-btn va-btn--primary"><FilePlus2 size={16} aria-hidden />Create a package</Link> : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented label="Filter by status" value={tab} onChange={setTab} options={[{ id: "all", label: "All" }, { id: "draft", label: "Drafts" }, { id: "submitted", label: "Submitted" }, { id: "approved", label: "Approved" }, { id: "archived", label: "Archived" }]} />
        <div className="va-affix" style={{ width: 260, maxWidth: "100%" }}><span className="pre"><Search size={15} aria-hidden /></span><Input aria-label="Filter packages by name" placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {loading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} h={56} r={10} />)}</div> : rows.length === 0 ? (
        <div className="va-card"><Empty icon={<Package size={20} />} title={q ? "No packages match" : tab === "all" ? "No packages yet" : `No ${tab} packages`} action={!q && tab === "all" && can("create") ? <Link href="/vani/app/packages/new" className="va-btn va-btn--primary">Create a package</Link> : q ? <Button onClick={() => setQ("")}>Clear filter</Button> : undefined}>{q ? `Nothing matches "${q}".` : tab === "all" ? "Create one to see it here." : "Packages in this state will appear here."}</Empty></div>
      ) : (
        <div className="va-tablewrap">
          <table className="va-table">
            <caption className="sr-only">Packages</caption>
            <thead><tr><th scope="col">Package</th><th scope="col">Stage</th><th scope="col">Status</th><th scope="col" className="num">Per month</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const c = costOf(p);
                return (
                  <tr key={p.id} className="row">
                    <td><Link href={`/vani/app/packages/${p.id}/${p.step}`} className="ink" style={{ fontWeight: 600, textDecoration: "none" }}>{p.name}</Link><div className="muted" style={{ fontSize: 12 }}>{p.quote?.id ?? "No quote yet"} · by {p.createdBy}</div></td>
                    <td><div style={{ minWidth: 120 }}>{stepLabel(p)}<div className="mt-1.5"><Progress value={stepProgress(p)} label={`${p.name} progress`} /></div></div></td>
                    <td><StateBadge p={p} /></td>
                    <td className="num">{c ? <span className="ink">{inr(c.recurring)}</span> : <span className="muted">Not priced</span>}</td>
                    <td><span title={dateLong(p.updatedAt)}>{ago(p.updatedAt)}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <Menu label={`Actions for ${p.name}`} trigger={({ props }) => <button type="button" className="va-btn va-btn--ghost va-btn--sm va-btn--icon" aria-label={`Actions for ${p.name}`} {...props}><MoreHorizontal size={16} /></button>}>
                        {(close) => (<>
                          <MenuItem onSelect={() => { close(); router.push(`/vani/app/packages/${p.id}/${p.step}`); }}>Open</MenuItem>
                          <MenuItem icon={<Copy size={15} />} disabled={!can("create")} onSelect={() => { close(); void dup(p); }}>Duplicate</MenuItem>
                          <div className="va-menusep" />
                          <MenuItem icon={<Archive size={15} />} disabled={!can("archive")} onSelect={() => { close(); void archive(p, !p.archived); }}>{p.archived ? "Restore" : "Archive"}</MenuItem>
                        </>)}
                      </Menu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!can("create") && <p className="mt-4 muted" style={{ fontSize: 12.5 }}>{denial(user?.role, "create")}</p>}
    </Page>
  );
}

/* ------------------------------------------------------------------ new package */

export function NewPackage() {
  const router = useRouter();
  const { can, user } = useVani();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const p = await api.createPackage(name); router.push(`/vani/app/packages/${p.id}/requirements`); } catch (x) { setErr(messageOf(x)); setBusy(false); }
  };
  if (!can("create")) return <Page><Alert tone="warn" title="You can't create packages" action={<Link href="/vani/app/packages" className="va-btn va-btn--secondary va-btn--sm">Back to packages</Link>}>{denial(user?.role, "create")}</Alert></Page>;
  return (
    <Page>
      <div style={{ maxWidth: 520 }}>
        <PageHeader eyebrow="New package" title="What are you building?" description="Name the service this package is for. You can rename it later." />
        <form onSubmit={submit} noValidate className="grid gap-5">
          <Field label="Package name" error={err} help="For example: Citizen Support Helpline, or Pension Query Line.">{(p) => <Input {...p} data-autofocus autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="Citizen Support Helpline" />}</Field>
          <div className="flex gap-2"><Button type="submit" variant="primary" size="lg" loading={busy} iconRight={<ArrowRight size={16} />}>Start</Button><Link href="/vani/app/packages" className="va-btn va-btn--ghost va-btn--lg">Cancel</Link></div>
        </form>
        <p className="mt-8 muted flex gap-2" style={{ fontSize: 12.5 }}><ShieldAlert size={14} className="flex-none mt-0.5" aria-hidden />Sample data only. Don&apos;t enter real caller or citizen information in this prototype.</p>
      </div>
    </Page>
  );
}
