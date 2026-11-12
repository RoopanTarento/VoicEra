"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import {
  RTVIEvent,
  type LLMFunctionCallStartedData,
  type LLMFunctionCallStoppedData,
  type RTVIMessage,
} from "@pipecat-ai/client-js";
import {
  PipecatClientAudio,
  PipecatClientProvider,
  VoiceVisualizer,
  usePipecatClient,
  usePipecatClientMicControl,
  usePipecatClientTransportState,
  usePipecatConversation,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { AgentDraftCard, AgentUpdateDraftCard, type AgentDraft, type AgentUpdateDraft } from "./CopilotPanel";
import { connectCopilotVoice, createCopilotVoicePipecatClient } from "@/lib/pipecat/createCopilotVoiceClient";

// Mirrors the ASK/BUILD/ANALYZE + TOOL_EXECUTION states a live voice
// conversation actually passes through — driven by real RTVI events, not a
// generic spinner, so the state on screen always matches the pipeline state.
type VoiceState = "connecting" | "listening" | "thinking" | "tool_execution" | "speaking" | "error";

const STATE_LABEL: Record<VoiceState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  tool_execution: "Checking",
  speaking: "Speaking",
  error: "Connection error",
};

// Kept in sync with toolLabel() in CopilotPanel.tsx — voice registers every
// text-Copilot tool (see copilot_voice_tool_names), so this needs the same
// full coverage or a real tool call falls back to its raw snake_case name.
const TOOL_LABELS: Record<string, string> = {
  list_agents: "Looking up your agents",
  get_agent: "Reading agent configuration",
  list_calls: "Looking up recent calls",
  get_call: "Reading call detail",
  get_analytics_summary: "Analysing call performance",
  list_campaigns: "Looking up campaigns",
  list_knowledge_documents: "Checking the knowledge base",
  list_available_providers: "Checking connected voices and models",
  list_recent_activity: "Checking the activity log",
  search_knowledge_base: "Searching the knowledge base",
  propose_create_agent: "Drafting the agent",
  propose_update_agent: "Drafting the update",
  propose_create_campaign: "Drafting the campaign",
};

// A small "thinking" indicator — three dots breathing in sequence, the
// voice-orb equivalent of a text chat's typing indicator. Deliberately
// calmer than the tool-execution sweep below: thinking is the model
// composing a reply, not doing visible work against real data.
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-white/80 animate-v-live"
          style={{ animationDelay: `${i * 0.22}s` }}
        />
      ))}
    </div>
  );
}

// A rotating arc around the orb's own ring — reserved for tool_execution
// only, so "the model is reading/writing something real" always looks
// different from "the model is thinking." Built from a conic-gradient
// masked down to a thin ring rather than a generic spinner glyph, so it
// reads as the orb itself doing work, not a loading icon pasted on top.
function ToolExecutionSweep() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-[3px] animate-v-spin rounded-full"
      style={{
        background: "conic-gradient(from 0deg, transparent 0deg, var(--v-warning) 80deg, transparent 150deg)",
        WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
        mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
      }}
    />
  );
}

