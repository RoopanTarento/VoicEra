"use client";

import { AlertTriangle, Check, CheckCircle2, Circle, Languages as LangIcon, PhoneIncoming, PhoneOutgoing, Radio, Search, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CHANNELS, COMPLEXITIES, LATENCIES, PRIORITIES, USE_CASES, VOICES, HOSTING_PROFILES } from "@/lib/vani/catalog";
import { applyUseCase, requirementsIssues, usageFrom } from "@/lib/vani/defaults";
import { compact, inr, millions, num } from "@/lib/vani/format";
import { ALL_LANGUAGE_INFO, languageInfo } from "@/lib/vani/languages";
import { profileFor } from "@/lib/vani/pricing";
import { evaluateAll } from "@/lib/vani/recommend";
import type { InteractionMode, Requirements } from "@/lib/vani/types";
import { LiveEstimate, useEstimate } from "./estimate";
import { Alert, Badge, Chip, CountUp, Field, InfoTip, Input, NumberInput, Radio as RadioInput, SelectCard, Select, Switch, Tooltip, cx } from "./ui";
import { ReadOnlyNotice, StepFooter, Stepper, WorkspaceHeader, useContinue, usePackage } from "./workspace";

const Section = ({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) => (
  <section aria-labelledby={id} className="grid gap-5" style={{ paddingTop: 36, borderTop: "1px solid var(--line)" }}>
    <div><h2 id={id} style={{ fontSize: 18 }}>{title}</h2>{description && <p className="mt-1.5" style={{ maxWidth: 560 }}>{description}</p>}</div>
    {children}
  </section>
);

/* ------------------------------------------------------------------ languages */

function Pill({ level, children }: { level: "tested" | "partial" | "none"; children: React.ReactNode }) {
  return <Badge tone={level === "tested" ? "pass" : level === "partial" ? "warn" : "bad"} icon={level === "tested" ? <CheckCircle2 size={12} aria-hidden /> : level === "partial" ? <AlertTriangle size={12} aria-hidden /> : <Circle size={12} aria-hidden />}>{children}</Badge>;
}

function LanguagePicker({ error }: { error?: string | null }) {
  const { pkg, setRequirements } = usePackage();
  const r = pkg.requirements;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ALL_LANGUAGE_INFO.filter((l) => !r.languages.includes(l.id) && (!t || l.name.toLowerCase().includes(t) || l.native.toLowerCase().includes(t)));
  }, [q, r.languages]);
  const add = (id: string) => { setRequirements((x) => ({ ...x, languages: [...x.languages, id] })); setQ(""); setSel(0); input.current?.focus(); };
  const infos = r.languages.map((id) => languageInfo(id)).filter(Boolean) as NonNullable<ReturnType<typeof languageInfo>>[];
  const weak = infos.filter((l) => l.status !== "tested");
  return (
    <div className="grid gap-4">
      <Field label="Languages callers speak" error={error} help="Search and add every language you need. We show how well each one is tested.">
        {(p) => (
          <div className="relative">
            <div className="va-affix">
              <span className="pre"><Search size={15} aria-hidden /></span>
              <input ref={input} {...p} className="va-input" role="combobox" aria-expanded={open} aria-controls="lang-list" aria-autocomplete="list" aria-activedescendant={open && matches[sel] ? `lang-${matches[sel].id}` : undefined} autoComplete="off" placeholder="Search languages, for example Marathi" value={q}
                onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
                onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setSel((s) => Math.min(matches.length - 1, s + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } if (e.key === "Enter" && open && matches[sel]) { e.preventDefault(); add(matches[sel].id); } if (e.key === "Escape") setOpen(false); if (e.key === "Backspace" && !q && r.languages.length) setRequirements((x) => ({ ...x, languages: x.languages.slice(0, -1) })); }} />
            </div>
            {open && (
              <ul id="lang-list" role="listbox" aria-label="Languages" className="va-pop va-fade m-0 p-1.5 list-none" style={{ top: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 280, overflowY: "auto" }}>
                {matches.map((l, i) => (
                  <li key={l.id} id={`lang-${l.id}`} role="option" aria-selected={i === sel}>
                    <button type="button" className="va-menuitem justify-between" style={i === sel ? { background: "var(--sunken)" } : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => add(l.id)} onMouseEnter={() => setSel(i)}>
                      <span><span className="ink">{l.name}</span> <span className="muted">{l.native}</span></span>
                      <Pill level={l.status}>{l.status === "tested" ? "Tested" : l.status === "partial" ? "Partly tested" : "Not tested"}</Pill>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <li className="muted p-3" style={{ fontSize: 13 }}>{q ? `No language matches "${q}".` : "All languages are added."}</li>}
              </ul>
            )}
          </div>
        )}
      </Field>
      {r.languages.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Selected languages">
          {infos.map((l) => <Chip key={l.id} onRemove={() => setRequirements((x) => ({ ...x, languages: x.languages.filter((y) => y !== l.id) }))} removeLabel={`Remove ${l.name}`}>{l.name}</Chip>)}
        </div>
      )}
      {infos.length > 0 && (
        <div className="va-tablewrap">
          <table className="va-table">
            <caption className="sr-only">Readiness of each chosen language</caption>
            <thead><tr><th scope="col">Language</th><th scope="col">Speech recognition</th><th scope="col">Voice</th><th scope="col">Dialects</th><th scope="col">Mixed language</th><th scope="col">Benchmarks</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {infos.map((l) => (
                <tr key={l.id}>
                  <td><span className="ink" style={{ fontWeight: 600 }}>{l.name}</span><div className="muted" style={{ fontSize: 12 }}>{l.native}</div></td>
                  <td>{l.asr.tested} tested{l.asr.partial ? `, ${l.asr.partial} partial` : ""} <span className="muted">of {l.asr.of}</span></td>
                  <td>{l.tts.tested} tested{l.tts.partial ? `, ${l.tts.partial} partial` : ""} <span className="muted">of {l.tts.of}</span></td>
                  <td>{l.dialects ? "Tested" : <span className="muted">Not tested</span>}</td>
                  <td>{l.codeSwitch ? "Supported" : <span className="muted">Not supported</span>}</td>
                  <td>{l.benchmarked} <span className="muted">of 8 packages</span></td>
                  <td><Pill level={l.status}>{l.status === "tested" ? "Tested" : l.status === "partial" ? "Partly tested" : "Not tested"}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {weak.length > 0 && (
        <Alert tone="warn" title={`${weak.map((l) => l.name).join(", ")} ${weak.length === 1 ? "isn't" : "aren't"} benchmarked end to end`}>
          {weak.some((l) => l.status === "none") ? "No package is tested for " + weak.filter((l) => l.status === "none").map((l) => l.name).join(", ") + ", so none can be recommended. " : ""}You can still continue. We will flag it as an open item and recommend a pilot on real calls before launch.
        </Alert>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ scale */

function Range({ id, label, value, min, max, step, onChange, format }: { id: string; label: string; value: number | null; min: number; max: number; step: number; onChange: (n: number) => void; format: (n: number) => string }) {
  return <input id={id} type="range" className="va-range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value ?? min))} aria-label={label} aria-valuetext={format(value ?? min)} onChange={(e) => onChange(Number(e.target.value))} />;
}

function ScaleVisual({ errors }: { errors: Record<string, string> }) {
  const { pkg, setRequirements, readOnly } = usePackage();
  const r = pkg.requirements;
  const est = useEstimate(pkg);
  const u = usageFrom(r);
  const growth = r.growthPct ?? 0;
  const minutes = u.callsPerMonth * u.avgMinutes;
  const peakAtEnd = u.peakConcurrency * (1 + Math.max(0, growth) / 100);
  const { profile, undersized } = profileFor(pkg.hosting.kind, "small", peakAtEnd);
  const months = Array.from({ length: 12 }, (_, i) => u.callsPerMonth * (1 + (growth / 100) * (i / 11)));
  const maxBar = Math.max(1, ...months);
  const slots = Math.min(profile.capacity, 60);
  const filled = Math.min(slots, Math.round((u.peakConcurrency / profile.capacity) * slots));
  const grown = Math.min(slots, Math.round((peakAtEnd / profile.capacity) * slots));
  const set = (patch: Partial<Requirements>) => setRequirements((x) => ({ ...x, ...patch }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="grid gap-5 content-start">
        <Field label="Calls per month" error={errors.callsPerMonth}>{(p) => <><NumberInput {...p} value={r.callsPerMonth} onChange={(v) => set({ callsPerMonth: v })} unit="calls" disabled={readOnly} /><div className="mt-3"><Range id="r-calls" label="Calls per month" value={r.callsPerMonth} min={1000} max={500000} step={1000} onChange={(n) => set({ callsPerMonth: n })} format={(n) => `${num(n)} calls`} /></div></>}</Field>
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Average call length" error={errors.avgMinutes}>{(p) => <><NumberInput {...p} value={r.avgMinutes} onChange={(v) => set({ avgMinutes: v })} unit="min" decimals={1} max={60} disabled={readOnly} /><div className="mt-3"><Range id="r-min" label="Average call length" value={r.avgMinutes} min={0.5} max={15} step={0.5} onChange={(n) => set({ avgMinutes: n })} format={(n) => `${n} minutes`} /></div></>}</Field>
          <Field label="Peak concurrent calls" error={errors.peakConcurrent}>{(p) => <><NumberInput {...p} value={r.peakConcurrent} onChange={(v) => set({ peakConcurrent: v })} unit="calls" disabled={readOnly} /><div className="mt-3"><Range id="r-peak" label="Peak concurrent calls" value={r.peakConcurrent} min={1} max={400} step={1} onChange={(n) => set({ peakConcurrent: n })} format={(n) => `${n} calls at once`} /></div></>}</Field>
        </div>
        <Field label="Growth over the next 12 months" optional error={errors.growthPct} help="Used to size hosting and project the cost at month 12.">{(p) => <><NumberInput {...p} value={r.growthPct} onChange={(v) => set({ growthPct: v })} unit="%" max={1000} disabled={readOnly} /><div className="mt-3"><Range id="r-gr" label="Growth over 12 months" value={r.growthPct} min={0} max={200} step={5} onChange={(n) => set({ growthPct: n })} format={(n) => `${n} percent`} /></div></>}</Field>
      </div>
      <div className="va-card va-card--pad grid gap-5 content-start" aria-label="What this scale means">
        <div className="flex items-center justify-between"><span className="eyebrow">What this scale means</span><Tooltip text="Worked out from your numbers and the sample catalogue."><span><Badge>Live</Badge></span></Tooltip></div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-4">
          {[["Minutes a month", compact(minutes)], ["Model tokens a month", millions(u.callsPerMonth * u.llmTokensPerCall)], ["Voice characters a month", millions(u.callsPerMonth * u.ttsCharsPerCall)], ["Hosting it needs", profile.name.replace(/ · .*/, "") + " " + profile.size]].map(([k, v]) => (
            <div key={k}><dt className="muted" style={{ fontSize: 12 }}>{k}</dt><dd className="m-0 ink tnum" style={{ fontWeight: 600, fontSize: 16 }}>{v}</dd></div>
          ))}
        </dl>
        <div>
          <div className="flex items-baseline justify-between mb-2"><span className="eyebrow">Calls each month</span><span className="muted tnum" style={{ fontSize: 12 }}>{compact(months[0])} to {compact(months[11])}</span></div>
          <div className="flex items-end gap-1" style={{ height: 64 }} role="img" aria-label={`Calls grow from ${num(Math.round(months[0]))} to ${num(Math.round(months[11]))} over twelve months`}>
            {months.map((m, i) => <div key={i} style={{ flex: 1, height: `${Math.max(6, (m / maxBar) * 100)}%`, background: i === 11 ? "var(--ink)" : "var(--line-strong)", borderRadius: 3, transition: "height 0.4s cubic-bezier(0.22,1,0.36,1)" }} />)}
          </div>
          <div className="flex justify-between muted mt-1" style={{ fontSize: 11 }}><span>Month 1</span><span>Month 12</span></div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-2"><span className="eyebrow">Peak against capacity</span><span className="muted tnum" style={{ fontSize: 12 }}>{u.peakConcurrency} of {profile.capacity}{growth > 0 ? `, ${Math.round(peakAtEnd)} at month 12` : ""}</span></div>
          <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`Peak of ${u.peakConcurrency} calls against ${profile.capacity} calls of capacity`}>
            {Array.from({ length: slots }, (_, i) => <span key={i} style={{ width: 9, height: 9, borderRadius: 2, background: i < filled ? "var(--ink)" : i < grown ? "var(--muted)" : "var(--line)", transition: "background 0.3s" }} />)}
          </div>
          {undersized && <p className="mt-2" style={{ fontSize: 12.5, color: "var(--warn)" }}>This peak is above what one {pkg.hosting.kind === "onprem" ? "on-prem" : "cloud"} profile covers. Expect to phase the rollout or scale out.</p>}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }} className="grid grid-cols-2 gap-4">
          <div><div className="muted" style={{ fontSize: 12 }}>Estimated cost a month</div><div className="serif ink tnum" style={{ fontSize: 26 }}>{est.cost ? <CountUp value={est.cost.recurring} format={(n) => inr(Math.round(n))} /> : "—"}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>At month 12</div><div className="serif ink tnum" style={{ fontSize: 26 }}>{est.cost?.recurringAt12 ? <CountUp value={est.cost.recurringAt12} format={(n) => inr(Math.round(n))} /> : "—"}</div></div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tensions */

function Tensions() {
  const { pkg } = usePackage();
  const r = pkg.requirements;
  const items = useMemo(() => {
    const out: { tone: "info" | "warn"; title: string; body: string }[] = [];
    if (!r.languages.length || !r.callsPerMonth || !r.avgMinutes || !r.peakConcurrent) return out;
    const set = evaluateAll(r, pkg.hosting);
    const c = set.candidates;
    if (!c.length) return out;
    const fastest = Math.min(...c.map((e) => e.latencyS));
    const cheapest = Math.min(...c.map((e) => e.cost.recurring));
    const lat = LATENCIES.find((l) => l.id === r.latency)?.maxS;
    if (lat && fastest > lat) out.push({ tone: "warn", title: `${lat === 1 ? "Under 1 second" : `Under ${lat} seconds`} is quicker than any package we measured`, body: `The fastest qualifying package takes about ${fastest.toFixed(1)} s per turn. You can continue. We will show the closest one and say how far off it is.` });
    if (r.monthlyBudget && cheapest > r.monthlyBudget) out.push({ tone: "warn", title: "Your budget is below the cheapest qualifying package", body: `That one costs about ${inr(cheapest)} a month, ${Math.round(((cheapest - r.monthlyBudget) / r.monthlyBudget) * 100)}% above your ceiling. You can continue. We will show the closest option and what would close the gap.` });
    else if (r.monthlyBudget && r.priority === "quality" && cheapest > r.monthlyBudget * 0.7) out.push({ tone: "info", title: "Highest quality may not fit this budget", body: "The best-measured packages cost the most. The recommendation may lean toward quality only as far as your ceiling allows." });
    if (r.complexity === "reasoning" && r.priority === "cost") out.push({ tone: "info", title: "Complex conversations limit how cheap this can get", body: "Open-ended reasoning needs a larger language model, which is the biggest part of the bill. Consider balanced instead of lowest cost." });
    if (r.latency === "lt1" && r.priority === "quality") out.push({ tone: "info", title: "Fast and best quality pull in opposite directions", body: "The highest-quality models are slower. We will balance the two and show the trade-off." });
    return out;
  }, [r, pkg.hosting]);
  if (!items.length) return null;
  return <div className="grid gap-3" aria-live="polite">{items.map((x) => <Alert key={x.title} tone={x.tone} title={x.title}>{x.body}</Alert>)}</div>;
}

/* ------------------------------------------------------------------ the step */

const MODES: { id: InteractionMode; label: string; help: string; icon: typeof PhoneIncoming }[] = [
  { id: "inbound", label: "Inbound", help: "Citizens call you.", icon: PhoneIncoming },
  { id: "outbound", label: "Outbound", help: "You call citizens, one at a time.", icon: PhoneOutgoing },
  { id: "broadcast", label: "Broadcast", help: "A campaign to a large list.", icon: Radio },
];

export function RequirementsStep() {
  const { pkg, setRequirements, readOnly } = usePackage();
  const r = pkg.requirements;
  const [attempted, setAttempted] = useState(false);
  const issues = requirementsIssues(r);
  const errors = useMemo(() => (attempted ? Object.fromEntries(issues.map((i) => [i.field, i.message])) : {}), [attempted, issues]);
  const set = (patch: Partial<Requirements>) => setRequirements((x) => ({ ...x, ...patch }));
  useContinue(() => {
    if (issues.length === 0) return true;
    setAttempted(true);
    requestAnimationFrame(() => { const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid]'); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.focus?.(); });
    return false;
  });
  const uc = USE_CASES.find((u) => u.id === r.useCase);
  return (
    <>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)]"><WorkspaceHeader /><Stepper /></div>
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0">
          <div className="mb-8"><p className="eyebrow mb-2">Step 1 of 5</p><h2 className="serif" style={{ fontSize: 30, lineHeight: 1.12, color: "var(--ink)" }}>What does your service need?</h2><p className="mt-2" style={{ maxWidth: 560 }}>Answer what you know. Everything updates the estimate on the right as you go, and you can change any answer later.</p></div>
          <ReadOnlyNotice />
          <fieldset disabled={readOnly} className="m-0 p-0 border-0 min-w-0 grid grid-cols-[minmax(0,1fr)] gap-10">
            <section aria-labelledby="s-service" className="grid gap-5">
              <h2 id="s-service" style={{ fontSize: 18 }}>The service</h2>
              <Field label="Service name" error={errors.serviceName}>{(p) => <Input {...p} value={r.serviceName} onChange={(e) => set({ serviceName: e.target.value })} placeholder="Citizen Support Helpline" />}</Field>
              <div role="radiogroup" aria-label="Use case" data-invalid={errors.useCase ? "" : undefined} tabIndex={errors.useCase ? -1 : undefined}>
                <p className="va-label">What will it do?</p>
                <div className="va-cards va-cards--wide">
                  {USE_CASES.map((u) => <SelectCard key={u.id} selected={r.useCase === u.id} onSelect={() => setRequirements((x) => applyUseCase(x, u.id))} title={u.label}>{u.help}</SelectCard>)}
                </div>
                {errors.useCase && <p className="va-error" role="alert">{errors.useCase}</p>}
                {uc && <p className="va-help flex items-center gap-1.5"><Sparkles size={13} aria-hidden />We set the call type and conversation depth for you. Change them below if they are off.</p>}
              </div>
              <div role="group" aria-label="How calls happen" data-invalid={errors.interaction ? "" : undefined} tabIndex={errors.interaction ? -1 : undefined}>
                <p className="va-label">How do calls happen?</p>
                <div className="va-cards">
                  {MODES.map((m) => { const I = m.icon; return <SelectCard key={m.id} multi selected={r.interaction.includes(m.id)} icon={<I size={18} aria-hidden />} onSelect={() => setRequirements((x) => ({ ...x, interaction: x.interaction.includes(m.id) ? x.interaction.filter((y) => y !== m.id) : [...x.interaction, m.id] }))} title={m.label}>{m.help}</SelectCard>; })}
                </div>
                {errors.interaction && <p className="va-error" role="alert">{errors.interaction}</p>}
              </div>
              <Field label="Channel" help={CHANNELS.find((c) => c.id === r.channel)?.help}>{(p) => <Select {...p} value={r.channel} onChange={(e) => set({ channel: e.target.value as Requirements["channel"] })}>{CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
            </section>

            <Section id="s-complexity" title="How demanding is the conversation?" description="This decides how capable the language model has to be, which is the largest part of the cost.">
              <div role="radiogroup" aria-label="Task complexity" className="va-cards">
                {COMPLEXITIES.map((c) => <SelectCard key={c.id} selected={r.complexity === c.id} onSelect={() => set({ complexity: c.id })} title={c.label}>{c.help}</SelectCard>)}
              </div>
            </Section>

            <Section id="s-lang" title="Language experience" description="Pick every language callers might use. Readiness is shown for each, so there are no surprises later.">
              <LanguagePicker error={errors.languages} />
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
                <Switch label="Callers speak regional dialects" description="Prefer speech models tested on dialects." checked={r.dialects} onChange={(v) => set({ dialects: v })} />
                <Switch label="Callers mix languages mid-sentence" description="For example Hindi and English together." checked={r.codeSwitching} onChange={(v) => set({ codeSwitching: v })} />
              </div>
              <Field label="Voice preference">{(p) => <Select {...p} value={r.voice} onChange={(e) => set({ voice: e.target.value as Requirements["voice"] })} style={{ maxWidth: 260 }}>{VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>}</Field>
            </Section>

            <Section id="s-scale" title="Scale" description="Drag a slider or type a number. Hosting, usage and cost follow along.">
              <ScaleVisual errors={errors} />
            </Section>

            <Section id="s-quality" title="Quality, speed and budget" description="Tell us what matters most. Combinations that are hard to meet are explained, not blocked.">
              <div role="radiogroup" aria-label="What matters most" className="va-cards">
                {PRIORITIES.map((p) => <SelectCard key={p.id} selected={r.priority === p.id} onSelect={() => set({ priority: p.id })} title={p.label}>{p.help}</SelectCard>)}
              </div>
              <div role="radiogroup" aria-label="How fast replies must be">
                <p className="va-label flex items-center gap-1.5">How quickly should it reply? <InfoTip text="The time from the caller finishing a sentence to the assistant starting its reply." /></p>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">{LATENCIES.map((l) => <RadioInput key={l.id} name="latency" label={l.label} checked={r.latency === l.id} onChange={() => set({ latency: l.id })} />)}</div>
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Monthly budget ceiling" optional help="We warn as the estimate nears it and block submission above it.">{(p) => <NumberInput {...p} value={r.monthlyBudget} onChange={(v) => set({ monthlyBudget: v })} unit="₹ a month" disabled={readOnly} />}</Field>
                <Field label="Target cost per minute" optional help="Checked against the worked-out cost per minute.">{(p) => <NumberInput {...p} value={r.costPerMinute} onChange={(v) => set({ costPerMinute: v })} unit="₹ a minute" decimals={2} disabled={readOnly} />}</Field>
              </div>
              <Tensions />
            </Section>
          </fieldset>
          {attempted && issues.length > 0 && <Alert tone="bad" className="mt-8" title={`${issues.length} thing${issues.length === 1 ? "" : "s"} to fix before continuing`}><ul className="m-0 pl-4">{issues.map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul></Alert>}
        </div>
        <LiveEstimate />
      </div>
      <StepFooter stepId="requirements" />
    </>
  );
}

export { Check, LangIcon, HOSTING_PROFILES, cx };
