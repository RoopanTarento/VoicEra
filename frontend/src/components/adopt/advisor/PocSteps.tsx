"use client";

import { useState } from "react";
import { Download, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { Notice, Panel } from "@/components/adopt/ui";
import { DOCUMENTED_LANGUAGES, OTHER_LANGUAGES, PLATINUM } from "@/lib/adopt/advisor/source";
import {
  QUESTION_TEMPLATES,
  generateKnowledgeFiles,
  generateScript,
  scriptAsText,
  validatePoc,
  type PocData,
  type PocIssue,
  type PocScheme,
} from "@/lib/adopt/advisor/poc";
import { makeZip } from "@/lib/adopt/advisor/zip";

export interface StepProps {
  poc: PocData;
  setPoc: (patch: Partial<PocData>) => void;
  /** Show errors for fields the person has already tried to move past. */
  showErrors: boolean;
}

const errFor = (issues: PocIssue[], field: string) => issues.find((i) => i.field === field);

function Field({ id, label, help, error, children }: { id: string; label: string; help?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-semibold">{label}</label>
      {help ? <p id={`${id}-help`} className="text-[12.5px] leading-snug text-v-muted">{help}</p> : null}
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="text-[12.5px] font-medium text-v-danger">{error}</p> : null}
    </div>
  );
}