function VoiceOrb({ state }: { state: VoiceState }) {
  const isActive = state === "listening" || state === "speaking";
  const ringClass =
    state === "speaking"
      ? "border-v-accent"
      : state === "error"
        ? "border-v-danger"
        : state === "tool_execution"
          ? "border-v-warning"
          : "border-v-line-strong";

  return (
    <div className="relative flex size-32 items-center justify-center">
      {/* A real "still listening" affordance, not decoration — only runs
          while genuinely listening, using the same ripple keyframe already
          in the design system (v-pulse), just not applied anywhere yet. */}
      {state === "listening" ? (
        <>
          <span className="absolute inset-0 animate-v-pulse rounded-full border border-v-accent/60" />
          <span
            className="absolute inset-0 animate-v-pulse rounded-full border border-v-accent/60"
            style={{ animationDelay: "0.9s" }}
          />
        </>
      ) : null}
      {/* A quieter, neutral-toned version of the same ripple while the
          session is still coming up — "warming up," not "hearing you." */}
      {state === "connecting" ? (
        <>
          <span className="absolute inset-0 animate-v-pulse rounded-full border border-v-line-strong/70" />
          <span
            className="absolute inset-0 animate-v-pulse rounded-full border border-v-line-strong/70"
            style={{ animationDelay: "0.9s" }}
          />
        </>
      ) : null}
      {state === "tool_execution" ? <ToolExecutionSweep /> : null}
      <motion.div
        animate={state === "error" ? { x: [0, -5, 5, -4, 4, -2, 2, 0] } : { x: 0 }}
        transition={{ duration: 0.45, ease: "easeInOut" }}
        className={`relative flex size-32 items-center justify-center rounded-full border-2 bg-v-fg transition-colors duration-300 ${ringClass}`}
      >
        <motion.div
          animate={{ scale: isActive ? [1, 1.05, 1] : 1, opacity: isActive ? [0.5, 0.8, 0.5] : 0.4 }}
          transition={{ duration: 1.8, repeat: isActive ? Infinity : 0, ease: "easeInOut" }}
          className="absolute inset-2 rounded-full bg-white/5"
        />
        {state === "thinking" || state === "connecting" ? (
          <ThinkingDots />
        ) : state === "tool_execution" ? (
          <Spinner />
        ) : (
          <VoiceVisualizer
            participantType={state === "speaking" ? "bot" : "local"}
            backgroundColor="transparent"
            barColor={state === "speaking" ? "rgba(110,231,183,0.95)" : "rgba(255,255,255,0.9)"}
            barCount={5}
            barGap={5}
            barWidth={7}
            barMaxHeight={48}
            barOrigin="center"
          />
        )}
      </motion.div>
    </div>
  );
}

