"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";

export function Tag({ tone = "plain", children }: { tone?: "plain" | "ok" | "info" | "warn" | "bad"; children: React.ReactNode }) {
  return <span className={`vb-tag ${tone === "plain" ? "" : tone}`}>{children}</span>;
}

/** A closed-by-default section built on the native details element. */
export function Fold({ title, summary, defaultOpen, children, tone }: { title: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode; tone?: "sheet" }) {
  return (
    <details open={defaultOpen} className={`group ${tone === "sheet" ? "rounded-2xl border border-[var(--vb-paper-line)]" : "vb-card"}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-snug">{title}</span>
          {summary ? <span className="vb-muted mt-0.5 block text-[13px] leading-snug">{summary}</span> : null}
        </span>
        <ChevronDown className="vb-muted size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className={`border-t px-5 py-5 ${tone === "sheet" ? "border-[var(--vb-paper-line)]" : "vb-hair"}`}>{children}</div>
    </details>
  );
}

export function NumInput({ label, value, onChange, prefix, suffix, step = 1, min = 0, hint, width }: { label: string; value: number | null; onChange: (v: number | null) => void; prefix?: string; suffix?: string; step?: number; min?: number; hint?: string; width?: string }) {
  const id = useId();
  return (
    <div style={width ? { width } : undefined}>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-semibold">{label}</label>
      <div className="relative">
        {prefix ? <span className="vb-muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px]" aria-hidden>{prefix}</span> : null}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value ?? ""}
          className={`vb-input tabular-nums ${prefix ? "!pl-9" : ""} ${suffix ? "!pr-14" : ""}`}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(null);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
        />
        {suffix ? <span className="vb-muted pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12.5px]" aria-hidden>{suffix}</span> : null}
      </div>
      {hint ? <p className="vb-muted mt-1.5 text-[12px] leading-snug">{hint}</p> : null}
    </div>
  );
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

export const TIER_TAG: Record<string, { label: string; tone: "plain" | "ok" | "info" | "warn" | "bad" }> = {
  auto: { label: "Recommended", tone: "info" },
  open: { label: "Open-source", tone: "ok" },
  proprietary: { label: "Commercial", tone: "warn" },
  confirm: { label: "To be confirmed", tone: "warn" },
  own: { label: "Your own", tone: "plain" },
  included: { label: "Included", tone: "ok" },
  quote: { label: "Quoted", tone: "warn" },
};
