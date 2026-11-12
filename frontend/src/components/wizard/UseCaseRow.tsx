"use client";

import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, Plus, RefreshCw, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { OUTCOME_LABELS, OutcomeBadge } from "@/components/ui/CallOutcomeBadge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogHeader } from "@/components/ui/Dialog";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { PdfPreviewSheet } from "@/components/knowledge/PdfPreviewSheet";
import { Spinner } from "@/components/ui/Spinner";
import { InfoTip } from "@/components/ui/Tooltip";
import { usePermissions } from "@/components/PermissionsProvider";
import { useUseCaseCatalogue } from "@/hooks/useUseCaseCatalogue";
import {
  addCustomScheme,
  deleteCustomScheme,
  fetchKnowledgePack,
  getUseCasePreset,
  schemeLimitLabel,
  type CustomSchemeInput,
  type IntentInfo,
  type Scheme,
  type SchemeKind,
  type Survey,
  type SurveyQuestion,
} from "@/lib/api/use-cases";
import type { AgentUseCase, CallOutcome, SchemeIntent } from "@/lib/api-types";
import { DepartmentSchemePicker } from "@/components/wizard/DepartmentSchemePicker";
import { AGENT_NAME_MAX_LENGTH, DEFAULT_FORM, type AgentForm } from "@/lib/wizard-data";

export const SURVEY_KIND_LABEL: Record<SurveyQuestion["kind"], string> = {
  rating: "Rating 1–5",
  yes_no: "Yes or no",
  open: "Open answer",
};

// Prompts "Write the agent for me" produced this session. Module-level, not
// component state: the Agent step unmounts when the user moves on, and coming
// back shouldn't then ask before replacing text they never touched.
const writtenPrompts = new Set<string>();

