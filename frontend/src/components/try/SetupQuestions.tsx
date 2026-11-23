"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { canCall, type TryCatalogue } from "@/lib/api/try-agent";

const FIRST_LANGUAGES = 6;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Shell shared by the three setup questions: Back, "Question n of 3", the
 * three-part progress bar, the question and its note, and the primary action. */
function QuestionFrame({
  index,
  title,
  note,
  onBack,
  action,
  children,
}: {
  index: 1 | 2 | 3;
  title: string;
  note: string;
  onBack: () => void;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col px-4 pb-16 pt-10 sm:px-6 sm:pt-14 animate-v-rise">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[14px] text-v-muted-2 hover:text-v-fg">
          <ArrowLeft className="size-4" strokeWidth={1.9} />
          Back
        </button>
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
          Question {index} of 3
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1 rounded-full ${n <= index ? "bg-v-accent" : "bg-v-track"}`} />
        ))}
      </div>
      <h1 className="m-0 mt-8 text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">{title}</h1>
      <p className="m-0 mt-2 text-[15px] font-light text-v-muted-2">{note}</p>
      <div className="mt-7">{children}</div>
      <div className="mt-8 flex justify-end">{action}</div>
    </section>
  );
}

function choiceClass(on: boolean) {
  return `flex w-full flex-col items-start gap-0.5 rounded-v-xl bg-white px-5 py-4 text-left transition-colors ${
    on ? "border-2 border-v-fg px-[19px] py-[15px]" : "border border-v-line hover:border-v-line-strong"
  }`;
}

export function DepartmentQuestion({
  catalogue,
  selected,
  onChange,
  onBack,
  onNext,
}: {
  catalogue: TryCatalogue;
  selected: string[];
  onChange: (departments: string[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of catalogue.schemes) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalogue]);

  return (
    <QuestionFrame
      index={1}
      title="Which department is this for?"
      note="Pick one or more."
      onBack={onBack}
      action={
        <Button disabled={!selected.length} onClick={onNext}>
          Next
          <ArrowRight className="size-4" strokeWidth={2} />
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {departments.map(([name, count]) => {
          const on = selected.includes(name);
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((d) => d !== name) : [...selected, name])}
              className={choiceClass(on)}
            >
              <span className="flex items-center gap-1.5 text-[16px] font-semibold">
                {name}
                {on ? <Check className="size-4" strokeWidth={2.6} /> : null}
              </span>
              <span className="text-[14px] text-v-muted-2">{plural(count, "scheme", "schemes")}</span>
            </button>
          );
        })}
      </div>
    </QuestionFrame>
  );
}

export function SchemeQuestion({
  catalogue,
  departments,
  selected,
  onChange,
  onBack,
  onNext,
}: {
  catalogue: TryCatalogue;
  departments: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const schemes = catalogue.schemes.filter((s) => departments.includes(s.category));
  const max = catalogue.max_schemes;
  const full = max !== null && selected.length >= max;

  return (
    <QuestionFrame
      index={2}
      title="Which schemes should it explain?"
      note={`From the official list for ${listWords(departments)}. All are selected; untick any you don't need.`}
      onBack={onBack}
      action={
        <Button disabled={!selected.length} onClick={onNext}>
          Next
          <ArrowRight className="size-4" strokeWidth={2} />
        </Button>
      }
    >
      <ul className="m-0 list-none divide-y divide-v-line overflow-hidden rounded-v-xl border border-v-line bg-white p-0">
        {schemes.map((s) => {
          const on = selected.includes(s.id);
          return (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-4 px-5 py-4 hover:bg-v-soft/40">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={on}
                  disabled={!on && full}
                  onChange={() => onChange(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                />
                <span
                  aria-hidden="true"
                  className={`flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-v-accent/40 ${
                    on ? "border-v-fg bg-v-fg text-white" : "border-v-line-strong bg-white"
                  }`}
                >
                  {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[15.5px] font-semibold">{s.name}</span>
                  <span className="text-[14px] text-v-muted-2">{s.summary}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </QuestionFrame>
  );
}

export function LanguageQuestion({
  catalogue,
  selected,
  onChange,
  onBack,
  onNext,
}: {
  catalogue: TryCatalogue;
  selected: string | null;
  onChange: (code: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [showAll, setShowAll] = useState(
    () => catalogue.languages.findIndex((l) => l.code === selected) >= FIRST_LANGUAGES,
  );
  const shown = showAll ? catalogue.languages : catalogue.languages.slice(0, FIRST_LANGUAGES);
  const selectedReady = canCall(catalogue.languages.find((l) => l.code === selected));
  const noneReady = !catalogue.languages.some(canCall);

  return (
    <QuestionFrame
      index={3}
      title="Which language should it speak?"
      note="You'll talk to it in this language on the test call."
      onBack={onBack}
      action={
        <Button disabled={!selectedReady} onClick={onNext}>
          Create my agent
          <ArrowRight className="size-4" strokeWidth={2} />
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((l) => {
          const ready = canCall(l);
          const on = ready && selected === l.code;
          return (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={on}
              disabled={!ready}
              onClick={() => onChange(l.code)}
              className={`${choiceClass(on)} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-v-line`}
            >
              <span className="flex items-center gap-1.5 text-[19px] font-semibold leading-snug">
                {l.native}
                {on ? <Check className="size-4" strokeWidth={2.6} /> : null}
              </span>
              <span className="text-[14px] text-v-muted-2">{ready ? l.name : `${l.name} · not available yet`}</span>
            </button>
          );
        })}
      </div>
      {noneReady ? (
        <p role="status" className="mt-6 text-[14px] text-v-danger">
          Test calls aren&apos;t available right now. Please check back soon.
        </p>
      ) : null}
      {!showAll && catalogue.languages.length > FIRST_LANGUAGES ? (
        <button type="button" onClick={() => setShowAll(true)} className="mt-6 text-[14px] font-semibold text-v-accent hover:text-v-accent-deep">
          Show all languages
        </button>
      ) : null}
    </QuestionFrame>
  );
}