function VoiceSession({ onEnd }: { onEnd: () => void }) {
  const client = usePipecatClient();
  const transportState = usePipecatClientTransportState();
  const { enableMic } = usePipecatClientMicControl();
  const { messages } = usePipecatConversation();

  const [state, setState] = useState<VoiceState>("connecting");
  const [toolName, setToolName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [draft, setDraft] = useState<
    { kind: "create"; draft: AgentDraft } | { kind: "update"; draft: AgentUpdateDraft } | null
  >(null);

  const isConnected = transportState === "ready" || transportState === "connected";
  // Derived, not a separate effect+setState: avoids a redundant render just
  // to flip "connecting" to "listening" once the transport reports ready.
  const displayState: VoiceState = state === "connecting" && isConnected ? "listening" : state;

  useRTVIClientEvent(RTVIEvent.UserStartedSpeaking, useCallback(() => setState("listening"), []));
  useRTVIClientEvent(RTVIEvent.UserStoppedSpeaking, useCallback(() => setState("thinking"), []));
  useRTVIClientEvent(RTVIEvent.BotStartedSpeaking, useCallback(() => setState("speaking"), []));
  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking, useCallback(() => setState("listening"), []));

  useRTVIClientEvent(
    RTVIEvent.LLMFunctionCallStarted,
    useCallback((data: LLMFunctionCallStartedData) => {
      setState("tool_execution");
      setToolName(data.function_name ?? null);
    }, []),
  );
  useRTVIClientEvent(
    RTVIEvent.LLMFunctionCallStopped,
    useCallback((data: LLMFunctionCallStoppedData) => {
      setToolName(null);
      setState("thinking");
      if (data.result && typeof data.result === "object") {
        const result = data.result as Record<string, unknown>;
        if (typeof result.draft_id === "string") {
          if (data.function_name === "propose_create_agent") {
            setDraft({ kind: "create", draft: result as unknown as AgentDraft });
          } else if (data.function_name === "propose_update_agent") {
            setDraft({ kind: "update", draft: result as unknown as AgentUpdateDraft });
          }
        }
      }
    }, []),
  );
  useRTVIClientEvent(RTVIEvent.Disconnected, useCallback(() => onEnd(), [onEnd]));
  useRTVIClientEvent(
    RTVIEvent.Error,
    useCallback((msg: RTVIMessage) => {
      const data = msg.data as { message?: string } | undefined;
      setError(data?.message || "Voice connection error");
      setState("error");
    }, []),
  );

  function toggleMic() {
    const next = !micEnabled;
    setMicEnabled(next);
    enableMic(next);
  }

  async function handleEnd() {
    try {
      await client?.disconnect();
    } catch {
      /* ignore */
    }
    onEnd();
  }

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-4);

  return (
    <div className="flex h-full flex-col items-center justify-between px-6 py-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <VoiceOrb state={displayState} />
        {/* role="status" + aria-live: the orb's colour/motion carries the
            state to sighted users, but a screen-reader user needs the same
            listening/thinking/speaking transitions announced as they
            happen, not just once on mount. */}
        <span
          role="status"
          aria-live="polite"
          className="text-[12px] font-medium uppercase tracking-[.1em] text-v-muted"
        >
          {displayState === "tool_execution"
            ? (toolName ? TOOL_LABELS[toolName] ?? "Working on it" : "Working on it")
            : STATE_LABEL[displayState]}
        </span>
        {error ? (
          <span role="alert" className="max-w-[260px] text-center text-[12px] text-v-danger-deep">
            {error}
          </span>
        ) : null}
        {draft ? (
          <div className="w-full max-w-[280px]">
            {draft.kind === "create" ? (
              <AgentDraftCard draft={draft.draft} />
            ) : (
              <AgentUpdateDraftCard draft={draft.draft} />
            )}
          </div>
        ) : null}
      </div>

      <div className="flex w-full flex-col gap-3">
        {visibleMessages.length > 0 ? (
          <div className="flex max-h-32 flex-col gap-1.5 overflow-y-auto rounded-v-sm bg-v-soft p-3 text-[12.5px] leading-relaxed">
            {visibleMessages.map((m, i) => (
              <p key={`${m.createdAt}-${i}`} className={m.role === "user" ? "text-v-fg" : "text-v-muted"}>
                <span className="font-medium">{m.role === "user" ? "You: " : "Agent Builder: "}</span>
                {m.parts
                  .map((p) => (typeof p.text === "string" ? p.text : ""))
                  .join(" ")
                  .trim()}
              </p>
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
            aria-pressed={!micEnabled}
            onClick={toggleMic}
            className={`flex size-11 cursor-pointer items-center justify-center rounded-full border transition-colors ${
              micEnabled
                ? "border-v-line-strong bg-v-panel text-v-fg hover:bg-v-soft"
                : "border-v-danger-line bg-v-danger-pale text-v-danger-deep"
            }`}
          >
            {micEnabled ? <Mic className="size-4" strokeWidth={1.8} /> : <MicOff className="size-4" strokeWidth={1.8} />}
          </button>
          <Button variant="danger-outline" size="md" onClick={() => void handleEnd()}>
            <PhoneOff className="size-4" strokeWidth={1.8} /> End
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Live spoken conversation with the Copilot — real streaming STT/LLM/TTS
 * over the same Pipecat infrastructure regular VoicERA agent calls use
 * (apps/runtime), not a browser-speech-recognition-to-text-chat shim.
 * Interruption/barge-in comes from Pipecat's own VAD + turn-taking, not
 * anything built here. */
export function CopilotVoiceMode({
  conversationId,
  onClose,
}: {
  conversationId?: string;
  onClose: () => void;
}) {
  const [client] = useState(() => createCopilotVoicePipecatClient());
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void connectCopilotVoice(client, conversationId).catch((err) => {
      if (!cancelled) {
        setConnectError(err instanceof Error ? err.message : "Couldn't start voice mode.");
      }
    });
    return () => {
      cancelled = true;
      void client.disconnect().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  if (connectError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="text-[13px] text-v-danger-deep">{connectError}</span>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <PipecatClientProvider client={client}>
      <PipecatClientAudio />
      <VoiceSession onEnd={onClose} />
    </PipecatClientProvider>
  );
}
