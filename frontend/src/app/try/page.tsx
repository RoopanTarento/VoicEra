"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, Check, RotateCcw } from "lucide-react";
import { LogoMark } from "@/components/ui/VoicEraMark";
import { Spinner } from "@/components/ui/Spinner";
import {
  buildTryAgent,
  getTryCatalogue,
  saveTryDraft,
  tryChat,
  type TryAgent,
  type TryCatalogue,
  type TryTurn,
} from "@/lib/api/try-agent";

type Stage = "hero" | "setup" | "chat";

interface Bubble {
  role: "user" | "assistant";
  text: string;
  english?: string | null;
}

// After this many agent replies the sign-up card slides in.
const NUDGE_AFTER = 2;
const STARTERS = ["Yes, go ahead", "Which schemes can I get?", "How do I apply?"];

/** Public funnel: one hero, pick schemes + language, talk to the agent,
 * then sign up to keep it. No account needed until the last step. */
export default function TryPage() {
  const [stage, setStage] = useState<Stage>("hero");
  const [catalogue, setCatalogue] = useState<TryCatalogue | null>(null);
  const [loadError, setLoadError] = useState("");
  const [schemeIds, setSchemeIds] = useState<string[]>([]);
  const [language, setLanguage] = useState("hi");

  useEffect(() => {
    getTryCatalogue()
      .then(setCatalogue)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Couldn't load schemes."));
  }, []);

  return (
    <div className="flex min-h-screen w-full flex-col bg-v-bg text-v-fg">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5">
        <button type="button" onClick={() => setStage("hero")} className="flex items-center gap-2.5" aria-label="VoicEra home">
          <LogoMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight">VoicEra</span>
        </button>
        <Link href="/" className="text-[13px] font-medium text-v-muted hover:text-v-fg">
          Sign in
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pb-10">
        {stage === "hero" ? (
          <Hero catalogue={catalogue} onStart={() => setStage("setup")} />
        ) : stage === "setup" ? (
          <Setup
            catalogue={catalogue}
            loadError={loadError}
            schemeIds={schemeIds}
            language={language}
            onSchemes={setSchemeIds}
            onLanguage={setLanguage}
            onDone={() => {
              saveTryDraft(schemeIds, language);
              setStage("chat");
            }}
          />
        ) : (
          <Chat
            schemeIds={schemeIds}
            language={language}
            languageName={catalogue?.languages.find((l) => l.code === language)?.name ?? language}
            onRestart={() => setStage("setup")}
          />
        )}
      </main>
    </div>
  );
}

