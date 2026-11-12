"use client";

import { useState } from "react";
import { AppCard } from "@/components/adopt/content";
import { Notice } from "@/components/adopt/ui";
import { APPLICATIONS } from "@/lib/adopt/applications";
import { SEGMENTS } from "@/lib/adopt/icp";
import { useAdopt } from "@/lib/adopt/state";

export function Catalogue() {
  const { state, hydrated } = useAdopt();
  const [filter, setFilter] = useState<string>("all");
  const mine = hydrated ? state.answers.segmentId : undefined;
  const seg = SEGMENTS.find((s) => s.id === filter);
  const apps = seg ? APPLICATIONS.filter((a) => seg.applications.includes(a.id)) : APPLICATIONS;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="seg-filter" className="font-mono text-[10px] uppercase tracking-[.14em] text-v-muted">
          Show applications for
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="seg-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="min-w-[260px] rounded-v-lg border border-v-line-strong bg-white px-3.5 py-2.5 text-[13.5px] text-v-fg focus:border-v-accent"
          >
            <option value="all">All segments</option>
            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {mine && filter !== mine ? (
            <button
              type="button"
              onClick={() => setFilter(mine)}
              className="rounded-v-md border border-v-line px-3 py-2 text-[12.5px] font-medium text-v-accent hover:bg-v-pale"
            >
              Use my segment: {SEGMENTS.find((s) => s.id === mine)?.name}
            </button>
          ) : null}
          {filter !== "all" ? (
            <button type="button" onClick={() => setFilter("all")} className="text-[12.5px] text-v-muted underline-offset-2 hover:underline">
              Clear filter
            </button>
          ) : null}
        </div>
      </div>
      {seg && seg.fitSource !== "icp" ? (
        <Notice tone="info" title="These matches are our suggestion">
          {seg.fitNote}
        </Notice>
      ) : null}
      <p className="text-[12.5px] text-v-muted" aria-live="polite">
        Showing {apps.length} of {APPLICATIONS.length} applications.
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {apps.map((a) => (
          <AppCard key={a.id} app={a} />
        ))}
      </div>
    </div>
  );
}
