"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Notice, Panel, Spinner } from "@/components/adopt/ui";
import { interpret, type Interpretation } from "@/lib/adopt/advisor/interpret";
import { DOCUMENTED_LANGUAGES, OTHER_LANGUAGES } from "@/lib/adopt/advisor/source";
import { useAdvisor } from "@/lib/adopt/advisor/store";
import { HIERARCHY, OBJECTIVES, OBJECTIVE_BY_ID, SEGMENTS, USE_CASES, objectivesForSegment } from "@/lib/adopt/advisor/usecases";
import type { Objective } from "@/lib/adopt/advisor/types";

const EXAMPLES = [
  "We want to call citizens after they visit a government office and collect feedback about their experience in Tamil and English.",
  "Farmers should be able to call and ask which schemes they qualify for, in Hindi and Marathi.",
  "We want to call beneficiaries of a pension scheme to remind them to renew, and answer their questions.",
];

type Mode = "describe" | "cards" | "sector";

function fitBadge(o: Objective) {
  if (o.needsTopic) return <Badge tone="warn">Depends on the topic</Badge>;
  return USE_CASES[o.useCase].documented ? <Badge tone="live">Documented use case</Badge> : <Badge tone="warn">Not documented, needs review</Badge>;
}

export function AdvisorStart() {
  const router = useRouter();
  const { state, hydrated, actions } = useAdvisor();
  const [mode, setMode] = useState<Mode>("describe");
  const [text, setText] = useState("");
  const [textErr, setTextErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Interpretation | null>(null);
  const [sector, setSector] = useState<string | null>(null);

  if (!hydrated) return <Spinner label="Opening the advisor" />;

  const hasSaved = !!state.answers.values.objective;
  const go = () => router.push("/adopt/advisor/questions");

  function read() {
    const t = text.trim();
    if (t.length < 15) {
      setTextErr("Say a little more, in a sentence or two, so there is something to read.");
      return;
    }
    setTextErr(null);
    actions.setStart("describe");
    actions.setFreeText(t);
    setDraft(interpret(t));
  }

  function confirm() {
    if (!draft) return;
    actions.setStart("describe");
    actions.acceptInterpretation(draft);
    go();
  }

  const tabs: { id: Mode; label: string }[] = [
    { id: "describe", label: "Describe it" },
    { id: "cards", label: "Pick a use case" },
    { id: "sector", label: "Explore by sector" },
  ];

  return (
    <div className="flex flex-col gap-8 pb-10">
      {hasSaved ? (
        <Notice tone="info" title="You have an advisor session saved on this device">
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>It will continue where you stopped.</span>
            <Link href="/adopt/advisor/questions" className="font-semibold underline">Continue the questions</Link>
            <Link href="/adopt/advisor/result" className="font-semibold underline">See the recommendation</Link>
            <button type="button" className="text-v-muted underline" onClick={() => actions.resetAdvisor()}>Start again</button>
          </span>
        </Notice>
      ) : null}

      <Link
        href="/adopt/advisor/poc"
        className="group flex flex-col gap-3 rounded-v-xl border border-v-accent bg-v-pale p-5 transition-colors hover:bg-white md:flex-row md:items-center md:justify-between md:p-6"
      >
        <span>
          <span className="font-mono text-[10px] uppercase tracking-[.16em] text-v-accent-deep">Going for scheme discovery?</span>
          <span className="mt-1 block text-[18px] font-semibold tracking-tight">Build a working proof of concept, with a guide at every step</span>
          <span className="mt-1 block max-w-[60ch] text-[13.5px] leading-relaxed text-v-body">
            Enter your schemes once. You get a conversation script, ready-to-use knowledge files inside the package limits, a conversation you can try, and a launch checklist.
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-v-accent">
          Start the walkthrough <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>

      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-v-muted" aria-label="How the advisor works">
        {HIERARCHY.map((h, i) => (
          <li key={h.id} className="flex items-center gap-1.5">
            <span className={i === 2 ? "font-semibold text-v-fg" : ""}>{h.label}</span>
            {i < HIERARCHY.length - 1 ? <span aria-hidden className="text-v-disabled">/</span> : null}
          </li>
        ))}
      </ol>

      <div>
        <div role="tablist" aria-label="Ways to start" className="mb-5 flex flex-wrap gap-1 border-b border-v-line">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={mode === t.id}
              aria-controls={`panel-${t.id}`}
              type="button"
              onClick={() => setMode(t.id)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-[13.5px] font-semibold transition-colors ${
                mode === t.id ? "border-v-accent text-v-accent-deep" : "border-transparent text-v-body hover:text-v-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "describe" ? (
          <div role="tabpanel" id="panel-describe" aria-labelledby="tab-describe" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="free-text" className="text-[14px] font-semibold">Describe what you want in plain English</label>
              <Textarea
                id="free-text"
                rows={4}
                value={text}
                maxLength={800}
                placeholder="For example: We want to call citizens after they visit a government office and collect feedback about their experience in Tamil and English."
                onChange={(e) => {
                  setText(e.target.value);
                  setTextErr(null);
                }}
                aria-invalid={textErr ? true : undefined}
                aria-describedby={textErr ? "free-err" : "free-help"}
              />
              <p id="free-help" className="text-[12.5px] text-v-muted">
                We read it with fixed rules, and no AI service is connected. You will see what we understood and can correct it before anything is used.
              </p>
              {textErr ? <p id="free-err" role="alert" className="text-[13px] font-medium text-v-danger">{textErr}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-v-muted">Try an example:</span>
              {EXAMPLES.map((e, i) => (
                <button key={i} type="button" onClick={() => { setText(e); setTextErr(null); }} className="rounded-v-md border border-v-line bg-white px-3 py-1.5 text-left text-[12px] text-v-body hover:border-v-accent">
                  {e.slice(0, 48)}…
                </button>
              ))}
            </div>
            <div>
              <Button onClick={read}>
                <Search className="size-3.5" aria-hidden /> Read my description
              </Button>
            </div>

            {draft ? <InterpretationCard draft={draft} onChange={setDraft} onConfirm={confirm} /> : null}
          </div>
        ) : null}

        {mode === "cards" ? (
          <div role="tabpanel" id="panel-cards" aria-labelledby="tab-cards" className="flex flex-col gap-4">
            <p className="max-w-[64ch] text-[14px] text-v-body">Choose the one closest to what you want. You can change it later.</p>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {OBJECTIVES.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      actions.setStart("cards");
                      actions.chooseObjective(o.id);
                      go();
                    }}
                    className="flex h-full w-full flex-col gap-2 rounded-v-xl border border-v-line bg-v-panel p-5 text-left shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent"
                  >
                    <span className="text-[15.5px] font-semibold leading-snug">{o.label}</span>
                    <span className="text-[13px] leading-relaxed text-v-body">{o.plain}</span>
                    <span className="text-[12px] text-v-muted">For example: {o.example}</span>
                    <span className="mt-auto pt-2">{fitBadge(o)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {mode === "sector" ? (
          <div role="tabpanel" id="panel-sector" aria-labelledby="tab-sector" className="flex flex-col gap-5">
            <p className="max-w-[64ch] text-[14px] text-v-body">These are the sectors in the VoicERA ICP. Pick yours to see what is typically asked of the voice service there.</p>
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {SEGMENTS.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={sector === s.id}
                    onClick={() => setSector(s.id)}
                    className={`flex h-full w-full flex-col gap-1 rounded-v-xl border bg-v-panel p-4 text-left transition-colors hover:border-v-accent ${sector === s.id ? "border-v-accent bg-v-pale" : "border-v-line"}`}
                  >
                    <span className="text-[14.5px] font-semibold">{s.name}</span>
                    <span className="text-[12.5px] leading-snug text-v-body">{s.workflow}</span>
                  </button>
                </li>
              ))}
            </ul>
            {sector ? (
              <Panel className="flex flex-col gap-3">
                <h2 className="text-[16px] font-semibold">What would you like to do in {SEGMENTS.find((s) => s.id === sector)?.name.toLowerCase()}?</h2>
                <ul className="flex flex-col divide-y divide-v-hairline">
                  {objectivesForSegment(sector).map(({ objective }) => (
                    <li key={objective.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium">{objective.label}</span>
                        <span className="block text-[12.5px] text-v-muted">{objective.plain}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        {fitBadge(objective)}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            actions.setStart("sector");
                            actions.chooseObjective(objective.id, sector);
                            go();
                          }}
                        >
                          Choose
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InterpretationCard({ draft, onChange, onConfirm }: { draft: Interpretation; onChange: (i: Interpretation) => void; onConfirm: () => void }) {
  const obj = draft.objectiveId ? OBJECTIVE_BY_ID[draft.objectiveId] : null;
  const toggleLang = (l: string) =>
    onChange({
      ...draft,
      languages: draft.languages.includes(l) ? draft.languages.filter((x) => x !== l) : [...draft.languages, l],
      undocumentedLanguages: (draft.languages.includes(l) ? draft.languages.filter((x) => x !== l) : [...draft.languages, l]).filter((x) => !(DOCUMENTED_LANGUAGES as readonly string[]).includes(x)),
    });

  return (
    <Panel className="flex flex-col gap-5" >
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">What we understood</p>
        <h2 className="mt-1 text-[18px] font-semibold tracking-tight">Please check this before we use it</h2>
      </div>

      {!obj ? (
        <Notice tone="warning" title="We could not pick out a service from that">
          Choose one below, or use the &ldquo;Pick a use case&rdquo; tab.
        </Notice>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="i-objective" className="text-[13px] font-semibold">What you want</label>
          <select
            id="i-objective"
            value={draft.objectiveId ?? ""}
            onChange={(e) => {
              const o = e.target.value ? OBJECTIVE_BY_ID[e.target.value] : null;
              onChange({ ...draft, objectiveId: o ? o.id : null, useCase: o ? o.useCase : null, infoTopic: o?.needsTopic ? draft.infoTopic ?? "schemes" : null });
            }}
            className="rounded-v-lg border border-v-line-strong bg-white px-3.5 py-2.5 text-[13.5px] text-v-fg"
          >
            <option value="">Choose one</option>
            {OBJECTIVES.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="i-direction" className="text-[13px] font-semibold">Who starts the call</label>
          <select
            id="i-direction"
            value={draft.direction ?? ""}
            onChange={(e) => onChange({ ...draft, direction: (e.target.value || null) as Interpretation["direction"] })}
            className="rounded-v-lg border border-v-line-strong bg-white px-3.5 py-2.5 text-[13.5px] text-v-fg"
          >
            <option value="">Not sure yet</option>
            <option value="outbound">The department calls citizens</option>
            <option value="inbound">Citizens call the department</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2" role="group" aria-label="Languages">
        <span className="text-[13px] font-semibold">Languages</span>
        <div className="flex flex-wrap gap-2">
          {[...DOCUMENTED_LANGUAGES, ...OTHER_LANGUAGES.filter((l) => draft.languages.includes(l))].map((l) => {
            const on = draft.languages.includes(l);
            const documented = (DOCUMENTED_LANGUAGES as readonly string[]).includes(l);
            return (
              <label key={l} className={`flex cursor-pointer items-center rounded-v-lg border px-3 py-1.5 text-[13px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 ${on ? (documented ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-warning bg-v-warn-tint text-v-warn-ink") : "border-v-line bg-white text-v-body"}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleLang(l)} />
                {l}
              </label>
            );
          })}
        </div>
      </div>

      {draft.understood.length ? (
        <ul className="flex flex-col gap-1.5 rounded-v-lg bg-v-surface-sunk p-3.5 text-[13px]">
          {draft.understood.map((u) => (
            <li key={u.label}>
              <span className="font-semibold">{u.label}:</span> {u.value} <span className="text-v-muted">({u.because})</span>
            </li>
          ))}
        </ul>
      ) : null}

      {draft.needs.length ? (
        <Notice tone="warning" title="You mentioned something the package may not cover">
          {draft.needs.join(", ").replace(/-/g, " ")}. This will be checked properly in the questions.
        </Notice>
      ) : null}

      <div>
        <p className="mb-1.5 text-[13px] font-semibold">We will still need to ask</p>
        <ul className="list-disc pl-5 text-[13px] leading-relaxed text-v-body">
          {draft.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>

      <div>
        <Button onClick={onConfirm} disabled={!draft.objectiveId}>
          Looks right, continue <ArrowRight className="size-3.5" aria-hidden />
        </Button>
        {!draft.objectiveId ? <p className="mt-2 text-[12.5px] text-v-muted">Choose what you want first.</p> : null}
      </div>
    </Panel>
  );
}
