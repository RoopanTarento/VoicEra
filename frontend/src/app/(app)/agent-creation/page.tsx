"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, MessageSquare, Phone, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StartStep } from "@/components/wizard/StartStep";
import { QuickAgentFlow } from "@/components/wizard/QuickAgentFlow";
import { Spinner } from "@/components/ui/Spinner";
import { listAgents } from "@/lib/api-client";
import { AgentBasicsStep } from "@/components/wizard/AgentBasicsStep";
import { LanguageProvidersStep } from "@/components/wizard/LanguageProvidersStep";
import { DeliveryStep } from "@/components/wizard/DeliveryStep";
import { CallDetailsStep } from "@/components/wizard/CallDetailsStep";
import { ReviewStep } from "@/components/wizard/ReviewStep";
import { PromptLibraryDialog } from "@/components/wizard/PromptLibraryDialog";
import { SectionNav, type SectionNavItem } from "@/components/wizard/SectionNav";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";
import { AgentForm, DEFAULT_FORM } from "@/lib/wizard-data";
import type { AgentUseCase } from "@/lib/api-types";
import { PromptModule } from "@/lib/prompt-modules";
import { useSyncCustomVariables } from "@/lib/use-sync-custom-variables";
import { useWizardCatalogs } from "@/lib/use-wizard-catalogs";
import { useWizardDefaults } from "@/lib/use-wizard-defaults";

const STEPS: SectionNavItem[] = [
  { id: "start", title: "Setup", subtitle: "Pick a use case", icon: MessageSquare },
  { id: "agent", title: "Agent", subtitle: "Name, greeting & prompt", icon: User },
  { id: "language", title: "Engine", subtitle: "STT · LLM · TTS", icon: Settings },
  { id: "delivery", title: "Delivery", subtitle: "Select provider", icon: Phone },
  { id: "call-details", title: "Call", subtitle: "Timeouts & silence", icon: Clock },
  { id: "review", title: "Review", subtitle: "Confirm", icon: CheckCircle2 },
];

const NEXT_LABEL: Record<string, string> = {
  agent: "Next — engine & providers",
  language: "Next — delivery",
  delivery: "Next — call details",
  "call-details": "Next — review",
};

export default function AgentCreationPage() {
  return (
    <RequirePermission permission="agents:write" what="create agents">
      <FlowChooser />
    </RequirePermission>
  );
}

/** An organisation's first agent gets the short guided flow (department →
 * schemes → agent → language); from the second agent on, or with ?full=1,
 * it's the full wizard. */