function Hero({ catalogue, onStart }: { catalogue: TryCatalogue | null; onStart: () => void }) {
  const facts = [
    `${catalogue?.schemes.length ?? 16} central schemes, facts checked against official sources`,
    `${catalogue?.languages.length ?? 11} Indian languages`,
    "Phone calls in and out",
  ];
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-7 py-16 text-center animate-v-rise">
      <span className="rounded-full border border-v-line bg-white px-3 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[.14em] text-v-muted">
        Scheme discovery agent
      </span>
      <h1 className="max-w-[18ch] text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-[54px]">
        Help every citizen find the schemes they qualify for
      </h1>
      <p className="max-w-[54ch] text-[15.5px] font-light leading-relaxed text-v-muted-2">
        A voice agent that asks a few questions, matches people to government schemes, and tells them which documents
        to bring and how to apply. In their own language, on a phone call.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="group inline-flex items-center gap-2 rounded-full bg-v-accent px-7 py-3.5 text-[15px] font-semibold text-white shadow-[var(--v-shadow-primary)] transition-colors hover:bg-v-accent-deep"
      >
        Build yours in 30 seconds
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
      </button>
      <span className="-mt-3 text-[12.5px] text-v-faint">Free to try. No sign-up.</span>
      <ul className="m-0 mt-4 flex list-none flex-wrap justify-center gap-x-6 gap-y-2 p-0 text-[12.5px] text-v-muted">
        {facts.map((f) => (
          <li key={f} className="flex items-center gap-1.5">
            <Check className="size-3.5 text-v-success" strokeWidth={2.4} />
            {f}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Setup({
  catalogue,
  loadError,
  schemeIds,
  language,
  onSchemes,
  onLanguage,
  onDone,
}: {
  catalogue: TryCatalogue | null;
  loadError: string;
  schemeIds: string[];
  language: string;
  onSchemes: (ids: string[]) => void;
  onLanguage: (code: string) => void;
  onDone: () => void;
}) {
  const groups = useMemo(() => {
    const by = new Map<string, TryCatalogue["schemes"]>();
    for (const s of catalogue?.schemes ?? []) by.set(s.category, [...(by.get(s.category) ?? []), s]);
    return [...by.entries()];
  }, [catalogue]);
  const max = catalogue?.max_schemes ?? null;
  const full = max !== null && schemeIds.length >= max;

  function toggle(id: string) {
    if (schemeIds.includes(id)) onSchemes(schemeIds.filter((x) => x !== id));
    else if (!full) onSchemes([...schemeIds, id]);
  }

  if (!catalogue) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-v-muted">
        {loadError ? <span className="text-v-danger">{loadError}</span> : <><Spinner light={false} /> Getting schemes…</>}
      </div>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-8 animate-v-rise">
      <div className="flex flex-col gap-3">
        <h2 className="text-[22px] font-semibold tracking-tight">Which schemes should it know?</h2>
        <div className="flex flex-col gap-4">
          {groups.map(([category, schemes]) => (
            <div key={category} className="flex flex-col gap-2">
              <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.14em] text-v-dim">{category}</span>
              <div className="flex flex-wrap gap-2">
                {schemes.map((s) => {
                  const on = schemeIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      title={s.benefit}
                      aria-pressed={on}
                      disabled={!on && full}
                      onClick={() => toggle(s.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] transition-colors disabled:opacity-40 ${
                        on
                          ? "border-v-accent bg-v-accent text-white"
                          : "border-v-line bg-white text-v-fg hover:border-v-line-strong"
                      }`}
                    >
                      {on ? <Check className="size-3.5" strokeWidth={2.4} /> : null}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[22px] font-semibold tracking-tight">Which language?</h2>
        <div className="flex flex-wrap gap-2">
          {catalogue.languages.map((l) => (
            <button
              key={l.code}
              type="button"
              aria-pressed={language === l.code}
              onClick={() => onLanguage(l.code)}
              className={`rounded-full border px-3.5 py-2 text-[13px] transition-colors ${
                language === l.code
                  ? "border-v-fg bg-v-fg text-white"
                  : "border-v-line bg-white text-v-fg hover:border-v-line-strong"
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-full border border-v-line bg-white/90 py-2 pl-5 pr-2 shadow-sm backdrop-blur">
        <span className="text-[13px] text-v-muted">
          {schemeIds.length
            ? `${schemeIds.length} ${schemeIds.length === 1 ? "scheme" : "schemes"}${max ? ` of ${max}` : ""}`
            : "Pick at least one scheme"}
        </span>
        <button
          type="button"
          disabled={!schemeIds.length}
          onClick={onDone}
          className="inline-flex items-center gap-2 rounded-full bg-v-accent px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-v-accent-deep disabled:cursor-not-allowed disabled:opacity-45"
        >
          Talk to my agent
          <ArrowRight className="size-4" strokeWidth={2} />
        </button>
      </div>
    </section>
  );
}

function Chat({
  schemeIds,
  language,
  languageName,
  onRestart,
}: {
  schemeIds: string[];
  language: string;
  languageName: string;
  onRestart: () => void;
}) {
  const [agent, setAgent] = useState<TryAgent | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([buildTryAgent(schemeIds, language), tryChat(schemeIds, language, [])])
      .then(([a, greeting]) => {
        if (cancelled) return;
        setAgent(a);
        setBubbles([{ role: "assistant", text: greeting.reply, english: greeting.english }]);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't start the agent."))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [schemeIds, language]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bubbles, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || ended) return;
    const next = [...bubbles, { role: "user" as const, text: content }];
    setBubbles(next);
    setInput("");
    setBusy(true);
    setError("");
    // The greeting is added on the server; send what came after it.
    const turns: TryTurn[] = next.slice(1).map((b) => ({ role: b.role, content: b.text }));
    try {
      const r = await tryChat(schemeIds, language, turns);
      setBubbles([...next, { role: "assistant", text: r.reply, english: r.english }]);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) setEnded(true);
      setError(err instanceof Error ? err.message : "The agent couldn't answer.");
    } finally {
      setBusy(false);
    }
  }

  const replies = bubbles.filter((b) => b.role === "assistant").length - 1;
  const nudge = ended || replies >= NUDGE_AFTER;

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 py-6 animate-v-rise">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.14em] text-v-dim">
            Preview · {languageName}
          </span>
          <h2 className="truncate text-[20px] font-semibold tracking-tight">{agent?.name ?? "Your agent"}</h2>
          <span className="text-[13px] font-light text-v-muted">
            It has just called you. Reply as a citizen would.
          </span>
        </div>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-v-line bg-white px-3 py-1.5 text-[12.5px] text-v-muted hover:text-v-fg"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          Change
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 rounded-v-xl border border-v-line bg-white p-4 sm:p-5">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex ${b.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed ${
                b.role === "user" ? "rounded-br-md bg-v-accent text-white" : "rounded-bl-md bg-v-soft text-v-fg"
              }`}
            >
              {b.text}
              {b.english ? <span className="mt-1.5 block text-[12px] font-light text-v-muted">{b.english}</span> : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-[13px] text-v-muted">
            <Spinner light={false} /> {bubbles.length ? "Typing…" : "Your agent is calling…"}
          </div>
        ) : null}
        {error ? <p className="m-0 text-[13px] text-v-danger">{error}</p> : null}
        {!busy && bubbles.length === 1 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-full border border-v-line px-3 py-1.5 text-[12.5px] text-v-muted-2 hover:border-v-accent hover:text-v-accent"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {nudge ? <SignupNudge /> : null}

      <form
        className="flex items-center gap-2 rounded-full border border-v-line bg-white py-1.5 pl-5 pr-1.5 focus-within:border-v-accent"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={600}
          disabled={ended}
          placeholder={ended ? "Preview finished" : "Type your reply…"}
          aria-label="Your reply"
          className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-v-faint"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy || ended}
          aria-label="Send"
          className="flex size-9 items-center justify-center rounded-full bg-v-accent text-white transition-colors hover:bg-v-accent-deep disabled:opacity-40"
        >
          <ArrowUp className="size-4" strokeWidth={2.2} />
        </button>
      </form>
    </section>
  );
}

function SignupNudge() {
  return (
    <div className="flex flex-col gap-3 rounded-v-xl border border-v-accent/30 bg-v-pale px-5 py-4 animate-v-rise sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">Want this agent for your citizens?</span>
        <span className="text-[13px] font-light text-v-muted-2">
          Sign up free to keep it, hear it on a real call, and give it a phone number.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/signup"
          className="inline-flex items-center gap-1.5 rounded-full bg-v-accent px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-v-accent-deep"
        >
          Sign up free
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </Link>
        <Link href="/" className="rounded-full px-3 py-2.5 text-[13px] font-medium text-v-muted-2 hover:text-v-fg">
          Sign in
        </Link>
      </div>
    </div>
  );
}
