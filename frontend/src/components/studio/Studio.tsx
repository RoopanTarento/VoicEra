"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CostEstimator } from "@/components/adopt/advisor/CostEstimator";
import { OutcomeBanner } from "@/components/adopt/advisor/ui";
import { Notice, Spinner } from "@/components/adopt/ui";
import { ScenarioRunner } from "@/components/adopt/ScenarioRunner";
import { ActiveQuestion, Composer, LogView, Thinking, useStickToBottom } from "@/components/studio/Chat";
import { BlueprintPane } from "@/components/studio/BlueprintPane";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { describeAnswer, setUnknown, setValue } from "@/lib/adopt/advisor/answers";
import { buildChecklist } from "@/lib/adopt/advisor/bundle";
import { caseOf } from "@/lib/adopt/advisor/derive";
import { evaluate, OUTCOME_LABEL, type EvalContext } from "@/lib/adopt/advisor/evaluate";
import { exportChecklistCsv, exportRecommendation } from "@/lib/adopt/advisor/export";
import { applyInterpretation, interpret } from "@/lib/adopt/advisor/interpret";
import { pocToWorkspaceConfig } from "@/lib/adopt/advisor/poc";
import { QUESTION_BY_ID } from "@/lib/adopt/advisor/questions";
import { nextQuestion, reactTo, remaining, whatIfs as computeWhatIfs, type WhatIf } from "@/lib/adopt/advisor/studio";
import { useStudio } from "@/lib/adopt/advisor/studio-store";
import { useAdvisor } from "@/lib/adopt/advisor/store";
import { OBJECTIVES, OBJECTIVE_BY_ID, emptyAnswers } from "@/lib/adopt/advisor/usecases";
import type { Answers, Question } from "@/lib/adopt/advisor/types";
import type { SimContext } from "@/lib/adopt/simulate";

const EXAMPLES = [
  "We want to call citizens after they visit a government office and collect feedback about their experience in Tamil and English.",
  "Farmers should be able to call and ask which schemes they qualify for, in Hindi and Marathi.",
  "Citizens call, and we check their pension eligibility live against our database.",
];

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const el = document.createElement("a");
  el.href = url;
  el.download = name;
  el.click();
  URL.revokeObjectURL(url);
}

const withoutValue = (a: Answers, id: string): Answers => {
  const values = { ...a.values };
  delete values[id];
  const unknown = { ...a.unknown };
  delete unknown[id];
  return { ...a, values, unknown };
};