function FlowChooser() {
  const [flow, setFlow] = useState<"checking" | "quick" | "full">("checking");
  const { notify, toastNode } = useToast();

  useEffect(() => {
    let cancelled = false;
    const wantsFull = new URLSearchParams(window.location.search).get("full") === "1";
    (wantsFull ? Promise.resolve(null) : listAgents())
      .then((agents) => {
        if (!cancelled) setFlow(agents && agents.length === 0 ? "quick" : "full");
      })
      .catch(() => {
        if (!cancelled) setFlow("full");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (flow === "checking") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-v-muted">
        <Spinner light={false} /> Getting ready…
      </div>
    );
  }
  if (flow === "quick") {
    return (
      <>
        <QuickAgentFlow onNotify={notify} />
        {toastNode}
      </>
    );
  }
  return <AgentCreation />;
}

function AgentCreation() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // Furthest step ever reached — going back to re-check an earlier step
  // shouldn't re-lock the ones already filled in ahead of it.
  const [maxStep, setMaxStep] = useState(0);
  const [form, setForm] = useState<AgentForm>(DEFAULT_FORM);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // The draft agent created as soon as Review is reached — lives here (not in
  // ReviewStep) so it survives navigating away from Review and back.
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null);

  const catalogs = useWizardCatalogs(
    form.langs,
    form.sttProvider,
    form.ttsProvider,
    form.llmProvider,
  );
  const { notify, toastNode } = useToast();

  const onChange = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    setMaxStep((m) => Math.max(m, step));
  }, [step]);

  useSyncCustomVariables(form, onChange);

  useWizardDefaults(form, setForm, catalogs);

  const jumpTo = (id: string) => {
    const idx = STEPS.findIndex((s) => s.id === id);
    if (idx >= 0) setStep(idx);
  };

  // The Agent step's use-case row opens pre-set to this (a scheme intent or
  // the city survey), so the user only picks the schemes or survey and asks
  // for the agent to be written.
  const pickUseCase = (useCase: AgentUseCase) => {
    setForm((f) => ({ ...f, useCase }));
    jumpTo("agent");
  };

  const insertModule = (m: PromptModule) => {
    setForm((f) => ({
      ...f,
      prompt: f.prompt.includes(m.text) ? f.prompt : `${f.prompt}\n\n${m.text}`,
    }));
  };

  const languageProvidersReady =
    form.langs.length > 0 &&
    Boolean(form.sttProvider) &&
    Boolean(form.ttsProvider) &&
    Boolean(form.llmProvider) &&
    Boolean(form.llmModel);

  const currentId = STEPS[step]?.id ?? "start";
  const showFooter = currentId !== "start" && currentId !== "review";

  const canAdvance =
    (currentId !== "agent" || Boolean(form.name)) &&
    (currentId !== "language" || languageProvidersReady) &&
    !catalogs.loading;

  const advanceBlockedReason =
    currentId === "agent" && !form.name
      ? "Give it a name to continue"
      : currentId === "language" && !languageProvidersReady
        ? "Select a language and STT/TTS/LLM providers to continue"
        : undefined;

  return (
    <main className="flex h-[calc(100vh-60px)] w-full flex-col">
      <div className="shrink-0">
        <SectionNav
          items={STEPS.map((s, i) => ({ ...s, disabled: i > maxStep }))}
          activeId={currentId}
          onSelect={(id) => jumpTo(id)}
          eyebrow="Create an agent"
        />
      </div>

      {/* Scrolls internally so the footer below never has to move — it's
          always the last flex child of this fixed-height shell, at the same
          screen position on every step regardless of that step's content
          height. min-h-0 is required for a flex-1 child to actually shrink
          and scroll instead of growing past its container (the usual
          flexbox-overflow gotcha) — deliberately not overflow-hidden on
          <main> itself, since that would clip the top/bottom bars' bleed. */}
      <div className="scrollbar-hide flex min-h-0 flex-1 overflow-y-auto py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          {catalogs.error ? (
            <div className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-sm text-v-danger">
              {catalogs.error}
            </div>
          ) : null}

          {currentId === "start" ? (
            <StartStep onStartScratch={() => setStep(1)} onPickUseCase={pickUseCase} />
          ) : null}

          {catalogs.loading && currentId !== "start" ? (
            <div className="text-sm text-v-muted">Loading provider catalogs…</div>
          ) : null}

          {currentId === "agent" && !catalogs.loading ? (
            <AgentBasicsStep
              form={form}
              onChange={onChange}
              onOpenLibrary={() => setLibraryOpen(true)}
              onNotify={notify}
            />
          ) : null}

          {currentId === "language" && !catalogs.loading ? (
            <LanguageProvidersStep form={form} catalogs={catalogs} onChange={onChange} />
          ) : null}

          {currentId === "delivery" && !catalogs.loading ? (
            <DeliveryStep form={form} catalogs={catalogs} onChange={onChange} />
          ) : null}

          {currentId === "call-details" && !catalogs.loading ? (
            <CallDetailsStep form={form} onChange={onChange} />
          ) : null}

          {currentId === "review" && !catalogs.loading ? (
            <ReviewStep
              form={form}
              catalogs={catalogs}
              agentId={draftAgentId}
              onAgentSaved={(agent) => setDraftAgentId(agent.agent_id)}
              onFinish={() => router.push("/dashboard")}
              onEditStep={jumpTo}
            />
          ) : null}
        </div>
      </div>

      {showFooter ? (
        <div className="-mx-[34px] -mb-[30px] flex shrink-0 border-t border-v-line bg-white px-[34px] py-5">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
            <span className="flex flex-1 flex-wrap items-center justify-end gap-4">
              <span className="text-xs font-light text-v-muted">
                Step {step + 1} of {STEPS.length - 1} · you can change anything later
              </span>
              <Button
                data-tour="wizard-next-button"
                disabled={!canAdvance}
                title={advanceBlockedReason}
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                {NEXT_LABEL[currentId] ?? "Next"}
              </Button>
            </span>
          </div>
        </div>
      ) : null}

      <PromptLibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        currentPrompt={form.prompt}
        onInsert={insertModule}
      />
      {toastNode}
    </main>
  );
}
