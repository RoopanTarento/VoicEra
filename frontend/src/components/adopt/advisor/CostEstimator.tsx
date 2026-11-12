"use client";

import { Input } from "@/components/ui/Field";
import { Notice, Panel } from "@/components/adopt/ui";
import { calculateCost, inr, type CostInput, type ModelCategory } from "@/lib/adopt/advisor/cost";
import { useAdvisor } from "@/lib/adopt/advisor/store";

const CATS: { id: ModelCategory; label: string; hint: string }[] = [
  { id: "open", label: "Open-source models", hint: "Rs. 0.50 a minute, end to end including telephony" },
  { id: "proprietary", label: "Proprietary models", hint: "Depends on the model. The pricing table has not been supplied" },
  { id: "unknown", label: "Not decided yet", hint: "The model choices are not confirmed" },
];

export function CostEstimator({ costInput }: { costInput: CostInput }) {
  const { actions } = useAdvisor();
  const c = calculateCost(costInput);
  const minutesUnknown = costInput.minutes === null;

  const patch = (p: Parameters<typeof actions.setCost>[0]) =>
    actions.setCost({ numbers: costInput.numbers, minutes: costInput.minutes, minutesIsAssumption: !!costInput.minutesIsAssumption, category: costInput.category, ...p });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Panel className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cost-numbers" className="text-[13.5px] font-semibold">How many phone numbers will you request?</label>
          <Input
            id="cost-numbers"
            type="number"
            min={0}
            step={1}
            className="max-w-[200px]"
            value={costInput.numbers ?? ""}
            onChange={(e) => patch({ numbers: e.target.value === "" ? null : Number(e.target.value) })}
            aria-invalid={c.errors.numbers ? true : undefined}
            aria-describedby={c.errors.numbers ? "cost-numbers-err" : "cost-numbers-help"}
          />
          <p id="cost-numbers-help" className="text-[12px] text-v-muted">Rs. 500 for each number requested. Enter 0 if you will not request any.</p>
          {c.errors.numbers ? <p id="cost-numbers-err" role="alert" className="text-[12.5px] font-medium text-v-danger">{c.errors.numbers}</p> : null}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13.5px] font-semibold">Which kind of model will you use?</legend>
          {CATS.map((k) => (
            <label key={k.id} className={`flex cursor-pointer items-start gap-3 rounded-v-lg border px-3.5 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 ${costInput.category === k.id ? "border-v-accent bg-v-pale" : "border-v-line bg-white"}`}>
              <input type="radio" name="cost-cat" className="mt-1 accent-[var(--v-accent)]" checked={costInput.category === k.id} onChange={() => patch({ category: k.id })} />
              <span>
                <span className="block text-[13.5px] font-medium">{k.label}</span>
                <span className="block text-[12px] text-v-muted">{k.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cost-min" className="text-[13.5px] font-semibold">Expected billable minutes</label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="cost-min"
              type="number"
              min={0}
              step="any"
              className="max-w-[200px]"
              value={costInput.minutes ?? ""}
              onChange={(e) => patch({ minutes: e.target.value === "" ? null : Number(e.target.value) })}
              aria-invalid={c.errors.minutes ? true : undefined}
              aria-describedby={c.errors.minutes ? "cost-min-err" : "cost-min-help"}
            />
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-v-body">
              <input type="checkbox" className="size-4 accent-[var(--v-accent)]" checked={!!costInput.minutesIsAssumption} onChange={(e) => patch({ minutesIsAssumption: e.target.checked })} />
              This is a planning assumption
            </label>
          </div>
          <p id="cost-min-help" className="text-[12px] text-v-muted">
            Minutes across the period you are planning for. If you do not know yet, leave it empty and we will not guess.
          </p>
          {c.errors.minutes ? <p id="cost-min-err" role="alert" className="text-[12.5px] font-medium text-v-danger">{c.errors.minutes}</p> : null}
          {minutesUnknown ? (
            <button type="button" onClick={() => patch({ minutes: 1000, minutesIsAssumption: true })} className="w-fit text-[12.5px] font-semibold text-v-accent hover:underline">
              Use 1,000 minutes as a clearly labelled planning figure
            </button>
          ) : null}
        </div>
      </Panel>

      <Panel className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">One-time costs</p>
          <dl className="mt-2 flex flex-col divide-y divide-v-hairline">
            {c.lines.filter((l) => l.kind === "one-time").map((l) => (
              <div key={l.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13.5px]">
                  {l.label}
                  <span className="block text-[12px] text-v-muted">{l.basis}</span>
                </dt>
                <dd className="text-[15px] font-semibold tabular-nums">{inr(l.amount)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">Usage, based on minutes</p>
          <dl className="mt-2 flex flex-col divide-y divide-v-hairline">
            {c.lines.filter((l) => l.kind === "usage").map((l) => (
              <div key={l.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13.5px]">
                  {l.label}
                  <span className="block text-[12px] text-v-muted">{l.basis}</span>
                </dt>
                <dd className={`text-[15px] font-semibold tabular-nums ${l.status === "unresolved" ? "text-v-warn-ink" : ""}`}>{l.status === "unresolved" ? "Not yet known" : inr(l.amount)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-v-lg bg-v-surface-sunk px-4 py-3.5">
          <p className="text-[12px] text-v-muted">{c.totalLabel}</p>
          <p className="text-[26px] font-semibold tracking-tight tabular-nums" aria-live="polite">{inr(c.knownTotal)}</p>
          {!c.totalIsComplete ? <p className="mt-1 text-[12.5px] text-v-body">This is not the full cost, because part of it is not yet known.</p> : null}
        </div>
        {c.unresolvedNote ? <Notice tone="warning">{c.unresolvedNote}</Notice> : null}
        {c.ifOpenSourceUsage !== null ? (
          <p className="text-[12.5px] text-v-muted">
            For reference only: if open-source models were used, {costInput.minutes?.toLocaleString("en-IN")} minutes would be {inr(c.ifOpenSourceUsage)}. That is not an estimate for the model type you chose.
          </p>
        ) : null}
        <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-v-muted">
          {c.assumptions.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
