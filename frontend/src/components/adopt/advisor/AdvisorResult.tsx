"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Download, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CostEstimator } from "@/components/adopt/advisor/CostEstimator";
import { CheckBadge, OutcomeBanner, ResultBadge, ResultIcon, SourceChips } from "@/components/adopt/advisor/ui";
import { BulletList, EmptyState, LinkButton, Notice, Panel, Section, Spinner } from "@/components/adopt/ui";
import { describeAnswer, visibleQuestions } from "@/lib/adopt/advisor/answers";
import { buildChecklist, buildExplanation, buildMeasures, buildPlan, MODEL_READINESS } from "@/lib/adopt/advisor/bundle";
import { calculateCost, inr } from "@/lib/adopt/advisor/cost";
import { directionOf, outboundOn } from "@/lib/adopt/advisor/derive";
import { evaluate, OUTCOME_LABEL, RULES } from "@/lib/adopt/advisor/evaluate";
import { exportChecklistCsv, exportRecommendation, exportRequestSummary } from "@/lib/adopt/advisor/export";
import { PLATINUM, SOURCES } from "@/lib/adopt/advisor/source";
import { useAdvisor } from "@/lib/adopt/advisor/store";
import { USE_CASES, getValue } from "@/lib/adopt/advisor/usecases";
import { useAdopt } from "@/lib/adopt/state";

const TOC: [string, string][] = [
  ["summary", "Recommendation"],
  ["mapping", "Requirement mapping"],
  ["included", "What is included"],
  ["provide", "What you provide"],
  ["limits", "Limitations and risks"],
  ["plan", "Adoption plan"],
  ["measures", "Success measures"],
  ["cost", "Cost estimate"],
  ["models", "Models and quality"],
  ["compare", "Compare package fit"],
  ["how", "How we arrived at this"],
  ["next", "Decide and act"],
];

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download = name;
  el.click();
  URL.revokeObjectURL(url);
}

