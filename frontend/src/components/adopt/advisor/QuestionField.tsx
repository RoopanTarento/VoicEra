"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { SourceChips } from "@/components/adopt/advisor/ui";
import { Notice } from "@/components/adopt/ui";
import { isDocumentedLanguage, DOCUMENTED_LANGUAGES, INTEGRATION_GAP_LINE, OTHER_LANGUAGES, PLATINUM } from "@/lib/adopt/advisor/source";
import { selectedNeeds } from "@/lib/adopt/advisor/derive";
import { getValue } from "@/lib/adopt/advisor/usecases";
import type { Answers, FileReadiness, Question, TableRow } from "@/lib/adopt/advisor/types";

interface Props {
  q: Question;
  answers: Answers;
  error?: string;
  onChange: (id: string, value: unknown) => void;
  onUnknown: (id: string, on: boolean) => void;
}

const FILE_TYPES = ["Text", "PDF", "Word", "Spreadsheet", "Web pages", "Other"];

/** A short, specific warning shown the moment an answer runs into a documented limit. */
function Hint({ q, a }: { q: Question; a: Answers }) {
  const v = getValue(a, q.id);
  if (q.id === "convDuration" && v === "long")
    return <Notice tone="warning">Conversations beyond 3 minutes are not recommended for this package. You can carry on to see the full picture.</Notice>;
  if (q.id === "convDuration" && v === "about")
    return <Notice tone="info">About 3 minutes is at the documented limit. Test calls will show whether it holds.</Notice>;
  if (q.id === "peakConcurrency" && v === "gt500")
    return <Notice tone="warning">More than 500 concurrent calls is above the documented limit. This would need technical validation.</Notice>;
  if (q.id === "campaignsPerMonth" && typeof v === "number" && v > PLATINUM.limits.maxCampaignOpsPerMonth.value)
    return <Notice tone="warning">Campaign setup and monitoring support is documented as up to {PLATINUM.limits.maxCampaignOpsPerMonth.value} a month.</Notice>;
  if (q.id === "languages") {
    const bad = (Array.isArray(v) ? (v as string[]) : []).filter((l) => !isDocumentedLanguage(l));
    if (bad.length) return <Notice tone="warning">{bad.join(", ")} {bad.length === 1 ? "is" : "are"} not in the documented list. That means unverified, and it will need checking before you rely on it.</Notice>;
  }
  if (q.id === "eligibilityMode" && (v === "live-check" || v === "application"))
    return <Notice tone="warning">{INTEGRATION_GAP_LINE}</Notice>;
  if (q.id === "needs") {
    const n = selectedNeeds(a);
    if (n.some((x) => ["existing-system", "database", "case-records", "api-webhook"].includes(x))) return <Notice tone="warning">{INTEGRATION_GAP_LINE}</Notice>;
    if (n.includes("whatsapp")) return <Notice tone="warning">WhatsApp calling is out of scope for this package.</Notice>;
    if (n.includes("multimodal") || n.includes("partial-stack")) return <Notice tone="warning">The package document says this is not recommended.</Notice>;
  }
  if (q.id === "kbFiles") {
    const f = (v ?? {}) as FileReadiness;
    const msgs: string[] = [];
    if (f.count != null && f.count > PLATINUM.limits.maxKnowledgeFiles.value) msgs.push(`${f.count} files is more than the ${PLATINUM.limits.maxKnowledgeFiles.value}-file limit.`);
    if (f.maxMB != null && f.maxMB > PLATINUM.limits.maxKnowledgeFileMB.value) msgs.push(`A ${f.maxMB} MB file is over the ${PLATINUM.limits.maxKnowledgeFileMB.value} MB limit.`);
    const non = (f.formats ?? []).filter((x) => x !== "Text");
    if (non.length) msgs.push(`${non.join(", ")} ${non.length === 1 ? "is" : "are"} not the documented text file type.`);
    if (msgs.length) return <Notice tone="warning">{msgs.join(" ")} This would need a review.</Notice>;
  }
  if (q.id === "fallback" && v === "live-transfer") return <Notice tone="warning">Passing a call to a person is not listed in the package, so it is unverified.</Notice>;
  if (q.id === "numberSource" && v === "own") return <Notice tone="info">Using your own provider and numbers is documented, as 2 to 4 weeks of work, case by case.</Notice>;
  return null;
}

