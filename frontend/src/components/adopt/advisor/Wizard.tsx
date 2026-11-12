"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { QuestionField } from "@/components/adopt/advisor/QuestionField";
import { OutcomeBanner } from "@/components/adopt/advisor/ui";
import { EmptyState, LinkButton, Notice, Spinner } from "@/components/adopt/ui";
import { describeAnswer, isAnswered, progress, stepErrors, stepsFor } from "@/lib/adopt/advisor/answers";
import { directionOf, caseOf } from "@/lib/adopt/advisor/derive";
import { evaluate } from "@/lib/adopt/advisor/evaluate";
import { useAdvisor } from "@/lib/adopt/advisor/store";
import { OBJECTIVE_BY_ID, SEGMENTS, USE_CASES } from "@/lib/adopt/advisor/usecases";

export function Wizard() {
  const router = useRouter();
  const { state, hydrated, actions, costInput } = useAdvisor();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  const a = state.answers;
  const steps = stepsFor(a);
  const idx = Math.min(Math.max(state.stepIndex, 0), Math.max(0, steps.length - 1));
  const step = steps[idx];

  useEffect(() => {
    headingRef.current?.focus();
  }, [idx, hydrated]);

  if (!hydrated) return <Spinner label="Opening your answers" />;
  if (!a.values.objective || !step) {
    return (
      <div className="py-12">
        <EmptyState title="Start with what you want to achieve" action={<LinkButton href="/adopt/advisor" arrow>Go to the start</LinkButton>}>
          The questions depend on your answer to that first one. Your progress is saved on this device.
        </EmptyState>
      </div>
    );
  }

  const ev = evaluate(a, { cost: { category: costInput.category, minutes: costInput.minutes } });
  const early = ev ? ev.findings.filter((f) => f.severity === "blocker" || f.severity === "review") : [];
  const prog = progress(a);
  const uc = caseOf(a);
  const dir = directionOf(a);
  const obj = OBJECTIVE_BY_ID[String(a.values.objective)];
  const seg = SEGMENTS.find((s) => s.id === a.values.sector);
  const last = idx === steps.length - 1;
  const required = step.questions.filter((q) => !q.optionalDetail);
  const optional = step.questions.filter((q) => q.optionalDetail);

  function go(to: number) {
    setErrors({});
    actions.setStepIndex(to);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function next() {
    const errs = stepErrors(step, a);
    if (Object.keys(errs).length) {
      setErrors(errs);
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
        first?.scrollIntoView({ block: "center" });
      });
      return;
    }
    if (last) {
      actions.markResult();
      router.push("/adopt/advisor/result");
      return;
    }
    go(idx + 1);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-12 lg:py-10">
      <div className="min-w-0">
        <nav aria-label="Where you are" className="mb-5 flex flex-wrap items-center gap-1 text-[12px] text-v-muted">
          <span>Your department{seg ? `, ${seg.name}` : ""}</span>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="text-v-body">{obj?.label ?? "Objective"}</span>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="font-medium text-v-fg">{uc ? USE_CASES[uc].label : "Use case"}</span>
          {dir ? (
            <>
              <ChevronRight className="size-3.5" aria-hidden />
              <span className="font-medium text-v-fg">{dir === "both" ? "Inbound and outbound" : dir === "inbound" ? "Inbound" : "Outbound"}</span>
            </>
          ) : null}
        </nav>

        <div className="mb-6 flex flex-col gap-3">
          <div className="flex items-center justify-between text-[12px] text-v-muted">
            <span className="font-mono uppercase tracking-[.14em]">Step {idx + 1} of {steps.length}</span>
            <span aria-live="polite">{prog.done} of {prog.required} needed answers given</span>
          </div>
          <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={idx + 1} className="flex gap-1">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Go to step ${i + 1}: ${s.title}`}
                aria-current={i === idx ? "step" : undefined}
                className={`h-1.5 flex-1 rounded-full transition-colors ${i < idx ? "bg-v-fg" : i === idx ? "bg-v-accent" : "bg-v-line"}`}
              />
            ))}
          </div>
          <ol className="hidden flex-wrap gap-x-4 gap-y-1 text-[12px] md:flex" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s.id} className={i === idx ? "font-semibold text-v-fg" : "text-v-muted"}>
                {s.title}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 ref={headingRef} tabIndex={-1} className="text-[26px] font-semibold leading-tight tracking-tight outline-none md:text-[30px]">
            {step.title}
          </h1>
          <p className="text-[14px] text-v-body">{step.blurb}</p>
        </div>

        {early.length > 0 && idx > 0 ? (
          <div className="mt-5">
            <Notice tone={early.some((f) => f.severity === "blocker") ? "danger" : "warning"} title={early.some((f) => f.severity === "blocker") ? "Part of this is already outside the documented package" : "Something here needs a review"}>
              {early[0].title}: {early[0].detail}
              {early.length > 1 ? ` (and ${early.length - 1} more.)` : ""} You can carry on to see the full picture, or go back and change an answer.
            </Notice>
          </div>
        ) : null}

        <div className="mt-7 flex flex-col gap-8">
          {required.map((q) => (
            <QuestionField key={q.id} q={q} answers={a} error={errors[q.id]} onChange={actions.setAnswer} onUnknown={actions.markUnknown} />
          ))}

          {optional.length > 0 ? (
            <details className="rounded-v-xl border border-v-line bg-v-surface-sunk" open={optional.some((q) => isAnswered(q, a)) || optional.some((q) => !!errors[q.id])}>
              <summary className="cursor-pointer list-none px-4 py-3.5 text-[13.5px] font-semibold text-v-accent-deep">
                Add more detail <span className="font-normal text-v-muted">({optional.length} optional, none change the fit unless noted)</span>
              </summary>
              <div className="flex flex-col gap-7 border-t border-v-line px-4 py-5">
                {optional.map((q) => (
                  <QuestionField key={q.id} q={q} answers={a} error={errors[q.id]} onChange={actions.setAnswer} onUnknown={actions.markUnknown} />
                ))}
              </div>
            </details>
          ) : null}
        </div>

        {Object.keys(errors).length > 0 ? (
          <div className="mt-6">
            <Notice tone="danger" title="A few answers are needed to go on">
              Answer the highlighted questions, or choose Not sure yet where it is offered.
            </Notice>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-v-line pt-5">
          <Button variant="ghost" onClick={() => (idx === 0 ? router.push("/adopt/advisor") : go(idx - 1))}>
            <ArrowLeft className="size-3.5" aria-hidden /> Back
          </Button>
          <div className="flex items-center gap-3">
            <span className="hidden text-[12px] text-v-muted sm:inline">Saved on this device</span>
            <Button onClick={next}>
              {last ? "See my recommendation" : "Next"} <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      <aside aria-label="Live check and your answers" className="flex flex-col gap-5 lg:sticky lg:top-[100px] lg:self-start">
        {ev ? (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Where this stands so far</p>
            {ev.outcome === "outside-scope" ? (
              <OutcomeBanner outcome={ev.outcome} pendingGovernance={ev.pendingGovernance} compact />
            ) : prog.done < prog.required ? (
              <div className="rounded-v-xl border border-v-line bg-v-surface-sunk px-4 py-4">
                <p className="text-[15px] font-semibold">Not enough answered yet to say</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-v-body">{prog.required - prog.done} needed {prog.required - prog.done === 1 ? "answer" : "answers"} to go. We will not guess for the questions you have not reached.</p>
              </div>
            ) : (
              <OutcomeBanner outcome={ev.outcome} pendingGovernance={ev.pendingGovernance} compact />
            )}
            <p className="text-[12px] leading-relaxed text-v-muted">Not final. It updates as you answer.</p>
          </div>
        ) : null}

        <details className="rounded-v-xl border border-v-line bg-v-panel" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-[14px] font-semibold">
            Your answers
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">{Object.keys(a.values).length + Object.keys(a.unknown).length}</span>
          </summary>
          <ul className="max-h-[360px] divide-y divide-v-hairline overflow-y-auto border-t border-v-line">
            {steps.flatMap((s, si) =>
              s.questions
                .filter((q) => isAnswered(q, a))
                .map((q) => (
                  <li key={q.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                    <span className="min-w-0">
                      <span className="block text-v-muted">{q.label.replace(/\?$/, "")}</span>
                      <span className="block truncate font-medium text-v-fg" title={describeAnswer(q, a)}>
                        {describeAnswer(q, a)}
                      </span>
                    </span>
                    <button type="button" onClick={() => go(si)} aria-label={`Change answer: ${q.label}`} className="mt-0.5 shrink-0 rounded-v-sm p-1.5 text-v-muted hover:bg-v-soft hover:text-v-accent">
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                  </li>
                )),
            )}
          </ul>
          <div className="flex items-center justify-between border-t border-v-line px-4 py-3 text-[12.5px]">
            <Link href="/adopt/advisor" className="text-v-accent hover:underline">Change the objective</Link>
            <button type="button" className="text-v-muted hover:text-v-danger" onClick={() => { actions.resetAdvisor(); router.push("/adopt/advisor"); }}>
              Start again
            </button>
          </div>
        </details>
      </aside>
    </div>
  );
}
