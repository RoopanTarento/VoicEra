"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CallSummary } from "@/components/try/CallSummary";
import { CodeSignIn } from "@/components/try/CodeSignIn";
import { Creating, type CreatedAgent } from "@/components/try/Creating";
import { Landing } from "@/components/try/Landing";
import { LiveCall, type EndedCall } from "@/components/try/LiveCall";
import { Ready } from "@/components/try/Ready";
import { DepartmentQuestion, LanguageQuestion, SchemeQuestion } from "@/components/try/SetupQuestions";
import { TryHeader, type TryStep } from "@/components/try/TryHeader";
import {
  getTryCatalogue,
  prepareTryCall,
  registerTryCall,
  saveTryDraft,
  translateLines,
  type TryCatalogue,
} from "@/lib/api/try-agent";
import { matchDescription } from "@/lib/try-match";

type Stage = "landing" | "department" | "schemes" | "language" | "creating" | "ready" | "call" | "summary" | "signin";

const STEP: Partial<Record<Stage, TryStep>> = {
  department: 1,
  schemes: 1,
  language: 1,
  creating: 1,
  ready: 2,
  summary: 3,
};

/** No-login flow: describe or pick a template → three questions → the agent is
 * created → test call in the browser → how it went → sign in to launch. */
export default function TryPage() {
  const [stage, setStage] = useState<Stage>("landing");
  const [catalogue, setCatalogue] = useState<TryCatalogue | null>(null);
  const [loadError, setLoadError] = useState("");
  const [description, setDescription] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [schemeIds, setSchemeIds] = useState<string[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAgent | null>(null);
  const [greeting, setGreeting] = useState("");
  const [english, setEnglish] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [ended, setEnded] = useState<EndedCall | null>(null);
  const [setupDone, setSetupDone] = useState(false);
  const [triedOnce, setTriedOnce] = useState(false);

  useEffect(() => {
    getTryCatalogue()
      .then(setCatalogue)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Couldn't load the page."));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage]);

  const languageName = catalogue?.languages.find((l) => l.code === language)?.name ?? "";
  const schemes = useMemo(
    () => (catalogue?.schemes ?? []).filter((s) => schemeIds.includes(s.id)),
    [catalogue, schemeIds],
  );

  function begin(fromDescription: boolean) {
    if (!catalogue) return;
    if (fromDescription && description.trim()) {
      const m = matchDescription(description, catalogue);
      setDepartments(m.departments);
      setSchemeIds(m.schemeIds);
      if (m.language) setLanguage(m.language);
    }
    setStage("department");
  }

  function toSchemes() {
    if (!catalogue) return;
    // Every scheme of the chosen departments starts ticked, unless the
    // description named particular ones.
    const inDepts = catalogue.schemes.filter((s) => departments.includes(s.category)).map((s) => s.id);
    const named = schemeIds.filter((id) => inDepts.includes(id));
    setSchemeIds(named.length ? named : inDepts);
    setStage("schemes");
  }

  function onCreated(result: CreatedAgent) {
    setCreated(result);
    setGreeting(result.agent.greeting);
    setEnglish(result.agent.english);
    setStale(false);
    setSetupDone(true);
    saveTryDraft({ schemeIds, language: language ?? "en", greeting: result.agent.greeting });
    setStage("ready");
  }

  async function startCall() {
    if (!created || !language) return;
    setStarting(true);
    setStartError("");
    try {
      let next = created;
      if (stale) {
        const prepared = await prepareTryCall(schemeIds, language, greeting);
        next = { ...created, prepared, callId: (await registerTryCall(prepared.agent_id, prepared.preview_token)).call_id };
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
    if (!language || text === greeting) return;
    setGreeting(text);
    setEnglish(null);
    setStale(true);
    saveTryDraft({ schemeIds, language, greeting: text });
    if (language !== "en") {
      translateLines(language, [text])
        .then(({ english: out }) => setEnglish(out[0] ?? null))
        .catch(() => {});
    }
  }

  const signInLink =
    setupDone ? (
      <button type="button" onClick={() => setStage("signin")} className="hover:text-v-fg">
        Sign in
      </button>
    ) : (
      <Link href="/" className="hover:text-v-fg">
        Sign in
      </Link>
    );

  const agentLabel = `Scheme discovery · ${languageName}`;
  const header =
    stage === "call" ? (
      <TryHeader right={<span className="text-v-muted-2">{agentLabel}</span>} />
    ) : stage === "signin" ? (
      <TryHeader
        onLogo={() => setStage(ended ? "summary" : "ready")}
        right={
          <button type="button" onClick={() => setStage(ended ? "summary" : "ready")} className="inline-flex items-center gap-1.5 hover:text-v-fg">
            <ArrowLeft className="size-4" strokeWidth={1.9} />
            Back to my agent
          </button>
        }
      />
    ) : (
      <TryHeader step={STEP[stage]} onLogo={() => setStage("landing")} right={stage === "creating" ? null : signInLink} />
    );

  let body: React.ReactNode;
  if (!catalogue) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-v-muted">
        {loadError ? <span className="text-v-danger">{loadError}</span> : <><Spinner light={false} /> Loading…</>}
      </div>
    );
  } else if (stage === "landing") {
    body = (
      <Landing description={description} onDescription={setDescription} onBuild={() => begin(true)} onTemplate={() => begin(false)} />
    );
  } else if (stage === "department") {
    body = (
      <DepartmentQuestion catalogue={catalogue} selected={departments} onChange={setDepartments} onBack={() => setStage("landing")} onNext={toSchemes} />
    );
  } else if (stage === "schemes") {
    body = (
      <SchemeQuestion
        catalogue={catalogue}
        departments={departments}
        selected={schemeIds}
        onChange={setSchemeIds}
        onBack={() => setStage("department")}
        onNext={() => setStage("language")}
      />
    );
  } else if (stage === "language") {
    body = (
      <LanguageQuestion
        catalogue={catalogue}
        selected={language}
        onChange={setLanguage}
        onBack={() => setStage("schemes")}
        onNext={() => {
          setEnded(null);
          setTriedOnce(false);
          setStage("creating");
        }}
      />
    );
  } else if (stage === "creating" && language) {
    body = (
      <Creating schemeIds={schemeIds} language={language} languageName={languageName} onDone={onCreated} onBack={() => setStage("language")} />
    );
  } else if (stage === "ready" && created && language) {
    body = (
      <Ready
        language={language}
        languageName={languageName}
        schemeCount={schemeIds.length}
        greeting={greeting}
        english={english}
        onGreeting={changeGreeting}
        onChangeSchemes={() => setStage("schemes")}
        onStart={() => void startCall()}
        starting={starting}
        error={startError}
      />
    );
  } else if (stage === "call" && created && language) {
    body = (
      <LiveCall
        key={created.callId}
        orgId={created.prepared.org_id}
        agentId={created.prepared.agent_id}
        callId={created.callId}
        language={language}
        maxSeconds={created.prepared.max_call_seconds}
        onEnded={(call) => {
          setEnded(call);
          setStage("summary");
        }}
        onFailed={() => setStage(ended ? "summary" : "ready")}
      />
    );
  } else if (stage === "summary" && ended && language) {
    body = (
      <CallSummary
        call={ended}
        language={language}
        languageName={languageName}
        schemes={schemes}
        onCallAgain={() => void startCall()}
        onAnotherLanguage={() => setStage("language")}
        onSignIn={() => setStage("signin")}
      />
    );
  } else if (stage === "signin") {
    body = <CodeSignIn agentLabel={agentLabel} />;
  } else {
    body = null;
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-v-bg text-v-fg">
      {header}
      <main className="flex w-full flex-1 flex-col">{body}</main>
    </div>
  );
}