export function AdvisorResult() {
  const router = useRouter();
  const { state, hydrated, actions, costInput } = useAdvisor();
  const adopt = useAdopt();
  const [copied, setCopied] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  if (!hydrated) return <Spinner label="Preparing your recommendation" />;
  const a = state.answers;
  const ev = evaluate(a, { cost: { category: costInput.category, minutes: costInput.minutes } });

  if (!ev) {
    return (
      <div className="py-12">
        <EmptyState title="There is no recommendation yet" action={<LinkButton href="/adopt/advisor" arrow>Start the advisor</LinkButton>}>
          A recommendation needs to know what you want the voice service to do. It takes a few minutes, and your answers are saved on this device as you go.
        </EmptyState>
      </div>
    );
  }

  const checklist = buildChecklist(a, ev);
  const plan = buildPlan(a, ev, checklist);
  const ex = buildExplanation(a, ev, checklist);
  const measures = buildMeasures(a);
  const cost = calculateCost(costInput);
  const uc = USE_CASES[ev.useCase];
  const dir = directionOf(a);
  const dept = String(getValue(a, "department") ?? "").trim();
  const mapped = ev.dimensions.filter((d) => d.result !== "na");
  const open = ev.findings;
  const unanswered = visibleQuestions(a).filter((q) => q.required && !a.unknown[q.id] && (a.values[q.id] === undefined || a.values[q.id] === "")).length;
  const canWorkspace = ev.outcome !== "outside-scope" && uc.icpApplication && (uc.id === "survey-feedback" || uc.id === "scheme-discovery");

  function openWorkspace() {
    if (!uc.icpApplication) return;
    if (dept) adopt.actions.setAnswer("department", dept);
    const langs = getValue<string[]>(a, "languages");
    if (langs?.length) adopt.actions.setAnswer("languages", langs);
    adopt.actions.startWorkspace(uc.id === "survey-feedback" ? "surveys" : "scheme-discovery", "deploy");
    router.push("/adopt/workspace");
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied("blocked");
    }
  }

  const request = state.request;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 pb-12 lg:grid-cols-[190px_minmax(0,1fr)]">
      <nav aria-label="On this page" className="sticky top-[88px] hidden self-start pt-10 lg:block">
        <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">On this page</p>
        <ul className="flex flex-col gap-0.5 border-l border-v-line text-[13px]">
          {TOC.map(([hash, label]) => (
            <li key={hash}>
              <a href={`#${hash}`} className="-ml-px block border-l border-transparent py-1.5 pl-3 text-v-body hover:border-v-accent hover:text-v-accent">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 divide-y divide-v-line">
        <header id="summary" className="flex scroll-mt-24 flex-col gap-5 pb-8 pt-10 md:pt-12">
          <span className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">Your recommendation</span>
          <h1 className="max-w-[26ch] text-[30px] font-semibold leading-[1.12] tracking-tight md:text-[38px]">{ex.headline}</h1>
          {unanswered > 0 ? (
            <Notice tone="warning" title={`${unanswered} needed ${unanswered === 1 ? "answer is" : "answers are"} still missing`}>
              This is based on what you have answered. <Link href="/adopt/advisor/questions" className="font-semibold underline">Finish the questions</Link> for a firmer result.
            </Notice>
          ) : null}
          <OutcomeBanner outcome={ev.outcome} pendingGovernance={ev.pendingGovernance} />
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Package", PLATINUM.name],
              ["Use case", uc.label],
              ["Interaction", dir ? (dir === "both" ? "Inbound and outbound" : dir === "inbound" ? "Citizens call the department" : "The department calls citizens") : "Not chosen"],
              ["Adoption outcome", ev.outcome === "outside-scope" ? "Not achievable as described" : ev.outcome === "needs-review" ? "Review needed before setup" : ev.setupBlockers.length ? "Prerequisites to complete first" : ev.outcome === "suitable" ? "Ready to start setup" : "Inputs in hand. Settle the conditions first"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">{k}</dt>
                <dd className="mt-1 text-[14px] font-medium leading-snug">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="max-w-[70ch] text-[14.5px] leading-relaxed text-v-body">{ex.whyItFits.filter(Boolean)[0]}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => router.push("/adopt/advisor/questions")}>
              <Pencil className="size-3.5" aria-hidden /> Revise my answers
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const md = exportRecommendation(a, costInput, dept);
                if (md) download("voicera-platinum-recommendation.md", md, "text/markdown");
              }}
            >
              <Download className="size-3.5" aria-hidden /> Export the recommendation
            </Button>
            {uc.id === "scheme-discovery" ? <LinkButton href="/adopt/advisor/poc" variant="outline">Build the proof of concept</LinkButton> : null}
          </div>
        </header>

        <Section id="mapping" title="How your requirements map to the package" intro="Each row compares one thing you told us with what the package document says. Rows that do not apply are left out.">
          <div className="overflow-x-auto rounded-v-xl border border-v-line bg-v-panel">
            <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Requirement to package mapping</caption>
              <thead>
                <tr className="border-b border-v-line bg-v-surface-sunk font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">
                  <th scope="col" className="px-4 py-3 font-medium">Requirement</th>
                  <th scope="col" className="px-4 py-3 font-medium">Your answer</th>
                  <th scope="col" className="px-4 py-3 font-medium">Package fit</th>
                  <th scope="col" className="px-4 py-3 font-medium">Explanation</th>
                </tr>
              </thead>
              <tbody>
                {mapped.map((d) => (
                  <tr key={d.id} className="border-b border-v-hairline align-top last:border-0">
                    <th scope="row" className="px-4 py-3.5 text-left font-semibold">
                      <span className="flex items-center gap-2"><ResultIcon result={d.result} />{d.label}</span>
                    </th>
                    <td className="px-4 py-3.5 leading-relaxed text-v-body">{d.answer}</td>
                    <td className="px-4 py-3.5"><ResultBadge result={d.result} /></td>
                    <td className="px-4 py-3.5 leading-relaxed text-v-body">
                      {d.consequence}
                      <span className="mt-1.5 block"><SourceChips ids={d.sources} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="included" title="What the package includes" intro="Only what the package document lists. Nothing else is implied.">
          <div className="grid gap-4 md:grid-cols-2">
            {PLATINUM.included.map((g) => (
              <Panel key={g.group} className="!p-4 md:!p-5">
                <h3 className="mb-2.5 text-[14.5px] font-semibold">{g.group}</h3>
                <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-v-body">
                  {g.items.map((i) => (
                    <li key={i.label} className="flex flex-wrap items-baseline gap-x-2">
                      <span>{i.label}</span>
                      <SourceChips ids={[i.src]} />
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
          <p className="text-[12.5px] text-v-muted">Out of scope: {PLATINUM.outOfScope.map((o) => o.label.toLowerCase()).join("; ")}. Not recommended: {PLATINUM.notRecommended.map((o) => o.label.toLowerCase()).join("; ")}.</p>
        </Section>

        <Section id="provide" title="What your department needs to provide" intro="Personalised from your answers. The first column of the package document asks for the use case, script, knowledge base, phone numbers for outbound and test resources.">
          <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
            {checklist.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{c.label}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-v-body">{c.detail}</p>
                  <span className="mt-1 inline-flex flex-wrap gap-1">
                    <SourceChips ids={[c.source]} />
                    {c.documentedAsBrought ? null : <span className="font-mono text-[9.5px] uppercase tracking-[.1em] text-v-muted">Not listed in the package document</span>}
                  </span>
                </div>
                <CheckBadge status={c.status} />
              </li>
            ))}
          </ul>
          <div>
            <Button variant="outline" size="sm" onClick={() => { const csv = exportChecklistCsv(a, costInput); if (csv) download("voicera-requirements-checklist.csv", csv, "text/csv"); }}>
              <Download className="size-3.5" aria-hidden /> Download the checklist
            </Button>
          </div>
        </Section>

        <Section id="limits" title="Limitations and risks that apply to you" intro="These are the items from the package document that touch your requirements. They are not hidden in an FAQ.">
          {open.length === 0 ? (
            <Notice tone="info">Nothing in your answers runs into a documented limit. The open items in the package document still apply, and are listed under Models and quality and in the FAQ.</Notice>
          ) : (
            <ul className="flex flex-col gap-3">
              {open.map((f) => (
                <li key={f.id}>
                  <Notice tone={f.severity === "blocker" ? "danger" : f.severity === "review" ? "warning" : "info"} title={`${f.severity === "blocker" ? "Outside the documented package" : f.severity === "review" ? "Needs review" : "Condition"}: ${f.title}`}>
                    <span className="block">{f.detail}</span>
                    <span className="mt-1.5 block"><SourceChips ids={f.sources} /></span>
                  </Notice>
                </li>
              ))}
            </ul>
          )}
          {ev.integrationNeeded ? (
            <Panel className="flex flex-col gap-2 !p-4">
              <h3 className="text-[14.5px] font-semibold">Why this needs a separate technical assessment</h3>
              <BulletList items={ev.integrationReasons} />
              <p className="text-[12.5px] text-v-muted">No second package or price for integration is defined in the material supplied, so none is suggested.</p>
            </Panel>
          ) : null}
        </Section>

        <Section id="plan" title="Your adoption plan" intro={`The documented setup SLA is ${PLATINUM.limits.setupSlaWorkingDays.value} working days after all requirements are provided. It covers setting up the voice agent. It is not a promise for the whole project.`}>
          <ol className="flex flex-col">
            {plan.map((s, i) => (
              <li key={s.n} className="relative flex gap-4 pb-5 last:pb-0">
                {i < plan.length - 1 ? <span className="absolute left-[13px] top-7 h-[calc(100%-18px)] w-px bg-v-line" aria-hidden /> : null}
                <span className={`z-10 flex size-[27px] shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] text-white ${s.status === "blocked" ? "bg-v-danger" : s.status === "ready" ? "bg-v-ok" : "bg-v-fg"}`}>{s.n}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold">
                    {s.title}
                    <Badge tone={s.status === "ready" ? "live" : s.status === "blocked" ? "danger" : s.status === "review" ? "warn" : "draft"}>{s.status === "pending" ? "To do" : s.status === "review" ? "Needs review" : s.status === "blocked" ? "Blocked" : "In hand"}</Badge>
                    {s.slaPrerequisite ? <Badge tone="accent">Input the setup SLA waits for</Badge> : null}
                  </p>
                  <p className="text-[12px] text-v-muted">{s.owner}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-v-body">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <Notice tone={ev.setupCanStart ? "info" : "warning"} title={ev.setupCanStart ? "Setup could start once you share the inputs" : "Setup cannot begin yet"}>
            {ev.setupCanStart
              ? `Everything the package asks the department to bring is in hand and nothing needs a review. The 2-working-day setup SLA runs from the point all requirements are provided.${ev.findings.length ? ` Conditions still open: ${ev.findings.map((f) => f.title.toLowerCase()).join(", ")}.` : ""}`
              : ev.outcome === "outside-scope"
                ? "A requirement is outside the documented package. Settle that first."
                : ev.setupBlockers.length
                  ? `Still needed: ${ev.setupBlockers.join(" ")}`
                  : "Items need review before setup."}
          </Notice>
        </Section>

        <Section id="measures" title="How you will measure success" intro={outboundOn(a) ? "The package dashboard shows these. Anything marked proposed is not documented and needs confirming." : "The documented dashboard is about campaigns. Inbound reporting is not described, so confirm what you would see."}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {measures.map((m) => (
              <li key={m.label} className="rounded-v-lg border border-v-line bg-v-panel px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">{m.label}{m.documented ? null : <Badge tone="warn">Proposed</Badge>}</p>
                <p className="text-[12.5px] text-v-body">{m.note}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="cost" title="Cost estimate" intro="Built only from documented rates: Rs. 50,000 one-time setup, Rs. 500 for each phone number, and Rs. 0.50 a minute for open-source models. Billing is through Bhashini.">
          <CostEstimator costInput={costInput} />
        </Section>

        <Section id="models" title="Models and quality" intro="The package document lists sample providers and says they are not the actual list, so nothing below is treated as an available choice.">
          <div className="overflow-x-auto rounded-v-xl border border-v-line bg-v-panel">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Model readiness</caption>
              <tbody>
                {MODEL_READINESS.map((m) => (
                  <tr key={m.label} className="border-b border-v-hairline align-top last:border-0">
                    <th scope="row" className="w-[220px] px-4 py-3 text-left font-semibold">{m.label}</th>
                    <td className="px-4 py-3 leading-relaxed text-v-body">{m.value}</td>
                    <td className="px-4 py-3"><Badge tone={m.status === "documented" ? "live" : m.status === "verify" ? "warn" : "draft"}>{m.status === "documented" ? "Documented" : m.status === "verify" ? "Needs verification" : "Pending"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12.5px] text-v-muted">Sample providers in the document, shown only so you can see what was listed: speech recognition: {PLATINUM.modelSample.asr.join(", ")}. Language models: {PLATINUM.modelSample.llm.join(", ")}. Speech synthesis: {PLATINUM.modelSample.tts.join(", ")}. These are samples, not the actual list.</p>
        </Section>

        <Section id="compare" title="Compare your needs with the package" intro="One look at what the package documents against what you asked for.">
          <div className="grid gap-4 md:grid-cols-2">
            <Panel className="!p-4 md:!p-5">
              <h3 className="mb-2 text-[14.5px] font-semibold">Documented as included, and you need it</h3>
              <BulletList items={ev.dimensions.filter((d) => d.result === "fit").map((d) => d.label)} />
            </Panel>
            <Panel className="!p-4 md:!p-5">
              <h3 className="mb-2 text-[14.5px] font-semibold">Does not fit, or cannot be confirmed</h3>
              {ev.dimensions.filter((d) => ["blocked", "review", "unresolved", "conditional"].includes(d.result)).length ? (
                <BulletList items={ev.dimensions.filter((d) => ["blocked", "review", "unresolved", "conditional"].includes(d.result)).map((d) => `${d.label}: ${d.result === "blocked" ? "outside scope" : d.result === "review" ? "needs review" : d.result === "conditional" ? "with conditions" : "not confirmed"}`)} />
              ) : (
                <p className="text-[13px] text-v-body">Nothing.</p>
              )}
            </Panel>
          </div>
          <Notice tone="demo" title="How this relates to Deploy, Connect and Orchestrate (our reading)">
            The ICP describes three depths of integration. Platinum as documented has no custom integration with department systems, which matches the Deploy depth. A requirement that needs a system connection would sit at Connect or Orchestrate depth, which the supplied package document does not cover. This is our reading, not a statement in the document.{" "}
            <Link href="/adopt/packages" className="font-semibold underline">See the three depths</Link>
          </Notice>
        </Section>

        <Section id="how" title="How we arrived at this recommendation" intro="Every claim traces to the package document or is labelled an assumption.">
          <details className="rounded-v-xl border border-v-line bg-v-panel" open={false}>
            <summary className="cursor-pointer list-none px-5 py-4 text-[14px] font-semibold text-v-accent-deep">Show the full explanation</summary>
            <div className="flex flex-col gap-6 border-t border-v-line px-5 py-5">
              {(
                [
                  ["What we recommend", [`${ex.status}. ${ex.summary}`]],
                  ["Why it fits", ex.whyItFits.filter(Boolean)],
                  ["Requirements it satisfies", ex.requirementsSatisfied],
                  ["Assumptions we made", ex.assumptions],
                  ["What is missing", ex.missing],
                  ["What could block implementation", ex.blockers],
                  ["What the department provides", ex.departmentProvides],
                  ["What package support provides", ex.packageProvides],
                  ["What needs separate confirmation", ex.needsConfirmation],
                  ["What to do next", ex.nextSteps],
                ] as [string, string[]][]
              ).map(([title, items]) => (
                <div key={title}>
                  <h3 className="mb-2 text-[14px] font-semibold">{title}</h3>
                  {items.length ? <BulletList items={items} /> : <p className="text-[13px] text-v-muted">Nothing.</p>}
                </div>
              ))}
              <div>
                <h3 className="mb-2 text-[14px] font-semibold">The answers that mattered</h3>
                <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] text-[13px]">
                  {ex.answersThatMattered.map((m) => (
                    <div key={m.question} className="contents">
                      <dt className="text-v-muted">{m.question}</dt>
                      <dd className="font-medium">{m.answer}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <button type="button" onClick={() => setShowRules((v) => !v)} className="text-[13px] font-semibold text-v-accent hover:underline" aria-expanded={showRules}>
                  {showRules ? "Hide the rules that were applied" : "Show the rules that were applied"}
                </button>
                {showRules ? (
                  <ul className="mt-3 flex flex-col gap-2">
                    {Array.from(new Set(ev.dimensions.flatMap((d) => d.ruleIds))).map((r) => (
                      <li key={r} className="rounded-v-md border border-v-line bg-v-surface-sunk px-3 py-2 text-[12.5px] leading-relaxed">
                        <span className="font-mono text-[11px] font-semibold">{r}</span> {RULES[r]?.rationale} <SourceChips ids={RULES[r]?.sources ?? []} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <p className="text-[12px] text-v-muted">The result comes from fixed rules over your answers. No AI service was used for the eligibility, scope, limit or cost checks.</p>
            </div>
          </details>
          <details className="rounded-v-xl border border-v-line bg-v-panel">
            <summary className="cursor-pointer list-none px-5 py-4 text-[14px] font-semibold text-v-accent-deep">Your answers</summary>
            <dl className="grid gap-x-8 gap-y-2 border-t border-v-line px-5 py-5 text-[13px] sm:grid-cols-2">
              {visibleQuestions(a).filter((q) => describeAnswer(q, a) !== "Not answered").map((q) => (
                <div key={q.id} className="contents">
                  <dt className="text-v-muted">{q.label}</dt>
                  <dd className="font-medium">{describeAnswer(q, a)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Section>

        <Section id="next" title="Decide and act" intro="Pick what to do next. Nothing here sends anything anywhere.">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => router.push("/adopt/advisor/questions")}>Revise my answers</Button>
            <Button variant="outline" onClick={() => document.getElementById("compare")?.scrollIntoView({ behavior: "smooth" })}>Compare package fit</Button>
            <Button variant="outline" onClick={() => { const md = exportRecommendation(a, costInput, dept); if (md) download("voicera-platinum-recommendation.md", md, "text/markdown"); }}>
              <Download className="size-3.5" aria-hidden /> Export the recommendation
            </Button>
            <Button variant="outline" onClick={() => { const csv = exportChecklistCsv(a, costInput); if (csv) download("voicera-requirements-checklist.csv", csv, "text/csv"); }}>
              <Download className="size-3.5" aria-hidden /> Download the checklist
            </Button>
            {canWorkspace ? <Button variant="outline" onClick={openWorkspace}>Try it in the workspace</Button> : null}
            <Button
              onClick={() => {
                const t = exportRequestSummary(a, costInput, dept);
                if (t) actions.prepareRequest(t);
              }}
            >
              Request an implementation discussion
            </Button>
          </div>

          {request ? (
            <Panel className="flex flex-col gap-3">
              <Notice tone="demo" title="Prepared on this device only. Nothing has been sent.">
                This is a demonstration. There is no connection to Bhashini, VoicEra or any sales team from here. Copy the text below and send it yourself, to the contact you have been given.
              </Notice>
              <label htmlFor="req-text" className="text-[13px] font-semibold">Your request summary</label>
              <textarea id="req-text" readOnly value={request.text} rows={12} className="w-full rounded-v-md border border-v-line-strong bg-v-surface-sunk p-3 font-mono text-[12px] leading-relaxed" />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => copyText("request", request.text)}>
                  <Copy className="size-3.5" aria-hidden /> Copy to clipboard
                </Button>
                <Button variant="ghost" size="sm" onClick={() => download("voicera-implementation-request.txt", request.text, "text/plain")}>Save as a file</Button>
                <span aria-live="polite" className="text-[12.5px] text-v-muted">
                  {copied === "request" ? "Copied." : copied === "blocked" ? "Your browser blocked copying. Select the text and copy it." : `Prepared ${new Date(request.preparedAt).toLocaleString("en-GB")}`}
                </span>
              </div>
            </Panel>
          ) : null}

          <p className="text-[12.5px] text-v-muted">
            Status: {OUTCOME_LABEL[ev.outcome]}. Known cost so far: {inr(cost.knownTotal)}{cost.totalIsComplete ? "" : " (not the full cost)"}. See also the{" "}
            <Link href="/adopt/advisor/faq" className="font-semibold text-v-accent hover:underline">FAQ and data governance answers</Link>.
          </p>
        </Section>

        <p className="pt-6 text-[12px] leading-relaxed text-v-muted">
          Source: {SOURCES["PKG-SUMMARY"].label.replace(": Offer summary", "")}. Where the document is blank or marks a list as a sample, this page says so. This is not an approval for production use.
        </p>
      </div>
    </div>
  );
}