export function download(name: string, content: string | Uint8Array, mime: string) {
  const part: BlobPart = typeof content === "string" ? content : (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download = name;
  el.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Basics ---------------- */

export function BasicsStep({ poc, setPoc, showErrors }: StepProps) {
  const [custom, setCustom] = useState("");
  const [customErr, setCustomErr] = useState<string | null>(null);
  const issues = validatePoc(poc).filter((i) => i.step === "basics");
  const toggle = (l: string) => setPoc({ languages: poc.languages.includes(l) ? poc.languages.filter((x) => x !== l) : [...poc.languages, l] });
  const extra = poc.languages.filter((l) => !(DOCUMENTED_LANGUAGES as readonly string[]).includes(l) && !(OTHER_LANGUAGES as readonly string[]).includes(l));

  const chip = (l: string, documented: boolean) => {
    const on = poc.languages.includes(l);
    return (
      <label key={l} className={`flex cursor-pointer items-center rounded-v-lg border px-3.5 py-2 text-[13.5px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 ${on ? (documented ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-warning bg-v-warn-tint text-v-warn-ink") : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>
        <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(l)} />
        {l}
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Field id="poc-dept" label="Your department or organisation" help="Spoken in the opening line." error={showErrors ? errFor(issues, "department")?.message : undefined}>
        <Input id="poc-dept" value={poc.department} maxLength={80} placeholder="For example, State Agriculture Department" onChange={(e) => setPoc({ department: e.target.value })} aria-invalid={showErrors && errFor(issues, "department") ? true : undefined} aria-describedby="poc-dept-help" />
      </Field>
      <Field id="poc-agent" label="What should the agent call itself? (optional)" help="For example, the Agriculture Department assistant. Leave blank to use a plain default.">
        <Input id="poc-agent" value={poc.agentName} maxLength={60} onChange={(e) => setPoc({ agentName: e.target.value })} />
      </Field>
      <div className="flex flex-col gap-2" role="group" aria-label="Languages">
        <span className="text-[13.5px] font-semibold">Languages citizens will speak</span>
        <p className="text-[12.5px] text-v-muted">The package documents English and ten Indian languages and can switch language mid-call. Any other language is unverified.</p>
        <div className="flex flex-wrap gap-2">{DOCUMENTED_LANGUAGES.map((l) => chip(l, true))}</div>
        <div className="flex flex-wrap gap-2">
          {OTHER_LANGUAGES.map((l) => chip(l, false))}
          {extra.map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5 rounded-v-lg border border-v-warning bg-v-warn-tint px-3 py-2 text-[13.5px] text-v-warn-ink">
              {l}
              <button type="button" aria-label={`Remove ${l}`} onClick={() => toggle(l)}><X className="size-3.5" aria-hidden /></button>
            </span>
          ))}
        </div>
        <div className="flex max-w-[380px] gap-2">
          <label htmlFor="poc-lang-add" className="sr-only">Another language</label>
          <Input id="poc-lang-add" value={custom} placeholder="Another language" maxLength={40} onChange={(e) => { setCustom(e.target.value); setCustomErr(null); }} />
          <Button
            variant="outline"
            onClick={() => {
              const n = custom.trim();
              if (n.length < 2) return setCustomErr("Enter at least 2 letters.");
              if (poc.languages.some((l) => l.toLowerCase() === n.toLowerCase())) return setCustomErr("Already chosen.");
              setPoc({ languages: [...poc.languages, n.replace(/\b\w/g, (c) => c.toUpperCase())] });
              setCustom("");
            }}
          >
            <Plus className="size-3.5" aria-hidden /> Add
          </Button>
        </div>
        {customErr ? <p role="alert" className="text-[12.5px] font-medium text-v-danger">{customErr}</p> : null}
        {showErrors && errFor(issues, "languages") ? <p role="alert" className="text-[12.5px] font-medium text-v-danger">{errFor(issues, "languages")?.message}</p> : null}
        {poc.languages.some((l) => !(DOCUMENTED_LANGUAGES as readonly string[]).includes(l)) ? (
          <Notice tone="warning">A language outside the documented list needs verifying, including quality, before you rely on it.</Notice>
        ) : null}
      </div>
      <Field id="poc-kblang" label="Language you will write the knowledge text in" help="The knowledge base takes text in the documented languages. You can add more files in other languages later.">
        <select id="poc-kblang" value={poc.kbLanguage} onChange={(e) => setPoc({ kbLanguage: e.target.value })} className="max-w-[260px] rounded-v-lg border border-v-line-strong bg-white px-3.5 py-2.5 text-[13.5px]">
          {DOCUMENTED_LANGUAGES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

/* ---------------- Schemes ---------------- */

const newScheme = (): PocScheme => ({ id: Math.random().toString(36).slice(2, 8), name: "", summary: "", eligibility: "", documents: "", howToApply: "", deadline: "" });

export function SchemesStep({ poc, setPoc, showErrors }: StepProps) {
  const issues = validatePoc(poc).filter((i) => i.step === "schemes");
  const update = (i: number, patch: Partial<PocScheme>) => setPoc({ schemes: poc.schemes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const gen = generateKnowledgeFiles(poc);

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="info" title="Use your own approved wording">
        Everything the agent says about a scheme comes from what you type here. Only put in information your department has approved for citizens.
      </Notice>
      {showErrors && errFor(issues, "schemes") ? <p role="alert" className="text-[13px] font-medium text-v-danger">{errFor(issues, "schemes")?.message}</p> : null}
      {poc.schemes.map((s, i) => {
        const e = (f: string) => (showErrors ? errFor(issues, `schemes.${i}.${f}`)?.message : undefined);
        return (
          <Panel key={s.id} className="flex flex-col gap-4 !p-4 md:!p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15.5px] font-semibold">Scheme {i + 1}{s.name.trim() ? `: ${s.name.trim()}` : ""}</h3>
              <button type="button" aria-label={`Remove scheme ${i + 1}`} onClick={() => setPoc({ schemes: poc.schemes.filter((_, j) => j !== i) })} className="flex size-9 items-center justify-center rounded-v-md border border-v-line text-v-muted hover:border-v-danger hover:text-v-danger">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field id={`s${i}-name`} label="Scheme name" error={e("name")}>
                <Input id={`s${i}-name`} value={s.name} maxLength={80} onChange={(ev) => update(i, { name: ev.target.value })} aria-invalid={e("name") ? true : undefined} />
              </Field>
              <Field id={`s${i}-summary`} label="What it offers (one line)">
                <Input id={`s${i}-summary`} value={s.summary} maxLength={140} onChange={(ev) => update(i, { summary: ev.target.value })} />
              </Field>
            </div>
            <Field id={`s${i}-elig`} label="Who it is for" help="In plain sentences. The agent uses these to explain who may qualify." error={e("eligibility")}>
              <Textarea id={`s${i}-elig`} rows={2} value={s.eligibility} maxLength={400} onChange={(ev) => update(i, { eligibility: ev.target.value })} aria-invalid={e("eligibility") ? true : undefined} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field id={`s${i}-docs`} label="Documents needed" help="Or write none." error={e("documents")}>
                <Input id={`s${i}-docs`} value={s.documents} maxLength={200} onChange={(ev) => update(i, { documents: ev.target.value })} />
              </Field>
              <Field id={`s${i}-apply`} label="How to apply" error={e("howToApply")}>
                <Input id={`s${i}-apply`} value={s.howToApply} maxLength={200} onChange={(ev) => update(i, { howToApply: ev.target.value })} aria-invalid={e("howToApply") ? true : undefined} />
              </Field>
            </div>
            <Field id={`s${i}-date`} label="Last date to apply (optional)">
              <Input id={`s${i}-date`} value={s.deadline} maxLength={60} placeholder="For example, 31 March 2027" onChange={(ev) => update(i, { deadline: ev.target.value })} className="max-w-[260px]" />
            </Field>
          </Panel>
        );
      })}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" onClick={() => setPoc({ schemes: [...poc.schemes, newScheme()] })}>
          <Plus className="size-3.5" aria-hidden /> Add a scheme
        </Button>
        <p className="text-[12.5px] text-v-muted">
          {poc.schemes.length} {poc.schemes.length === 1 ? "scheme" : "schemes"} will become {gen.files.length} knowledge {gen.files.length === 1 ? "file" : "files"}. The package takes up to {PLATINUM.limits.maxKnowledgeFiles.value}.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Questions ---------------- */

export function QuestionsStep({ poc, setPoc, showErrors }: StepProps) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const issues = validatePoc(poc).filter((i) => i.step === "questions");
  const has = (id: string) => poc.questions.some((q) => q.id === id);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[64ch] text-[14px] leading-relaxed text-v-body">
        The agent asks a few questions to narrow down which scheme may apply. Pick the ones your scheme rules depend on. Where a question mentions a limit or a category, replace it with the exact one.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13.5px] font-semibold">Common questions</legend>
        {QUESTION_TEMPLATES.map((t) => (
          <label key={t.id} className="flex cursor-pointer items-start gap-3 rounded-v-lg border border-v-line bg-white px-4 py-3 has-[:checked]:border-v-accent has-[:checked]:bg-v-pale has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--v-accent)]" checked={has(t.id)} onChange={() => setPoc({ questions: has(t.id) ? poc.questions.filter((q) => q.id !== t.id) : [...poc.questions, t] })} />
            <span>
              <span className="block text-[14px] font-medium">{t.question}</span>
              <span className="block text-[12.5px] text-v-muted">{t.why}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="poc-q-add" className="text-[13.5px] font-semibold">Add your own question</label>
        <div className="flex flex-wrap gap-2">
          <Input id="poc-q-add" className="min-w-[260px] flex-1" value={text} maxLength={160} placeholder="Do you hold a ration card?" onChange={(e) => { setText(e.target.value); setErr(null); }} aria-invalid={err ? true : undefined} />
          <Button
            variant="outline"
            onClick={() => {
              const q = text.trim();
              if (q.length < 8) return setErr("A question needs at least 8 characters.");
              setPoc({ questions: [...poc.questions, { id: `c-${Math.random().toString(36).slice(2, 7)}`, question: q, why: "Added by you.", custom: true }] });
              setText("");
            }}
          >
            <Plus className="size-3.5" aria-hidden /> Add
          </Button>
        </div>
        {err ? <p role="alert" className="text-[12.5px] font-medium text-v-danger">{err}</p> : null}
      </div>

      <div>
        <p className="mb-2 text-[13.5px] font-semibold">The agent will ask, in this order</p>
        {poc.questions.length === 0 ? (
          <p className="text-[13px] text-v-muted">None chosen yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {poc.questions.map((q, i) => (
              <li key={q.id} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center font-mono text-[11px] text-v-muted">{i + 1}</span>
                <label className="sr-only" htmlFor={`pq-${q.id}`}>Question {i + 1}</label>
                <Input id={`pq-${q.id}`} value={q.question} maxLength={160} onChange={(e) => setPoc({ questions: poc.questions.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)) })} />
                <button type="button" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => { const n = [...poc.questions]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setPoc({ questions: n }); }} className="rounded-v-md border border-v-line px-2 py-2 text-[12px] disabled:opacity-40">Up</button>
                <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => setPoc({ questions: poc.questions.filter((_, j) => j !== i) })} className="flex size-9 shrink-0 items-center justify-center rounded-v-md border border-v-line text-v-muted hover:border-v-danger hover:text-v-danger">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        )}
        {showErrors && issues.length ? <p role="alert" className="mt-2 text-[12.5px] font-medium text-v-warn-ink">{issues[0].message}</p> : null}
      </div>
    </div>
  );
}

/* ---------------- Voice and script ---------------- */

export function VoiceStep({ poc, setPoc, showErrors }: StepProps) {
  const issues = validatePoc(poc).filter((i) => i.step === "voice");
  const blocks = generateScript(poc);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col gap-5">
        <Field id="poc-intro" label="Introduction message" help="The package lets you set a custom introduction. Use {{department}} to insert your name." error={showErrors ? errFor(issues, "intro")?.message : undefined}>
          <Textarea id="poc-intro" rows={3} value={poc.intro} maxLength={300} onChange={(e) => setPoc({ intro: e.target.value })} aria-invalid={showErrors && errFor(issues, "intro") ? true : undefined} />
        </Field>
        <Field id="poc-hold" label="Hold message" help="Played while the agent looks something up. The package supports hold messages.">
          <Input id="poc-hold" value={poc.holdMessage} maxLength={140} onChange={(e) => setPoc({ holdMessage: e.target.value })} />
        </Field>
        <Field id="poc-unsure" label="When the agent cannot tell for certain">
          <Textarea id="poc-unsure" rows={2} value={poc.notSure} maxLength={240} onChange={(e) => setPoc({ notSure: e.target.value })} />
        </Field>
        <Field id="poc-nomatch" label="When no scheme matches">
          <Textarea id="poc-nomatch" rows={2} value={poc.noMatch} maxLength={240} onChange={(e) => setPoc({ noMatch: e.target.value })} />
        </Field>
        <Field id="poc-close" label="Closing line" error={showErrors ? errFor(issues, "closing")?.message : undefined}>
          <Input id="poc-close" value={poc.closing} maxLength={140} onChange={(e) => setPoc({ closing: e.target.value })} aria-invalid={showErrors && errFor(issues, "closing") ? true : undefined} />
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-v-lg border border-v-line bg-white px-4 py-3">
          <span>
            <span className="block text-[14px] font-medium">Noise cancellation</span>
            <span className="block text-[12.5px] text-v-muted">The package supports noise cancellation configuration. This records that you want it set up.</span>
          </span>
          <Switch checked={poc.noiseCancellation} label="Noise cancellation" onChange={(v) => setPoc({ noiseCancellation: v })} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[15.5px] font-semibold">Your script, as it stands</h3>
          <Button variant="outline" size="sm" onClick={() => download("scheme-discovery-script.txt", scriptAsText(poc), "text/plain;charset=utf-8")}>
            <Download className="size-3.5" aria-hidden /> Download
          </Button>
        </div>
        <ol className="flex flex-col gap-2.5 rounded-v-xl border border-v-line bg-v-surface-sunk p-4">
          {blocks.map((b) => (
            <li key={b.id} className={b.who === "note" ? "rounded-v-md bg-v-track px-3 py-2 text-[12px] text-v-muted" : ""}>
              <span className="font-mono text-[9.5px] uppercase tracking-[.12em] text-v-muted">{b.title}</span>
              <p className="text-[13.5px] leading-relaxed">{b.text}</p>
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-v-muted">Square brackets are filled in from your scheme details during the call. The script is a draft for your department to review and approve.</p>
      </div>
    </div>
  );
}

/* ---------------- Knowledge files ---------------- */

export function KnowledgeStep({ poc }: { poc: PocData }) {
  const { files, problems } = generateKnowledgeFiles(poc);
  const [open, setOpen] = useState<string | null>(null);
  const max = PLATINUM.limits.maxKnowledgeFiles.value;
  const maxBytes = PLATINUM.limits.maxKnowledgeFileMB.value * 1024 * 1024;
  const fmt = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-v-lg border border-v-line bg-white px-4 py-3">
          <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Files</p>
          <p className="text-[20px] font-semibold tabular-nums">{files.length} <span className="text-[13px] font-normal text-v-muted">of {max} allowed</span></p>
        </div>
        <div className="rounded-v-lg border border-v-line bg-white px-4 py-3">
          <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Largest file</p>
          <p className="text-[20px] font-semibold tabular-nums">{fmt(Math.max(...files.map((f) => f.bytes)))} <span className="text-[13px] font-normal text-v-muted">of {PLATINUM.limits.maxKnowledgeFileMB.value} MB</span></p>
        </div>
        <div className="rounded-v-lg border border-v-line bg-white px-4 py-3">
          <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Type</p>
          <p className="text-[20px] font-semibold">Text</p>
        </div>
        <Button onClick={() => download("scheme-discovery-knowledge-files.zip", makeZip(files), "application/zip")}>
          <Download className="size-3.5" aria-hidden /> Download all as one zip
        </Button>
      </div>

      {problems.length ? (
        <Notice tone="danger" title="These files go over a package limit">
          <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Notice>
      ) : (
        <Notice tone="info" title="Inside the package limits">
          Up to {max} text files, up to {PLATINUM.limits.maxKnowledgeFileMB.value} MB each. We group schemes into files for you so the count stays inside the limit.
        </Notice>
      )}
      <Notice tone="warning" title="These are drafts built from what you typed">
        Only content your department has approved should reach citizens. Have each file reviewed before setup. The headings are in English; have the text reviewed in {poc.kbLanguage === "English" ? "your language" : poc.kbLanguage} if your scheme details are written in another language.
      </Notice>

      <ul className="flex flex-col gap-3">
        {files.map((f) => (
          <li key={f.name} className="rounded-v-xl border border-v-line bg-v-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-[13px] font-semibold">{f.name}</p>
                <p className="text-[12px] text-v-muted">{fmt(f.bytes)} · {Math.max(0.01, Math.round((f.bytes / maxBytes) * 10000) / 100)}% of the size limit</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(open === f.name ? null : f.name)} aria-expanded={open === f.name}>{open === f.name ? "Hide" : "Preview"}</Button>
                <Button variant="outline" size="sm" onClick={() => download(f.name, f.content, "text/plain;charset=utf-8")}>
                  <Download className="size-3.5" aria-hidden /> Download
                </Button>
              </div>
            </div>
            {open === f.name ? <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap border-t border-v-line bg-v-surface-sunk px-4 py-3 text-[12px] leading-relaxed">{f.content}</pre> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
