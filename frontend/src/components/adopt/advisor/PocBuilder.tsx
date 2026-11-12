"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CheckBadge } from "@/components/adopt/advisor/ui";
import { BasicsStep, KnowledgeStep, QuestionsStep, SchemesStep, VoiceStep, download } from "@/components/adopt/advisor/PocSteps";
import { ScenarioRunner } from "@/components/adopt/ScenarioRunner";
import { BulletList, Notice, Panel, Spinner } from "@/components/adopt/ui";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { PLATINUM } from "@/lib/adopt/advisor/source";
import {
  generateKnowledgeFiles,
  hasBlocking,
  pocToAnswers,
  pocToWorkspaceConfig,
  samplePoc,
  scriptAsText,
  validatePoc,
  type PocIssue,
} from "@/lib/adopt/advisor/poc";
import { useAdvisor } from "@/lib/adopt/advisor/store";
import { makeZip } from "@/lib/adopt/advisor/zip";
import type { SimContext } from "@/lib/adopt/simulate";
import { useAdopt } from "@/lib/adopt/state";

const STEPS = [
  { id: "welcome", title: "Start" },
  { id: "basics", title: "About you" },
  { id: "schemes", title: "Your schemes" },
  { id: "questions", title: "What it asks" },
  { id: "voice", title: "How it sounds" },
  { id: "knowledge", title: "Knowledge files" },
  { id: "play", title: "Try it" },
  { id: "launch", title: "Launch checklist" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const WALK: Record<StepId, { what: string; why: string; get: string }> = {
  welcome: {
    what: "Read what you will have by the end, then choose your own start or a worked example.",
    why: "The package asks your department to bring a use case, a conversation script and a basic knowledge base. This builds the script and the knowledge files for you from your own scheme details.",
    get: "A clear picture of what you will build, and no blank page.",
  },
  basics: {
    what: "Say who you are and which languages citizens speak.",
    why: "The package documents English and ten Indian languages and can switch language mid-call. Anything else is unverified.",
    get: "A department name for the opening line and a language list checked against the documented ones.",
  },
  schemes: {
    what: "Add each scheme: who it is for, documents, how to apply.",
    why: "The agent only explains schemes you list. Nothing is guessed or taken from elsewhere.",
    get: "A scheme catalogue the agent can speak from.",
  },
  questions: {
    what: "Pick the few questions that narrow down which scheme applies.",
    why: "Good scheme discovery asks a little, then explains. It does not list every scheme.",
    get: "An ordered list of questions for the conversation.",
  },
  voice: {
    what: "Write the introduction, hold message, fallbacks and closing line.",
    why: "The package supports a custom introduction, hold messages and noise cancellation. How the agent behaves when it does not know matters most.",
    get: "A readable draft script you can download and send for approval.",
  },
  knowledge: {
    what: "Check the knowledge files we built from your schemes and download them.",
    why: "The package takes up to 10 text files, up to 5 MB each. We group your schemes so you stay inside that.",
    get: "Text files ready for your department to review, plus a single zip.",
  },
  play: {
    what: "Try the conversation as a citizen, and type your own replies.",
    why: "A real test call comes after setup. This lets you hear the wording, the questions and the fallbacks before you ask anyone to approve them.",
    get: "Confidence in the wording, and a list of gaps if there are any.",
  },
  launch: {
    what: "See what is ready, what needs approval, and what happens next.",
    why: "The setup SLA starts only after all requirements are provided, so knowing exactly what is missing saves days.",
    get: "A checklist, a download of everything, and your answers pre-filled in the advisor so you do not repeat yourself.",
  },
};

const FLOW = [
  ["Schemes", "Enter each scheme once"],
  ["Script", "We draft the conversation"],
  ["Knowledge", "We build the text files"],
  ["Try it", "Play the conversation"],
  ["Check fit", "The advisor checks it against the package"],
];

function stepIssues(id: StepId, issues: PocIssue[]) {
  if (id === "basics") return issues.filter((i) => i.step === "basics");
  if (id === "schemes") return issues.filter((i) => i.step === "schemes");
  if (id === "questions") return issues.filter((i) => i.step === "questions");
  if (id === "voice") return issues.filter((i) => i.step === "voice");
  return [];
}

export function PocBuilder() {
  const router = useRouter();
  const { state, hydrated, actions } = useAdvisor();
  const adopt = useAdopt();
  const [showErr, setShowErr] = useState<Record<string, boolean>>({});
  const [scenarioId, setScenarioId] = useState("match");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const step = Math.min(Math.max(state.pocStep, 0), STEPS.length - 1);
  const cur = STEPS[step];

  useEffect(() => {
    headingRef.current?.focus();
  }, [step, hydrated]);

  if (!hydrated) return <Spinner label="Opening the walkthrough" />;

  const poc = state.poc;
  const issues = validatePoc(poc);
  const blockingHere = stepIssues(cur.id, issues).filter((i) => i.blocking);
  const app = APPLICATION_BY_ID["scheme-discovery"];
  const scenario = app.scenarios.find((s) => s.id === scenarioId) ?? app.scenarios[0];
  const ctx: SimContext = { app, config: pocToWorkspaceConfig(poc), integrations: {}, packageId: "deploy" };
  const { files, problems } = generateKnowledgeFiles(poc);
  const played = Object.keys(state.pocPlayed).length > 0;

  function go(to: number) {
    actions.setPocStep(Math.min(Math.max(to, 0), STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function next() {
    if (blockingHere.length) {
      setShowErr((s) => ({ ...s, [cur.id]: true }));
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView({ block: "center" }));
      return;
    }
    go(step + 1);
  }

  function checkFit() {
    actions.replaceAnswers(pocToAnswers(poc, state.answers));
    actions.setStepIndex(0);
    router.push("/adopt/advisor/questions");
  }

  function downloadEverything() {
    const list = [
      { name: "script/scheme-discovery-script.txt", content: scriptAsText(poc) },
      ...files.map((f) => ({ name: `knowledge-base/${f.name}`, content: f.content })),
      {
        name: "README.txt",
        content: [
          `Scheme Discovery proof of concept: ${poc.department}`,
          "",
          "Contents",
          "- script/: the conversation script flow, as a draft for approval",
          `- knowledge-base/: ${files.length} text files, inside the package limits (up to ${PLATINUM.limits.maxKnowledgeFiles.value} files, up to ${PLATINUM.limits.maxKnowledgeFileMB.value} MB each)`,
          "",
          "Before setup",
          "- Have the script and every knowledge file reviewed and approved by your department.",
          "- Provide your use case, script, knowledge base and people to test calls. For outbound, also provide citizen phone numbers.",
          `- The documented setup SLA is ${PLATINUM.limits.setupSlaWorkingDays.value} working days after all requirements are provided.`,
          "",
          "Open items in the package document: where call data is stored, whether it trains models, how long it is kept, the actual model options and proprietary pricing.",
        ].join("\n"),
      },
    ];
    download("scheme-discovery-poc.zip", makeZip(list), "application/zip");
  }

  function openWorkspace() {
    adopt.actions.setAnswer("department", poc.department.trim());
    adopt.actions.setAnswer("languages", poc.languages);
    adopt.actions.startWorkspace("scheme-discovery", "deploy");
    adopt.actions.setConfig(pocToWorkspaceConfig(poc));
    router.push("/adopt/workspace/test");
  }

  const checklist = [
    { label: "Scheme details complete", status: hasBlocking(poc) ? ("missing" as const) : ("ready" as const), detail: hasBlocking(poc) ? "Some required details are missing. Go back to the steps marked with a dot." : `${poc.schemes.length} scheme${poc.schemes.length === 1 ? "" : "s"} and ${poc.questions.length} question${poc.questions.length === 1 ? "" : "s"}.` },
    { label: "Conversation script", status: hasBlocking(poc) ? ("missing" as const) : ("review" as const), detail: "Drafted from your details. Your department has to approve it." },
    { label: "Knowledge base files", status: problems.length ? ("review" as const) : files.length ? ("review" as const) : ("missing" as const), detail: problems.length ? problems.join(" ") : `${files.length} text files, inside the limits. They need approval before they are used.` },
    { label: "You tried the conversation", status: played ? ("ready" as const) : ("missing" as const), detail: played ? "Yes." : "Try it in the previous step." },
    { label: "Test resources", status: "review" as const, detail: "People to make test calls after setup. The package expects the department to provide them." },
    { label: "Citizens' phone numbers", status: "review" as const, detail: "Only for outbound calling. Not needed for inbound scheme discovery." },
    { label: "Security and data-governance confirmation", status: "review" as const, detail: "Storage location, model training and retention are open in the package document. Ask before approving." },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 py-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10 lg:py-10">
      <nav aria-label="Walkthrough steps" className="min-w-0 lg:sticky lg:top-[100px] lg:self-start">
        <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Scheme discovery walkthrough</p>
        <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {STEPS.map((s, i) => {
            const bad = stepIssues(s.id, issues).some((x) => x.blocking) && i < step;
            const done = i < step && !bad;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-v-md px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${i === step ? "bg-v-pale text-v-accent-deep" : "text-v-body hover:bg-v-soft"}`}
                >
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${done ? "bg-v-ok text-white" : bad ? "bg-v-danger text-white" : i === step ? "bg-v-accent text-white" : "border border-v-line-strong bg-white text-v-muted"}`}>
                    {done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : i + 1}
                  </span>
                  {s.title}
                  {bad ? <span className="sr-only"> needs attention</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
        {poc.example ? <p className="mt-4 rounded-v-md bg-v-warn-tint px-3 py-2 text-[12px] leading-snug text-v-warn-ink">You are working from a made-up example. Replace it with your own schemes.</p> : null}
      </nav>

      <div className="min-w-0">
        <div className="mb-6 flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">Step {step + 1} of {STEPS.length}</p>
          <h1 ref={headingRef} tabIndex={-1} className="text-[28px] font-semibold leading-tight tracking-tight outline-none md:text-[34px]">
            {cur.id === "welcome" ? "Build a Scheme Discovery proof of concept" : cur.title}
          </h1>
        </div>

        <details className="mb-7 rounded-v-xl border border-v-line bg-v-surface-sunk" open>
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-v-accent-deep">Walkthrough for this step</summary>
          <dl className="grid gap-4 border-t border-v-line px-4 py-4 text-[13px] leading-relaxed md:grid-cols-3">
            <div><dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">What you do</dt><dd className="mt-1 text-v-body">{WALK[cur.id].what}</dd></div>
            <div><dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Why it matters</dt><dd className="mt-1 text-v-body">{WALK[cur.id].why}</dd></div>
            <div><dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">What you will have</dt><dd className="mt-1 text-v-body">{WALK[cur.id].get}</dd></div>
          </dl>
        </details>

        {cur.id === "welcome" ? (
          <div className="flex flex-col gap-6">
            <ol className="grid gap-3 sm:grid-cols-5" aria-label="What happens">
              {FLOW.map(([t, d], i) => (
                <li key={t} className="rounded-v-xl border border-v-line bg-v-panel p-4">
                  <span className="flex size-6 items-center justify-center rounded-full bg-v-fg font-mono text-[11px] text-white">{i + 1}</span>
                  <p className="mt-2 text-[14px] font-semibold">{t}</p>
                  <p className="text-[12.5px] leading-snug text-v-muted">{d}</p>
                </li>
              ))}
            </ol>
            <div className="grid gap-4 md:grid-cols-2">
              <Panel className="flex flex-col gap-2">
                <h2 className="text-[15.5px] font-semibold">What the package does for scheme discovery</h2>
                <BulletList items={["Works inbound, outbound or both", "Explains schemes from up to 10 text files, up to 5 MB each", "Speaks English and ten Indian languages and can switch mid-call", "Custom introduction, hold messages and noise cancellation", "A dashboard of calls, plus post-campaign analysis"]} />
              </Panel>
              <Panel className="flex flex-col gap-2">
                <h2 className="text-[15.5px] font-semibold">What it does not do</h2>
                <BulletList items={["Check a citizen's records or decide eligibility from a database", "Submit an application", "Connect to your systems, which is out of scope", "Hold conversations beyond about 3 minutes, which is not recommended"]} />
              </Panel>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => { actions.setPoc({ example: false }); go(1); }}>Start with my own schemes <ArrowRight className="size-3.5" aria-hidden /></Button>
              <Button variant="outline" onClick={() => { actions.replacePoc(samplePoc()); go(1); }}>Load a worked example</Button>
            </div>
            <p className="text-[12.5px] text-v-muted">The worked example uses made-up schemes so you can see the whole flow in a minute. It is clearly marked, and you can replace it at any time.</p>
          </div>
        ) : null}

        {cur.id === "basics" ? <BasicsStep poc={poc} setPoc={actions.setPoc} showErrors={!!showErr.basics} /> : null}
        {cur.id === "schemes" ? <SchemesStep poc={poc} setPoc={actions.setPoc} showErrors={!!showErr.schemes} /> : null}
        {cur.id === "questions" ? <QuestionsStep poc={poc} setPoc={actions.setPoc} showErrors={!!showErr.questions} /> : null}
        {cur.id === "voice" ? <VoiceStep poc={poc} setPoc={actions.setPoc} showErrors={!!showErr.voice} /> : null}
        {cur.id === "knowledge" ? <KnowledgeStep poc={poc} /> : null}

        {cur.id === "play" ? (
          <div className="flex flex-col gap-5">
            <Notice tone="demo" title="A text simulation of your conversation">
              It uses your schemes, questions and messages. No speech, language model or telephony is involved, and nobody is called. A real test call comes after setup, using the package.
            </Notice>
            {hasBlocking(poc) ? (
              <Notice tone="warning" title="Some details are missing">Parts of the conversation will show placeholders. Fill in the earlier steps for the full picture.</Notice>
            ) : null}
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Situation</legend>
              {app.scenarios.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-start gap-2.5 rounded-v-lg border border-v-line bg-white px-3.5 py-3 has-[:checked]:border-v-accent has-[:checked]:bg-v-pale has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v-accent/40">
                  <input type="radio" name="poc-scn" className="mt-1 accent-[var(--v-accent)]" checked={scenarioId === s.id} onChange={() => setScenarioId(s.id)} />
                  <span>
                    <span className="block text-[13.5px] font-semibold">{s.title}</span>
                    <span className="block text-[12px] text-v-muted">{s.situation}</span>
                    {state.pocPlayed[s.id] ? <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-[.1em] text-v-ok-ink">Tried</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <ScenarioRunner
              key={scenario.id}
              ctx={ctx}
              scenario={scenario}
              mode="adopter"
              onRun={(run) => {
                if (run.transcript.some((m) => m.who === "citizen") && !state.pocPlayed[scenario.id]) actions.markPlayed(scenario.id);
              }}
            />
          </div>
        ) : null}

        {cur.id === "launch" ? (
          <div className="flex flex-col gap-8">
            <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
              {checklist.map((c) => (
                <li key={c.label} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div>
                    <p className="text-[14px] font-medium">{c.label}</p>
                    <p className="text-[12.5px] leading-relaxed text-v-body">{c.detail}</p>
                  </div>
                  <CheckBadge status={c.status} />
                </li>
              ))}
            </ul>

            <div>
              <h2 className="mb-3 text-[17px] font-semibold">What happens next</h2>
              <ol className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-v-body">
                <li><span className="font-semibold text-v-fg">1. Your department approves</span> the script and every knowledge file.</li>
                <li><span className="font-semibold text-v-fg">2. You provide the inputs</span>: use case, script, knowledge base, and people to test calls. For outbound, also citizens&apos; phone numbers.</li>
                <li><span className="font-semibold text-v-fg">3. Package support sets up the voice agent.</span> The documented SLA is {PLATINUM.limits.setupSlaWorkingDays.value} working days after all requirements are provided.</li>
                <li><span className="font-semibold text-v-fg">4. Your people test calls</span> before any launch.</li>
                <li><span className="font-semibold text-v-fg">5. You approve and launch.</span> Post-campaign analysis is shared within {PLATINUM.limits.postCampaignAnalysisWorkingDays.value} working days, and issues are troubleshot within {PLATINUM.limits.troubleshootingHours.value} hours.</li>
              </ol>
              <p className="mt-3 text-[12.5px] text-v-muted">The SLA covers setting up the voice agent. It is not a promise for the whole project, and approvals on your side are not part of it.</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={checkFit}>Check this against the package <ArrowRight className="size-3.5" aria-hidden /></Button>
              <Button variant="outline" onClick={downloadEverything}><Download className="size-3.5" aria-hidden /> Download everything</Button>
              <Button variant="outline" onClick={openWorkspace}>Open it in the workspace</Button>
            </div>
            <p className="text-[12.5px] text-v-muted">
              &ldquo;Check this against the package&rdquo; fills in the advisor from what you built, and marks the script and knowledge files as drafts that are not yet approved. You then answer only what is left. See also the <Link href="/adopt/advisor/faq" className="font-semibold text-v-accent hover:underline">FAQ and data governance answers</Link>.
            </p>
          </div>
        ) : null}

        {Object.values(showErr).some(Boolean) && blockingHere.length ? (
          <div className="mt-6">
            <Notice tone="danger" title={`${blockingHere.length} ${blockingHere.length === 1 ? "thing needs" : "things need"} fixing to go on`}>
              <ul className="mt-1 list-disc pl-5">{blockingHere.slice(0, 5).map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul>
            </Notice>
          </div>
        ) : null}

        <div className="mt-9 flex items-center justify-between gap-3 border-t border-v-line pt-5">
          <Button variant="ghost" onClick={() => (step === 0 ? router.push("/adopt/advisor") : go(step - 1))}>
            <ArrowLeft className="size-3.5" aria-hidden /> Back
          </Button>
          <div className="flex items-center gap-3">
            <span className="hidden text-[12px] text-v-muted sm:inline">Saved on this device</span>
            {cur.id !== "welcome" && cur.id !== "launch" ? (
              <Button onClick={next}>Next <ArrowRight className="size-3.5" aria-hidden /></Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
