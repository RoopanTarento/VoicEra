"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { QuestionField } from "@/components/adopt/advisor/QuestionField";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { describeAnswer, questionError } from "@/lib/adopt/advisor/answers";
import { QUESTION_BY_ID } from "@/lib/adopt/advisor/questions";
import type { LogItem } from "@/lib/adopt/advisor/studio-store";
import type { Answers, Question } from "@/lib/adopt/advisor/types";

const CHIP_KINDS = ["single", "assumption", "range", "yesno"];

function Agent({ children, tone }: { children: React.ReactNode; tone?: "note" }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="flex gap-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-v-fg text-white" aria-hidden>
        <VoicEraMark size={13} className="text-white" />
      </span>
      <div className={`min-w-0 max-w-[92%] text-[14px] leading-relaxed ${tone === "note" ? "border-l-2 border-v-accent pl-3 text-[13px] text-v-body" : "text-v-fg"}`}>{children}</div>
    </motion.div>
  );
}

function User({ children, onEdit }: { children: React.ReactNode; onEdit?: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex flex-col items-end gap-1">
      <p className="max-w-[88%] rounded-v-lg rounded-tr-sm bg-v-accent px-3.5 py-2 text-[14px] leading-relaxed text-white">{children}</p>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-[11.5px] text-v-muted hover:text-v-accent">
          <Pencil className="size-3" aria-hidden /> Change this answer
        </button>
      ) : null}
    </motion.div>
  );
}

export function Thinking() {
  return (
    <div className="flex gap-2.5" role="status" aria-label="Working out what that means">
      <span className="mt-0.5 size-6 shrink-0 rounded-full bg-v-fg" aria-hidden />
      <span className="flex items-center gap-1 pt-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="size-1.5 rounded-full bg-v-muted" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }} />
        ))}
      </span>
    </div>
  );
}

export function LogView({ log, answers, onEdit, onRechange }: { log: LogItem[]; answers: Answers; onEdit: (qid: string) => void; onRechange: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {log.map((it) => {
        switch (it.kind) {
          case "user":
            return <User key={it.id}>{it.text}</User>;
          case "agent":
            return <Agent key={it.id}>{it.text}</Agent>;
          case "read":
            return (
              <Agent key={it.id}>
                <p className="mb-2 font-medium">Here is how I read that.</p>
                {it.understood.length ? (
                  <ul className="mb-2 flex flex-col gap-1 rounded-v-lg bg-v-surface-sunk p-3 text-[13px]">
                    {it.understood.map((u) => (
                      <li key={u.label}><span className="font-semibold">{u.label}:</span> {u.value}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-2 text-v-body">I could not pick out the service from that, so I will ask.</p>
                )}
                {it.missing.length ? <p className="text-[13px] text-v-body">I still need to know: {it.missing.slice(0, 3).join("; ").toLowerCase()}.</p> : null}
                <button type="button" onClick={onRechange} className="mt-2 text-[12.5px] font-semibold text-v-accent hover:underline">That is not quite right</button>
              </Agent>
            );
          case "q": {
            const q = QUESTION_BY_ID[it.qid];
            return (
              <Agent key={it.id}>
                <p className="font-medium">{q?.label}</p>
              </Agent>
            );
          }
          case "a":
            return (
              <User key={it.id} onEdit={QUESTION_BY_ID[it.qid] && answers.values[it.qid] !== undefined ? () => onEdit(it.qid) : undefined}>
                {it.label}
              </User>
            );
          case "react":
            return <Agent key={it.id} tone="note">{it.text}</Agent>;
        }
      })}
    </div>
  );
}

/** The question currently being put to the person, with its answer controls. */
export function ActiveQuestion({
  q,
  answers,
  editing,
  onChange,
  onUnknown,
  onCommit,
}: {
  q: Question;
  answers: Answers;
  editing: boolean;
  onChange: (id: string, v: unknown) => void;
  onUnknown: (id: string, on: boolean) => void;
  /** Commit the answer. `value` is set for chip answers, or undefined for forms where the value is already in the answers. */
  onCommit: (q: Question, opts: { value?: unknown; unknown?: boolean }) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const chips = CHIP_KINDS.includes(q.kind);
  const opts = q.kind === "yesno" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : (q.options ?? []);

  return (
    <motion.div key={q.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="flex flex-col gap-3">
      <Agent>
        {editing ? <p className="mb-1 text-[12px] text-v-muted">Changing an earlier answer</p> : null}
        <p className="font-medium">{q.label}</p>
        <p className="mt-0.5 text-[12.5px] text-v-muted">{q.why}</p>
      </Agent>
      <div className="ml-[34px] flex flex-col gap-2">
        {chips ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={q.label}>
            {opts.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onCommit(q, { value: q.kind === "yesno" ? o.value === "yes" : o.value })}
                className="rounded-v-lg border border-v-line-strong bg-white px-3.5 py-2 text-left text-[13.5px] font-medium text-v-fg transition-colors hover:border-v-accent hover:bg-v-pale focus-visible:border-v-accent"
              >
                {o.label}
                {"hint" in o && (o as { hint?: string }).hint ? <span className="mt-0.5 block text-[11.5px] font-normal text-v-muted">{(o as { hint?: string }).hint}</span> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-v-xl border border-v-line bg-white p-4">
            <QuestionField q={q} answers={answers} error={err ?? undefined} onChange={(id, v) => { setErr(null); onChange(id, v); }} onUnknown={(id, on) => { setErr(null); onUnknown(id, on); }} />
            <div className="mt-4">
              <Button
                size="sm"
                onClick={() => {
                  const e = questionError(q, answers);
                  const done = answers.unknown[q.id] || answers.values[q.id] !== undefined;
                  if (e || (q.required && !done)) return setErr(e ?? "Answer this, or choose Not sure yet, to go on.");
                  setErr(null);
                  onCommit(q, {});
                }}
              >
                Send answer
              </Button>
            </div>
          </div>
        )}
        {chips && q.allowUnknown ? (
          <button type="button" onClick={() => onCommit(q, { unknown: true })} className="w-fit text-[12.5px] text-v-muted underline-offset-2 hover:text-v-accent hover:underline">
            Not sure yet
          </button>
        ) : null}
        {chips && !q.required ? (
          <button type="button" onClick={() => onCommit(q, { unknown: true })} className="w-fit text-[12.5px] text-v-muted underline-offset-2 hover:underline">Skip</button>
        ) : null}
      </div>
    </motion.div>
  );
}

export function Composer({ placeholder, onSend, label = "Add or change something in your own words" }: { placeholder: string; onSend: (text: string) => void; label?: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  function send() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }
  return (
    <div className="flex items-end gap-2 rounded-v-xl border border-v-line-strong bg-white p-2 focus-within:border-v-accent">
      <label htmlFor="studio-composer" className="sr-only">{label}</label>
      <textarea
        id="studio-composer"
        ref={ref}
        rows={1}
        value={text}
        maxLength={600}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-snug outline-none placeholder:text-v-dim"
      />
      <button type="button" onClick={send} disabled={!text.trim()} aria-label="Send" className="flex size-9 shrink-0 items-center justify-center rounded-v-md bg-v-accent text-white transition-colors hover:bg-v-accent-deep disabled:opacity-40">
        <ArrowUp className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [dep]);
  return ref;
}

export { describeAnswer };
