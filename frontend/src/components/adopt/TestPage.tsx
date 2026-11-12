"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice, Panel } from "@/components/adopt/ui";
import { ScenarioRunner } from "@/components/adopt/ScenarioRunner";
import { useWorkspace } from "@/lib/adopt/use-workspace";
import { validateConfig } from "@/lib/adopt/config-schema";
import type { RunState, SimContext } from "@/lib/adopt/simulate";
import type { ScenarioResult } from "@/lib/adopt/types";

function union(a: string[], b: string[]) {
  return Array.from(new Set([...a, ...b]));
}

function verdictBadge(r?: ScenarioResult) {
  if (!r || !r.ran) return <Badge tone="draft">Not run</Badge>;
  if (r.verdict === "passed") return <Badge tone="live">Passed</Badge>;
  if (r.verdict === "needs-work") return <Badge tone="danger">Needs work</Badge>;
  return <Badge tone="accent">Run, not reviewed</Badge>;
}

export function TestPage() {
  const { app, ws, actions } = useWorkspace();
  const [selected, setSelected] = useState<string | null>(null);
  const [runKeys, setRunKeys] = useState<Record<string, number>>({});

  const ctx: SimContext | null = useMemo(
    () => (app ? { app, config: ws.config, integrations: ws.integrations, packageId: ws.packageId } : null),
    [app, ws.config, ws.integrations, ws.packageId],
  );

  if (!app || !ctx) return null;
  const scenario = app.scenarios.find((s) => s.id === (selected ?? app.scenarios[0].id)) ?? app.scenarios[0];
  const result = ws.results[scenario.id];
  const v = validateConfig(app, ws.config);

  function record(run: RunState) {
    const prev = ws.results[scenario.id];
    const ran = (prev?.ran ?? false) || run.transcript.some((m) => m.who === "citizen");
    if (!ran) return;
    actions.setResult({
      scenarioId: scenario.id,
      ran: true,
      observed: union(prev?.observed ?? [], run.observed),
      gaps: union(prev?.gaps ?? [], run.gaps),
      verdict: prev?.verdict ?? "unreviewed",
      reviewedAt: prev?.reviewedAt,
    });
  }

  const seen = scenario.expects.filter((e) => result?.observed.includes(e));
  const notSeen = scenario.expects.length - seen.length;
  const canPass = !!result?.ran && notSeen === 0;

  function review(verdict: "passed" | "needs-work") {
    if (!result) return;
    actions.setResult({ ...result, verdict, reviewedAt: new Date().toISOString() });
  }

  function clearScenario() {
    actions.setResult({ scenarioId: scenario.id, ran: false, observed: [], gaps: [], verdict: "unreviewed" });
    setRunKeys((k) => ({ ...k, [scenario.id]: (k[scenario.id] ?? 0) + 1 }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Conversation testing</h2>
        <p className="max-w-[64ch] text-[14px] leading-relaxed text-v-body">
          Walk through each situation as a citizen would. The agent&apos;s lines come from your saved configuration, so a gap
          in your setup shows up here as a gap in the conversation.
        </p>
      </div>

      <Notice tone="demo" title="This is a simulation">
        It is a scripted walk-through built from your configuration. There is no speech, no language model, no
        telephony and no call to your systems. It helps you review wording and find gaps. It is not the platform&apos;s
        evaluation engine, and passing here does not prove an agent is ready for live calls.
      </Notice>

      {!v.complete ? (
        <Notice tone="warning" title="Your configuration is incomplete">
          Some required fields are empty, so parts of the conversation will show placeholders.{" "}
          <Link href="/adopt/workspace/configure" className="font-semibold underline">Finish the configuration</Link>
        </Notice>
      ) : null}

      <div className="flex flex-col gap-6">
        <nav aria-label="Test scenarios">
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Scenarios</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {app.scenarios.map((s) => {
              const r = ws.results[s.id];
              const active = s.id === scenario.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full flex-col items-start gap-1.5 rounded-v-lg border px-3.5 py-3 text-left transition-colors ${
                      active ? "border-v-accent bg-v-pale" : "border-v-line bg-white hover:border-v-line-strong"
                    }`}
                  >
                    <span className="text-[13.5px] font-semibold">{s.title}</span>
                    {verdictBadge(r)}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <h3 className="text-[17px] font-semibold tracking-tight">{scenario.title}</h3>
            <p className="text-[13.5px] text-v-body">{scenario.situation}</p>
          </div>

          <ScenarioRunner
            key={`${scenario.id}-${runKeys[scenario.id] ?? 0}`}
            ctx={ctx}
            scenario={scenario}
            mode="adopter"
            onRun={record}
          />

          <Panel className="flex flex-col gap-4 !p-4 md:!p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">Your review</p>
                <p className="text-[12.5px] text-v-muted">
                  Behaviours seen across all your runs of this scenario: {seen.length} of {scenario.expects.length}.
                </p>
              </div>
              {verdictBadge(result)}
            </div>
            {!canPass ? (
              <p className="text-[12.5px] leading-relaxed text-v-body">
                {!result?.ran
                  ? "Reply to the agent at least once to start a run."
                  : `${notSeen} ${notSeen === 1 ? "behaviour has" : "behaviours have"} not been seen yet. Try the other replies to cover them, then review.`}
              </p>
            ) : result && result.gaps.length > 0 ? (
              <p className="text-[12.5px] leading-relaxed text-v-body">
                {result.gaps.length} {result.gaps.length === 1 ? "gap was" : "gaps were"} noted during your runs. You can still mark the wording as passed. The gaps stay visible in Readiness.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => review("passed")} disabled={!canPass}>
                <Check className="size-4" aria-hidden /> Mark as passed
              </Button>
              <Button variant="outline" onClick={() => review("needs-work")} disabled={!result?.ran}>
                Needs work
              </Button>
              <Button variant="ghost" size="sm" onClick={clearScenario} disabled={!result?.ran}>
                Clear results for this scenario
              </Button>
            </div>
            {result?.reviewedAt ? (
              <p className="text-[12px] text-v-muted">Reviewed {new Date(result.reviewedAt).toLocaleString("en-GB")}</p>
            ) : null}
          </Panel>
        </div>
      </div>

      <div className="flex justify-end">
        <Link href="/adopt/workspace/readiness" className="text-[13px] font-semibold text-v-accent hover:underline">
          Go to readiness
        </Link>
      </div>
    </div>
  );
}