/** "2026-10-02" → "2 Oct 2026"; anything unparseable is shown as sent. */
function formatChecked(value: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function hrefFor(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function hostOf(url: string): string {
  try {
    return new URL(hrefFor(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

interface UseCaseRowProps {
  form: AgentForm;
  onChange: <K extends keyof AgentForm>(key: K, value: AgentForm[K]) => void;
  onNotify: (title: string, note: string) => void;
}

const NEW_INTENTS: SchemeIntent[] = ["awareness", "discovery", "enrolment"];
const EXISTING_INTENTS: SchemeIntent[] = ["utilisation", "support", "feedback"];
const INTENT_FALLBACK_NAME: Record<SchemeIntent, string> = {
  awareness: "Awareness",
  discovery: "Discovery",
  enrolment: "Enrolment",
  utilisation: "Utilisation",
  support: "Support",
  feedback: "Feedback",
};

/** Top of the Agent step: what the agent is for (a scheme intent or a city
 * survey), which schemes / survey, and a button that writes the name,
 * greeting and prompt from the server's ready-made text. Everything it fills
 * in stays editable below. */
export function UseCaseRow({ form, onChange, onNotify }: UseCaseRowProps) {
  const { can } = usePermissions();
  const canWrite = can("agents:write");
  const { catalogue, loading, error, reload, addScheme, removeScheme } = useUseCaseCatalogue();
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<Scheme | null>(null);
  const [viewing, setViewing] = useState<{ name: string; blob?: Blob } | null>(null);

  const useCase = form.useCase;
  const schemes = useMemo(() => catalogue?.schemes ?? [], [catalogue]);
  const surveys = catalogue?.surveys ?? [];
  const intent = useCase?.type === "scheme" ? (useCase.intent ?? "discovery") : null;
  const intentInfo = intent ? catalogue?.intents.find((i) => i.id === intent) : undefined;
  // Until the catalogue loads, assume the strictest limit the intent could have.
  const maxSchemes = intent ? (intentInfo ? intentInfo.max_schemes : intent === "discovery" ? null : 1) : null;
  const intentName = (id: SchemeIntent) => catalogue?.intents.find((i) => i.id === id)?.name ?? INTENT_FALLBACK_NAME[id];

  const setUseCase = (next: AgentUseCase | null) => {
    setWriteError("");
    onChange("useCase", next);
  };

  function setType(value: string) {
    if (!value) {
      // Free-form: only the label goes — whatever text is in the form stays.
      setUseCase(null);
      return;
    }
    if (value === "city_survey") {
      if (useCase?.type !== "city_survey") setUseCase({ type: "city_survey", intent: null, scheme_ids: [], survey_id: null });
      return;
    }
    const next = value.replace("scheme:", "") as SchemeIntent;
    if (intent === next) return;
    const limit = catalogue?.intents.find((i) => i.id === next)?.max_schemes ?? (next === "discovery" ? null : 1);
    const kept = useCase?.type === "scheme" ? useCase.scheme_ids : [];
    setUseCase({ type: "scheme", intent: next, scheme_ids: limit ? kept.slice(0, limit) : kept, survey_id: null });
  }

  const setSchemeIds = (ids: string[]) =>
    setUseCase({ type: "scheme", intent: intent ?? "discovery", scheme_ids: ids, survey_id: null });

  const selectedSchemes = useMemo(
    () =>
      (useCase?.type === "scheme" ? useCase.scheme_ids : [])
        .map((id) => schemes.find((s) => s.id === id))
        .filter((s): s is Scheme => Boolean(s)),
    [useCase, schemes],
  );
  const missingSchemes =
    catalogue && useCase?.type === "scheme" ? useCase.scheme_ids.length - selectedSchemes.length : 0;

  const survey = useCase?.type === "city_survey" ? surveys.find((s) => s.id === useCase.survey_id) : undefined;
  const feedbackSurvey =
    intent === "feedback" && selectedSchemes[0]
      ? catalogue?.feedback_surveys.find((f) => f.scheme_id === selectedSchemes[0].id)
      : undefined;

  const promptEdited =
    form.prompt.trim() !== "" && form.prompt !== DEFAULT_FORM.prompt && !writtenPrompts.has(form.prompt);

  async function writeAgent() {
    if (!useCase) return;
    setConfirmReplace(false);
    setWriting(true);
    setWriteError("");
    try {
      const preset = await getUseCasePreset(useCase);
      writtenPrompts.add(preset.prompt);
      onChange("name", preset.name.slice(0, AGENT_NAME_MAX_LENGTH));
      onChange("purpose", preset.purpose);
      onChange("welcome", preset.welcome);
      onChange("prompt", preset.prompt);
      onNotify(
        "Agent written",
        preset.knowledge?.length
          ? "Name, greeting and prompt are filled in, with the scheme knowledge built in. Change anything you like."
          : "Name, greeting and prompt are filled in. Change anything you like.",
      );
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Couldn't write the agent.");
    } finally {
      setWriting(false);
    }
  }

  const selectValue = !useCase ? "" : useCase.type === "city_survey" ? "city_survey" : `scheme:${intent}`;

  return (
    <div className="flex flex-col gap-4 rounded-v-md border border-v-line bg-white p-5">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          Use case
          <InfoTip text="Pick what the agent is for, then let VoicEra write the prompt. You can still edit it." />
        </span>
        <Select className="sm:max-w-80" value={selectValue} onChange={(e) => setType(e.target.value)}>
          {/* ui/Select flattens <optgroup>, so the group goes in each label. */}
          {[...NEW_INTENTS, ...EXISTING_INTENTS].map((id) => (
            <option key={id} value={`scheme:${id}`}>
              Scheme agent · {intentName(id)}
            </option>
          ))}
          <option value="city_survey">City feedback survey</option>
          <option value="">None (free-form agent)</option>
        </Select>
        {!useCase ? (
          <span className="text-xs font-light text-v-muted">You write the greeting and prompt yourself below.</span>
        ) : null}
      </div>

      {intentInfo ? <IntentSummary intent={intentInfo} all={catalogue?.intents ?? []} /> : null}

      {useCase && loading ? (
        <p className="flex items-center gap-2 text-[13px] font-light text-v-muted">
          <Spinner light={false} /> Getting schemes and surveys…
        </p>
      ) : null}

      {useCase && error && !catalogue ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-v-danger">
          {error}
          <Button type="button" size="sm" variant="ghost" onClick={() => void reload()}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            Try again
          </Button>
        </p>
      ) : null}

      {useCase?.type === "scheme" && catalogue ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              {maxSchemes === 1 ? "Scheme" : "Schemes"}
              <span className="font-mono text-[10px] font-normal uppercase tracking-[.1em] text-v-muted">
                {schemeLimitLabel(maxSchemes)}
              </span>
            </span>
            {canWrite ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" strokeWidth={1.9} />
                Add your own scheme
              </Button>
            ) : null}
          </div>

          <DepartmentSchemePicker
            schemes={schemes}
            selectedIds={useCase.scheme_ids}
            max={maxSchemes}
            onChange={setSchemeIds}
            onRemoveCustom={canWrite ? setRemoving : undefined}
          />

          {missingSchemes > 0 ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-v-warn-ink">
              {missingSchemes} picked {missingSchemes === 1 ? "scheme is" : "schemes are"} no longer available.
              <button
                type="button"
                className="cursor-pointer font-semibold underline"
                onClick={() => setSchemeIds(selectedSchemes.map((s) => s.id))}
              >
                Remove
              </button>
            </p>
          ) : null}

          {selectedSchemes.length > 0 ? (
            <BuiltInKnowledge
              schemes={selectedSchemes}
              onView={async (scheme) => {
                setViewing({ name: scheme.pack_name });
                try {
                  setViewing({ name: scheme.pack_name, blob: await fetchKnowledgePack(scheme.id) });
                } catch (err) {
                  setViewing(null);
                  onNotify("Couldn't open the pack", err instanceof Error ? err.message : "Something went wrong.");
                }
              }}
            />
          ) : null}

          {intent === "feedback" && feedbackSurvey ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">
                Questions the agent asks
              </span>
              <SurveyPreview survey={feedbackSurvey} />
            </div>
          ) : selectedSchemes.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">
                What the agent will say
              </span>
              {selectedSchemes.map((s) => (
                <SchemePreview key={s.id} scheme={s} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {useCase?.type === "city_survey" && catalogue ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Survey
            <Select
              value={useCase.survey_id ?? ""}
              onChange={(e) =>
                setUseCase({ type: "city_survey", intent: null, scheme_ids: [], survey_id: e.target.value || null })
              }
            >
              <option value="">Pick a survey</option>
              {surveys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          {survey ? <SurveyPreview survey={survey} /> : null}
        </div>
      ) : null}

      {useCase ? (
        <div className="flex flex-col gap-2 border-t border-v-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={writing}
              onClick={() => (promptEdited ? setConfirmReplace(true) : void writeAgent())}
            >
              {writing ? <Spinner /> : <WandSparkles className="size-4" strokeWidth={1.8} />}
              Write the agent for me
            </Button>
            <span className="text-xs font-light text-v-muted">Fills in the name, greeting and prompt below.</span>
          </div>
          {writeError ? (
            <p className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-3.5 py-2.5 text-[13px] text-v-danger">
              {writeError}
            </p>
          ) : null}
        </div>
      ) : null}

      {addOpen ? (
        <AddSchemeDialog
          kinds={catalogue?.kinds ?? []}
          onClose={() => setAddOpen(false)}
          onAdded={(scheme) => {
            addScheme(scheme);
            const current = useCase?.type === "scheme" ? useCase.scheme_ids : [];
            // A one-scheme agent switches to the new scheme; others add it if there's room.
            const next = maxSchemes === 1 ? [scheme.id] : [...current, scheme.id];
            const fits = !maxSchemes || next.length <= maxSchemes;
            if (fits) setSchemeIds(next);
            setAddOpen(false);
            onNotify(
              "Scheme added",
              fits ? `${scheme.name} is in your list and selected.` : `${scheme.name} is in your list. Remove a scheme to pick it.`,
            );
          }}
        />
      ) : null}

      {removing ? (
        <RemoveSchemeDialog
          scheme={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            removeScheme(removing.id);
            if (useCase?.type === "scheme" && useCase.scheme_ids.includes(removing.id)) {
              setSchemeIds(useCase.scheme_ids.filter((id) => id !== removing.id));
            }
            setRemoving(null);
          }}
        />
      ) : null}

      <PdfPreviewSheet file={viewing} onClose={() => setViewing(null)} />

      {confirmReplace ? (
        <Dialog open onClose={() => setConfirmReplace(false)} widthClassName="max-w-sm">
          <DialogHeader title="Replace your prompt?" onClose={() => setConfirmReplace(false)} />
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm font-light leading-relaxed text-v-fg">
              You&apos;ve changed the prompt. Writing the agent replaces the name, greeting and prompt with new text.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmReplace(false)}>
                Keep mine
              </Button>
              <Button size="sm" onClick={() => void writeAgent()}>
                Replace
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/** What a scheme intent's agent does on the call, the paths it can switch
 * to, and what it records. */
function IntentSummary({ intent, all }: { intent: IntentInfo; all: IntentInfo[] }) {
  const recorded = intent.outcomes.filter((o): o is CallOutcome => o in OUTCOME_LABELS && o !== "no_answer");
  const others = all.filter((i) => i.id !== intent.id);
  return (
    <div className="flex flex-col gap-2.5 rounded-v-md border border-v-line bg-v-soft/40 p-3.5">
      <span className="text-[13px] font-semibold">{intent.name}</span>
      <p className="m-0 text-[12.5px] font-light leading-relaxed text-v-muted">{intent.description}</p>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-4.5 text-[12.5px] leading-snug text-v-fg">
        {intent.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {others.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-v-hairline pt-2.5">
          <span className="text-[11.5px] text-v-muted">Switches mid-call when the person needs</span>
          {others.map((i) => (
            <Badge key={i.id} tone="neutral">
              {i.name}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-v-hairline pt-2.5">
        <span className="text-[11.5px] text-v-muted">Calls usually end as</span>
        {recorded.map((o) => (
          <OutcomeBadge key={o} outcome={o} />
        ))}
      </div>
    </div>
  );
}

/** The picked schemes' built-in knowledge packs: written into the prompt, nothing to upload. */
function BuiltInKnowledge({ schemes, onView }: { schemes: Scheme[]; onView: (scheme: Scheme) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-v-md border border-v-line bg-white p-3.5">
      <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
        <BookOpen className="size-4 text-v-accent" strokeWidth={1.8} />
        Knowledge base
        <Badge tone="live">Built in</Badge>
      </span>
      <ul className="m-0 flex flex-col gap-1 p-0">
        {schemes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span className="min-w-0 truncate">{s.pack_name}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => onView(s)}>
              View
            </Button>
          </li>
        ))}
      </ul>
      <span className="text-xs font-light text-v-muted">
        One pack per scheme, covering all six paths. It&apos;s written into the agent when you press Write the agent
        for me. Nothing to upload.
      </span>
    </div>
  );
}

/** Only the catalogue's own fields — nothing here is written by the UI. */
function SchemePreview({ scheme }: { scheme: Scheme }) {
  const rows: [string, string][] = [
    ["Benefit", scheme.benefit],
    ["Who can get it", scheme.eligibility],
    ["How to apply", scheme.how_to_apply],
  ];
  return (
    <div className="flex flex-col gap-2 rounded-v-md border border-v-line bg-white p-3.5">
      <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
        {scheme.name}
        {scheme.custom ? <Badge tone="accent">Your scheme</Badge> : null}
      </span>
      <dl className="m-0 grid grid-cols-1 gap-x-3 gap-y-1 text-[12.5px] leading-relaxed sm:grid-cols-[110px_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-v-muted">{k}</dt>
              <dd className="m-0 mb-1 text-v-fg sm:mb-0">{v}</dd>
            </div>
          ))}
        {scheme.website ? (
          <div className="contents">
            <dt className="text-v-muted">Website</dt>
            <dd className="m-0">
              <a
                href={hrefFor(scheme.website)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-v-accent hover:underline"
              >
                {hostOf(scheme.website)}
                <ExternalLink className="size-3" strokeWidth={1.9} />
              </a>
            </dd>
          </div>
        ) : null}
        {scheme.helpline ? (
          <div className="contents">
            <dt className="text-v-muted">Helpline</dt>
            <dd className="m-0 text-v-fg">{scheme.helpline}</dd>
          </div>
        ) : null}
      </dl>
      {scheme.sources.length > 0 ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-v-hairline pt-2 text-[11.5px] text-v-muted">
          {scheme.last_checked ? `Facts checked ${formatChecked(scheme.last_checked)} from official sources:` : "Sources:"}
          {scheme.sources.map((src) => (
            <a
              key={src}
              href={hrefFor(src)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-v-accent hover:underline"
            >
              {hostOf(src)}
              <ExternalLink className="size-2.5" strokeWidth={2} />
            </a>
          ))}
        </p>
      ) : scheme.custom ? (
        <p className="m-0 border-t border-v-hairline pt-2 text-[11.5px] text-v-muted">
          Added by your team. The agent says what was entered here.
        </p>
      ) : null}
    </div>
  );
}

function SurveyPreview({ survey }: { survey: Survey }) {
  return (
    <div className="flex flex-col gap-2 rounded-v-md border border-v-line bg-white p-3.5">
      {survey.topic ? <span className="text-[12.5px] font-light text-v-muted">{survey.topic}</span> : null}
      <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">
        {survey.questions.length} {survey.questions.length === 1 ? "question" : "questions"}
      </span>
      <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-4.5 text-[13px] leading-snug">
        {survey.questions.map((q) => (
          <li key={q.id}>
            <span className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0 flex-1">{q.text}</span>
              <span className="shrink-0 text-xs text-v-muted">{SURVEY_KIND_LABEL[q.kind] ?? q.kind}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --- Custom scheme dialogs -------------------------------------------------------

const EMPTY_SCHEME = {
  name: "",
  category: "",
  summary: "",
  benefit: "",
  eligibility: "",
  how_to_apply: "",
  website: "",
  helpline: "",
  kind: "other",
  documents: "",
  questions: "",
  sources: "",
};

function AddSchemeDialog({
  kinds,
  onClose,
  onAdded,
}: {
  kinds: SchemeKind[];
  onClose: () => void;
  onAdded: (scheme: Scheme) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_SCHEME);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (key: keyof typeof EMPTY_SCHEME) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const ready = Boolean(
    draft.name.trim() && draft.benefit.trim() && draft.eligibility.trim() && draft.how_to_apply.trim(),
  );

  async function save() {
    setSaving(true);
    setError("");
    const input: CustomSchemeInput = {
      name: draft.name.trim(),
      benefit: draft.benefit.trim(),
      eligibility: draft.eligibility.trim(),
      how_to_apply: draft.how_to_apply.trim(),
      kind: draft.kind,
      ...(draft.category.trim() ? { category: draft.category.trim() } : {}),
      ...(draft.summary.trim() ? { summary: draft.summary.trim() } : {}),
      ...(draft.website.trim() ? { website: draft.website.trim() } : {}),
      ...(draft.helpline.trim() ? { helpline: draft.helpline.trim() } : {}),
      documents: lines(draft.documents),
      questions: lines(draft.questions),
      sources: lines(draft.sources),
    };
    try {
      onAdded(await addCustomScheme(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the scheme.");
    } finally {
      setSaving(false);
    }
  }

  const field = "flex flex-col gap-1.5 text-[13px] font-semibold";
  const hint = "text-[11px] font-normal text-v-muted";

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-xl">
      <DialogHeader
        title="Add your own scheme"
        subtitle="A state or city scheme. The agent only says what you enter here."
        onClose={onClose}
      />
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={field}>
            Name *
            <Input value={draft.name} onChange={set("name")} placeholder="e.g. Mukhyamantri Pension Yojana" />
          </label>
          <label className={field}>
            Category
            <Input value={draft.category} onChange={set("category")} placeholder="e.g. Pension" />
          </label>
        </div>
        <label className={field}>
          <span>
            How people get the benefit{" "}
            <span className={hint}>· shapes the Utilisation, Support and Feedback agents</span>
          </span>
          <Select value={draft.kind} onChange={set("kind")}>
            {(kinds.length ? kinds : [{ id: "other", label: "Other" }]).map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
        </label>
        <label className={field}>
          One-line summary
          <Input value={draft.summary} onChange={set("summary")} />
        </label>
        <label className={field}>
          Benefit *
          <Textarea rows={2} value={draft.benefit} onChange={set("benefit")} />
        </label>
        <label className={field}>
          Who can get it *
          <Textarea rows={2} value={draft.eligibility} onChange={set("eligibility")} />
        </label>
        <label className={field}>
          How to apply *
          <Textarea rows={2} value={draft.how_to_apply} onChange={set("how_to_apply")} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={field}>
            Website
            <Input value={draft.website} onChange={set("website")} placeholder="https://…" />
          </label>
          <label className={field}>
            Helpline
            <Input value={draft.helpline} onChange={set("helpline")} />
          </label>
        </div>
        <label className={field}>
          <span>
            Documents needed <span className={hint}>· one per line</span>
          </span>
          <Textarea rows={2} value={draft.documents} onChange={set("documents")} />
        </label>
        <label className={field}>
          <span>
            Questions to check eligibility <span className={hint}>· one per line</span>
          </span>
          <Textarea rows={2} value={draft.questions} onChange={set("questions")} />
        </label>
        <label className={field}>
          <span>
            Official sources <span className={hint}>· one link per line</span>
          </span>
          <Textarea rows={2} value={draft.sources} onChange={set("sources")} />
        </label>

        {error ? (
          <p className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-3.5 py-2.5 text-sm text-v-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready || saving} title={ready ? undefined : "Fill in the fields marked *"} onClick={save}>
            {saving ? <Spinner /> : null}
            Add scheme
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RemoveSchemeDialog({
  scheme,
  onClose,
  onRemoved,
}: {
  scheme: Scheme;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await deleteCustomScheme(scheme.id);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the scheme.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-sm">
      <DialogHeader title="Remove scheme?" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm font-light leading-relaxed text-v-fg">
          Remove <strong className="font-semibold">{scheme.name}</strong> from your organisation&apos;s list? New
          agents can&apos;t pick it any more. This can&apos;t be undone.
        </p>
        {error ? (
          <p className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-3.5 py-2.5 text-sm text-v-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger-outline" size="sm" disabled={busy} onClick={confirm}>
            {busy ? <Spinner light={false} /> : null}
            Remove
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
