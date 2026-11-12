"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Panel, Spinner } from "@/components/adopt/ui";
import { useAdopt } from "@/lib/adopt/state";
import {
  isAnswered,
  questionError,
  visibleQuestions,
  type Question,
} from "@/lib/adopt/questionnaire";
import type { QuestionnaireAnswers } from "@/lib/adopt/types";

function answerLabel(q: Question, a: QuestionnaireAnswers): string {
  const v = a[q.id];
  if (v === undefined || v === "") return "";
  const opts = q.options ? q.options(a) : [];
  if (Array.isArray(v)) return v.map((x) => opts.find((o) => o.value === x)?.label ?? x).join(", ");
  if (typeof v === "string") return opts.find((o) => o.value === v)?.label ?? v;
  return String(v);
}

export function Selection() {
  const router = useRouter();
  const { state, hydrated, actions } = useAdopt();
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const answers = state.answers;
  const qs = visibleQuestions(answers);
  const step = Math.min(Math.max(state.step, 0), qs.length);
  const onReview = step >= qs.length;
  const q = onReview ? null : qs[step];
  const answeredCount = qs.filter((x) => isAnswered(x, answers)).length;

  // Move focus to the question heading when the step changes, so keyboard and screen reader users follow along.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step, hydrated]);

  if (!hydrated) return <Spinner label="Loading your answers" />;

  function go(to: number) {
    setError(null);
    actions.setStep(to);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  }

  function next() {
    if (!q) return;
    const err = questionError(q, answers);
    if (err) {
      setError(err);
      return;
    }
    go(step + 1);
  }

  const pct = Math.round((answeredCount / Math.max(1, qs.length)) * 100);
  const groups = Array.from(new Set(qs.map((x) => x.group)));

  return (
    <div className="grid gap-8 py-8 lg:grid-cols-[1fr_320px] lg:gap-12 lg:py-12">
      <div className="min-w-0">
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex items-center justify-between text-[12px] text-v-muted">
            <span className="font-mono uppercase tracking-[.14em]">
              {onReview ? "Review" : q?.group}
            </span>
            <span aria-live="polite">
              {onReview ? "All questions answered" : `Question ${step + 1} of ${qs.length}`}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Questions answered"
            className="h-1 w-full overflow-hidden rounded-full bg-v-line"
          >
            <div className="h-full rounded-full bg-v-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <ol className="hidden flex-wrap gap-x-5 gap-y-1 text-[12px] sm:flex" aria-label="Sections">
            {groups.map((g) => {
              const current = q?.group === g;
              return (
                <li key={g} className={current ? "font-semibold text-v-fg" : "text-v-muted"}>
                  {g}
                </li>
              );
            })}
          </ol>
        </div>

        {onReview ? (
          <Review qs={qs} answers={answers} onEdit={go} onDone={() => router.push("/adopt/select/result")} onBack={() => go(qs.length - 1)} />
        ) : q ? (
          <Panel className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 ref={headingRef} tabIndex={-1} className="text-[24px] font-semibold leading-tight tracking-tight outline-none md:text-[28px]">
                {q.title}
              </h1>
              {q.help ? <p id="q-help" className="max-w-[60ch] text-sm leading-relaxed text-v-body">{q.help}</p> : null}
            </div>

            <QuestionInput q={q} answers={answers} onChange={(key, value) => { setError(null); actions.setAnswer(key, value as never); }} error={error} />

            {error ? (
              <p id="q-error" role="alert" className="text-[13px] font-medium text-v-danger">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t border-v-hairline pt-5">
              <Button variant="ghost" onClick={() => (step === 0 ? router.push("/adopt/sectors") : go(step - 1))}>
                <ArrowLeft className="size-3.5" aria-hidden /> Back
              </Button>
              <Button onClick={next}>
                {step === qs.length - 1 ? "Review answers" : "Next"} <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            </div>
          </Panel>
        ) : null}
      </div>

      <aside aria-label="Your answers so far" className="lg:pt-[58px]">
        <details className="rounded-v-xl border border-v-line bg-v-panel lg:open:block" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-semibold lg:cursor-default">
            Your answers
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">{answeredCount}/{qs.length}</span>
          </summary>
          <ul className="divide-y divide-v-hairline border-t border-v-line">
            {qs.map((x, i) => {
              const label = answerLabel(x, answers);
              return (
                <li key={x.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                  <span className="min-w-0">
                    <span className="block text-v-muted">{x.title.replace(/\?$/, "")}</span>
                    <span className={`block truncate ${label ? "font-medium text-v-fg" : "text-v-disabled"}`} title={label}>
                      {label || "Not answered"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Change answer: ${x.title}`}
                    className={`mt-0.5 shrink-0 rounded-v-sm p-1.5 text-v-muted hover:bg-v-soft hover:text-v-accent ${i === step && !onReview ? "text-v-accent" : ""}`}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-v-line px-4 py-3">
            <button
              type="button"
              className="text-[12.5px] text-v-muted underline-offset-2 hover:text-v-danger hover:underline"
              onClick={() => {
                actions.resetSelection();
                setError(null);
              }}
            >
              Clear answers and start again
            </button>
          </div>
        </details>
      </aside>
    </div>
  );
}

function QuestionInput({
  q,
  answers,
  onChange,
  error,
}: {
  q: Question;
  answers: QuestionnaireAnswers;
  onChange: (key: keyof QuestionnaireAnswers, value: unknown) => void;
  error: string | null;
}) {
  const options = q.options ? q.options(answers) : [];
  const value = answers[q.id];

  if (q.kind === "text") {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={`q-${q.id}`} className="sr-only">
          {q.title}
        </label>
        <Input
          id={`q-${q.id}`}
          autoComplete="organization"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(q.id, e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "q-error" : q.help ? "q-help" : undefined}
          maxLength={80}
          placeholder="For example, Water Supply and Sewerage Board"
        />
      </div>
    );
  }

  const multi = q.kind === "multi" || q.kind === "languages";
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(v: string) {
    if (q.kind === "multi" && v === "none") {
      onChange(q.id, selected.includes("none") ? [] : ["none"]);
      return;
    }
    const base = q.kind === "multi" ? selected.filter((x) => x !== "none") : selected;
    onChange(q.id, base.includes(v) ? base.filter((x) => x !== v) : [...base, v]);
  }

  const compact = q.kind === "languages";
  return (
    <fieldset aria-describedby={error ? "q-error" : q.help ? "q-help" : undefined}>
      <legend className="sr-only">{q.title}</legend>
      <div className={compact ? "flex flex-wrap gap-2" : "flex flex-col gap-2.5"}>
        {options.map((o) => {
          const checked = multi ? selected.includes(o.value) : value === o.value;
          return (
            <label
              key={o.value}
              className={`relative flex cursor-pointer items-start gap-3 rounded-v-lg border bg-white transition-colors has-[:checked]:border-v-accent has-[:checked]:bg-v-pale has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40 hover:border-v-line-strong ${
                compact ? "px-3.5 py-2" : "px-4 py-3.5"
              } ${checked ? "border-v-accent" : "border-v-line"}`}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                name={`q-${q.id}`}
                value={o.value}
                checked={checked}
                onChange={() => (multi ? toggle(o.value) : onChange(q.id, o.value))}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={`mt-[3px] flex size-4 shrink-0 items-center justify-center border border-v-line-strong bg-white peer-checked:border-v-accent peer-checked:bg-v-accent peer-checked:[&>span]:opacity-100 ${
                  multi ? "rounded-[4px]" : "rounded-full"
                } ${compact ? "mt-[2px]" : ""}`}
              >
                <span className="size-1.5 rounded-full bg-white opacity-0" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-v-fg">{o.label}</span>
                {o.hint ? <span className="mt-0.5 block text-[12.5px] leading-snug text-v-muted">{o.hint}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Review({
  qs,
  answers,
  onEdit,
  onDone,
  onBack,
}: {
  qs: Question[];
  answers: QuestionnaireAnswers;
  onEdit: (i: number) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const missing = qs.findIndex((x) => !isAnswered(x, answers) || questionError(x, answers));
  return (
    <Panel className="flex flex-col gap-5">
      <div>
        <h1 tabIndex={-1} className="text-[24px] font-semibold leading-tight tracking-tight outline-none md:text-[28px]">
          Check your answers
        </h1>
        <p className="mt-2 text-sm text-v-body">Change anything that is not right. The recommendation updates to match.</p>
      </div>
      <ul className="divide-y divide-v-hairline rounded-v-lg border border-v-line">
        {qs.map((x, i) => (
          <li key={x.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 text-[13.5px]">
              <p className="text-v-muted">{x.title}</p>
              <p className="mt-0.5 font-medium text-v-fg">{answerLabel(x, answers) || "Not answered"}</p>
            </div>
            <button type="button" onClick={() => onEdit(i)} className="shrink-0 text-[12.5px] font-semibold text-v-accent hover:underline">
              Change
            </button>
          </li>
        ))}
      </ul>
      {missing !== -1 ? (
        <p role="alert" className="text-[13px] font-medium text-v-danger">
          One question still needs an answer: {qs[missing].title}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t border-v-hairline pt-5">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-3.5" aria-hidden /> Back
        </Button>
        <Button onClick={() => (missing === -1 ? onDone() : onEdit(missing))}>
          {missing === -1 ? "See my recommendation" : "Answer the missing question"} <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </Panel>
  );
}
