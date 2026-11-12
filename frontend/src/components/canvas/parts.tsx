"use client";

import { Check, ChevronDown, OctagonAlert, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/Field";
import { inr } from "@/lib/adopt/advisor/cost";
import { costFor, judgeCanvas, type Canvas, type CanvasCost, type CanvasVerdict, type ModuleState, type Status } from "@/lib/adopt/advisor/canvas";
import { makeZip } from "@/lib/adopt/advisor/zip";

export function derive(c: Canvas): { cost: CanvasCost; verdict: CanvasVerdict | null } {
  return { cost: costFor(c), verdict: judgeCanvas(c) };
}

export function download(name: string, content: string | Uint8Array, mime: string) {
  const part: BlobPart = typeof content === "string" ? content : (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([part], { type: typeof content === "string" ? `${mime};charset=utf-8` : mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadZip(name: string, files: { name: string; content: string }[]) {
  download(name, makeZip(files), "application/zip");
}

/** A number field that holds null when empty. */
export function NumField({
  id, label, value, onChange, hint, min = 0, max, step = 1, prefix, className = "",
}: {
  id: string; label: string; value: number | null; onChange: (v: number | null) => void; hint?: string; min?: number; max?: number; step?: number; prefix?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-semibold text-v-fg">{label}</label>
      <div className="relative">
        {prefix ? <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13.5px] text-v-muted" aria-hidden>{prefix}</span> : null}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          className={`tabular-nums ${prefix ? "pl-8" : ""}`}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(null);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
        />
      </div>
      {hint ? <p className="mt-1 text-[11.5px] leading-snug text-v-muted">{hint}</p> : null}
    </div>
  );
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  included: { label: "In the package", cls: "bg-v-ok-tint text-v-ok-ink" },
  priced: { label: "Priced in the document", cls: "bg-v-pale text-v-accent-deep" },
  yours: { label: "You supply", cls: "bg-v-surface-sunk text-v-body" },
  confirm: { label: "Confirm first", cls: "bg-v-warn-tint text-v-warn-ink" },
  outside: { label: "Not in the package", cls: "bg-v-danger-pale text-v-danger-deep" },
  quote: { label: "Needs a quote", cls: "bg-v-warn-tint text-v-warn-ink" },
};

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`inline-block whitespace-nowrap rounded-v-sm px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[.08em] ${s.cls}`}>{s.label}</span>;
}

export function StateIcon({ state }: { state: ModuleState }) {
  if (state === "blocked") return <OctagonAlert className="size-4 shrink-0 text-v-danger" aria-label="Outside the package" />;
  if (state === "warn") return <TriangleAlert className="size-4 shrink-0 text-v-warning-deep" aria-label="Needs attention" />;
  return <Check className="size-4 shrink-0 text-v-ok" aria-label="Fits" />;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">{children}</p>;
}

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** A closed-by-default section. Native details element, so it works with the keyboard and without scripts. */
export function Fold({ title, summary, defaultOpen, children }: { title: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-v-xl border border-v-line bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-snug">{title}</span>
          {summary ? <span className="mt-0.5 block text-[13px] leading-snug text-v-muted">{summary}</span> : null}
        </span>
        <ChevronDown className="size-4 shrink-0 text-v-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-v-line px-5 py-5">{children}</div>
    </details>
  );
}

export function BudgetMeter({ c, cost }: { c: Canvas; cost: CanvasCost }) {
  const f = cost.fit;
  const usage = f.plannedUsage ?? 0;
  const total = f.fixed + usage + f.yourFigures;
  const scale = Math.max(c.budget ?? 0, total, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-v-line" role="img" aria-label={c.budget === null ? "No budget entered" : `${inr(total)} of ${inr(c.budget)} budget`}>
      <div className="absolute inset-y-0 left-0 flex w-full">
        <div className="h-full bg-v-fg" style={{ width: pct(f.fixed) }} />
        <div className="h-full bg-v-accent" style={{ width: pct(usage) }} />
        <div className="h-full bg-v-warning" style={{ width: pct(f.yourFigures) }} />
      </div>
      {c.budget !== null ? <div className="absolute inset-y-0 w-0.5 bg-v-danger" style={{ left: pct(c.budget) }} aria-hidden /> : null}
    </div>
  );
}
