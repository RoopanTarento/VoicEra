"use client";

import { Bot, Download, Lock, Megaphone, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import * as api from "@/lib/vani/api";
import { ago, dateLong, dateTime, inr } from "@/lib/vani/format";
import { costOf } from "@/lib/vani/packages";
import { can as canDo, denial, ROLES, type Permission } from "@/lib/vani/rbac";
import { stateOf } from "@/lib/vani/status";
import { ACCESS_GROUPS } from "@/lib/vani/catalog";
import type { Role } from "@/lib/vani/types";
import { ErrorState, Page, PageHeader, useAsync } from "./page";
import { useVani } from "./provider";
import { Alert, Badge, Button, Empty, Field, Input, Progress, Segmented, Select, Skeleton, Switch, TabPanel, Tabs, Checkbox } from "./ui";

/* ------------------------------------------------------------------ agents */

export function AgentsPage() {
  const { can, fail } = useVani();
  const [tab, setTab] = useState<"agents" | "campaigns">("agents");
  const ag = useAsync(() => api.listAgents(), "agents");
  const pk = useAsync(() => api.listPackages(), "pk");
  if (ag.error) return <Page><ErrorState error={ag.error} onRetry={ag.reload} /></Page>;
  const agents = ag.data ?? [];
  const toggle = async (id: string, step: string, done: boolean) => { try { await api.updateAgent(id, step, done); ag.reload(); } catch (e) { fail(e); } };
  const ready = (pk.data ?? []).filter((p) => stateOf(p) === "approved" && !agents.some((a) => a.packageId === p.id));
  return (
    <Page>
      <PageHeader title="Agents & campaigns" description="Agents are created from approved quotes. Each has a short checklist from set-up to go-live." />
      <Tabs label="Agents and campaigns" value={tab} onChange={setTab} tabs={[{ id: "agents", label: "Agents", count: agents.length }, { id: "campaigns", label: "Campaigns" }]} />
      <div className="mt-6">
        <TabPanel id="agents" active={tab === "agents"}>
          {ag.loading ? <Skeleton h={160} r={12} /> : agents.length === 0 ? (
            <div className="va-card"><Empty icon={<Bot size={20} />} title="No agents yet" action={<Link href="/vani/app/packages" className="va-btn va-btn--secondary">Go to packages</Link>}>An agent is set up once a quote is approved. Open an approved quote and choose &quot;Set up an agent with this package&quot;.</Empty></div>
          ) : (
            <div className="grid gap-4">
              {agents.map((a) => {
                const steps = Object.entries(a.checklist); const done = steps.filter(([, v]) => v).length;
                return (
                  <section key={a.id} className="va-card va-card--pad" aria-label={a.name}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 style={{ fontSize: 17 }}>{a.name}</h3><p className="muted" style={{ fontSize: 12.5 }}>{a.quoteId} · {a.versionLabel} · created {ago(a.createdAt)} by {a.createdBy}</p></div><div className="flex items-center gap-2"><Badge tone={a.status === "live" ? "pass" : a.status === "testing" ? "info" : "neutral"}>{a.status.toUpperCase()}</Badge><Link href={`/vani/app/packages/${a.packageId}/quote`} className="va-btn va-btn--ghost va-btn--sm">View quote</Link></div></div>
                    <div className="mt-4"><Progress value={(done / steps.length) * 100} label={`${a.name} set-up progress`} /><p className="mt-1.5 muted" style={{ fontSize: 12.5 }}>{done} of {steps.length} set-up steps done</p></div>
                    <fieldset className="m-0 mt-4 p-0 border-0 grid gap-3" disabled={!can("agent")}><legend className="sr-only">Set-up checklist</legend>{steps.map(([s, v]) => <Checkbox key={s} label={s} checked={v} onChange={(x) => void toggle(a.id, s, x)} />)}</fieldset>
                    {!can("agent") && <p className="mt-3 muted" style={{ fontSize: 12.5 }}>You can view this checklist but not change it.</p>}
                  </section>
                );
              })}
            </div>
          )}
          {ready.length > 0 && can("agent") && <Alert tone="info" className="mt-6" title={`${ready.length} approved package${ready.length === 1 ? "" : "s"} ready for an agent`}>{ready.map((p) => <Link key={p.id} href={`/vani/app/packages/${p.id}/quote`} className="mr-4">{p.name}</Link>)}</Alert>}
        </TabPanel>
        <TabPanel id="campaigns" active={tab === "campaigns"}>
          <div className="va-card"><Empty icon={<Megaphone size={20} />} title="No campaigns yet">Campaigns run on an agent whose package supports outbound or broadcast calls. This prototype stops at agent set-up, so scheduling and call lists are not part of it.</Empty></div>
          <p className="mt-4 muted" style={{ fontSize: 12.5 }}>Agents that could run campaigns: {agents.length ? agents.length : "none yet"}.</p>
        </TabPanel>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ insights */

const LINE_KEYS = [["asr", "Speech"], ["llm", "Model"], ["tts", "Voice"], ["telephony", "Telephony"], ["hosting", "Hosting"], ["language", "Language"], ["platform", "Platform"]] as const;
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];

export function InsightsPage() {
  const pk = useAsync(() => api.listPackages(), "pk");
  const [view, setView] = useState<"chart" | "table">("chart");
  const data = useMemo(() => (pk.data ?? []).map((p) => { const c = costOf(p); return { id: p.id, name: p.name, state: stateOf(p), budget: p.requirements.monthlyBudget, c, ...Object.fromEntries(LINE_KEYS.map(([k]) => [k, c?.lines.find((l) => l.id === k)?.monthly ?? 0])) }; }).filter((d) => d.c), [pk.data]);
  if (pk.error) return <Page><ErrorState error={pk.error} onRetry={pk.reload} /></Page>;
  const counts = { draft: 0, submitted: 0, approved: 0 };
  (pk.data ?? []).forEach((p) => { counts[stateOf(p)]++; });
  const total = data.reduce((t, d) => t + (d.c?.recurring ?? 0), 0);
  return (
    <Page wide>
      <PageHeader title="Insights" description="What your packages cost and where the money goes. Figures come from the sample catalogue rates." actions={<Segmented label="View" value={view} onChange={setView} options={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />} />
      {pk.loading ? <Skeleton h={320} r={12} /> : data.length === 0 ? <div className="va-card"><Empty icon={<Search size={20} />} title="Nothing to chart yet">Insights appear once a package has a recommendation and a price.</Empty></div> : (
        <div className="grid gap-8">
          <dl className="m-0 grid grid-cols-2 sm:grid-cols-4 gap-0" style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
            {([["Packages priced", String(data.length)], ["Combined monthly cost", inr(total)], ["Waiting for approval", String(counts.submitted)], ["Approved", String(counts.approved)]] as [string, string][]).map(([k, v], i) => <div key={k} className="p-4" style={{ borderLeft: i ? "1px solid var(--line)" : 0 }}><dt className="muted" style={{ fontSize: 12.5 }}>{k}</dt><dd className="m-0 serif ink tnum" style={{ fontSize: 26 }}>{v}</dd></div>)}
          </dl>
          <section aria-labelledby="in-cost"><h2 id="in-cost" style={{ fontSize: 18 }}>Monthly cost by package, split by line</h2>
            {view === "chart" ? (
              <div className="va-card va-card--pad mt-4" role="img" aria-label="Stacked bar chart of monthly cost per package by line"><div style={{ height: 320 }}>
                <ResponsiveContainer><BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={{ stroke: "var(--line)" }} tickLine={false} /><YAxis tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} axisLine={false} tickLine={false} width={52} />
                  <RTooltip cursor={{ fill: "var(--sunken)" }} contentStyle={{ background: "var(--raised)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12.5 }} formatter={(v) => inr(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {LINE_KEYS.map(([k, label], i) => <Bar key={k} dataKey={k} name={label} stackId="a" fill={COLORS[i]} maxBarSize={96}>{data.map((d) => <Cell key={d.id} fill={COLORS[i]} />)}</Bar>)}
                </BarChart></ResponsiveContainer></div></div>
            ) : (
              <div className="va-tablewrap mt-4"><table className="va-table"><caption className="sr-only">Monthly cost by package and line</caption><thead><tr><th scope="col">Package</th>{LINE_KEYS.map(([k, l]) => <th key={k} scope="col" className="num">{l}</th>)}<th scope="col" className="num">Total</th></tr></thead><tbody>{data.map((d) => <tr key={d.id}><td className="ink" style={{ fontWeight: 500 }}>{d.name}</td>{LINE_KEYS.map(([k]) => <td key={k} className="num">{inr((d as unknown as Record<string, number>)[k])}</td>)}<td className="num ink" style={{ fontWeight: 600 }}>{inr(d.c?.recurring ?? 0)}</td></tr>)}</tbody></table></div>
            )}
          </section>
          <section aria-labelledby="in-bud"><h2 id="in-bud" style={{ fontSize: 18 }}>Budget use</h2>
            <ul className="m-0 mt-4 p-0 list-none va-card">{data.map((d, i) => (
              <li key={d.id} className="grid gap-2 p-4" style={{ borderTop: i ? "1px solid var(--line)" : 0 }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="ink" style={{ fontWeight: 500 }}>{d.name}</span><span className="muted tnum" style={{ fontSize: 13 }}>{d.budget ? `${Math.round(d.c?.budgetUsedPct ?? 0)}% of ${inr(d.budget)}` : "No ceiling set"}</span></div>
                {d.budget && <Progress value={Math.min(100, d.c?.budgetUsedPct ?? 0)} label={`${d.name} budget used`} />}
                {d.c?.overBudget && <p style={{ fontSize: 12.5, color: "var(--bad)" }}>Over the ceiling. Launch is blocked until it is fixed.</p>}
              </li>))}</ul>
          </section>
        </div>
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------ governance */

const PERMS: { id: Permission; label: string }[] = [
  { id: "view", label: "View packages" }, { id: "create", label: "Create packages" }, { id: "edit", label: "Edit packages" }, { id: "resolve", label: "Resolve policy items" }, { id: "submit", label: "Submit quotes" },
  { id: "approve", label: "Approve or return quotes" }, { id: "agent", label: "Set up agents" }, { id: "export", label: "Export quotes" }, { id: "audit", label: "See the audit log" }, { id: "archive", label: "Archive packages" }, { id: "users", label: "Manage people" }, { id: "simulate", label: "Prototype settings" },
];

export function GovernancePage() {
  const { user, can } = useVani();
  const [tab, setTab] = useState<"audit" | "access" | "data">("audit");
  const [q, setQ] = useState("");
  const au = useAsync(() => (can("audit") ? api.listAudit() : Promise.resolve([])), `au-${user?.role}`);
  const pk = useAsync(() => api.listPackages(), "pk");
  const rows = useMemo(() => { const t = q.trim().toLowerCase(); return (au.data ?? []).filter((a) => !t || `${a.by} ${a.action} ${a.target} ${a.detail ?? ""}`.toLowerCase().includes(t)); }, [au.data, q]);
  const csv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = [["When", "Who", "Action", "Target", "Detail"], ...rows.map((a) => [a.at, a.by, a.action, a.target, a.detail ?? ""])].map((r) => r.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = "audit-log.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  return (
    <Page wide>
      <PageHeader title="Governance" description="Who did what, who can do what, and how data is handled across your packages." />
      <Tabs label="Governance" value={tab} onChange={setTab} tabs={[{ id: "audit", label: "Audit log" }, { id: "access", label: "Access and roles" }, { id: "data", label: "Data handling" }]} />
      <div className="mt-6">
        <TabPanel id="audit" active={tab === "audit"}>
          {!can("audit") ? <Alert tone="warn" title="You can't see the audit log">{denial(user?.role, "audit")}</Alert> : au.error ? <ErrorState error={au.error} onRetry={au.reload} /> : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="va-affix" style={{ width: 300, maxWidth: "100%" }}><span className="pre"><Search size={15} aria-hidden /></span><Input aria-label="Search the audit log" placeholder="Search who, what or which package" value={q} onChange={(e) => setQ(e.target.value)} /></div>{can("export") && <Button size="sm" icon={<Download size={14} />} onClick={csv} disabled={!rows.length}>Download CSV</Button>}</div>
              {au.loading ? <Skeleton h={200} r={12} /> : rows.length === 0 ? <div className="va-card"><Empty icon={<Search size={20} />} title="No matching entries" /></div> : (
                <div className="va-tablewrap"><table className="va-table"><caption className="sr-only">Audit log</caption><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Detail</th></tr></thead>
                  <tbody>{rows.slice(0, 100).map((a) => <tr key={a.id}><td style={{ whiteSpace: "nowrap" }} title={a.at}>{dateTime(a.at)}</td><td className="ink">{a.by}</td><td>{a.action}</td><td>{a.target}</td><td className="muted">{a.detail ?? ""}</td></tr>)}</tbody></table></div>
              )}
            </div>
          )}
        </TabPanel>
        <TabPanel id="access" active={tab === "access"}>
          <p className="mb-4" style={{ maxWidth: 620 }}>Your role is <b className="ink">{ROLES.find((r) => r.id === user?.role)?.label}</b>. A tick means the role can do it. Disabled controls elsewhere explain who to ask.</p>
          <div className="va-tablewrap"><table className="va-table"><caption className="sr-only">What each role can do</caption>
            <thead><tr><th scope="col">Can</th>{ROLES.map((r) => <th key={r.id} scope="col" style={{ textAlign: "center", color: r.id === user?.role ? "var(--ink)" : undefined }}>{r.label}{r.id === user?.role && <div><Badge tone="solid">You</Badge></div>}</th>)}</tr></thead>
            <tbody>{PERMS.map((p) => <tr key={p.id}><th scope="row" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13, background: "transparent", fontWeight: 500, color: "var(--body)" }}>{p.label}</th>{ROLES.map((r) => <td key={r.id} style={{ textAlign: "center" }}>{canDo(r.id as Role, p.id) ? <><span aria-hidden className="ink" style={{ fontWeight: 700 }}>✓</span><span className="sr-only">Yes</span></> : <><span aria-hidden className="muted">–</span><span className="sr-only">No</span></>}</td>)}</tr>)}</tbody></table></div>
          <ul className="m-0 mt-5 p-0 list-none grid gap-2" style={{ fontSize: 13 }}>{ROLES.map((r) => <li key={r.id}><b className="ink">{r.label}.</b> {r.summary}</li>)}</ul>
        </TabPanel>
        <TabPanel id="data" active={tab === "data"}>
          {pk.loading ? <Skeleton h={200} r={12} /> : (pk.data ?? []).length === 0 ? <div className="va-card"><Empty icon={<Lock size={20} />} title="No packages yet">Data handling rules appear here once packages exist.</Empty></div> : (
            <div className="va-tablewrap"><table className="va-table" style={{ minWidth: 760 }}><caption className="sr-only">Data handling by package</caption>
              <thead><tr><th scope="col">Package</th><th scope="col">Location</th><th scope="col">Recordings</th><th scope="col">Transcripts</th><th scope="col">PII removed</th><th scope="col">Readable by</th></tr></thead>
              <tbody>{(pk.data ?? []).map((p) => { const h = p.hosting; return <tr key={p.id}><td><Link href={`/vani/app/packages/${p.id}/hosting`} className="ink" style={{ fontWeight: 600, textDecoration: "none" }}>{p.name}</Link></td><td>{h.region}{h.inCountry ? <div className="muted" style={{ fontSize: 12 }}>Stays in India</div> : <div style={{ fontSize: 12, color: "var(--warn)" }}>May leave India</div>}</td><td>{h.recording === "off" ? "Not recorded" : h.recording === "consent" ? "With consent" : "Always"}{h.retention.recordings.days && h.recording !== "off" ? `, ${h.retention.recordings.days} days` : ""}</td><td>{h.transcripts === "none" ? "Not kept" : `${h.transcripts === "redacted" ? "Redacted" : "Full"}${h.retention.transcripts.days ? `, ${h.retention.transcripts.days} days` : ""}`}</td><td>{h.transcripts === "none" ? "—" : h.pii.length ? `${h.pii.length} types` : <span style={{ color: "var(--bad)" }}>None</span>}</td><td>{h.transcripts === "none" ? "—" : ACCESS_GROUPS.find((a) => a.id === h.retention.transcripts.access)?.label}</td></tr>; })}</tbody></table></div>
          )}
        </TabPanel>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ settings */

export function SettingsPage() {
  const router = useRouter();
  const { user, org, can, theme, setTheme, toast, fail, signOut, refresh, confirm } = useVani();
  const [tab, setTab] = useState<"profile" | "appearance" | "people" | "prototype">("profile");
  const people = useAsync(() => api.listPeople(), "people");
  const sim = useAsync(() => api.getSimulation(), "sim");
  const ses = useAsync(() => api.getSession(), "ses");
  const setS = async (patch: Partial<NonNullable<typeof sim.data>>) => { try { await api.setSimulation(patch); sim.reload(); toast("Prototype setting changed.", "pass"); } catch (e) { fail(e); } };
  return (
    <Page>
      <PageHeader title="Settings" description="Your profile, how the app looks and, for admins, people and prototype controls." />
      <Tabs label="Settings" value={tab} onChange={setTab} tabs={[{ id: "profile", label: "Profile" }, { id: "appearance", label: "Appearance" }, { id: "people", label: "People and roles" }, { id: "prototype", label: "Prototype tools" }]} />
      <div className="mt-6" style={{ maxWidth: 720 }}>
        <TabPanel id="profile" active={tab === "profile"}>
          <dl className="m-0 va-card">{([["Name", user?.name], ["Email", user?.email], ["Role", ROLES.find((r) => r.id === user?.role)?.label], ["Organisation", org?.name], ["Environment", org?.environment], ["Session ends", ses.data ? `${dateTime(ses.data.expiresAt)} ${ses.data.remember ? "(kept signed in)" : ""}` : "…"]] as [string, string | undefined][]).map(([k, v], i) => <div key={k} className="grid grid-cols-[140px_1fr] gap-4 px-5 py-3.5" style={{ borderTop: i ? "1px solid var(--line)" : 0 }}><dt className="muted">{k}</dt><dd className="m-0 ink">{v}</dd></div>)}</dl>
          <div className="mt-5"><Button onClick={async () => { if (await confirm({ title: "Sign out?", body: "Your work is saved.", confirmLabel: "Sign out" })) void signOut(); }}>Sign out</Button></div>
        </TabPanel>
        <TabPanel id="appearance" active={tab === "appearance"}>
          <Field label="Theme" help="System follows your device setting.">{(p) => <Select {...p} value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")} style={{ maxWidth: 240 }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></Select>}</Field>
        </TabPanel>
        <TabPanel id="people" active={tab === "people"}>
          {people.error ? <ErrorState error={people.error} onRetry={people.reload} /> : people.loading ? <Skeleton h={160} r={12} /> : (
            <div className="va-tablewrap"><table className="va-table"><caption className="sr-only">People in your organisation</caption><thead><tr><th scope="col">Person</th><th scope="col">Role</th></tr></thead>
              <tbody>{(people.data ?? []).map((u) => <tr key={u.id}><td><span className="ink" style={{ fontWeight: 500 }}>{u.name}</span>{u.id === user?.id && <> <Badge>You</Badge></>}<div className="muted" style={{ fontSize: 12 }}>{u.email}</div></td>
                <td style={{ minWidth: 190 }}>{can("users") ? <Select aria-label={`Role for ${u.name}`} value={u.role} onChange={async (e) => { try { await api.setRole(u.id, e.target.value as Role); people.reload(); await refresh(); toast("Role changed.", "pass"); } catch (x) { fail(x); } }}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select> : ROLES.find((r) => r.id === u.role)?.label}</td></tr>)}</tbody></table></div>
          )}
          {!can("users") && <p className="mt-3 muted" style={{ fontSize: 12.5 }}>{denial(user?.role, "users")}</p>}
        </TabPanel>
        <TabPanel id="prototype" active={tab === "prototype"}>
          {!can("simulate") ? <Alert tone="warn" title="Admins only">{denial(user?.role, "simulate")}</Alert> : (
            <div className="grid gap-6">
              <Alert tone="info">These switches make the prototype fail on purpose so you can see the error states. They only affect this browser.</Alert>
              {sim.data && (
                <div className="va-card va-card--pad grid gap-5">
                  <Switch label="Network is down" description="Every request fails with an offline message." checked={sim.data.network} onChange={(v) => void setS({ network: v })} />
                  <Switch label="Recommendation service is down" description="Running a recommendation fails." checked={sim.data.recommendationDown} onChange={(v) => void setS({ recommendationDown: v })} />
                  <Switch label="Pricing is unavailable" description="Saving a configuration change fails." checked={sim.data.pricingDown} onChange={(v) => void setS({ pricingDown: v })} />
                  <Switch label="PDF creation fails" description="The PDF download errors. CSV still works." checked={sim.data.pdfFails} onChange={(v) => void setS({ pdfFails: v })} />
                  <Switch label="Prices changed since quoting" description="Submitting a quote asks you to refresh prices first." checked={sim.data.stalePricing} onChange={(v) => void setS({ stalePricing: v })} />
                  <Field label="A provider is unavailable" help="That provider disappears from the options and any package using it is excluded.">{(p) => <Select {...p} value={sim.data?.unavailableProviders[0] ?? ""} onChange={(e) => void setS({ unavailableProviders: e.target.value ? [e.target.value] : [] })} style={{ maxWidth: 280 }}><option value="">None</option><option value="asr-sarvam">Sarvam speech</option><option value="tts-sarvam1">Sarvam voice</option><option value="llm-llama70">Llama 70B class model</option><option value="tel-plivo">Plivo telephony</option></Select>}</Field>
                </div>
              )}
              <div className="va-card va-card--pad grid gap-3"><h3 style={{ fontSize: 15 }}>Session and data</h3>
                <div className="flex flex-wrap gap-2"><Button onClick={async () => { try { await api.expireMySession(); toast("Session expired. The next action will ask you to sign in.", "info"); } catch (e) { fail(e); } }}>Expire my session now</Button>
                  <Button variant="danger-quiet" onClick={async () => { if (await confirm({ title: "Reset all demo data?", body: "This deletes every package, quote, account and setting stored in this browser and restores the sample data.", confirmLabel: "Reset", danger: true })) { await api.resetDemo(); router.push("/vani/signin"); } }}>Reset demo data</Button></div></div>
            </div>
          )}
        </TabPanel>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ help */

const FAQ: [string, string][] = [
  ["How is the fit percentage worked out?", "Hosting and data rules remove packages that cannot qualify. The rest are scored on language coverage, reply speed, budget, cost, quality, conversation depth and hosting fit. What you said matters most sets the weights. Open \"How the fit is worked out\" on the recommendation to see each part."],
  ["Is the data real?", "No. Provider names are real, but every model, rate and benchmark is a sample figure for the prototype, and every account and package lives only in this browser. Do not enter real citizen information."],
  ["What does confidence mean?", "How sure we are that the recommendation is right. It rises as you answer more of the nine input groups and clear open items, so a high fit can still have lower confidence."],
  ["Why can't I submit a quote?", "Three things block it: a monthly cost above your budget ceiling, requirements that changed after the recommendation, and policy items that are still open. The quote page lists exactly which."],
  ["What is the difference between CHECK and OPEN?", "CHECK needs your confirmation. OPEN needs a decision or missing information. Either can be cleared by fixing the cause, or accepted with a written reason that goes in the audit log."],
  ["Can I undo a change?", "In Configure, each change shows Undo, a comparison with the last snapshot, and Save as version. Any saved version can be restored, and restoring creates a new version, so nothing is lost."],
  ["Who can do what?", "See Governance, Access and roles. If a button is disabled, hover it to see who can do it."],
];
const KEYS: [string, string][] = [["/", "Open search"], ["Ctrl or Cmd + K", "Open search"], ["Esc", "Close a dialog, drawer or menu"], ["Arrow keys", "Move through tabs, menus and search results"], ["Tab", "Move to the next control"]];

export function HelpPage() {
  return (
    <Page>
      <PageHeader title="Help" description="Answers to the questions people ask most, and the shortcuts." />
      <div className="grid gap-10">
        <section aria-labelledby="h-faq"><h2 id="h-faq" style={{ fontSize: 18 }}>Common questions</h2>
          <div className="mt-4 va-card">{FAQ.map(([q, a], i) => <details key={q} className="px-5 py-4" style={{ borderTop: i ? "1px solid var(--line)" : 0 }}><summary className="ink" style={{ fontWeight: 600, cursor: "pointer" }}>{q}</summary><p className="mt-2.5" style={{ maxWidth: 640 }}>{a}</p></details>)}</div>
        </section>
        <section aria-labelledby="h-keys"><h2 id="h-keys" style={{ fontSize: 18 }}>Keyboard</h2>
          <div className="va-tablewrap mt-4"><table className="va-table"><caption className="sr-only">Keyboard shortcuts</caption><thead><tr><th scope="col">Keys</th><th scope="col">What they do</th></tr></thead><tbody>{KEYS.map(([k, v]) => <tr key={k}><td><span className="va-kbd">{k}</span></td><td>{v}</td></tr>)}</tbody></table></div>
        </section>
        <section aria-labelledby="h-more"><h2 id="h-more" style={{ fontSize: 18 }}>More</h2><p className="mt-2"><Link href="/vani/app/design">The design system</Link> shows every component used in the product.</p></section>
      </div>
    </Page>
  );
}

export { dateLong };
