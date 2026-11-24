"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import {
  PipecatClientAudio,
  PipecatClientProvider,
  VoiceVisualizer,
  usePipecatClient,
  usePipecatClientMicControl,
  usePipecatClientTransportState,
  usePipecatConversation,
  useRTVIClientEvent,
  type ConversationMessage,
} from "@pipecat-ai/client-react";
import { RoleCard } from "@/components/try/Ready";
import { Button } from "@/components/ui/Button";
import { getCallProgress, translateLines, type DemoRole } from "@/lib/api/try-agent";
import { maskPersonal } from "@/lib/mask";
import {
  createBrowserPipecatClient,
  getBrowserWsUrl,
} from "@/lib/pipecat/createBrowserClient";

export interface TranscriptLine {
  key: string;
  role: "agent" | "user";
  text: string;
  english: string | null;
}

export interface EndedCall {
  seconds: number;
  transcript: TranscriptLine[];
}

function messageText(m: ConversationMessage): string {
  return m.parts
    .map((p) => {
      if (typeof p.text === "string") return p.text;
      if (p.text && typeof p.text === "object" && "spoken" in p.text) {
        return `${p.text.spoken}${p.text.unspoken ?? ""}`;
      }
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

interface StageProps {
  orgId: string;
  agentId: string;
  callId: string;
  previewToken: string;
  language: string;
  maxSeconds: number;
  role: DemoRole;
  /** The team's review build: tag each agent line with its flow and step. */
  review: boolean;
  onEnded: (call: EndedCall) => void;
  onFailed: () => void;
}

/** The browser test call: the agent and the tester's role card on the left,
 * the live transcript (with English under each line) on the right. Ends on End
 * call, when the agent hangs up, or after ``maxSeconds``. What the tester says
 * is masked on screen (long numbers, codes, emails). */
export function LiveCall(props: StageProps) {
  const client = useMemo(() => createBrowserPipecatClient(), []);
  useEffect(() => {
    return () => {
      void client.disconnect().catch(() => {});
    };
  }, [client]);
  return (
    <PipecatClientProvider client={client}>
      <PipecatClientAudio />
      <Stage {...props} />
    </PipecatClientProvider>
  );
}

function Stage({ orgId, agentId, callId, previewToken, language, maxSeconds, role, review, onEnded, onFailed }: StageProps) {
  const client = usePipecatClient();
  const transport = usePipecatClientTransportState();
  const { enableMic } = usePipecatClientMicControl();
  const { messages } = usePipecatConversation();
  const [seconds, setSeconds] = useState(0);
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState("");
  const [english, setEnglish] = useState<Record<string, string | null>>({});
  // Review build: the flow and step each agent line was spoken at.
  const [tags, setTags] = useState<Record<string, string>>({});
  // The brand accent, read from the design tokens (the visualizer draws on a canvas).
  const [accent] = useState(() =>
    typeof document === "undefined"
      ? "#1f4ee8"
      : getComputedStyle(document.documentElement)
          .getPropertyValue("--v-accent")
          .trim() || "#1f4ee8",
  );
  const connectedOnce = useRef(false);
  const ended = useRef(false);
  const pending = useRef(new Set<string>());
  const transcriptRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(
    () =>
      messages
        .filter((m) => m.role === "assistant" || m.role === "user")
        .map((m) => {
          const role =
            m.role === "assistant" ? ("agent" as const) : ("user" as const);
          const key = `${role}-${m.createdAt}`;
          const raw = messageText(m);
          return {
            key,
            role,
            text: role === "user" ? maskPersonal(raw) : raw,
            english: english[key] ?? null,
            final: m.final !== false,
          };
        })
        .filter((l) => l.text),
    [messages, english],
  );

  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const finish = useCallback(async () => {
    if (ended.current) return;
    ended.current = true;
    await client?.disconnect().catch(() => {});
    onEnded({
      seconds,
      transcript: linesRef.current.map(({ key, role, text, english: en }) => ({
        key,
        role,
        text,
        english: en,
      })),
    });
  }, [client, onEnded, seconds]);

  // Connect once.
  useEffect(() => {
    if (!client) return;
    client
      .connect({ wsUrl: getBrowserWsUrl(orgId, agentId, callId) })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        setError(
          /permission|notallowed|denied/i.test(message)
            ? "Allow microphone access in your browser, then try again."
            : "Couldn't reach the voice service. Try again in a moment.",
        );
      });
  }, [client, orgId, agentId, callId]);

  const connected = transport === "ready" || transport === "connected";
  useEffect(() => {
    if (connected) connectedOnce.current = true;
  }, [connected]);

  // The agent hung up (or the line dropped) after the call had started.
  useEffect(() => {
    if (
      connectedOnce.current &&
      (transport === "disconnected" || transport === "error") &&
      !ended.current
    ) {
      void finish();
    }
  }, [transport, finish]);

  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [connected]);

  useEffect(() => {
    if (seconds >= maxSeconds) void finish();
  }, [seconds, maxSeconds, finish]);

  useEffect(() => {
    const panel = transcriptRef.current;
    if (panel)
      requestAnimationFrame(() => (panel.scrollTop = panel.scrollHeight));
  }, [lines.length]);

  // English under each finished line (a few at a time).
  useEffect(() => {
    if (language === "en") return;
    const todo = lines
      .filter(
        (l) => l.final && !(l.key in english) && !pending.current.has(l.key),
      )
      .slice(0, 12);
    if (!todo.length) return;
    todo.forEach((l) => pending.current.add(l.key));
    translateLines(
      language,
      todo.map((l) => l.text),
    )
      .then(({ english: out }) =>
        setEnglish((prev) => ({
          ...prev,
          ...Object.fromEntries(todo.map((l, i) => [l.key, out[i] ?? null])),
        })),
      )
      .catch(() =>
        setEnglish((prev) => ({
          ...prev,
          ...Object.fromEntries(todo.map((l) => [l.key, null])),
        })),
      )
      .finally(() => todo.forEach((l) => pending.current.delete(l.key)));
  }, [lines, english, language]);

  // Review build only: poll the server-held flow state and tag the latest agent line.
  useEffect(() => {
    if (!review || !connected) return;
    let stop = false;
    const tick = async () => {
      try {
        const p = await getCallProgress({ agent_id: agentId, preview_token: previewToken, call_id: callId });
        const last = [...linesRef.current].reverse().find((l) => l.role === "agent");
        if (!stop && last && p.active_flow) {
          setTags((prev) => (prev[last.key] ? prev : { ...prev, [last.key]: `${p.active_flow} · step ${p.step}` }));
        }
      } catch {
        /* tags are a review aid; ignore */
      }
    };
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [review, connected, agentId, previewToken, callId]);

  useRTVIClientEvent(
    RTVIEvent.BotStartedSpeaking,
    useCallback(() => setBotSpeaking(true), []),
  );
  useRTVIClientEvent(
    RTVIEvent.BotStoppedSpeaking,
    useCallback(() => setBotSpeaking(false), []),
  );
  useRTVIClientEvent(
    RTVIEvent.UserStartedSpeaking,
    useCallback(() => setUserSpeaking(true), []),
  );
  useRTVIClientEvent(
    RTVIEvent.UserStoppedSpeaking,
    useCallback(() => setUserSpeaking(false), []),
  );

  const status = error
    ? "Call couldn't start"
    : !connected
      ? "Connecting…"
      : botSpeaking
        ? "Agent is speaking…"
        : userSpeaking
          ? "You're speaking…"
          : "Agent is listening…";

  return (
    <section className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 pb-10 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-7 rounded-[24px] border border-v-line bg-white px-6 py-10">
        <span
          className={`inline-flex items-center gap-2 rounded-v-sm px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[.12em] ${
            connected
              ? "bg-v-danger-pale text-v-danger"
              : "bg-v-soft text-v-muted-2"
          }`}
        >
          <span
            className={`size-2 rounded-full ${connected ? "bg-v-danger animate-pulse" : "bg-v-faint"}`}
          />
          {connected
            ? `Live · ${clock(seconds)}`
            : error
              ? "Not connected"
              : "Connecting"}
        </span>

        <div className="flex size-[200px] items-center justify-center rounded-full bg-v-pale sm:size-[220px]">
          <div className="flex size-[138px] items-center justify-center rounded-full bg-v-fg sm:size-[150px]">
            <VoiceVisualizer
              participantType="local"
              backgroundColor="transparent"
              barColor={botSpeaking ? accent : "rgba(255,255,255,0.85)"}
              barCount={5}
              barGap={6}
              barWidth={8}
              barMaxHeight={56}
              barOrigin="center"
            />
          </div>
        </div>

        <span className="text-[19px] font-semibold" aria-live="polite">
          {status}
        </span>
        {error ? (
          <span className="max-w-sm text-center text-[13.5px] text-v-danger">
            {error}
          </span>
        ) : null}

        {error ? (
          <Button
            variant="dark"
            onClick={onFailed}
            className="!rounded-full !px-6 !py-3.5 !text-[15px]"
          >
            Back to my agent
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!connected}
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
              aria-pressed={!micOn}
              onClick={() => {
                const next = !micOn;
                setMicOn(next);
                enableMic(next);
              }}
              className="flex size-12 items-center justify-center rounded-full border border-v-line bg-white text-v-fg transition-colors hover:bg-v-soft disabled:opacity-40"
            >
              {micOn ? (
                <Mic className="size-5" strokeWidth={1.9} />
              ) : (
                <MicOff className="size-5" strokeWidth={1.9} />
              )}
            </button>
            <Button
              variant="dark"
              onClick={() => void finish()}
              className="!rounded-full !px-6 !py-3.5 !text-[15px]"
            >
              <X className="size-4" strokeWidth={2.2} />
              End call
            </Button>
          </div>
        )}
        <div className="w-full max-w-[420px]">
          <RoleCard role={role} compact />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[.14em] text-v-muted-2">
          Live transcript · one question per turn
        </span>
        <div
          ref={transcriptRef}
          className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1"
        >
          {lines.map((l) => (
            <div
              key={l.key}
              className={`flex max-w-[88%] flex-col gap-1 rounded-v-xl px-5 py-3.5 ${
                l.role === "user"
                  ? "self-end bg-v-pale"
                  : "self-start border border-v-line bg-white"
              }`}
            >
              <span className="text-[13px] font-semibold text-v-muted-2">
                {l.role === "agent" ? "Agent" : "You"}
              </span>
              <span
                lang={language}
                className="text-[16px] leading-relaxed text-v-fg"
              >
                {l.text}
              </span>
              {l.english ? (
                <span className="text-[14px] text-v-muted-2">{l.english}</span>
              ) : null}
              {review && tags[l.key] ? (
                <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-v-accent">
                  {tags[l.key]}
                </span>
              ) : null}
            </div>
          ))}
          {review ? (
            <span className="text-[12px] text-v-muted">Step tags are for the team&apos;s review build only, not shown to visitors.</span>
          ) : null}
          {connected && !botSpeaking ? (
            <span className="flex items-center gap-2 text-[14px] text-v-muted-2">
              <span className="flex gap-1" aria-hidden="true">
                <span className="size-1.5 animate-pulse rounded-full bg-v-fg" />
                <span className="size-1.5 animate-pulse rounded-full bg-v-faint [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-v-disabled [animation-delay:300ms]" />
              </span>
              Listening
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
