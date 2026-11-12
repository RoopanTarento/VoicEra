"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  HandHeart,
  HardHat,
  HeartPulse,
  House,
  Landmark,
  Layers,
  MapPin,
  Search,
  ShieldCheck,
  Sprout,
  Store,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import type { Scheme } from "@/lib/api/use-cases";

// Departments are the schemes' own categories; these give each a face.
const DEPARTMENT_ICON: Record<string, LucideIcon> = {
  Farmers: Sprout,
  Health: HeartPulse,
  Housing: House,
  Women: HandHeart,
  Workers: HardHat,
  Pension: Landmark,
  Insurance: ShieldCheck,
  Livelihood: Store,
  "State or city": MapPin,
};

function departmentOf(s: Scheme): string {
  return s.category || "Other";
}

/** Pick schemes the way people think about them: first a department
 * (Health, Pension, Farmers…), then that department's schemes. Search
 * looks across every department. */
export function DepartmentSchemePicker({
  schemes,
  selectedIds,
  max,
  onChange,
  onRemoveCustom,
}: {
  schemes: Scheme[];
  selectedIds: string[];
  /** 1 = pick one; n = up to n; null = any number. */
  max: number | null;
  onChange: (ids: string[]) => void;
  /** Only passed when the user may delete their organisation's own schemes. */
  onRemoveCustom?: (scheme: Scheme) => void;
}) {
  const [department, setDepartment] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const departments = useMemo(() => {
    const map = new Map<string, Scheme[]>();
    for (const s of schemes) map.set(departmentOf(s), [...(map.get(departmentOf(s)) ?? []), s]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [schemes]);

  const single = max === 1;
  const full = max !== null && !single && selectedIds.length >= max;
  const selected = selectedIds.map((id) => schemes.find((s) => s.id === id)).filter((s): s is Scheme => Boolean(s));

  function toggle(id: string) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else if (single) onChange([id]);
    else if (!full) onChange([...selectedIds, id]);
  }

  const q = query.trim().toLowerCase();
  const searchHits = q
    ? schemes.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          departmentOf(s).toLowerCase().includes(q),
      )
    : null;
  const shown = searchHits ?? (department ? (departments.find(([d]) => d === department)?.[1] ?? []) : null);

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-v-muted">Picked:</span>
          {selected.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              aria-label={`Remove ${s.name}`}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-v-accent/40 bg-v-pale px-2.5 py-1 text-xs font-medium text-v-fg transition-colors hover:border-v-accent"
            >
              {s.name}
              <X className="size-3 text-v-muted" strokeWidth={2} />
            </button>
          ))}
          {full ? <span className="text-xs text-v-muted">· that&apos;s the most this agent covers</span> : null}
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-v-muted" strokeWidth={1.75} />
        <input
          type="search"
          placeholder="Search all schemes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-v-sm border border-v-line-strong bg-white py-2 pl-8 pr-3 text-[13px] text-v-fg transition-colors focus:border-v-accent focus:outline-none"
        />
      </div>

      {shown === null ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {departments.map(([name, items]) => {
            const Icon = DEPARTMENT_ICON[name] ?? Layers;
            const picked = items.filter((s) => selectedIds.includes(s.id)).length;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setDepartment(name)}
                className="group relative flex cursor-pointer flex-col gap-2.5 rounded-v-md border border-v-line bg-white p-3.5 text-left transition-colors hover:border-v-accent"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-full bg-v-pale text-v-accent transition-transform group-hover:scale-105">
                    <Icon className="size-[18px]" strokeWidth={1.8} />
                  </span>
                  {picked ? <Badge tone="accent">{picked} picked</Badge> : null}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-semibold tracking-tight">{name}</span>
                  <span className="text-[11.5px] font-light leading-snug text-v-muted">
                    {items
                      .slice(0, 2)
                      .map((s) => s.name)
                      .join(", ")}
                    {items.length > 2 ? ` +${items.length - 2}` : ""}
                  </span>
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[.1em] text-v-accent">
                  {items.length} {items.length === 1 ? "scheme" : "schemes"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {!searchHits && department ? (
            <button
              type="button"
              onClick={() => setDepartment(null)}
              className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium text-v-muted transition-colors hover:text-v-accent"
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.8} />
              All departments
              <span className="text-v-fg">· {department}</span>
            </button>
          ) : (
            <span className="text-xs text-v-muted">
              {shown.length} {shown.length === 1 ? "scheme matches" : "schemes match"} &ldquo;{query.trim()}&rdquo;
            </span>
          )}
          {shown.length === 0 ? (
            <p className="text-[13px] font-light text-v-muted">No schemes match. Try another word or browse a department.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {shown.map((s) => {
                const checked = selectedIds.includes(s.id);
                const blocked = full && !checked;
                return (
                  <div
                    key={s.id}
                    role="checkbox"
                    aria-checked={checked}
                    aria-disabled={blocked}
                    tabIndex={0}
                    onClick={() => !blocked && toggle(s.id)}
                    onKeyDown={(e) => {
                      if ((e.key === " " || e.key === "Enter") && !blocked) {
                        e.preventDefault();
                        toggle(s.id);
                      }
                    }}
                    className={`relative flex flex-col gap-2 rounded-v-md border bg-white p-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-v-accent/40 ${
                      checked ? "border-v-accent ring-1 ring-v-accent/30" : "border-v-line"
                    } ${blocked ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:border-v-accent"}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13.5px] font-semibold leading-snug">{s.name}</span>
                        {searchHits ? <span className="text-[11px] text-v-muted">{departmentOf(s)}</span> : null}
                      </span>
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center border ${single ? "rounded-full" : "rounded-[5px]"} ${
                          checked ? "border-v-accent bg-v-accent text-white" : "border-v-line-strong bg-white"
                        }`}
                      >
                        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                      </span>
                    </span>
                    {s.summary ? <span className="text-[12.5px] leading-relaxed text-v-body">{s.summary}</span> : null}
                    <span className="mt-auto flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] text-v-muted">
                        <BookOpen className="size-3 text-v-accent" strokeWidth={1.9} />
                        Knowledge built in
                      </span>
                      {s.custom ? <Badge tone="accent">Your scheme</Badge> : null}
                    </span>
                    {s.custom && onRemoveCustom ? (
                      <IconButton
                        type="button"
                        aria-label={`Remove ${s.name}`}
                        className="absolute bottom-2 right-2 size-[28px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCustom(s);
                        }}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </IconButton>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
