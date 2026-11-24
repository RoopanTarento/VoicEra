"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, FileText, Link2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import {
  addLinkSource,
  canCall,
  uploadSource,
  type AddedSource,
  type DemoAnswers,
  type DemoCardRow,
  type DemoSector,
  type DemoSources,
  type DemoTemplate,
  type TryCatalogue,
} from "@/lib/api/try-agent";
import { COPY, jobOf } from "@/lib/demo-copy";

const FIRST_LANGUAGES = 6;
const MAX_SURVEY_QUESTIONS = 8;

/** Everything the visitor has answered so far. */
export interface Setup {
  templateId: string;
  sectorId: string | null;
  topic: string;
  language: string | null;
  sampleKnowledge: boolean;
  /** Sample cards the visitor unticked. */
  excludedCards: string[];
  added: AddedSource[];
  announcement: string;
  audience: string;
  reminder: string;
  ifCantMakeIt: "reschedule" | "helpline";
  /** null = the suggested set. */
  surveyQuestions: string[] | null;
  /** null = every complaint type. */
  complaintFlows: string[] | null;
  serviceCardId: string | null;
}

export function newSetup(templateId: string): Setup {
  return {
    templateId,
    sectorId: null,
    topic: "",
    language: null,
    sampleKnowledge: true,
    excludedCards: [],
    added: [],
    announcement: "",
    audience: "",
    reminder: "",
    ifCantMakeIt: "reschedule",
    surveyQuestions: null,
    complaintFlows: null,
    serviceCardId: null,
  };
}

/** Sample cards the agent will load (none when sample knowledge is off). */
export function keptCards(s: Setup, sources: DemoSources): number {
  if (!s.sampleKnowledge) return 0;
  const ids = (sources.cards.items ?? sources.cards.preview).map((c) => c.card_id);
  return Math.max(0, sources.cards.count - ids.filter((id) => s.excludedCards.includes(id)).length);
}

/** The visitor kept something for the agent to answer from. */
function hasKnowledge(s: Setup, sources: DemoSources): boolean {
  return keptCards(s, sources) > 0 || s.added.length > 0;
}

/** The answers the server builds the agent from (ids only, plus the visitor's own text). */
export function toAnswers(s: Setup): DemoAnswers | null {
  if (!s.sectorId || !s.language) return null;
  const job = s.templateId;
  return {
    template_id: s.templateId,
    sector_id: s.sectorId,
    language: s.language,
    ...(s.topic.trim() ? { topic: s.topic.trim() } : {}),
    sample_knowledge: s.sampleKnowledge,
    ...(s.sampleKnowledge && s.excludedCards.length ? { excluded_cards: s.excludedCards } : {}),
    source_ids: s.added.map((a) => a.source_id),
    ...(job === "T-INFORM" ? { announcement: s.announcement.trim(), audience: s.audience.trim() } : {}),
    ...(job === "T-REMIND" ? { reminder: s.reminder.trim(), if_cant_make_it: s.ifCantMakeIt } : {}),
    ...(job === "T-COLLECT" && s.surveyQuestions ? { survey_questions: s.surveyQuestions.map((q) => q.trim()).filter(Boolean) } : {}),
    ...(job === "T-RESOLVE" && s.complaintFlows ? { complaint_flows: s.complaintFlows } : {}),
    ...(job === "T-GUIDE" && s.serviceCardId ? { service_card_id: s.serviceCardId } : {}),
  };
}

