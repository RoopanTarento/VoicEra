"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CallSummary } from "@/components/try/CallSummary";
import { CodeSignIn } from "@/components/try/CodeSignIn";
import { Creating, type CreatedAgent } from "@/components/try/Creating";
import { Landing } from "@/components/try/Landing";
import { LiveCall, type EndedCall } from "@/components/try/LiveCall";
import { Ready } from "@/components/try/Ready";
import { KnowledgeQuestion, LanguageQuestion, SectorQuestion, newSetup, toAnswers, type Setup } from "@/components/try/SetupQuestions";
import { TryHeader, type TryStep } from "@/components/try/TryHeader";
import { VoicePreloader } from "@/components/try/VoiceWave";
import {
  canCall,
  getDemoSources,
  getTryCatalogue,
  prepareTryCall,
  registerTryCall,
  routeDescription,
  saveDemoDraft,
  translateLines,
  type DemoSources,
  type TryCatalogue,
} from "@/lib/api/try-agent";
import { getSession } from "@/lib/auth-storage";

const noSubscribe = () => () => {};

type Stage = "landing" | "q1" | "q2" | "q3" | "creating" | "ready" | "call" | "summary" | "signin";

const STEP: Partial<Record<Stage, TryStep>> = { q1: 1, q2: 1, q3: 1, creating: 1, ready: 2, summary: 3 };

/** No-login demo builder: describe the agent or pick one of six templates →
 * three questions → the agent is assembled from the knowledge base → test call
 * in the browser → how it went → sign in to launch. */