export function QuestionField({ q, answers, error, onChange, onUnknown }: Props) {
  const value = answers.values[q.id];
  const unknown = !!answers.unknown[q.id];
  const id = `aq-${q.id}`;
  const described = [`${id}-why`, error ? `${id}-err` : ""].filter(Boolean).join(" ");
  const fromText = answers.origin[q.id] === "interpreted";

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={described} aria-invalid={error ? true : undefined}>
      <legend className="text-[15.5px] font-semibold leading-snug text-v-fg">
        {q.label}
        {q.required ? <span className="ml-1.5 text-[12px] font-normal text-v-muted">(needed)</span> : null}
      </legend>
      <p id={`${id}-why`} className="-mt-1 text-[13px] leading-relaxed text-v-muted">
        {q.why}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {q.source.refs.length ? <SourceChips ids={q.source.refs} /> : null}
        {fromText ? (
          <span className="rounded-v-sm bg-v-pale px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-[.1em] text-v-accent-deep">Pre-filled for you, please check</span>
        ) : null}
      </div>

      <div className={unknown ? "pointer-events-none opacity-40" : ""} aria-disabled={unknown}>
        <Control q={q} id={id} value={value} answers={answers} onChange={onChange} error={!!error} />
      </div>

      {q.allowUnknown ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-v-body">
          <input type="checkbox" checked={unknown} onChange={(e) => onUnknown(q.id, e.target.checked)} className="size-4 accent-[var(--v-accent)]" />
          Not sure yet
        </label>
      ) : null}
      {unknown && q.onUnknown ? <p className="text-[12.5px] text-v-body">{q.onUnknown}</p> : null}

      {error ? (
        <p id={`${id}-err`} role="alert" className="text-[13px] font-medium text-v-danger">
          {error}
        </p>
      ) : null}
      {!unknown ? <Hint q={q} a={answers} /> : null}
    </fieldset>
  );
}

