"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { LANGUAGES } from "@/lib/adopt/applications";
import type { FieldErrors } from "@/lib/adopt/config-schema";
import type { ConfigField, ConfigSection } from "@/lib/adopt/types";

type Row = Record<string, unknown>;

interface Props {
  sections: ConfigSection[];
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors: FieldErrors;
  /** Fields (or `key.row.col`) whose errors may be shown. `"*"` shows all. */
  visibleErrors: Set<string> | "all";
  onTouch: (key: string) => void;
  warnings?: { key: string; message: string }[];
}

function showErr(vis: Props["visibleErrors"], key: string): boolean {
  if (vis === "all") return true;
  const base = key.split(".")[0];
  return vis.has(key) || vis.has(base);
}

export function FormRenderer({ sections, config, onChange, errors, visibleErrors, onTouch, warnings = [] }: Props) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  return (
    <div className="flex flex-col gap-10">
      {sections.map((s) => (
        <section key={s.id} id={`sec-${s.id}`} aria-labelledby={`h-${s.id}`} className="scroll-mt-28">
          <div className="mb-5 flex flex-col gap-1 border-b border-v-line pb-4">
            <h2 id={`h-${s.id}`} className="text-lg font-semibold tracking-tight">{s.title}</h2>
            <p className="text-[13.5px] leading-relaxed text-v-body">{s.description}</p>
          </div>
          <div className="flex flex-col gap-6">
            {s.fields.map((f) => (
              <FieldView
                key={f.key}
                f={f}
                value={config[f.key]}
                error={errors[f.key] && showErr(visibleErrors, f.key) ? errors[f.key] : undefined}
                rowErrors={showErr(visibleErrors, f.key) ? errors : {}}
                warning={warnings.find((w) => w.key === f.key)?.message}
                onChange={(v) => set(f.key, v)}
                onTouch={() => onTouch(f.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FieldShell({
  f,
  error,
  warning,
  children,
  inline = false,
}: {
  f: ConfigField;
  error?: string;
  warning?: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  const id = `f-${f.key}`;
  return (
    <div className={inline ? "flex items-start justify-between gap-6" : "flex flex-col gap-2"}>
      <div className={inline ? "min-w-0" : ""}>
        <label htmlFor={id} className="text-[13.5px] font-semibold text-v-fg">
          {f.label}
          {f.required || (f.minRows ?? 0) > 0 ? <span className="ml-1 font-normal text-v-muted">(required)</span> : null}
        </label>
        {f.help ? (
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-snug text-v-muted">
            {f.help}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-err`} role="alert" className="mt-1 text-[12.5px] font-medium text-v-danger">
            {error}
          </p>
        ) : null}
        {!error && warning ? <p className="mt-1 text-[12.5px] text-v-warn-ink">{warning}</p> : null}
      </div>
      {children}
    </div>
  );
}

function FieldView({
  f,
  value,
  error,
  rowErrors,
  warning,
  onChange,
  onTouch,
}: {
  f: ConfigField;
  value: unknown;
  error?: string;
  rowErrors: FieldErrors;
  warning?: string;
  onChange: (v: unknown) => void;
  onTouch: () => void;
}) {
  const id = `f-${f.key}`;
  const describedBy = [f.help ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    onBlur: onTouch,
  } as const;
  const errCls = error ? "!border-v-danger" : "";

  switch (f.kind) {
    case "text":
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <Input {...common} className={errCls} value={String(value ?? "")} placeholder={f.placeholder} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
    case "textarea":
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <Textarea {...common} rows={3} className={errCls} value={String(value ?? "")} placeholder={f.placeholder} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />
          {f.maxLength ? (
            <p className="-mt-1 text-right text-[11px] text-v-dim">{String(value ?? "").length} / {f.maxLength}</p>
          ) : null}
        </FieldShell>
      );
    case "number":
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <Input {...common} type="number" inputMode="numeric" className={`max-w-[200px] ${errCls}`} min={f.min} max={f.max} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
        </FieldShell>
      );
    case "time":
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <Input {...common} type="time" className={`max-w-[200px] ${errCls}`} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
    case "date":
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <Input {...common} type="date" className={`max-w-[220px] ${errCls}`} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
    case "select":
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <div className="max-w-[460px]">
            <Select id={id} value={String(value ?? "")} onChange={(e) => { onChange(e.target.value); onTouch(); }} aria-describedby={describedBy}>
              <option value="">Choose one</option>
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.note ? `${o.label} (${o.note})` : o.label}
                </option>
              ))}
            </Select>
          </div>
        </FieldShell>
      );
    case "toggle":
      return (
        <FieldShell f={f} inline>
          <Switch checked={Boolean(value)} label={f.label} onChange={(v) => { onChange(v); onTouch(); }} />
        </FieldShell>
      );
    case "languages":
    case "tags": {
      const sel = Array.isArray(value) ? (value as string[]) : [];
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <div role="group" aria-label={f.label} className="flex flex-wrap gap-2" id={id}>
            {LANGUAGES.map((l) => {
              const on = sel.includes(l);
              return (
                <label
                  key={l}
                  className={`flex cursor-pointer items-center gap-2 rounded-v-lg border px-3.5 py-2 text-[13.5px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 ${
                    on ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body hover:border-v-line-strong"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      onChange(on ? sel.filter((x) => x !== l) : [...sel, l]);
                      onTouch();
                    }}
                    className="sr-only"
                  />
                  {l}
                </label>
              );
            })}
          </div>
        </FieldShell>
      );
    }
    case "rows": {
      const rows = Array.isArray(value) ? (value as Row[]) : [];
      const cols = f.columns ?? [];
      const blank = () => Object.fromEntries(cols.map((c) => [c.key, c.kind === "select" ? (c.options?.[0] ?? "") : ""]));
      return (
        <FieldShell f={f} error={error} warning={warning}>
          <div className="flex flex-col gap-3" id={id} role="group" aria-label={f.label}>
            {rows.map((r, i) => (
              <fieldset key={i} className="rounded-v-lg border border-v-line bg-v-surface-sunk p-3">
                <legend className="px-1 font-mono text-[9.5px] uppercase tracking-[.12em] text-v-muted">Row {i + 1}</legend>
                <div className="flex flex-wrap items-start gap-3">
                  {cols.map((c) => {
                    const ek = `${f.key}.${i}.${c.key}`;
                    const cellErr = rowErrors[ek];
                    const cid = `${id}-${i}-${c.key}`;
                    return (
                      <div key={c.key} className="flex min-w-[150px] flex-1 flex-col gap-1" style={c.width ? { flex: `0 0 ${c.width}`, minWidth: c.width } : undefined}>
                        <label htmlFor={cid} className="text-[11.5px] font-medium text-v-muted">{c.label}</label>
                        {c.kind === "select" ? (
                          <Select id={cid} size="md" value={String(r[c.key] ?? "")} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)))}>
                            {(c.options ?? []).map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </Select>
                        ) : (
                          <Input
                            id={cid}
                            type={c.kind === "number" ? "number" : "text"}
                            inputMode={c.kind === "number" ? "numeric" : undefined}
                            className={cellErr ? "!border-v-danger" : ""}
                            aria-invalid={cellErr ? true : undefined}
                            aria-describedby={cellErr ? `${cid}-err` : undefined}
                            placeholder={c.placeholder}
                            value={String(r[c.key] ?? "")}
                            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: c.kind === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value } : x)))}
                            onBlur={onTouch}
                          />
                        )}
                        {cellErr ? <p id={`${cid}-err`} role="alert" className="text-[11.5px] font-medium text-v-danger">{cellErr}</p> : null}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    aria-label={`Remove row ${i + 1} from ${f.label}`}
                    className="mt-[22px] flex size-10 shrink-0 items-center justify-center rounded-v-md border border-v-line text-v-muted hover:border-v-danger hover:text-v-danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </fieldset>
            ))}
            <div>
              <Button variant="outline" size="sm" onClick={() => { onChange([...rows, blank()]); onTouch(); }}>
                <Plus className="size-3.5" aria-hidden /> Add a row
              </Button>
            </div>
          </div>
        </FieldShell>
      );
    }
  }
}
