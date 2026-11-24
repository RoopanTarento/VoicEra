"use client";

import { useState } from "react";
import { Mic, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import type { DemoRole } from "@/lib/api/try-agent";

const GREETING_MAX = 400;

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-v-sm bg-v-pale px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[.12em] text-v-fg">
      {children}
    </span>
  );
}

/** Who the tester plays on the call (the knowledge base's role card). */
export function RoleCard({ role, compact = false }: { role: DemoRole; compact?: boolean }) {
  return (
    <div className="flex w-full items-start gap-3 rounded-v-xl bg-v-pale px-5 py-4 text-left">
      <UserRound className="mt-0.5 size-[18px] shrink-0 text-v-fg" strokeWidth={1.9} />
      <span className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">You&apos;re playing</span>
        <span className="text-[15.5px] font-semibold leading-snug">{role.you_are}</span>
        {compact ? null : (
          <span className="text-[14px] text-v-muted-2">
            Try asking: “{role.try_asking}” Or just talk freely.
          </span>
        )}
      </span>
    </div>
  );
}

/** The agent before its test call: what it is, the line it opens with, and who the tester plays. */
export function Ready({
  templateName,
  languageName,
  sectorName,
  cards,
  language,
  opening,
  english,
  greeting,
  notice,
  role,
  onGreeting,
  onChangeSources,
  onStart,
  starting,
  error,
}: {
  templateName: string;
  languageName: string;
  sectorName: string;
  cards: number;
  language: string;
  opening: string;
  english: string | null;
  greeting: string;
  notice: string;
  role: DemoRole;
  onGreeting: (text: string) => void;
  onChangeSources: () => void;
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
          <Tag>{templateName}</Tag>
          <Tag>{languageName}</Tag>
          <Tag>
            {sectorName} · {cards} {cards === 1 ? "card" : "cards"}
          </Tag>
        </div>
        <span className="mt-2 font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">It will open with</span>

        {editing ? (
          <div className="flex flex-col gap-3">
            <Textarea lang={language} rows={3} maxLength={GREETING_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Greeting" />
            <p className="m-0 text-[13px] text-v-muted-2">
              Always added: “<span lang={language}>{notice}</span>”
            </p>
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
              <button type="button" onClick={onChangeSources} className="ml-auto text-[13.5px] font-semibold text-v-accent underline underline-offset-4">
                Change sources
              </button>
            </div>
          </div>
        ) : (
          <>
            <p lang={language} className="m-0 text-[20px] font-medium leading-relaxed text-v-fg sm:text-[22px]">
              “{opening}”
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
              Change greeting or sources
            </button>
          </>
        )}
      </div>

      <div className="mt-4 w-full">
        <RoleCard role={role} />
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