function Choice({ checked, type, name, value, onChange, label, hint, compact }: { checked: boolean; type: "radio" | "checkbox"; name: string; value: string; onChange: () => void; label: string; hint?: string; compact?: boolean }) {
  return (
    <label
      className={`relative flex cursor-pointer items-start gap-3 rounded-v-lg border bg-white transition-colors hover:border-v-line-strong has-[:checked]:border-v-accent has-[:checked]:bg-v-pale has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 ${
        compact ? "px-3.5 py-2" : "px-4 py-3"
      } ${checked ? "border-v-accent" : "border-v-line"}`}
    >
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden
        className={`mt-[3px] flex size-4 shrink-0 items-center justify-center border border-v-line-strong bg-white peer-checked:border-v-accent peer-checked:bg-v-accent peer-checked:[&>span]:opacity-100 ${
          type === "checkbox" ? "rounded-[4px]" : "rounded-full"
        }`}
      >
        <span className="size-1.5 rounded-full bg-white opacity-0" />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-v-fg">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12.5px] leading-snug text-v-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function Control({ q, id, value, answers, onChange, error }: { q: Question; id: string; value: unknown; answers: Answers; onChange: (id: string, v: unknown) => void; error: boolean }) {
  const set = (v: unknown) => onChange(q.id, v);
  const invalid = error ? { "aria-invalid": true as const } : {};

  switch (q.kind) {
    case "single":
    case "assumption":
      return (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={q.label}>
          {q.options?.map((o) => (
            <Choice key={o.value} type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => set(o.value)} label={o.label} hint={o.hint} />
          ))}
        </div>
      );
    case "range":
      return (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.label}>
          {q.options?.map((o) => (
            <Choice key={o.value} compact type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => set(o.value)} label={o.label} />
          ))}
        </div>
      );
    case "yesno":
      return (
        <div className="flex gap-2" role="radiogroup" aria-label={q.label}>
          <Choice compact type="radio" name={id} value="yes" checked={value === true} onChange={() => set(true)} label="Yes" />
          <Choice compact type="radio" name={id} value="no" checked={value === false} onChange={() => set(false)} label="No" />
        </div>
      );
    case "multi": {
      const sel = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) => {
        const exclusive = ["standalone", "none"];
        if (exclusive.includes(v)) return set(sel.includes(v) ? [] : [v]);
        const base = sel.filter((x) => !exclusive.includes(x));
        set(base.includes(v) ? base.filter((x) => x !== v) : [...base, v]);
      };
      return (
        <div className="flex flex-col gap-2">
          {q.options?.map((o) => (
            <Choice key={o.value} type="checkbox" name={id} value={o.value} checked={sel.includes(o.value)} onChange={() => toggle(o.value)} label={o.label} hint={o.hint} />
          ))}
        </div>
      );
    }
    case "number":
      return (
        <div className="flex max-w-[320px] items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={q.min}
            max={q.max}
            step="any"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
            {...invalid}
          />
          {q.unit ? <span className="shrink-0 text-[13px] text-v-muted">{q.unit}</span> : null}
        </div>
      );
    case "shorttext":
      return <Input id={id} value={typeof value === "string" ? value : ""} maxLength={120} placeholder={q.placeholder} onChange={(e) => set(e.target.value)} {...invalid} />;
    case "longtext":
      return <Textarea id={id} rows={3} value={typeof value === "string" ? value : ""} maxLength={600} placeholder={q.placeholder} onChange={(e) => set(e.target.value)} {...invalid} />;
    case "language":
      return <LanguagePicker id={id} value={Array.isArray(value) ? (value as string[]) : []} onChange={set} />;
    case "table":
      return <TableInput q={q} id={id} rows={Array.isArray(value) ? (value as TableRow[]) : []} onChange={set} />;
    case "fileReadiness":
      return <FileInput id={id} value={(value ?? {}) as FileReadiness} onChange={set} />;
    default:
      void answers;
      return null;
  }
}

