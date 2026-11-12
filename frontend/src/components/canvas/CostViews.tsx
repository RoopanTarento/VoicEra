"use client";

import { useState } from "react";
import type { Canvas, CanvasCost } from "@/lib/adopt/advisor/canvas";
import { MonthView, SplitView } from "./CostChart";
import { FlowDiagram } from "./FlowDiagram";

const VIEWS = [
  { id: "flow", label: "How it flows", hint: "Your service, and which charge pays for which part." },
  { id: "split", label: "Where it goes", hint: "The known cost, split into its parts." },
  { id: "month", label: "Month by month", hint: "The running total against your budget." },
] as const;

type View = (typeof VIEWS)[number]["id"];

/** One picture at a time: the orchestration, the split, or the months. */
export function CostViews({ c, cost }: { c: Canvas; cost: CanvasCost }) {
  const [view, setView] = useState<View>("flow");
  const current = VIEWS.find((v) => v.id === view)!;
  return (
    <section aria-label="Cost analysis" className="flex flex-col gap-4">
      <div role="tablist" aria-label="Cost views" className="flex gap-1 rounded-v-xl border border-v-line bg-white p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`flex-1 rounded-v-lg px-2 py-2 text-[13px] font-semibold transition-colors ${view === v.id ? "bg-v-fg text-white" : "text-v-body hover:bg-v-soft hover:text-v-fg"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="text-[13.5px] text-v-body">{current.hint}</p>
      <div role="tabpanel" aria-label={current.label}>
        {view === "flow" ? <FlowDiagram c={c} cost={cost} /> : null}
        {view === "split" ? <div className="rounded-v-xl border border-v-line bg-white p-5"><SplitView c={c} cost={cost} /></div> : null}
        {view === "month" ? <div className="rounded-v-xl border border-v-line bg-white p-5"><MonthView c={c} cost={cost} /></div> : null}
      </div>
    </section>
  );
}
