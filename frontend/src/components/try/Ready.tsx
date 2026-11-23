"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";

const GREETING_MAX = 300;

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-v-sm bg-v-pale px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[.12em] text-v-fg">
      {children}
    </span>
  );
}

/** The agent before its test call: what it covers and the line it opens with. */
export function Ready({
  language,
  languageName,
  schemeCount,
  greeting,
  english,
  onGreeting,
  onChangeSchemes,
  onStart,
  starting,
  error,
}: {
  language: string;
  languageName: string;
  schemeCount: number;
  greeting: string;
  english: string | null;
  onGreeting: (text: string) => void;
  onChangeSchemes: () => void;
  onStart: () => void;
  starting: boolean;
  error: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(greeting);

  return (
    <section className="mx-auto flex w-full max-w-[680px] flex-col items-center px-4 pb-16 pt-14 sm:px-6 animate-v-rise">
      <h1 className="m-0 text-center text-[30px] font-semibold tracking-tight sm:text-[36px]">Your agent is ready</h1>

      <div className="mt-8 flex w-full flex-col gap-3 rounded-[20px] border border-v-line bg-white px-6 py-6 sm:px-8">
        <div className="flex flex-wrap gap-2">
          <Tag>Scheme discovery</Tag>
          <Tag>{languageName}</Tag>
          <Tag>
            {schemeCount} {schemeCount === 1 ? "scheme" : "schemes"}
          </Tag>
        </div>
        <span className="mt-2 font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">It will open with</span>

        {editing ? (
          <div className="flex flex-col gap-3">
            <Textarea
              lang={language}
              rows={3}
              maxLength={GREETING_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Opening line"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!draft.trim()}
                onClick={() => {
                  onGreeting(draft.trim());
                  setEditing(false);
                }}
              >
                Save greeting
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <button type="button" onClick={onChangeSchemes} className="ml-auto text-[13.5px] font-semibold text-v-accent underline underline-offset-4">
                Change schemes
              </button>
            </div>
          </div>
        ) : (
          <>
            <p lang={language} className="m-0 text-[20px] font-medium leading-relaxed text-v-fg sm:text-[22px]">
              “{greeting}”
            </p>
            {english ? <p className="m-0 text-[14.5px] text-v-muted-2">{english}</p> : null}
            <button
              type="button"
              onClick={() => {
                setDraft(greeting);
                setEditing(true);
              }}
              className="mt-2 self-start text-[14px] font-semibold text-v-accent underline underline-offset-4 hover:text-v-accent-deep"
            >
              Change greeting or schemes
            </button>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="m-0 mt-4 w-full rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-[13.5px] text-v-danger">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onStart}
        disabled={starting || editing}
        className="mt-8 inline-flex items-center gap-3 rounded-full bg-v-accent px-9 py-4 text-[17px] font-semibold text-white shadow-[var(--v-shadow-primary)] transition-colors hover:bg-v-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Mic className="size-5" strokeWidth={2} />
        {starting ? "Connecting…" : "Start test call"}
      </button>
      <p className="m-0 mt-4 text-center text-[13.5px] text-v-muted-2">Uses your microphone. Nothing is saved until you sign in.</p>
    </section>
  );
}
