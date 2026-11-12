"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Compass, Sparkles } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { usePermissions } from "@/components/PermissionsProvider";
import { BrowserCallSession } from "@/components/call/BrowserCallSession";
import { PdfPreviewSheet } from "@/components/knowledge/PdfPreviewSheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { AgentStackFields } from "@/components/wizard/AgentStackFields";
import { DepartmentSchemePicker } from "@/components/wizard/DepartmentSchemePicker";
import { useUseCaseCatalogue } from "@/hooks/useUseCaseCatalogue";
import { formToAgentCreatePayload } from "@/lib/agent-mapper";
import { createAgent } from "@/lib/api-client";
import { fetchKnowledgePack, getUseCasePreset, type Scheme } from "@/lib/api/use-cases";
import type { AgentApiResponse } from "@/lib/api-types";
import { useWizardCatalogs } from "@/lib/use-wizard-catalogs";
import { useWizardDefaults } from "@/lib/use-wizard-defaults";
import { AGENT_NAME_MAX_LENGTH, DEFAULT_FORM, type AgentForm } from "@/lib/wizard-data";

const STEPS = ["Schemes", "Your agent", "Language", "Ready"] as const;

/** The first agent an organisation builds: department → schemes → the agent
 * written for them → a language → test it. Every technical setting (speech,
 * AI model, voice, timeouts) takes the same best default the full wizard
 * would pick; all of it can be changed later on the agent's page. */