export function TryFlow() {
  const [stage, setStage] = useState<Stage>("landing");
  const [catalogue, setCatalogue] = useState<TryCatalogue | null>(null);
  const [loadError, setLoadError] = useState("");
  const [description, setDescription] = useState("");
  const [routing, setRouting] = useState(false);
  const [routeNotice, setRouteNotice] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [sources, setSources] = useState<DemoSources | null>(null);
  const [created, setCreated] = useState<CreatedAgent | null>(null);
  const [greeting, setGreeting] = useState("");
  const [opening, setOpening] = useState("");
  const [english, setEnglish] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [ended, setEnded] = useState<EndedCall | null>(null);
  const [triedOnce, setTriedOnce] = useState(false);

  // Read after hydration (the server never has a session, nor the query string).
  const signedIn = useSyncExternalStore(noSubscribe, () => Boolean(getSession()), () => false);
  const review = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).get("review") === "1", () => false);

  useEffect(() => {
    getTryCatalogue()
      .then(setCatalogue)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Couldn't load the page."));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage]);

  const template = catalogue?.templates.find((t) => t.template_id === setup?.templateId) ?? null;
  const sector = catalogue?.sectors.find((s) => s.sector_id === setup?.sectorId) ?? null;
  const languageName = catalogue?.languages.find((l) => l.code === setup?.language)?.name ?? "";
  const answers = useMemo(() => (setup ? toAnswers(setup) : null), [setup]);

  const patch = useCallback((p: Partial<Setup>) => setSetup((s) => (s ? { ...s, ...p } : s)), []);

  // Q1/Q2 content for the chosen template and sector; prefill what the sheet has.
  const sourceKey = setup?.sectorId ? `${setup.templateId}|${setup.sectorId}` : "";
  useEffect(() => {
    if (!sourceKey) return;
    const [templateId, sectorId] = sourceKey.split("|");
    let cancelled = false;
    getDemoSources(templateId, sectorId)
      .then((src) => {
        if (cancelled) return;
        setSources(src);
        setSetup((s) => {
          if (!s || s.templateId !== templateId || s.sectorId !== sectorId) return s;
          return {
            ...s,
            announcement: s.announcement || src.announcement || "",
            audience: s.audience || src.audience || "",
            reminder: s.reminder || src.reminder || "",
            serviceCardId: s.serviceCardId && src.services?.some((x) => x.card_id === s.serviceCardId) ? s.serviceCardId : (src.service_match ?? src.services?.[0]?.card_id ?? null),
            surveyQuestions: null,
            complaintFlows: null,
          };
        });
      })
      .catch(() => !cancelled && setSources(null));
    return () => {
      cancelled = true;
      setSources(null);
    };
  }, [sourceKey]);

  function defaultLanguage(c: TryCatalogue, wanted: string | null): string | null {
    const ok = (code: string | null) => (code && canCall(c.languages.find((l) => l.code === code)) ? code : null);
    return ok(wanted) ?? ok(c.demo_language);
  }

  function startTemplate(templateId: string) {
    if (!catalogue) return;
    setRouteNotice("");
    setSetup({ ...newSetup(templateId), language: defaultLanguage(catalogue, null) });
    setStage("q1");
  }

  async function routeAndStart() {
    if (!catalogue || !description.trim()) return;
    setRouting(true);
    setRouteNotice("");
    try {
      const r = await routeDescription(description.trim());
      if (!r.template_id) {
        setRouteNotice(r.reason || "That isn't something a public-service agent can do. Try describing it differently, or pick a template.");
        return;
      }
      const sectorId = r.sector_id;
      setSetup({
        ...newSetup(r.template_id),
        sectorId,
        topic: r.topic,
        language: defaultLanguage(catalogue, r.language),
      });
      // The router's ask_next decides which question opens; Q2 is always shown
      // once there is a sector, so the visitor sees what the agent will know.
      setStage(!sectorId ? "q1" : r.ask_next === "q3" ? "q3" : "q2");
    } catch (err) {
      setRouteNotice(err instanceof Error ? err.message : "Couldn't read that just now. Pick a template instead.");
    } finally {
      setRouting(false);
    }
  }

  function onCreated(result: CreatedAgent) {
    setCreated(result);
    setGreeting(result.agent.greeting);
    setOpening(result.prepared.opening || result.agent.opening);
    setEnglish(result.agent.opening_english);
    setStale(false);
    if (answers) saveDemoDraft({ answers, greeting: result.agent.greeting, label: result.agent.name });
    setStage("ready");
  }

  async function startCall() {
    if (!created || !answers) return;
    setStarting(true);
    setStartError("");
    try {
      let next = created;
      if (stale) {
        const prepared = await prepareTryCall(answers, greeting);
        next = { ...created, prepared, callId: (await registerTryCall(prepared.agent_id, prepared.preview_token)).call_id };
        setOpening(prepared.opening);
        setStale(false);
      } else if (triedOnce) {
        next = { ...created, callId: (await registerTryCall(created.prepared.agent_id, created.prepared.preview_token)).call_id };
      }
      setCreated(next);
      setTriedOnce(true);
      setStage("call");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Couldn't start the call.");
    } finally {
      setStarting(false);
    }
  }

  function changeGreeting(text: string) {
    if (!created || !answers || text === greeting) return;
    const notice = created.agent.notice;
    setGreeting(text);
    // What will be spoken: the new greeting, with the notice before its last sentence (as the server adds it).
    const parts = text.split(/(?<=[.?!।])\s+/).filter(Boolean);
    setOpening(parts.length > 1 ? [...parts.slice(0, -1), notice, parts.at(-1)].join(" ") : `${text} ${notice}`);
    setEnglish(null);
    setStale(true);
    saveDemoDraft({ answers, greeting: text, label: created.agent.name });
    if (answers.language !== "en") {
      translateLines(answers.language, [text])
        .then(({ english: out }) => setEnglish(out[0] ? `${out[0]} (+ the AI and demo notice)` : null))
        .catch(() => {});
    }
  }

  // Signed in already: straight back to the workspace. Otherwise Sign in (the
  // code sign-in once an agent exists, so it's saved) and Sign up.
  const signInLink = signedIn ? (
    <Link href="/dashboard" className="hover:text-v-fg">
      Open workspace
    </Link>
  ) : (
    <span className="flex items-center gap-2 sm:gap-4">
      {created ? (
        <button type="button" onClick={() => setStage("signin")} className="hover:text-v-fg">
          Sign in
        </button>
      ) : (
        <Link href="/signin" className="hover:text-v-fg">
          Sign in
        </Link>
      )}
      <Link
        href="/signup"
        className="rounded-v-md border border-v-line-strong bg-white px-3 py-1.5 font-semibold text-v-fg transition-colors hover:border-v-fg"
      >
        Sign up
      </Link>
    </span>
  );

  const agentLabel = [template?.name, sector?.name, languageName].filter(Boolean).join(" · ");
  const back = () => setStage(ended ? "summary" : "ready");
  const header =
    stage === "call" ? (
      <TryHeader right={<span className="text-v-muted-2">{agentLabel}</span>} />
    ) : stage === "signin" ? (
      <TryHeader
        onLogo={back}
        right={
          <button type="button" onClick={back} className="inline-flex items-center gap-1.5 hover:text-v-fg">
            <ArrowLeft className="size-4" strokeWidth={1.9} />
            Back to my agent
          </button>
        }
      />
    ) : (
      <TryHeader step={STEP[stage]} onLogo={() => setStage("landing")} right={stage === "creating" ? null : signInLink} />
    );

  let body: React.ReactNode = null;
  if (!catalogue) {
    body = loadError ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <span className="text-[15px] text-v-danger">{loadError}</span>
        <button type="button" onClick={() => window.location.reload()} className="text-[14px] font-semibold text-v-accent hover:text-v-accent-deep">
          Try again
        </button>
      </div>
    ) : (
      <VoicePreloader />
    );
  } else if (stage === "landing" || !setup || !template) {
    body = (
      <Landing
        templates={catalogue.templates}
        description={description}
        onDescription={setDescription}
        onBuild={() => void routeAndStart()}
        onTemplate={startTemplate}
        routing={routing}
        notice={routeNotice}
      />
    );
  } else if (stage === "q1") {
    body = (
      <SectorQuestion
        template={template}
        sectors={catalogue.sectors}
        setup={setup}
        onSetup={patch}
        onBack={() => setStage("landing")}
        onNext={() => setStage("q2")}
      />
    );
  } else if (stage === "q2" && sector) {
    body = (
      <KnowledgeQuestion
        template={template}
        sector={sector}
        sources={sources}
        setup={setup}
        onSetup={patch}
        onBack={() => setStage("q1")}
        onNext={() => setStage("q3")}
      />
    );
  } else if (stage === "q3") {
    body = (
      <LanguageQuestion
        template={template}
        catalogue={catalogue}
        selected={setup.language}
        onChange={(language) => patch({ language })}
        onBack={() => setStage(setup.sectorId ? "q2" : "q1")}
        onNext={() => {
          if (!setup.sectorId) {
            setStage("q1");
            return;
          }
          setEnded(null);
          setTriedOnce(false);
          setCreated(null);
          setStage("creating");
        }}
      />
    );
  } else if (stage === "creating" && answers) {
    body = (
      <Creating
        answers={answers}
        languageName={languageName}
        expectedCards={sources ? (setup.sampleKnowledge ? sources.cards.count : 0) + setup.added.reduce((n, a) => n + a.card_count, 0) : null}
        onDone={onCreated}
        onBack={() => setStage("q3")}
      />
    );
  } else if (stage === "ready" && created && answers) {
    body = (
      <Ready
        templateName={created.agent.template.name}
        languageName={languageName}
        sectorName={created.agent.sector.name}
        cards={created.agent.cards}
        language={answers.language}
        opening={opening}
        english={english}
        greeting={greeting}
        notice={created.agent.notice}
        role={created.agent.role}
        onGreeting={changeGreeting}
        onChangeSources={() => setStage("q2")}
        onStart={() => void startCall()}
        starting={starting}
        error={startError}
      />
    );
  } else if (stage === "call" && created && answers) {
    body = (
      <LiveCall
        key={created.callId}
        orgId={created.prepared.org_id}
        agentId={created.prepared.agent_id}
        callId={created.callId}
        previewToken={created.prepared.preview_token}
        language={answers.language}
        maxSeconds={created.prepared.max_call_seconds}
        role={created.agent.role}
        review={review}
        onEnded={(call) => {
          setEnded(call);
          setStage("summary");
        }}
        onFailed={back}
      />
    );
  } else if (stage === "summary" && ended && created && answers) {
    body = (
      <CallSummary
        key={created.callId}
        call={ended}
        callRef={{ agent_id: created.prepared.agent_id, preview_token: created.prepared.preview_token, call_id: created.callId }}
        language={answers.language}
        languageName={languageName}
        onCallAgain={() => void startCall()}
        onAnotherLanguage={() => setStage("q3")}
        onSignIn={() => setStage("signin")}
      />
    );
  } else if (stage === "signin") {
    body = <CodeSignIn agentLabel={agentLabel} />;
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-v-bg text-v-fg">
      {header}
      <main className="flex w-full flex-1 flex-col">{body}</main>
    </div>
  );
}