/** Back link, "TEMPLATE · Question n of 3", the progress bar, the question and its note, the primary action. */
function QuestionFrame({
  index,
  template,
  title,
  note,
  backLabel = "Back",
  onBack,
  action,
  children,
}: {
  index: 1 | 2 | 3;
  template: DemoTemplate;
  title: string;
  note: string;
  backLabel?: string;
  onBack: () => void;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full max-w-[760px] flex-col px-4 pb-16 pt-10 sm:px-6 sm:pt-14 animate-v-rise">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[14px] text-v-muted-2 hover:text-v-fg">
          <ArrowLeft className="size-4" strokeWidth={1.9} />
          {backLabel}
        </button>
        <span className="text-right font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
          {template.name} · Question {index} of 3
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

function NextButton({ disabled, onClick, label = "Next" }: { disabled: boolean; onClick: () => void; label?: string }) {
  return (
    <Button disabled={disabled} onClick={onClick}>
      {label}
      <ArrowRight className="size-4" strokeWidth={2} />
    </Button>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">{children}</span>;
}

// --- Q1: what is it about ----------------------------------------------------------------

export function SectorQuestion({
  template,
  sectors,
  setup,
  onSetup,
  onBack,
  onNext,
}: {
  template: DemoTemplate;
  sectors: DemoSector[];
  setup: Setup;
  onSetup: (patch: Partial<Setup>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const job = jobOf(template.job);
  const field = COPY[job].field;
  const key: "announcement" | "reminder" | "topic" = job === "INFORM" ? "announcement" : job === "REMIND" ? "reminder" : "topic";
  const value = setup[key];
  const ready = Boolean(setup.sectorId) && (!field.required || value.trim().length > 0);

  return (
    <QuestionFrame
      index={1}
      template={template}
      title={template.q1}
      note="Pick a sector, or describe it in your own words."
      backLabel="Templates"
      onBack={onBack}
      action={<NextButton disabled={!ready} onClick={onNext} />}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sectors.map((s) => {
          const on = setup.sectorId === s.sector_id;
          return (
            <button
              key={s.sector_id}
              type="button"
              aria-pressed={on}
              title={s.description}
              onClick={() => onSetup({ sectorId: s.sector_id })}
              className={choiceClass(on)}
            >
              <span className="flex items-center gap-1.5 text-[16px] font-semibold leading-snug">
                {s.name}
                {on ? <Check className="size-4" strokeWidth={2.6} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <label className="mt-7 flex flex-col gap-2 text-[14px] font-semibold">
        {field.label}
        {field.long ? (
          <Textarea rows={3} maxLength={key === "announcement" ? 700 : 300} value={value} onChange={(e) => onSetup({ [key]: e.target.value })} placeholder={field.placeholder} />
        ) : (
          <Input maxLength={160} value={value} onChange={(e) => onSetup({ [key]: e.target.value })} placeholder={field.placeholder} />
        )}
      </label>
      {field.required && setup.sectorId && !value.trim() ? (
        <p className="m-0 mt-2 text-[13px] text-v-muted-2">This one is needed: the agent says only what you write here.</p>
      ) : null}
    </QuestionFrame>
  );
}

// --- Q2: what should it know ---------------------------------------------------------------

function StatusTag({ status }: { status: string }) {
  return <span className={`text-[12.5px] ${status === "Verified" ? "text-v-ok-ink" : "text-v-warn-ink"}`}>{status}</span>;
}

const PREVIEW_CARDS = 4;

/** The sector's sample cards, each with a tick box; the first few show, the rest open with the "+ N more" row. */
function CardList({
  sector,
  cards,
  total,
  flows,
  excluded,
  first,
  onExcluded,
}: {
  sector: DemoSector;
  cards: DemoCardRow[];
  total: number;
  flows: number;
  excluded: string[];
  first: number;
  onExcluded: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = cards.length > first;
  const shown = open ? cards : cards.slice(0, first);
  const hidden = Math.max(0, total - shown.length);
  const kept = total - cards.filter((c) => excluded.includes(c.card_id)).length;
  const flowText = `${flows} question ${flows === 1 ? "flow" : "flows"}`;
  const toggle = (id: string) => onExcluded(excluded.includes(id) ? excluded.filter((x) => x !== id) : [...excluded, id]);

  let summary: string;
  if (open) summary = `Show fewer · ${kept} of ${total} cards kept`;
  else if (first === 0) summary = `${kept} of ${total} cards and ${flowText} for ${sector.name}`;
  else summary = `+ ${hidden} more ${hidden === 1 ? "card" : "cards"} and ${flowText} for ${sector.name}`;

  return (
    <div className="overflow-hidden rounded-v-xl border border-v-line bg-white">
      {shown.map((c) => {
        const on = !excluded.includes(c.card_id);
        return (
          <label key={c.card_id} className="flex cursor-pointer items-start gap-3 border-b border-v-line px-5 py-3.5 hover:bg-v-soft">
            <input type="checkbox" checked={on} onChange={() => toggle(c.card_id)} className="mt-1 size-4 shrink-0 accent-[var(--v-fg)]" />
            <span className={`flex min-w-0 flex-col gap-0.5 ${on ? "" : "opacity-50"}`}>
              <span className="text-[15px] font-semibold leading-snug">{c.title}</span>
              <span className="text-[12.5px] text-v-muted-2">
                {c.type} · <StatusTag status={c.status} />
              </span>
            </span>
          </label>
        );
      })}
      {canOpen ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-[14px] text-v-muted-2 hover:bg-v-soft hover:text-v-fg"
        >
          {summary}
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
        </button>
      ) : (
        <p className="m-0 px-5 py-3.5 text-[14px] text-v-muted-2">
          {total} {total === 1 ? "card" : "cards"} and {flowText} for {sector.name}
        </p>
      )}
    </div>
  );
}

function KnowledgePanel({
  sector,
  sources,
  setup,
  onSetup,
  compact,
}: {
  sector: DemoSector;
  sources: DemoSources;
  setup: Setup;
  onSetup: (patch: Partial<Setup>) => void;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"" | "upload" | "link">("");
  const [error, setError] = useState("");
  const full = sources.cards.count;
  const rows = sources.cards.items ?? sources.cards.preview;
  const kept = keptCards(setup, sources);
  const allVerified = sources.cards.partly_verified === 0;

  async function add(kind: "upload" | "link", run: () => Promise<AddedSource>) {
    setBusy(kind);
    setError("");
    try {
      const added = await run();
      onSetup({ added: [...setup.added.filter((a) => a.source_id !== added.source_id), added].slice(-3) });
      setLink("");
      setLinkOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {compact ? <Eyebrow>What it knows</Eyebrow> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          aria-pressed={setup.sampleKnowledge}
          onClick={() => onSetup({ sampleKnowledge: !setup.sampleKnowledge })}
          className={choiceClass(setup.sampleKnowledge)}
        >
          <span className="flex items-center gap-1.5 text-[16px] font-semibold">
            Sample knowledge {setup.sampleKnowledge ? <Check className="size-4" strokeWidth={2.6} /> : null}
          </span>
          <span className="text-[13.5px] text-v-muted-2">
            {setup.sampleKnowledge ? kept : full} {allVerified ? "verified " : ""}
            {(setup.sampleKnowledge ? kept : full) === 1 ? "card" : "cards"} · default
          </span>
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== "" || setup.added.length >= 3} className={choiceClass(false)}>
          <span className="flex items-center gap-1.5 text-[16px] font-semibold">
            {busy === "upload" ? <Spinner light={false} /> : <FileText className="size-4" strokeWidth={1.9} />} Upload documents
          </span>
          <span className="text-[13.5px] text-v-muted-2">Optional · PDF, circulars</span>
        </button>
        <button type="button" onClick={() => setLinkOpen((v) => !v)} disabled={busy !== "" || setup.added.length >= 3} className={choiceClass(linkOpen)}>
          <span className="flex items-center gap-1.5 text-[16px] font-semibold">
            {busy === "link" ? <Spinner light={false} /> : <Link2 className="size-4" strokeWidth={1.9} />} Paste a link
          </span>
          <span className="text-[13.5px] text-v-muted-2">Optional · a department page</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void add("upload", () => uploadSource(file));
        }}
      />
      {linkOpen ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) void add("link", () => addLinkSource(link.trim()));
          }}
        >
          <Input type="url" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… a public department page" />
          <Button type="submit" disabled={!link.trim() || busy !== ""}>
            Add
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 rounded-v-md border border-v-danger-line bg-v-danger-pale px-3.5 py-2.5 text-[13.5px] text-v-danger">
          {error}
        </p>
      ) : null}

      {setup.added.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {setup.added.map((a) => (
            <li key={a.source_id} className="flex items-center gap-3 rounded-v-md border border-v-line bg-white px-4 py-3">
              {a.kind === "link" ? <Link2 className="size-4 shrink-0" strokeWidth={1.9} /> : <FileText className="size-4 shrink-0" strokeWidth={1.9} />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14.5px] font-semibold">{a.name}</span>
                <span className="text-[12.5px] text-v-muted-2">
                  {a.card_count} {a.card_count === 1 ? "card" : "cards"} for this session · deleted after the session
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => onSetup({ added: setup.added.filter((x) => x.source_id !== a.source_id) })}
                className="rounded-v-sm p-1.5 text-v-muted-2 hover:bg-v-soft hover:text-v-fg"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {setup.sampleKnowledge ? (
        <CardList
          sector={sector}
          cards={rows}
          total={full}
          flows={sources.flows.length}
          excluded={setup.excludedCards}
          first={compact ? 0 : PREVIEW_CARDS}
          onExcluded={(excludedCards) => onSetup({ excludedCards })}
        />
      ) : null}
      {setup.sampleKnowledge && kept === 0 && !setup.added.length ? (
        <p className="m-0 text-[13.5px] text-v-warn-ink">Tick at least one card, or add a document or link.</p>
      ) : null}
      <p className="m-0 text-[13px] text-v-muted">Only Verified and Partly verified cards are loaded.</p>
    </div>
  );
}

function ServicePicker({ sources, setup, onSetup }: { sources: DemoSources; setup: Setup; onSetup: (patch: Partial<Setup>) => void }) {
  const services = sources.services ?? [];
  const chosen = services.find((s) => s.card_id === setup.serviceCardId);
  if (!services.length) return <p className="m-0 text-[14.5px] text-v-muted-2">No service cards for this sector yet; the agent will use the sector&apos;s knowledge.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {services.map((s) => {
          const on = s.card_id === setup.serviceCardId;
          return (
            <button key={s.card_id} type="button" aria-pressed={on} onClick={() => onSetup({ serviceCardId: s.card_id })} className={choiceClass(on)}>
              <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug">
                {s.title} {on ? <Check className="size-4 shrink-0" strokeWidth={2.6} /> : null}
              </span>
              <StatusTag status={s.status} />
            </button>
          );
        })}
      </div>
      {chosen ? (
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 rounded-v-xl border border-v-line bg-white px-5 py-4 sm:grid-cols-[140px_1fr]">
          {(
            [
              ["Steps", chosen.steps],
              ["Documents", chosen.documents],
              ["Fee and time", chosen.fee_and_time],
              ["Where to go", chosen.where_to_go],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[13.5px] text-v-muted-2">{k}</dt>
                <dd className="m-0 whitespace-pre-line text-[14.5px] leading-relaxed">{v.replace(/\s(?=\d+\.\s)/g, "\n")}</dd>
              </div>
            ))}
        </dl>
      ) : null}
    </div>
  );
}

function ComplaintPicker({ sources, setup, onSetup }: { sources: DemoSources; setup: Setup; onSetup: (patch: Partial<Setup>) => void }) {
  const complaints = sources.complaints ?? [];
  const chosen = setup.complaintFlows ?? complaints.map((c) => c.flow_id);
  if (!complaints.length) {
    return (
      <p className="m-0 rounded-v-xl border border-v-line bg-white px-5 py-4 text-[14.5px] text-v-muted-2">
        Every complaint is taken the same way and goes to {sources.helpline ? `the helpline, ${sources.helpline}` : "the department office"}.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-v-xl border border-v-line bg-white">
      {complaints.map((c) => {
        const on = chosen.includes(c.flow_id);
        return (
          <label key={c.flow_id} className="flex cursor-pointer items-start gap-3 border-b border-v-line px-5 py-4 last:border-b-0">
            <input
              type="checkbox"
              checked={on}
              onChange={() => onSetup({ complaintFlows: on ? chosen.filter((f) => f !== c.flow_id) : [...chosen, c.flow_id] })}
              className="mt-1 size-4 accent-[var(--v-fg)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{c.name}</span>
              <span className="text-[13.5px] text-v-muted-2">Goes to: {c.goes_to}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function SurveyEditor({ setup, onSetup, suggested }: { setup: Setup; onSetup: (patch: Partial<Setup>) => void; suggested: string[] }) {
  const questions = setup.surveyQuestions ?? suggested;
  const set = (next: string[]) => onSetup({ surveyQuestions: next });
  return (
    <div className="flex flex-col gap-2.5">
      {questions.map((q, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 shrink-0 text-right text-[13px] text-v-muted-2">{i + 1}.</span>
          <Input value={q} maxLength={200} onChange={(e) => set(questions.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Question ${i + 1}`} />
          <button
            type="button"
            aria-label={`Remove question ${i + 1}`}
            disabled={questions.length <= 1}
            onClick={() => set(questions.filter((_, j) => j !== i))}
            className="rounded-v-sm p-2 text-v-muted-2 hover:bg-v-soft hover:text-v-fg disabled:opacity-30"
          >
            <Trash2 className="size-4" strokeWidth={1.9} />
          </button>
        </div>
      ))}
      {questions.length < MAX_SURVEY_QUESTIONS ? (
        <button type="button" onClick={() => set([...questions, ""])} className="ml-8 inline-flex items-center gap-1.5 self-start text-[14px] font-semibold text-v-accent hover:text-v-accent-deep">
          <Plus className="size-4" strokeWidth={2} /> Add a question
        </button>
      ) : null}
    </div>
  );
}

export function KnowledgeQuestion({
  template,
  sector,
  sources,
  setup,
  onSetup,
  onBack,
  onNext,
}: {
  template: DemoTemplate;
  sector: DemoSector;
  sources: DemoSources | null;
  setup: Setup;
  onSetup: (patch: Partial<Setup>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const job = jobOf(template.job);
  let body: React.ReactNode = (
    <p className="m-0 flex items-center gap-2 text-[14.5px] text-v-muted-2">
      <Spinner light={false} /> Loading {sector.name} knowledge…
    </p>
  );
  let ready = false;
  if (sources) {
    if (job === "ANSWER") {
      body = <KnowledgePanel sector={sector} sources={sources} setup={setup} onSetup={onSetup} />;
      ready = hasKnowledge(setup, sources);
    } else if (job === "GUIDE") {
      body = (
        <div className="flex flex-col gap-8">
          <ServicePicker sources={sources} setup={setup} onSetup={onSetup} />
          <KnowledgePanel sector={sector} sources={sources} setup={setup} onSetup={onSetup} compact />
        </div>
      );
      ready = (!(sources.services ?? []).length || Boolean(setup.serviceCardId)) && hasKnowledge(setup, sources);
    } else if (job === "RESOLVE") {
      body = (
        <div className="flex flex-col gap-8">
          <ComplaintPicker sources={sources} setup={setup} onSetup={onSetup} />
          <KnowledgePanel sector={sector} sources={sources} setup={setup} onSetup={onSetup} compact />
        </div>
      );
      const offered = (sources.complaints ?? []).length;
      ready = (!offered || (setup.complaintFlows ?? ["all"]).length > 0) && hasKnowledge(setup, sources);
    } else if (job === "INFORM") {
      body = (
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-[14px] font-semibold">
            Who should hear it, and where?
            <Textarea rows={2} maxLength={200} value={setup.audience} onChange={(e) => onSetup({ audience: e.target.value })} placeholder="e.g. Residents of Ward 42" />
          </label>
          <div className="rounded-v-xl bg-v-soft px-5 py-4">
            <Eyebrow>The announcement</Eyebrow>
            <p className="m-0 mt-1.5 text-[15px] leading-relaxed">{setup.announcement}</p>
          </div>
        </div>
      );
      ready = true;
    } else if (job === "REMIND") {
      const options = [
        { id: "reschedule" as const, title: "Offer a new date", note: "The agent notes a date that suits them." },
        { id: "helpline" as const, title: "Give the helpline", note: sources.helpline ? `${sources.helpline}` : "The department office" },
      ];
      body = (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {options.map((o) => (
            <button key={o.id} type="button" aria-pressed={setup.ifCantMakeIt === o.id} onClick={() => onSetup({ ifCantMakeIt: o.id })} className={choiceClass(setup.ifCantMakeIt === o.id)}>
              <span className="flex items-center gap-1.5 text-[16px] font-semibold">
                {o.title} {setup.ifCantMakeIt === o.id ? <Check className="size-4" strokeWidth={2.6} /> : null}
              </span>
              <span className="text-[13.5px] text-v-muted-2">{o.note}</span>
            </button>
          ))}
        </div>
      );
      ready = true;
    } else {
      const suggested = sources.survey?.questions ?? [];
      body = <SurveyEditor setup={setup} onSetup={onSetup} suggested={suggested} />;
      ready = (setup.surveyQuestions ?? suggested).some((q) => q.trim());
    }
  }

  return (
    <QuestionFrame
      index={2}
      template={template}
      title={template.q2}
      note={COPY[job].q2Note(sector.name)}
      onBack={onBack}
      action={<NextButton disabled={!ready} onClick={onNext} />}
    >
      {body}
    </QuestionFrame>
  );
}

// --- Q3: which language -------------------------------------------------------------------

export function LanguageQuestion({
  template,
  catalogue,
  selected,
  onChange,
  onBack,
  onNext,
}: {
  template: DemoTemplate;
  catalogue: TryCatalogue;
  selected: string | null;
  onChange: (code: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [showAll, setShowAll] = useState(() => catalogue.languages.findIndex((l) => l.code === selected) >= FIRST_LANGUAGES);
  const shown = showAll ? catalogue.languages : catalogue.languages.slice(0, FIRST_LANGUAGES);
  const selectedReady = canCall(catalogue.languages.find((l) => l.code === selected));
  const noneReady = !catalogue.languages.some(canCall);
  const allReady = catalogue.languages.every(canCall);

  return (
    <QuestionFrame
      index={3}
      template={template}
      title="Which language should it speak?"
      note={`You'll talk to it in this language on the test call.${allReady ? ` All ${catalogue.languages.length} languages are supported by the fixed voice stack.` : ""}`}
      onBack={onBack}
      action={<NextButton disabled={!selectedReady} onClick={onNext} label="Create my agent" />}
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
              <span className="text-[14px] text-v-muted-2">
                {l.name}
                {l.beta ? " · beta" : ""}
                {ready ? "" : " · not available yet"}
              </span>
            </button>
          );
        })}
      </div>
      {noneReady ? (
        <p role="status" className="m-0 mt-6 text-[14px] text-v-danger">
          Test calls aren&apos;t available right now. Please check back soon.
        </p>
      ) : null}
      {!showAll && catalogue.languages.length > FIRST_LANGUAGES ? (
        <button type="button" onClick={() => setShowAll(true)} className="mt-6 text-[14px] font-semibold text-v-accent hover:text-v-accent-deep">
          Show all {catalogue.languages.length} languages
        </button>
      ) : null}
    </QuestionFrame>
  );
}