export function QuickAgentFlow({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const router = useRouter();
  const { session } = useAuth();
  const { can } = usePermissions();
  const { catalogue, loading: catalogueLoading, error: catalogueError } = useUseCaseCatalogue();
  const [step, setStep] = useState(0);
  // Browser-tested first; a phone number can be attached once it sounds right.
  const [form, setForm] = useState<AgentForm>({ ...DEFAULT_FORM, delivery: "" });
  const [schemeIds, setSchemeIds] = useState<string[]>([]);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [writtenFor, setWrittenFor] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [agent, setAgent] = useState<AgentApiResponse | null>(null);
  const [viewing, setViewing] = useState<{ name: string; blob?: Blob } | null>(null);

  const catalogs = useWizardCatalogs(form.langs, form.sttProvider, form.ttsProvider, form.llmProvider);
  useWizardDefaults(form, setForm, catalogs);

  const onChange = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const schemes = catalogue?.schemes ?? [];
  const picked = schemeIds.map((id) => schemes.find((s) => s.id === id)).filter((s): s is Scheme => Boolean(s));
  const discovery = catalogue?.intents.find((i) => i.id === "discovery");
  const otherPaths = (catalogue?.intents ?? []).filter((i) => i.id !== "discovery").map((i) => i.name);

  async function writeAgent() {
    const key = schemeIds.join(",");
    setStep(1);
    if (key === writtenFor) return;
    setWriting(true);
    setWriteError("");
    try {
      const preset = await getUseCasePreset({ type: "scheme", intent: "discovery", scheme_ids: schemeIds, survey_id: null });
      setForm((f) => ({
        ...f,
        name: preset.name.slice(0, AGENT_NAME_MAX_LENGTH),
        purpose: preset.purpose,
        welcome: preset.welcome,
        prompt: preset.prompt,
        useCase: preset.use_case,
      }));
      setWrittenFor(key);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Couldn't write the agent.");
    } finally {
      setWriting(false);
    }
  }

  async function create() {
    setCreating(true);
    setCreateError("");
    try {
      const created = await createAgent(formToAgentCreatePayload(form, catalogs));
      setAgent(created);
      setStep(3);
      onNotify("Agent created", `${created.name} is ready to test.`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create the agent.");
    } finally {
      setCreating(false);
    }
  }

  async function viewPack(s: Scheme) {
    setViewing({ name: s.pack_name });
    try {
      setViewing({ name: s.pack_name, blob: await fetchKnowledgePack(s.id) });
    } catch (err) {
      setViewing(null);
      onNotify("Couldn't open the pack", err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const providerName = (list: Record<string, { name: string }>, id: string) => list[id]?.name ?? id;
  const missingEngines = [
    !form.sttProvider && "speech recognition",
    !form.llmProvider && "AI model",
    !form.ttsProvider && "voice",
  ].filter(Boolean) as string[];
  const engineReady = !catalogs.loading && missingEngines.length === 0 && form.langs.length > 0 && Boolean(form.llmModel);

  return (
    <main className="flex w-full flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 py-6">
        {/* Header + progress */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-v-dim">Your first agent</span>
              <h1 className="text-[28px] font-semibold tracking-tight">Build your scheme discovery agent</h1>
            </div>
            {step < 3 ? (
              <Link href="/agent-creation?full=1" className="text-[12.5px] font-medium text-v-muted hover:text-v-accent">
                Use the full setup instead
              </Link>
            ) : null}
          </div>
          <ol className="m-0 grid list-none grid-cols-4 gap-2 p-0" aria-label="Progress">
            {STEPS.map((label, i) => (
              <li key={label} className="flex flex-col gap-1.5">
                <span className={`h-1 rounded-full ${i <= step ? "bg-v-accent" : "bg-v-track"}`} />
                <span className={`text-[12px] ${i === step ? "font-semibold text-v-fg" : "text-v-muted"}`}>
                  {i + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* 1. Department → schemes */}
        {step === 0 ? (
          <section className="flex flex-col gap-4 animate-v-rise">
            <div className="flex flex-col gap-1">
              <h2 className="text-[19px] font-semibold tracking-tight">Which schemes should your agent explain?</h2>
              <p className="max-w-[64ch] text-[13.5px] font-light leading-relaxed text-v-muted">
                Pick a department, then its schemes. You can pick schemes from several departments; the agent works
                out which ones fit each caller.
              </p>
            </div>
            {catalogueLoading && !catalogue ? (
              <p className="flex items-center gap-2 text-sm text-v-muted">
                <Spinner light={false} /> Getting schemes…
              </p>
            ) : catalogueError && !catalogue ? (
              <p className="text-sm text-v-danger">{catalogueError}</p>
            ) : (
              <DepartmentSchemePicker schemes={schemes} selectedIds={schemeIds} max={discovery?.max_schemes ?? null} onChange={setSchemeIds} />
            )}
            <div className="flex items-center justify-end gap-3 border-t border-v-line pt-4">
              <span className="text-xs text-v-muted">
                {picked.length ? `${picked.length} ${picked.length === 1 ? "scheme" : "schemes"} picked` : "Pick at least one scheme"}
              </span>
              <Button disabled={picked.length === 0} onClick={() => void writeAgent()}>
                Write my agent
                <ArrowRight className="size-4" strokeWidth={1.9} />
              </Button>
            </div>
          </section>
        ) : null}

        {/* 2. The agent, written for them */}
        {step === 1 ? (
          <section className="flex flex-col gap-4 animate-v-rise">
            {writing ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-v-md border border-v-line bg-white">
                <Spinner light={false} />
                <span className="text-sm font-semibold">Writing your agent…</span>
                <span className="text-xs text-v-muted">Greeting, call script and scheme knowledge</span>
              </div>
            ) : writeError ? (
              <div className="flex flex-col items-start gap-3 rounded-v-md border border-v-danger-line bg-v-danger-pale p-4 text-sm text-v-danger">
                {writeError}
                <Button size="sm" variant="outline" onClick={() => void writeAgent()}>
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 rounded-v-md border border-v-line bg-white p-5">
                  <span className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-full bg-v-accent text-white">
                      <Compass className="size-[18px]" strokeWidth={1.8} />
                    </span>
                    <span className="flex flex-col">
                      <span className="text-[15px] font-semibold">Discovery agent</span>
                      <span className="text-[12.5px] font-light text-v-muted">
                        {discovery?.description ?? "Finds which schemes may fit the family, and how to apply."}
                      </span>
                    </span>
                  </span>
                  {otherPaths.length ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-v-muted">
                      Switches mid-call when someone needs
                      {otherPaths.map((p) => (
                        <Badge key={p} tone="neutral">
                          {p}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_280px]">
                  <div className="flex flex-col gap-4 rounded-v-md border border-v-line bg-white p-5">
                    <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                      Agent name
                      <Input
                        value={form.name}
                        maxLength={AGENT_NAME_MAX_LENGTH}
                        onChange={(e) => onChange("name", e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                      First thing it says
                      <Textarea rows={3} value={form.welcome} onChange={(e) => onChange("welcome", e.target.value)} />
                    </label>
                    <details className="group rounded-v-sm border border-v-line bg-v-soft/40 px-3.5 py-2.5">
                      <summary className="cursor-pointer text-[13px] font-medium text-v-muted-2">See the full call script</summary>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-v-body">
                        {form.prompt}
                      </pre>
                      <span className="text-[11.5px] text-v-muted">You can edit it later on the agent&apos;s page.</span>
                    </details>
                  </div>
                  <div className="flex flex-col gap-2.5 rounded-v-md border border-v-line bg-white p-4">
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                      <BookOpen className="size-4 text-v-accent" strokeWidth={1.8} />
                      Knowledge
                      <Badge tone="live">Built in</Badge>
                    </span>
                    {picked.map((s) => (
                      <span key={s.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <span className="min-w-0 truncate">{s.name}</span>
                        <Button size="sm" variant="ghost" onClick={() => void viewPack(s)}>
                          View
                        </Button>
                      </span>
                    ))}
                    <span className="text-[11.5px] font-light leading-relaxed text-v-muted">
                      Checked against official sources. Nothing to upload.
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-v-line pt-4">
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    <ArrowLeft className="size-4" strokeWidth={1.9} />
                    Schemes
                  </Button>
                  <Button disabled={!form.name.trim()} onClick={() => setStep(2)}>
                    Next: language
                    <ArrowRight className="size-4" strokeWidth={1.9} />
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {/* 3. Language only; engines chosen for them */}
        {step === 2 ? (
          <section className="flex flex-col gap-4 animate-v-rise">
            <div className="flex flex-col gap-1">
              <h2 className="text-[19px] font-semibold tracking-tight">Which language should it speak?</h2>
              <p className="max-w-[64ch] text-[13.5px] font-light leading-relaxed text-v-muted">
                Pick the language your callers use. We choose the best speech recognition, AI model and voice for it.
              </p>
            </div>
            {catalogs.loading ? (
              <p className="flex items-center gap-2 text-sm text-v-muted">
                <Spinner light={false} /> Getting languages…
              </p>
            ) : (
              <AgentStackFields
                value={form}
                onChange={(key, value) => onChange(key, value as AgentForm[typeof key])}
                catalogs={catalogs}
                sections={["languages"]}
              />
            )}

            {!catalogs.loading ? (
              missingEngines.length ? (
                <p className="flex items-start gap-2 rounded-v-md border border-v-warn-tint bg-v-warn-tint px-3.5 py-3 text-[13px] text-v-warn-ink">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  <span>
                    No{" "}
                    {missingEngines.length > 1
                      ? `${missingEngines.slice(0, -1).join(", ")} or ${missingEngines.at(-1)}`
                      : missingEngines[0]}{" "}
                    provider is connected for this language yet.{" "}
                    {can("integrations:write") ? (
                      <Link href="/integrations" className="font-semibold underline">
                        Connect one under Integrations
                      </Link>
                    ) : (
                      "Ask your Super admin to connect one under Integrations"
                    )}
                    , or pick another language.
                  </span>
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-v-md border border-v-line bg-v-soft/40 px-4 py-3 text-[12.5px] text-v-muted-2">
                  <span className="font-medium text-v-fg">Chosen for you:</span>
                  <span>Speech: {providerName(catalogs.sttProviders, form.sttProvider)}</span>
                  <span>
                    AI: {providerName(catalogs.llmProviders, form.llmProvider)}
                    {form.llmModel ? ` · ${form.llmModel}` : ""}
                  </span>
                  <span>Voice: {providerName(catalogs.ttsProviders, form.ttsProvider)}</span>
                  <span className="text-v-muted">Change any of these later on the agent&apos;s page.</span>
                </div>
              )
            ) : null}

            {createError ? (
              <p className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-3.5 py-2.5 text-[13px] text-v-danger">{createError}</p>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t border-v-line pt-4">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="size-4" strokeWidth={1.9} />
                Your agent
              </Button>
              <Button disabled={!engineReady || creating} onClick={() => void create()}>
                {creating ? <Spinner /> : <Sparkles className="size-4" strokeWidth={1.9} />}
                Create my agent
              </Button>
            </div>
          </section>
        ) : null}

        {/* 4. Ready: test it */}
        {step === 3 && agent ? (
          <section className="flex flex-col gap-5 animate-v-rise">
            <div className="flex flex-col items-center gap-2 rounded-v-xl border border-v-line bg-white px-6 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-v-pale text-v-ok">
                <CheckCircle2 className="size-7" strokeWidth={1.8} />
              </span>
              <h2 className="text-[24px] font-semibold tracking-tight">{agent.name} is ready</h2>
              <p className="max-w-[56ch] text-[13.5px] font-light leading-relaxed text-v-muted">
                Talk to it below, the way a citizen would. When it sounds right, attach a phone number and start a campaign.
              </p>
            </div>
            {can("calls:test") && session?.orgId ? (
              <BrowserCallSession orgId={session.orgId} agentId={agent.agent_id} agentName={agent.name} />
            ) : (
              <p className="text-center text-[13px] text-v-muted">Your role can&apos;t place test calls.</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button onClick={() => router.push("/dashboard")}>Go to my agents</Button>
              <Button variant="outline" onClick={() => router.push(`/agents/${agent.agent_id}/edit`)}>
                Fine-tune settings
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <PdfPreviewSheet file={viewing} onClose={() => setViewing(null)} />
    </main>
  );
}
