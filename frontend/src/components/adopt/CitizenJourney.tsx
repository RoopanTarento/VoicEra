"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { BulletList, Notice, Panel, Spinner } from "@/components/adopt/ui";
import { PhoneFrame, ScenarioRunner } from "@/components/adopt/ScenarioRunner";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { useAdopt } from "@/lib/adopt/state";
import type { ApplicationId } from "@/lib/adopt/types";
import type { SimContext } from "@/lib/adopt/simulate";

export function CitizenJourney({ id }: { id: string }) {
  const app = APPLICATION_BY_ID[id as ApplicationId];
  if (!app) notFound();
  const { state, hydrated } = useAdopt();
  const [scenarioId, setScenarioId] = useState(app.scenarios[0].id);
  const [language, setLanguage] = useState<string | null>(null);
  const [large, setLarge] = useState(false);

  const ws = state.workspace;
  const usingWorkspace = hydrated && ws.started && ws.applicationId === app.id;

  let baseConfig: Record<string, unknown>;
  if (usingWorkspace) {
    baseConfig = ws.config;
  } else {
    baseConfig = JSON.parse(JSON.stringify(app.defaults));
    baseConfig.department = hydrated && state.answers.department ? state.answers.department : "the department";
  }

  const languages = (Array.isArray(baseConfig.languages) ? (baseConfig.languages as string[]) : ["English"]).filter(Boolean);
  const chosen = language && languages.includes(language) ? language : languages[0];
  const scenario = app.scenarios.find((s) => s.id === scenarioId) ?? app.scenarios[0];

  const ctx: SimContext = {
    app,
    config: { ...baseConfig, languages: [chosen] },
    integrations: usingWorkspace ? ws.integrations : {},
    packageId: usingWorkspace ? ws.packageId : app.recommendedPackage,
  };

  if (!hydrated) return <Spinner label="Opening the citizen view" />;

  return (
    <div className="grid gap-10 py-8 lg:grid-cols-[1fr_420px] lg:py-12">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Link href="/adopt/citizen" className="text-[12.5px] font-medium text-v-accent hover:underline">
            All citizen journeys
          </Link>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">{app.name}, from the citizen&apos;s side</h1>
          <p className="max-w-[60ch] text-[15px] font-light leading-relaxed text-v-body">
            This is what a person would meet on a call. Pick a situation, choose a reply or type your own, and see how
            the agent copes.
          </p>
        </div>

        <Notice tone="demo" title="A text demonstration, not a call">
          {usingWorkspace
            ? "It uses the configuration saved in your workspace."
            : "It uses sample content. Configure your own in the workspace and it will appear here."}{" "}
          No speech, language model or telephony is involved, and no one is called.
        </Notice>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-mono text-[10px] uppercase tracking-[.14em] text-v-muted">Situation</legend>
          <div className="flex flex-col gap-2">
            {app.scenarios.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-start gap-3 rounded-v-lg border border-v-line bg-white px-4 py-3 has-[:checked]:border-v-accent has-[:checked]:bg-v-pale has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40"
              >
                <input
                  type="radio"
                  name="scenario"
                  value={s.id}
                  checked={s.id === scenario.id}
                  onChange={() => setScenarioId(s.id)}
                  className="mt-1 accent-[var(--v-accent)]"
                />
                <span>
                  <span className="block text-[14px] font-semibold">{s.title}</span>
                  <span className="block text-[13px] text-v-body">{s.situation}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="citizen-lang" className="font-mono text-[10px] uppercase tracking-[.14em] text-v-muted">
              Language
            </label>
            <select
              id="citizen-lang"
              value={chosen}
              onChange={(e) => setLanguage(e.target.value)}
              className="min-w-[180px] rounded-v-lg border border-v-line-strong bg-white px-3.5 py-2.5 text-[13.5px] text-v-fg"
            >
              {languages.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span id="size-label" className="font-mono text-[10px] uppercase tracking-[.14em] text-v-muted">Text size</span>
            <div role="group" aria-labelledby="size-label" className="flex overflow-hidden rounded-v-lg border border-v-line-strong bg-white">
              <button
                type="button"
                aria-pressed={!large}
                onClick={() => setLarge(false)}
                className={`flex items-center gap-1 px-3 py-2.5 text-[13px] ${!large ? "bg-v-fg text-white" : "text-v-body"}`}
              >
                <Minus className="size-3.5" aria-hidden /> Normal
              </button>
              <button
                type="button"
                aria-pressed={large}
                onClick={() => setLarge(true)}
                className={`flex items-center gap-1 px-3 py-2.5 text-[13px] ${large ? "bg-v-fg text-white" : "text-v-body"}`}
              >
                <Plus className="size-3.5" aria-hidden /> Large
              </button>
            </div>
          </div>
        </div>
        <p className="-mt-3 text-[12px] text-v-muted">
          The demonstration is shown in English text. A real call would be spoken in {chosen}. Voice readiness for each
          language has to be confirmed with the implementation team.
        </p>

        <Panel className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">What to look for</h2>
          <BulletList
            items={[
              "The agent says who it is and what happens to the call before collecting anything",
              "A citizen can ask for a person or ask it to repeat at any time",
              "Unclear answers get a second try, then a person, not a dead end",
              "Danger is sent to 112, not handled here",
              "The agent never asks for bank details, identity numbers or codes",
            ]}
          />
        </Panel>
      </div>

      <div className="min-w-0">
        <PhoneFrame title={`Call to ${String(baseConfig.department || "the department")}`}>
          <ScenarioRunner key={`${scenario.id}-${chosen}`} ctx={ctx} scenario={scenario} mode="citizen" large={large} />
        </PhoneFrame>
      </div>
    </div>
  );
}