export function Studio() {
  const advisor = useAdvisor();
  const studio = useStudio();
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [mobile, setMobile] = useState<"talk" | "see">("talk");
  const timer = useRef<number | null>(null);
  const [undo, setUndo] = useState<Answers | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const scroller = useStickToBottom(`${studio.state.log.length}-${thinking}-${editing}`);

  if (!advisor.hydrated || !studio.hydrated) return <Spinner label="Opening the studio" />;

  const a = advisor.state.answers;
  const costInput = advisor.costInput;
  const ctx: EvalContext = { cost: { category: costInput.category, minutes: costInput.minutes } };
  const ev = evaluate(a, ctx);
  const q = editing ? QUESTION_BY_ID[editing] : nextQuestion(a, { deepen: studio.state.deepen });
  const togo = remaining(a);
  const tab = studio.state.tab;
  const { actions } = studio;

  const react = (before: Answers, after: Answers, question: Question, delay = 420) => {
    const msg = reactTo(evaluate(before, ctx), evaluate(after, ctx), question, after);
    if (!msg) return;
    setThinking(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      actions.push({ kind: "react", text: msg });
      setThinking(false);
    }, delay);
  };

  function begin(source: string, objectiveId?: string) {
    actions.start();
    if (objectiveId) {
      const o = OBJECTIVE_BY_ID[objectiveId];
      advisor.actions.replaceAnswers(setValue(emptyAnswers(), "objective", objectiveId));
      actions.push({ kind: "user", text: o.label }, { kind: "agent", text: `${o.plain} Let me ask what decides whether it fits.` });
      return;
    }
    const i = interpret(source);
    advisor.actions.replaceAnswers(applyInterpretation(emptyAnswers(), i));
    actions.push({ kind: "user", text: source }, { kind: "read", understood: i.understood, missing: i.missing });
  }

  function commit(question: Question, opts: { value?: unknown; unknown?: boolean }) {
    const base = withoutValue(a, question.id);
    const next = opts.unknown ? setUnknown(base, question.id, true) : opts.value !== undefined ? setValue(base, question.id, opts.value) : a;
    if (next !== a) advisor.actions.replaceAnswers(next);
    const label = describeAnswer(question, next);
    const edited = editing === question.id;
    actions.push(
      ...(edited ? [{ kind: "agent" as const, text: "Changed. Let me see what that does." }] : [{ kind: "q" as const, qid: question.id }]),
      { kind: "a", qid: question.id, label },
    );
    setEditing(null);
    react(base, next, question);
  }

  function tryWhatIf(w: WhatIf) {
    const next = w.apply(a);
    setUndo(a);
    advisor.actions.replaceAnswers(next);
    actions.push({ kind: "agent", text: `Trying it: ${w.label.charAt(0).toLowerCase()}${w.label.slice(1)}. It now reads: ${OUTCOME_LABEL[w.outcome]}.` });
  }

  function undoLast() {
    if (!undo) return;
    advisor.actions.replaceAnswers(undo);
    actions.push({ kind: "agent", text: "Put that back as it was." });
    setUndo(null);
  }

  function addInWords(t: string) {
    const i = interpret(t);
    const keepObjective = !!a.values.objective;
    const next = applyInterpretation(a, keepObjective ? { ...i, objectiveId: null, useCase: null, infoTopic: null } : i);
    const changed = Object.keys(next.values).filter((k) => JSON.stringify(next.values[k]) !== JSON.stringify(a.values[k]));
    advisor.actions.replaceAnswers(next);
    actions.push(
      { kind: "user", text: t },
      {
        kind: "agent",
        text: changed.length
          ? `I picked up: ${changed.map((k) => `${QUESTION_BY_ID[k]?.label.replace(/\?$/, "") ?? k} (${describeAnswer(QUESTION_BY_ID[k], next)})`).join("; ")}.`
          : "I did not find anything new in that. Try naming a language, whether you call or they call, or a system you need to connect to.",
      },
    );
    const lastQ = QUESTION_BY_ID[changed[0]] ?? QUESTION_BY_ID.objective;
    react(a, next, lastQ);
  }

  /* ------------------------------ before it starts ------------------------------ */
  if (!studio.state.started) {
    return (
      <div className="h-full overflow-y-auto"><div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-center gap-8 px-5 py-10 md:px-8">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">VoicERA Studio</span>
          <h1 className="text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[48px]">Tell me about the service you want to build.</h1>
          <p className="max-w-[58ch] text-[15px] font-light leading-relaxed text-v-body">
            Say it the way you would to a colleague. I will work out what it needs, ask only what could change the answer, and draw the call as we go. Anything the package cannot do, I will say straight away.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <label htmlFor="studio-first" className="sr-only">Describe the service</label>
          <textarea
            id="studio-first"
            rows={3}
            value={text}
            maxLength={800}
            onChange={(e) => setText(e.target.value)}
            placeholder="For example: We want to call citizens after they visit a government office and collect feedback about their experience in Tamil and English."
            className="w-full resize-none rounded-v-xl border border-v-line-strong bg-white px-4 py-3.5 text-[15px] leading-relaxed outline-none placeholder:text-v-dim focus:border-v-accent"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => text.trim().length >= 10 && begin(text.trim())} disabled={text.trim().length < 10}>
              Start <ArrowRight className="size-3.5" aria-hidden />
            </Button>
            <span className="text-[12px] text-v-muted">Read by fixed rules. No AI service is connected, and nothing leaves this device.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-v-muted">Or try:</span>
            {EXAMPLES.map((e, i) => (
              <button key={i} type="button" onClick={() => setText(e)} className="rounded-v-md border border-v-line bg-white px-3 py-1.5 text-left text-[12px] text-v-body hover:border-v-accent">
                {e.slice(0, 46)}…
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Or start from a use case</p>
          <ul className="flex flex-wrap gap-2">
            {OBJECTIVES.filter((o) => o.id !== "other").map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => begin("", o.id)} className="rounded-v-lg border border-v-line bg-white px-3.5 py-2 text-[13px] hover:border-v-accent hover:bg-v-pale">{o.label}</button>
              </li>
            ))}
          </ul>
        </div>
      </div></div>
    );
  }

  /* ------------------------------ in conversation ------------------------------ */
  const schemeCount = advisor.state.poc.schemes.filter((s) => s.name.trim()).length;
  const pocQuestions = advisor.state.poc.questions.length;
  const finished = !q && !editing;

  const chat = (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5" role="log" aria-live="polite" aria-label="Conversation">
        <div className="flex flex-col gap-5">
          <LogView
            log={studio.state.log}
            answers={a}
            onEdit={(qid) => setEditing(qid)}
            onRechange={() => setEditing("objective")}
          />
          {thinking ? <Thinking /> : null}
          {q && !thinking ? (
            <ActiveQuestion
              q={q}
              answers={a}
              editing={!!editing}
              onChange={(id, v) => advisor.actions.setAnswer(id, v)}
              onUnknown={(id, on) => advisor.actions.markUnknown(id, on)}
              onCommit={commit}
            />
          ) : null}
          {finished && !thinking ? (
            <div className="flex flex-col gap-3 rounded-v-xl border border-v-line bg-v-surface-sunk p-4">
              <p className="text-[15px] font-semibold">That is enough for a first view.</p>
              {ev ? <OutcomeBanner outcome={ev.outcome} pendingGovernance={ev.pendingGovernance} compact /> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { actions.setTab("hear"); setMobile("see"); }}>Hear it</Button>
                <Button size="sm" variant="outline" onClick={() => { actions.setTab("handover"); setMobile("see"); }}>Hand-over and cost</Button>
                {!studio.state.deepen ? <Button size="sm" variant="ghost" onClick={() => actions.setDeepen(true)}>Answer the optional questions</Button> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="border-t border-v-line bg-v-panel p-3 md:p-4">
        <Composer placeholder="Add or correct something in your own words, for example: they also speak Telugu" onSend={addInWords} />
      </div>
    </div>
  );

  const hearApp = caseOf(a) === "survey-feedback" ? "surveys" : caseOf(a) === "scheme-discovery" ? "scheme-discovery" : null;
  const hearCtx: SimContext | null = hearApp
    ? (() => {
        const app = APPLICATION_BY_ID[hearApp];
        const cfg: Record<string, unknown> = hearApp === "scheme-discovery" && schemeCount ? pocToWorkspaceConfig(advisor.state.poc) : JSON.parse(JSON.stringify(app.defaults));
        const dept = typeof a.values.department === "string" && a.values.department.trim() ? a.values.department.trim() : "Sample Department";
        cfg.department = dept;
        const langs = a.values.languages;
        if (Array.isArray(langs) && langs.length) cfg.languages = langs;
        return { app, config: cfg, integrations: {}, packageId: "deploy" as const };
      })()
    : null;

  const right = (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Studio views" className="flex shrink-0 gap-1 border-b border-v-line bg-v-panel px-3 md:px-5">
        {([["blueprint", "Blueprint"], ["hear", "Hear it"], ["handover", "Hand-over and cost"]] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            type="button"
            onClick={() => actions.setTab(id)}
            className={`-mb-px border-b-2 px-3.5 py-3 text-[13px] font-semibold transition-colors ${tab === id ? "border-v-accent text-v-accent-deep" : "border-transparent text-v-body hover:text-v-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-v-surface-sunk" role="tabpanel">
        {tab === "blueprint" ? (
          <BlueprintPane answers={a} ev={ev} cost={costInput} togo={togo} schemeCount={schemeCount} questionCount={pocQuestions} onOpenHandover={() => actions.setTab("handover")} whatIfs={ev && ev.outcome !== "suitable" ? computeWhatIfs(a, ctx) : []} onTry={tryWhatIf} canUndo={!!undo} onUndo={undoLast} />
        ) : null}

        {tab === "hear" ? (
          <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
            <h2 className="text-[16px] font-semibold">Hear how it would go</h2>
            {hearCtx ? (
              <>
                <Notice tone="demo" title="A text simulation">
                  Built from what you have told me{hearApp === "scheme-discovery" && !schemeCount ? ", with sample schemes because you have not added your own yet" : ""}. No speech, model or telephony is involved, and nobody is called.
                </Notice>
                {hearApp === "scheme-discovery" && !schemeCount ? (
                  <div className="flex flex-wrap gap-3 text-[13px]">
                    <Link href="/adopt/advisor/poc" className="font-semibold text-v-accent hover:underline">Add your own schemes in the proof-of-concept builder</Link>
                  </div>
                ) : null}
                <HearRunner key={hearApp} ctx={hearCtx} />
              </>
            ) : (
              <Notice tone="info">You can hear a conversation for the two documented use cases: scheme discovery and citizen feedback or surveys. Your use case is outside those, so there is nothing to play yet.</Notice>
            )}
          </div>
        ) : null}

        {tab === "handover" ? (
          <div className="flex flex-col gap-6 px-4 py-5 md:px-6">
            {ev ? <OutcomeBanner outcome={ev.outcome} pendingGovernance={ev.pendingGovernance} /> : <Notice tone="info">Start describing the service and this fills in.</Notice>}
            {ev && ev.findings.length ? (
              <ul className="flex flex-col gap-2">
                {ev.findings.slice(0, 5).map((f) => (
                  <li key={f.id}>
                    <Notice tone={f.severity === "blocker" ? "danger" : f.severity === "review" ? "warning" : "info"} title={f.title}>{f.detail}</Notice>
                  </li>
                ))}
              </ul>
            ) : null}
            {ev ? (
              <div>
                <h2 className="mb-2 text-[15px] font-semibold">What you bring</h2>
                <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-white">
                  {buildChecklist(a, ev).filter((i) => i.status !== "na").map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-[13px]">
                      <span>{i.label}<span className="block text-[12px] text-v-muted">{i.detail}</span></span>
                      <span className={`shrink-0 font-mono text-[10px] uppercase tracking-[.1em] ${i.status === "ready" ? "text-v-ok-ink" : i.status === "missing" ? "text-v-danger" : "text-v-warn-ink"}`}>{i.status === "review" ? "review" : i.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h2 className="mb-2 text-[15px] font-semibold">Cost</h2>
              <CostEstimator costInput={costInput} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => { const md = exportRecommendation(a, costInput, String(a.values.department ?? "")); if (md) download("voicera-platinum-recommendation.md", md, "text/markdown"); }}>
                <Download className="size-3.5" aria-hidden /> Export the recommendation
              </Button>
              <Button variant="outline" onClick={() => { const csv = exportChecklistCsv(a, costInput); if (csv) download("voicera-requirements-checklist.csv", csv, "text/csv"); }}>
                <Download className="size-3.5" aria-hidden /> Download the checklist
              </Button>
              <Link href="/adopt/advisor/result" className="inline-flex items-center gap-1.5 rounded-v-md border border-v-line-strong bg-white px-[17px] py-[11px] text-[13px] font-semibold hover:border-v-accent">
                Open the full recommendation <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
            <p className="text-[12px] text-v-muted">Nothing is sent anywhere from here. The full recommendation page uses the same answers.</p>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-v-line bg-v-panel lg:hidden" role="tablist" aria-label="Talk or see">
        {([["talk", "Talk"], ["see", ev ? "Blueprint" : "Blueprint"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mobile === id} type="button" onClick={() => setMobile(id)} className={`-mb-px flex-1 border-b-2 py-3 text-[13px] font-semibold ${mobile === id ? "border-v-accent text-v-accent-deep" : "border-transparent text-v-body"}`}>
            {label}
            {id === "see" && ev ? <span className="ml-1.5 text-[11px] font-normal text-v-muted">{togo ? `${togo} to go` : "ready"}</span> : null}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(380px,460px)_minmax(0,1fr)]">
        <section aria-label="Conversation" className={`min-h-0 border-r border-v-line bg-v-panel ${mobile === "talk" ? "block" : "hidden"} lg:block`}>{chat}</section>
        <section aria-label="Blueprint and results" className={`min-h-0 ${mobile === "see" ? "block" : "hidden"} lg:block`}>{right}</section>
      </div>
    </div>
  );
}

function HearRunner({ ctx }: { ctx: SimContext }) {
  const [id, setId] = useState(ctx.app.scenarios[0].id);
  const scenario = ctx.app.scenarios.find((s) => s.id === id) ?? ctx.app.scenarios[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Situation">
        {ctx.app.scenarios.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === scenario.id} onClick={() => setId(s.id)} className={`rounded-v-lg border px-3.5 py-2 text-[13px] font-medium ${s.id === scenario.id ? "border-v-accent bg-v-pale text-v-accent-deep" : "border-v-line bg-white text-v-body hover:border-v-line-strong"}`}>
            {s.title}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-v-body">{scenario.situation}</p>
      <ScenarioRunner key={scenario.id} ctx={ctx} scenario={scenario} mode="adopter" />
    </div>
  );
}
