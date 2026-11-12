"use client";

import { Check, Cloud, CloudCog, Server, Phone, FileText, ScanSearch, EyeOff, Database, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { ACCESS_GROUPS, AVAILABILITY, DATA_TYPES, HOSTING_OPTIONS, LANGUAGE_BY_ID, OPERATORS, PII_TYPES, REGIONS, RETENTION_DAYS, SAMPLE_NOTICE, SUPPORT_MODELS } from "@/lib/vani/catalog";
import type { Hosting, HostingKind, PiiType } from "@/lib/vani/types";
import { LiveEstimate } from "./estimate";
import { PolicyList, PolicySummary, usePolicy } from "./policy-ui";
import { Alert, Badge, Checkbox, Field, Input, Select, SelectCard, Switch, Textarea, cx } from "./ui";
import { ReadOnlyNotice, StepFooter, Stepper, WorkspaceHeader, usePackage } from "./workspace";

const ICONS: Record<HostingKind, LucideIcon> = { govcloud: Cloud, onprem: Server, approved: CloudCog };

const Section = ({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) => (
  <section aria-labelledby={id} className="grid gap-5" style={{ paddingTop: 36, borderTop: "1px solid var(--line)" }}>
    <div><h2 id={id} style={{ fontSize: 18 }}>{title}</h2>{description && <p className="mt-1.5" style={{ maxWidth: 580 }}>{description}</p>}</div>
    {children}
  </section>
);

/* ------------------------------------------------------------------ privacy pipeline */

const SAMPLE_SPOKEN = ["My number is ", "98765 43210", " and I am ", "Anita Rao", ". Please check application ", "AB-1042", "."];
const SAMPLE_TYPE: (PiiType | null)[] = [null, "phone", null, "name", null, "govid", null];
const TAG: Record<string, string> = { phone: "PHONE", name: "NAME", govid: "ID", email: "EMAIL", address: "ADDRESS", custom: "CUSTOM" };

function PrivacyPipeline() {
  const { pkg } = usePackage();
  const h = pkg.hosting;
  const [active, setActive] = useState(2);
  const detect = h.transcripts !== "none" && h.pii.length > 0;
  const stored = h.transcripts === "none" ? "Nothing stored" : h.transcripts === "full" ? `Full transcript, ${h.retention.transcripts.days ?? "no"} days` : `Redacted transcript, ${h.retention.transcripts.days ?? "no"} days`;
  const stages: { id: string; label: string; icon: LucideIcon; text: string; state: "on" | "off" | "warn"; detail: string }[] = [
    { id: "call", label: "CALL", icon: Phone, state: "on", text: h.callerNotice.trim() ? "Notice played" : "No notice yet", detail: h.callerNotice.trim() ? "The caller hears your notice before anything else." : "No caller notice is written yet. Callers would not be told it is an assistant." },
    { id: "transcription", label: "TRANSCRIPTION", icon: FileText, state: "on", text: "Speech to text", detail: "The caller's words are turned into text so the assistant can answer. This happens in memory, in the region you chose." },
    { id: "detect", label: "PII DETECTION", icon: ScanSearch, state: detect ? "on" : h.transcripts === "none" ? "off" : "warn", text: detect ? `${h.pii.length} type${h.pii.length === 1 ? "" : "s"}` : h.transcripts === "none" ? "Not needed" : "None selected", detail: detect ? "Personal details of the selected kinds are found in the text." : h.transcripts === "none" ? "Nothing is stored, so there is nothing to scan." : "Transcripts are kept but no PII types are chosen, so nothing would be found." },
    { id: "redact", label: "REDACTION", icon: EyeOff, state: detect && h.transcripts === "redacted" ? "on" : h.transcripts === "full" ? "warn" : "off", text: h.transcripts === "redacted" && detect ? "Replaced by labels" : h.transcripts === "full" ? "Skipped, full text kept" : "Not needed", detail: h.transcripts === "full" ? "You chose to keep full transcripts. Details are flagged but not removed, so access has to be tight." : h.transcripts === "redacted" && detect ? "Found details are replaced with labels such as [PHONE] before the text is written anywhere." : "Nothing is stored, so nothing needs redacting." },
    { id: "store", label: "STORAGE", icon: Database, state: h.transcripts === "none" && h.recording === "off" ? "off" : "on", text: stored, detail: `${stored}. Recordings: ${h.recording === "off" ? "not kept" : h.recording === "consent" ? "kept only with consent" : "always kept"}. Logs kept ${h.retention.logs.days ?? 0} days.` },
  ];
  const cur = stages[active];
  return (
    <div className="va-card va-card--pad" aria-label="Privacy pipeline">
      <div className="flex items-center justify-between mb-4"><span className="eyebrow">What happens to a call</span><Badge>Fake sample call</Badge></div>
      <ol className="m-0 p-0 list-none grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Pipeline stages">
        {stages.map((s, i) => {
          const I = s.icon;
          return (
            <li key={s.id}>
              <button type="button" onClick={() => setActive(i)} aria-pressed={i === active} className="w-full text-left" style={{ background: i === active ? "var(--sunken)" : "transparent", border: `1px solid ${i === active ? "var(--ink)" : "var(--line)"}`, borderRadius: 10, padding: "10px 8px", cursor: "pointer", font: "inherit", color: "inherit", minHeight: 92, transition: "all 0.15s" }}>
                <span className="flex items-center justify-between"><I size={16} className="ink" aria-hidden /><span className="va-dot" style={{ background: s.state === "on" ? "var(--pass)" : s.state === "warn" ? "var(--warn)" : "var(--line-strong)" }} /></span>
                <span className="block mt-2 ink" style={{ fontWeight: 650, fontSize: 9.5, letterSpacing: "0.04em", wordBreak: "break-word" }}>{s.label}</span>
                <span className="block muted" style={{ fontSize: 11, lineHeight: 1.3 }}>{s.text}</span>
                <span className="sr-only">{s.state === "on" ? "Active" : s.state === "warn" ? "Needs attention" : "Not used"}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-4" style={{ fontSize: 13.5 }} aria-live="polite"><b className="ink">{cur.label.charAt(0) + cur.label.slice(1).toLowerCase()}.</b> {cur.detail}</p>
      <div className="mt-4 p-3.5" style={{ background: "var(--sunken)", borderRadius: 10, fontSize: 13.5, lineHeight: 1.7 }}>
        <div className="eyebrow mb-1.5">{active >= 3 ? (h.transcripts === "none" ? "Stored" : "Stored text") : "Spoken"}</div>
        {active >= 4 && h.transcripts === "none" ? <span className="muted">Nothing is stored for this call.</span> : SAMPLE_SPOKEN.map((t, i) => {
          const type = SAMPLE_TYPE[i];
          if (!type) return <span key={i}>{t}</span>;
          const found = h.pii.includes(type);
          const hide = active >= 3 && h.transcripts === "redacted" && found;
          const flag = active === 2 && found;
          return hide ? <mark key={i} className="mono" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>[{TAG[type]}]</mark> : <span key={i} style={flag ? { background: "var(--warn-soft)", borderRadius: 3, padding: "0 2px", boxShadow: "inset 0 -2px 0 var(--warn)" } : undefined}>{t}</span>;
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the step */

export function HostingStep() {
  const { pkg, setHosting, readOnly } = usePackage();
  const h = pkg.hosting;
  const r = pkg.requirements;
  const { checks, summary } = usePolicy();
  const set = (patch: Partial<Hosting>) => setHosting((x) => ({ ...x, ...patch }));
  const setRet = (k: keyof Hosting["retention"], patch: Partial<Hosting["retention"][keyof Hosting["retention"]]>) => setHosting((x) => ({ ...x, retention: { ...x.retention, [k]: { ...x.retention[k], ...patch } } }));
  const regions = REGIONS[h.kind];
  const noRedaction = r.languages.filter((l) => LANGUAGE_BY_ID[l] && !LANGUAGE_BY_ID[l].redaction).map((l) => LANGUAGE_BY_ID[l].name);
  const pickHosting = (kind: HostingKind) => setHosting((x) => { const list = REGIONS[kind]; const keep = list.find((g) => g.id === x.region && (!x.inCountry || g.inCountry)); const pick = keep ?? list.find((g) => !x.inCountry || g.inCountry) ?? list[0]; return { ...x, kind, region: pick.id }; });
  const toggleCountry = (on: boolean) => setHosting((x) => { if (!on) return { ...x, inCountry: false }; const cur = REGIONS[x.kind].find((g) => g.id === x.region); return { ...x, inCountry: true, region: cur?.inCountry ? x.region : REGIONS[x.kind].find((g) => g.inCountry)?.id ?? x.region }; });
  const regionAbroad = !regions.find((g) => g.id === h.region)?.inCountry;
  return (
    <>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)]"><WorkspaceHeader /><Stepper /></div>
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0">
          <div className="mb-8"><p className="eyebrow mb-2">Step 2 of 5</p><h2 className="serif" style={{ fontSize: 30, lineHeight: 1.12, color: "var(--ink)" }}>Where does it run, and what is kept?</h2><p className="mt-2" style={{ maxWidth: 580 }}>Choose where the system runs and how caller data is handled. The checks at the bottom tell you what is clear and what still needs a decision.</p></div>
          <ReadOnlyNotice />
          <fieldset disabled={readOnly} className="m-0 p-0 border-0 min-w-0 grid grid-cols-[minmax(0,1fr)] gap-10">
            <section aria-labelledby="h-host" className="grid gap-5">
              <h2 id="h-host" style={{ fontSize: 18 }}>Hosting</h2>
              <div role="radiogroup" aria-label="Hosting" className="va-cards va-cards--wide">
                {HOSTING_OPTIONS.map((o) => { const I = ICONS[o.id]; return (
                  <SelectCard key={o.id} selected={h.kind === o.id} onSelect={() => pickHosting(o.id)} icon={<I size={18} aria-hidden />} title={o.label}>
                    <span className="block">{o.where}</span><span className="block mt-2 muted" style={{ fontSize: 12.5 }}>{o.confirm}</span><span className="block mt-2" style={{ fontSize: 12 }}><Badge>{o.approvals}</Badge></span>
                  </SelectCard>); })}
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Region" help={regionAbroad ? "This region is outside India." : undefined}>{(p) => <Select {...p} value={h.region} onChange={(e) => set({ region: e.target.value })}>{regions.map((g) => <option key={g.id} value={g.id} disabled={h.inCountry && !g.inCountry}>{g.id}{g.inCountry ? "" : " (outside India)"}</option>)}</Select>}</Field>
                <Field label="Who operates it">{(p) => <Select {...p} value={h.operator} onChange={(e) => set({ operator: e.target.value })}>{OPERATORS.map((o) => <option key={o}>{o}</option>)}</Select>}</Field>
              </div>
              <Switch label="Data must stay in-country" description="Excludes any package with a component that runs outside India." checked={h.inCountry} onChange={toggleCountry} />
              {!h.inCountry && <Alert tone="warn" title="Data may leave India">Some packages that process data abroad become available. A policy check will ask you to confirm this is permitted.</Alert>}
            </section>

            <Section id="h-data" title="Data governance" description="For each kind of data, decide whether it is kept, for how long, and who can read it.">
              <div className="va-tablewrap">
                <table className="va-table">
                  <caption className="sr-only">Data handling by type</caption>
                  <thead><tr><th scope="col">Data</th><th scope="col">What to keep</th><th scope="col">Keep for</th><th scope="col">Who can read it</th></tr></thead>
                  <tbody>
                    {DATA_TYPES.map((d) => {
                      const rule = h.retention[d.id];
                      const off = (d.id === "recordings" && h.recording === "off") || (d.id === "transcripts" && h.transcripts === "none");
                      return (
                        <tr key={d.id}>
                          <td style={{ minWidth: 150 }}><span className="ink" style={{ fontWeight: 600 }}>{d.label}</span><div className="muted" style={{ fontSize: 12 }}>{d.help}</div></td>
                          <td style={{ minWidth: 190 }}>
                            {d.id === "recordings" && <Select aria-label="Recordings policy" value={h.recording} onChange={(e) => set({ recording: e.target.value as Hosting["recording"] })}><option value="off">Don&apos;t record</option><option value="consent">Record with consent</option><option value="always">Always record</option></Select>}
                            {d.id === "transcripts" && <Select aria-label="Transcripts policy" value={h.transcripts} onChange={(e) => set({ transcripts: e.target.value as Hosting["transcripts"] })}><option value="none">Don&apos;t store</option><option value="redacted">Store redacted</option><option value="full">Store full text</option></Select>}
                            {(d.id === "logs" || d.id === "memory") && <span className="muted">{d.id === "logs" ? "Always kept" : rule.days === null ? "Not kept" : "Kept"}</span>}
                          </td>
                          <td style={{ minWidth: 130 }}><Select aria-label={`${d.label} retention`} disabled={off} value={off ? "none" : rule.days === null ? "none" : String(rule.days)} onChange={(e) => setRet(d.id, { days: e.target.value === "none" ? null : Number(e.target.value) })}><option value="none">{d.id === "logs" ? "Not kept" : "Not kept"}</option>{RETENTION_DAYS.map((n) => <option key={n} value={n}>{n} days</option>)}</Select></td>
                          <td style={{ minWidth: 150 }}><Select aria-label={`${d.label} access`} disabled={off || rule.days === null} value={off || rule.days === null ? "nobody" : rule.access} onChange={(e) => setRet(d.id, { access: e.target.value as Hosting["retention"][typeof d.id]["access"] })}>{ACCESS_GROUPS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Field label="Caller notice" help="Read to every caller at the start. Also covers recording consent." optional>
                {(p) => <><Textarea {...p} rows={3} value={h.callerNotice} onChange={(e) => set({ callerNotice: e.target.value })} placeholder={SAMPLE_NOTICE} /><button type="button" className="va-link mt-2" style={{ fontSize: 13 }} onClick={() => set({ callerNotice: SAMPLE_NOTICE })}>Use the sample text</button></>}
              </Field>
            </Section>

            <Section id="h-pii" title="Personal information" description="Pick what to detect and remove from transcripts before they are stored.">
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3.5">
                {PII_TYPES.map((t) => <Checkbox key={t.id} label={t.label} checked={h.pii.includes(t.id)} onChange={(v) => setHosting((x) => ({ ...x, pii: v ? [...x.pii, t.id] : x.pii.filter((y) => y !== t.id) }))} />)}
              </div>
              {h.pii.includes("custom") && <Field label="Custom pattern" help="For example: a case number that looks like AB-1234.">{(p) => <Input {...p} value={h.piiCustom} onChange={(e) => set({ piiCustom: e.target.value })} placeholder="AB-1234" />}</Field>}
              {noRedaction.length > 0 && <Alert tone="warn" title={`Redaction isn't available for ${noRedaction.join(", ")}`}>Detection is tested for the other languages. For these, either don&apos;t store transcripts or keep them for a short time with tight access.</Alert>}
              <PrivacyPipeline />
            </Section>

            <Section id="h-ops" title="Operations and integrations" description="What it connects to and how it is looked after. These feed the price.">
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
                <Switch label="Connect a phone number" description="Telephony set-up is included." checked={h.integrations.telephony} onChange={(v) => setHosting((x) => ({ ...x, integrations: { ...x.integrations, telephony: v } }))} />
                <Switch label="Language adapter" description="Helps with mixed-language speech." checked={h.integrations.adapter} onChange={(v) => setHosting((x) => ({ ...x, integrations: { ...x.integrations, adapter: v } }))} />
                <Switch label="Government API integrations" description="For example status lookups." checked={h.integrations.govApis} onChange={(v) => setHosting((x) => ({ ...x, integrations: { ...x.integrations, govApis: v } }))} />
                <Switch label="CRM integration" description="Create and update records." checked={h.integrations.crm} onChange={(v) => setHosting((x) => ({ ...x, integrations: { ...x.integrations, crm: v } }))} />
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Availability target">{(p) => <Select {...p} value={h.availability} onChange={(e) => set({ availability: Number(e.target.value) })}>{AVAILABILITY.map((a) => <option key={a} value={a}>{a}%</option>)}</Select>}</Field>
                <Field label="Support" help={SUPPORT_MODELS.find((m) => m.id === h.support)?.help}>{(p) => <Select {...p} value={h.support} onChange={(e) => set({ support: e.target.value as Hosting["support"] })}>{SUPPORT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>}</Field>
              </div>
              <Switch label="Recovery site" description={h.availability >= 99.9 ? "Needed for this availability target." : "A second site for disasters. Adds cost."} checked={h.disasterRecovery} onChange={(v) => set({ disasterRecovery: v })} />
            </Section>
          </fieldset>

          <section aria-labelledby="h-checks" className="grid gap-4 mt-10" style={{ paddingTop: 36, borderTop: "1px solid var(--line)" }}>
            <div><h2 id="h-checks" style={{ fontSize: 18 }}>Policy checks</h2><p className="mt-1.5" style={{ maxWidth: 580 }}>These update as you answer. You don&apos;t have to clear them to continue, but every one must be cleared before a quote can be submitted.</p></div>
            <PolicySummary summary={summary} />
            <PolicyList checks={checks} />
          </section>
        </div>
        <LiveEstimate />
      </div>
      <StepFooter stepId="hosting" />
    </>
  );
}

export { Check, cx };