function LanguagePicker({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const toggle = (l: string) => onChange(value.includes(l) ? value.filter((x) => x !== l) : [...value, l]);
  const customSelected = value.filter((l) => !(DOCUMENTED_LANGUAGES as readonly string[]).includes(l) && !(OTHER_LANGUAGES as readonly string[]).includes(l));

  const chip = (l: string, documented: boolean) => {
    const on = value.includes(l);
    return (
      <label
        key={l}
        className={`flex cursor-pointer items-center gap-2 rounded-v-lg border px-3.5 py-2 text-[13.5px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 ${
          on ? (documented ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-warning bg-v-warn-tint text-v-warn-ink") : "border-v-line bg-white text-v-body hover:border-v-line-strong"
        }`}
      >
        <input type="checkbox" checked={on} onChange={() => toggle(l)} className="sr-only" />
        {l}
      </label>
    );
  };

  function add() {
    const name = custom.trim();
    if (name.length < 2) return setErr("Enter at least 2 letters.");
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) return setErr("That language is already chosen.");
    onChange([...value, name.replace(/\b\w/g, (c) => c.toUpperCase())]);
    setCustom("");
    setErr(null);
  }

  return (
    <div className="flex flex-col gap-4" id={id}>
      <div>
        <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">In the package document</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Documented languages">
          {DOCUMENTED_LANGUAGES.map((l) => chip(l, true))}
        </div>
      </div>
      <div>
        <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Not in the document, so unverified</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Languages that need verifying">
          {OTHER_LANGUAGES.map((l) => chip(l, false))}
          {customSelected.map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5 rounded-v-lg border border-v-warning bg-v-warn-tint px-3 py-2 text-[13.5px] text-v-warn-ink">
              {l}
              <button type="button" aria-label={`Remove ${l}`} onClick={() => toggle(l)} className="rounded-full p-0.5 hover:bg-white/60">
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-custom`} className="text-[12.5px] font-medium text-v-body">Another language</label>
        <div className="flex max-w-[380px] gap-2">
          <Input
            id={`${id}-custom`}
            value={custom}
            maxLength={40}
            placeholder="Type a language name"
            onChange={(e) => {
              setCustom(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            aria-invalid={err ? true : undefined}
          />
          <Button variant="outline" onClick={add}>
            <Plus className="size-3.5" aria-hidden /> Add
          </Button>
        </div>
        {err ? <p role="alert" className="text-[12.5px] font-medium text-v-danger">{err}</p> : null}
      </div>
    </div>
  );
}

function TableInput({ q, id, rows, onChange }: { q: Question; id: string; rows: TableRow[]; onChange: (v: TableRow[]) => void }) {
  const cols = q.columns ?? [];
  const data = rows.length ? rows : [Object.fromEntries(cols.map((c) => [c.key, ""]))];
  const update = (i: number, key: string, v: string) => onChange(data.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <div className="flex flex-col gap-3" id={id}>
      {data.map((r, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2 rounded-v-lg border border-v-line bg-v-surface-sunk p-3">
          {cols.map((c) => (
            <div key={c.key} className="flex min-w-[170px] flex-1 flex-col gap-1">
              <label htmlFor={`${id}-${i}-${c.key}`} className="text-[11.5px] font-medium text-v-muted">{c.label}</label>
              <Input id={`${id}-${i}-${c.key}`} value={r[c.key] ?? ""} placeholder={c.placeholder} maxLength={120} onChange={(e) => update(i, c.key, e.target.value)} />
            </div>
          ))}
          <button
            type="button"
            aria-label={`Remove row ${i + 1}`}
            onClick={() => onChange(data.filter((_, j) => j !== i))}
            className="mt-[22px] flex size-10 shrink-0 items-center justify-center rounded-v-md border border-v-line text-v-muted hover:border-v-danger hover:text-v-danger"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" onClick={() => onChange([...data, Object.fromEntries(cols.map((c) => [c.key, ""]))])}>
          <Plus className="size-3.5" aria-hidden /> Add a row
        </Button>
      </div>
    </div>
  );
}

function FileInput({ id, value, onChange }: { id: string; value: FileReadiness; onChange: (v: FileReadiness) => void }) {
  const formats = value.formats ?? [];
  const L = PLATINUM.limits;
  return (
    <div className="flex flex-col gap-4" id={id}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-count`} className="text-[12.5px] font-medium text-v-body">How many files? (up to {L.maxKnowledgeFiles.value} are supported)</label>
          <Input id={`${id}-count`} type="number" min={0} step={1} value={value.count ?? ""} onChange={(e) => onChange({ ...value, count: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-mb`} className="text-[12.5px] font-medium text-v-body">Size of the largest file, in MB (up to {L.maxKnowledgeFileMB.value} is supported)</label>
          <Input id={`${id}-mb`} type="number" min={0} step="any" value={value.maxMB ?? ""} onChange={(e) => onChange({ ...value, maxMB: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
      </div>
      <div role="group" aria-label="File types" className="flex flex-col gap-1.5">
        <p className="text-[12.5px] font-medium text-v-body">What kind of files? (the package takes text files)</p>
        <div className="flex flex-wrap gap-2">
          {FILE_TYPES.map((t) => {
            const on = formats.includes(t);
            return (
              <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-v-lg border px-3.5 py-2 text-[13.5px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 ${on ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body"}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange({ ...value, formats: on ? formats.filter((x) => x !== t) : [...formats, t] })} />
                {t}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
