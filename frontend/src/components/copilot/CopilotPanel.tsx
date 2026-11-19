"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Compass,
  Download,
  FileSpreadsheet,
  Ghost,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  Mic,
  Paperclip,
  Pencil,
  Phone,
  Search,
  Send,
  Sparkles,
  Square,
  SquarePen,
  TrendingUp,
  X,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { Button, IconButton } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { useAuth } from "@/components/AuthProvider";
import { useWalkthrough } from "@/components/walkthrough";
import { useCopilot, type CopilotChatMessage, type CopilotToolEvent } from "@/hooks/useCopilot";
import { getAgent, listAgents } from "@/lib/api-client";
import {
  confirmAgentDraft,
  confirmCampaignDraft,
  dismissAgentDraft,
  dismissCampaignDraft,
} from "@/lib/api/copilot";
import { downloadAnalyticsPdf } from "@/lib/report";
import { maskPhoneNumber } from "@/lib/format";
import { CopilotHistoryMenu } from "./CopilotHistoryMenu";
import { CopilotIntroTour, CopilotIntroTourButton, hasSeenIntro } from "./CopilotIntroTour";
import { useCopilotUi } from "./CopilotProvider";
import { CopilotVoiceMode } from "./CopilotVoiceMode";
import {
  ATTACHMENT_ACCEPT,
  CopilotAttachmentImage,
  DropOverlay,
  PendingAttachmentStrip,
  filesFromClipboard,
  useCopilotAttachments,
  useFileDrop,
} from "./attachments";
import type {
  AgentApiResponse,
  CallAnalyticsResponse,
  CopilotContext,
} from "@/lib/api-types";

const STARTER_PROMPTS = ["How do integrations work?", "What should I configure first?"];


function toolLabel(tool: string): string {
  switch (tool) {
    case "list_agents":
      return "Looking up your agents";
    case "get_agent":
      return "Reading agent configuration";
    case "list_calls":
      return "Looking up recent calls";
    case "get_call":
      return "Reading call detail";
    case "get_analytics_summary":
      return "Analysing call performance";
    case "list_campaigns":
      return "Looking up campaigns";
    case "list_knowledge_documents":
      return "Checking the knowledge base";
    case "search_knowledge_base":
      return "Searching the knowledge base";
    case "list_available_providers":
      return "Checking connected voices and models";
    case "list_recent_activity":
      return "Checking the activity log";
    case "propose_create_agent":
      return "Drafting the agent";
    case "propose_update_agent":
      return "Drafting the update";
    case "propose_create_campaign":
      return "Drafting the campaign";
    case "read_images":
      return "Reading your images";
    default:
      return tool;
  }
}

/** "Thinking" indicator built from the same frequency-bar motif as the
 * VoicEra brand mark — five bars animated with `v-bar`, the exact keyframe
 * the sign-in hero uses for its live voice-level meter (see AuthHero.tsx),
 * so every "VoicEra is working" moment reads as one consistent brand
 * animation instead of a generic spinner or dot pulse. */
function ThinkingWave() {
  return (
    <span className="inline-flex h-3.5 items-center gap-[3px] py-1" aria-label="Thinking" role="status">
      {[0, 0.12, 0.24, 0.36, 0.48].map((delay, i) => (
        <span
          key={i}
          style={{ animationDelay: `${delay}s` }}
          className={`h-full w-[2.5px] origin-center animate-v-bar rounded-full ${
            i === 2 ? "bg-v-accent" : "bg-v-accent/40"
          }`}
        />
      ))}
    </span>
  );
}

/** A small, on-brand "thinking" orb for genuinely long waits (a rate-limit
 * retry, a slow model) — real, clearly-visible motion (a rotating gradient
 * sweep ring plus a breathing core), not a subtle background-position shift
 * that reads as static at small sizes. Two real states: 'thinking' (calm,
 * default while streaming with nothing to show yet) and 'waiting' (faster,
 * more pronounced — a retry_wait event, so it reads as "still actively
 * working," not stalled). ThinkingWave's quick bars still cover ordinary
 * brief "working" moments elsewhere. */
export function BuilderOrb({
  size = 40,
  state = "thinking",
}: {
  size?: number;
  state?: "thinking" | "waiting";
}) {
  const waiting = state === "waiting";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <span
        className={`absolute inset-0 rounded-full ${waiting ? "animate-v-spin-fast" : "animate-v-spin"}`}
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, var(--v-accent) 120deg, #22c58f 200deg, transparent 320deg)",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2.5px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2.5px))",
        }}
      />
      <span
        className={`absolute inset-[3px] rounded-full bg-[linear-gradient(135deg,var(--v-accent-deep),var(--v-accent)_55%,#22c58f)] ${
          waiting ? "animate-v-breathe-fast" : "animate-v-breathe"
        }`}
      />
    </div>
  );
}

/** A live "what the AI is doing right now" trail — real tool-call events,
 * not a fabricated progress bar. Shown only while a message is still
 * streaming; once it finishes, this disappears and the ordinary rich
 * ToolResultCards + final text are all that remain (unchanged from before).
 * "Understanding request" is a fair label for the model-generation phase
 * that always precedes the first real tool call in this architecture, not
 * a step the backend actually reports — every step after it is real. */
function ExecutionTrail({ events }: { events: CopilotToolEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-v-sm border border-v-line bg-v-soft px-3 py-2.5">
      <span className="flex items-center gap-2 text-[11.5px] text-v-muted">
        <Check className="size-3 shrink-0 text-v-success-deep" strokeWidth={2.5} />
        Understanding request
      </span>
      {events.map((e, i) => (
        <span key={`${e.tool}-${i}`} className="flex items-center gap-2 text-[11.5px] text-v-muted">
          {e.status === "done" ? (
            <Check
              className={`size-3 shrink-0 ${e.ok === false ? "text-v-danger-deep" : "text-v-success-deep"}`}
              strokeWidth={2.5}
            />
          ) : (
            <span className="flex size-3 shrink-0 items-center justify-center">
              <span className="size-1.5 animate-v-live rounded-full bg-v-accent" />
            </span>
          )}
          {toolLabel(e.tool)}
          {e.status === "done" && e.ok === false ? (
            <span className="text-v-danger-deep">— didn&apos;t work</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

interface AgentRow {
  agent_id: string;
  name: string;
  primary_language?: string | null;
  llm?: string | null;
}

interface AgentDetail {
  agent_id: string;
  name: string;
  agent_category?: string | null;
  language?: { primary?: string } | null;
  models?: { llm_config?: { model?: string } } | null;
  knowledge_base?: { enabled?: boolean; document_ids?: string[] } | null;
}

interface CallRow {
  call_id: string;
  call_type?: string | null;
  to_number?: string | null;
  from_number?: string | null;
  call_response?: string | null;
  status?: string | null;
  duration?: number | null;
}

/** The contact's side of a call, masked (the caller on inbound, the callee otherwise). */
function callRowLabel(c: CallRow): string {
  const contact = c.call_type === "inbound" ? c.from_number : c.to_number || c.from_number;
  const masked = maskPhoneNumber(contact);
  return masked === "–" ? c.call_id : masked;
}

interface CallDetail extends CallRow {
  error_message?: string | null;
}

interface CampaignRow {
  campaign_id: string;
  name: string;
  state: string;
  processed_rows: number;
  total_rows: number;
}

interface DocumentRow {
  document_id: string;
  original_filename: string;
  status: string;
}

interface KbResultRow {
  source_filename?: string | null;
  text: string;
}

interface ActivityEventRow {
  entity_type: string;
  entity_id?: string | null;
  entity_name?: string | null;
  action: string;
  actor_email: string;
  detail?: string | null;
  created_at: string;
}

/** Where an activity row's entity actually lives, if it has a real page —
 * mirrors the route map in engine.py's system prompt. Calls/campaigns/etc.
 * with no per-item route intentionally aren't listed here. */
const ACTIVITY_ENTITY_HREF: Record<string, (id: string) => string> = {
  agent: (id) => `/agents/${id}/edit`,
};

function activityLine(event: ActivityEventRow): string {
  const who = event.actor_email;
  const what = event.entity_name || event.entity_type;
  switch (event.action) {
    case "created":
      return `${who} created ${what}`;
    case "updated":
      return `${who} updated ${what}`;
    case "deleted":
      return `${who} deleted ${what}`;
    case "started":
      return `${who} started ${what}`;
    case "paused":
      return `${who} paused ${what}`;
    case "resumed":
      return `${who} resumed ${what}`;
    case "linked":
      return `${who} linked ${what}`;
    case "unlinked":
      return `${who} unlinked ${what}`;
    case "invited":
      return `${who} invited ${what}`;
    case "removed":
      return `${who} removed ${what}`;
    case "role_changed":
      return `${who} changed ${what}'s role${event.detail ? ` (${event.detail})` : ""}`;
    default:
      return `${who} — ${event.action} — ${what}`;
  }
}

export interface AgentDraft {
  draft_id: string;
  name: string;
  purpose: string;
  agent_category: string;
  primary_language: string;
  system_prompt: string;
  greeting_message: string;
  llm?: string | null;
  stt?: string | null;
  tts?: string | null;
  tts_voice?: string | null;
  knowledge_base_enabled?: boolean;
  knowledge_base_document_count?: number;
  /** Honest per-field provenance the model reported when proposing this
   * draft — 'user_selected' | 'inferred' | 'recommended'. Never assume a
   * missing entry means anything beyond "not labelled"; render nothing for
   * an unlabelled field rather than guessing a status for it. */
  field_provenance?: Record<string, string>;
}

const PROVENANCE_LABEL: Record<string, string> = {
  user_selected: "you said this",
  inferred: "inferred",
  recommended: "recommended",
};

/** Small, honest provenance tag next to a draft field — never rendered for
 * an unlabelled field, so silence means "the model didn't say," not "this
 * was confirmed." Keeps inferences and defaults visually distinct from
 * what the user actually typed, per the trust requirement this exists for. */
function ProvenanceTag({ provenance, field }: { provenance?: Record<string, string>; field: string }) {
  const value = provenance?.[field];
  if (!value || !(value in PROVENANCE_LABEL)) return null;
  const tone =
    value === "user_selected"
      ? "border-v-line-strong text-v-muted"
      : value === "inferred"
        ? "border-v-accent/40 text-v-accent-deep"
        : "border-v-warning/40 text-v-warning-deep";
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[.04em] ${tone}`}>
      {PROVENANCE_LABEL[value]}
    </span>
  );
}

/** The one card that can produce a real write — and only when the user
 * clicks Create. Mirrors the propose -> preview -> confirm flow in
 * engine.py's system prompt; this component is where "confirm" lives. */
export function AgentDraftCard({
  draft,
  onCreated,
}: {
  draft: AgentDraft;
  /** Real agent_id the confirm call actually returned — lets the page thread
   * it into subsequent chat turns' context, so "make it more formal" right
   * after creating resolves to this exact agent instead of needing another
   * lookup round trip or the user naming it again. */
  onCreated?: (agentId: string) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "created" | "dismissed" | "error">("idle");
  const [error, setError] = useState("");
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function handleConfirm() {
    setState("busy");
    setError("");
    try {
      const result = await confirmAgentDraft(draft.draft_id);
      setCreatedAgentId(result.agent_id);
      setState("created");
      onCreated?.(result.agent_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the agent.");
      setState("error");
    }
  }

  async function handleDismiss() {
    setState("busy");
    try {
      await dismissAgentDraft(draft.draft_id);
    } catch {
      /* draft may already be resolved — dismiss client-side regardless */
    }
    setState("dismissed");
  }

  if (state === "dismissed") {
    return (
      <div className="rounded-v-sm border border-v-line bg-v-soft px-3 py-2 text-[12px] text-v-muted">
        Draft dismissed — nothing was created.
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-v-md border p-3.5 ${
        state === "created" ? "border-v-success/30 bg-v-panel" : "border-v-accent/30 bg-v-panel"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-[11px] font-medium uppercase tracking-[.06em] ${
            state === "created" ? "text-v-success-deep" : "text-v-accent"
          }`}
        >
          {state === "created" ? "Agent created — this is its real configuration" : "Proposed agent — not yet created"}
        </span>
      </div>
      <span className="text-[14px] font-semibold text-v-fg">{draft.name}</span>
      <span className="text-[12px] text-v-muted">{draft.purpose}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-v-faint">
        <span className="flex items-center gap-1.5">
          Language: {draft.primary_language}
          <ProvenanceTag provenance={draft.field_provenance} field="primary_language" />
        </span>
        <span>Delivery: {draft.agent_category === "websocket" ? "Browser test" : draft.agent_category}</span>
        {draft.tts_voice ? (
          <span className="flex items-center gap-1.5">
            Voice: {draft.tts_voice}
            <ProvenanceTag provenance={draft.field_provenance} field="tts_voice" />
          </span>
        ) : null}
        {draft.knowledge_base_enabled ? (
          <span className="flex items-center gap-1.5">
            Knowledge base: {draft.knowledge_base_document_count ?? 0} document
            {draft.knowledge_base_document_count === 1 ? "" : "s"} attached
            <ProvenanceTag provenance={draft.field_provenance} field="knowledge_base" />
          </span>
        ) : null}
      </div>
      {draft.system_prompt ? (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[.06em] text-v-faint">
            System prompt
          </span>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-v-sm bg-v-soft px-2.5 py-2 text-[12px] leading-relaxed text-v-fg">
            {draft.system_prompt}
          </p>
        </div>
      ) : null}
      <p className="rounded-v-sm bg-v-soft px-2.5 py-2 text-[12px] italic text-v-muted">
        &ldquo;{draft.greeting_message}&rdquo;
      </p>

      {draft.llm || draft.stt || draft.tts ? (
        <div className="flex flex-col gap-1.5 border-t border-v-hairline pt-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex cursor-pointer items-center gap-1 text-[10.5px] font-medium uppercase tracking-[.06em] text-v-muted hover:text-v-fg"
          >
            <ChevronDown
              className={`size-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              strokeWidth={2}
            />
            Advanced configuration
          </button>
          {advancedOpen ? (
            <div className="flex flex-col gap-1 text-[11px] text-v-faint">
              {draft.llm ? (
                <span className="flex items-center gap-1.5">
                  LLM model: {draft.llm}
                  <ProvenanceTag provenance={draft.field_provenance} field="llm" />
                </span>
              ) : null}
              {draft.stt ? (
                <span className="flex items-center gap-1.5">
                  STT model: {draft.stt}
                  <ProvenanceTag provenance={draft.field_provenance} field="stt" />
                </span>
              ) : null}
              {draft.tts ? (
                <span className="flex items-center gap-1.5">
                  TTS model: {draft.tts}
                  {draft.tts_voice ? ` (voice: ${draft.tts_voice})` : ""}
                  <ProvenanceTag provenance={draft.field_provenance} field="tts" />
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {state === "created" ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-v-success-deep">
              <Check className="size-3.5" strokeWidth={2.5} /> Created
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => createdAgentId && router.push(`/agents/${createdAgentId}/edit`)}
            >
              Open agent
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-v-faint">
            Everything above is its real, saved configuration. Keep talking here to change anything — the
            prompt, voice, language, or behaviour — no need to open the page.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={handleConfirm} disabled={state === "busy"}>
            {state === "busy" ? <Spinner /> : "Create agent"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss} disabled={state === "busy"}>
            <X className="size-3.5" strokeWidth={2} /> Dismiss
          </Button>
        </div>
      )}
      {state === "error" && error ? (
        <span className="text-[12px] text-v-danger-deep">{error}</span>
      ) : null}
    </div>
  );
}

export interface AgentUpdateDraft {
  draft_id: string;
  agent_id: string;
  agent_name: string;
  new_name?: string | null;
  changes: string[];
}

/** Same propose -> preview -> confirm pattern as AgentDraftCard, but for a
 * REAL existing agent — confirming calls agent_service.update_agent (via
 * the same /agent-drafts/{id}/confirm endpoint, branched server-side on the
 * draft's entity_type) instead of create_agent. Shows what's changing, not
 * a full config dump, since everything else on the real agent is untouched. */
export function AgentUpdateDraftCard({
  draft,
  onUpdated,
}: {
  draft: AgentUpdateDraft;
  /** Fired with the real agent_id once the update is actually saved — lets
   * the page keep threading it into context for further prompt-based edits. */
  onUpdated?: (agentId: string) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "updated" | "dismissed" | "error">("idle");
  const [error, setError] = useState("");

  async function handleConfirm() {
    setState("busy");
    setError("");
    try {
      await confirmAgentDraft(draft.draft_id);
      setState("updated");
      onUpdated?.(draft.agent_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the agent.");
      setState("error");
    }
  }

  async function handleDismiss() {
    setState("busy");
    try {
      await dismissAgentDraft(draft.draft_id);
    } catch {
      /* draft may already be resolved — dismiss client-side regardless */
    }
    setState("dismissed");
  }

  if (state === "dismissed") {
    return (
      <div className="rounded-v-sm border border-v-line bg-v-soft px-3 py-2 text-[12px] text-v-muted">
        Draft dismissed — nothing was changed.
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-v-md border p-3.5 ${
        state === "updated" ? "border-v-success/30 bg-v-panel" : "border-v-accent/30 bg-v-panel"
      }`}
    >
      <span
        className={`text-[11px] font-medium uppercase tracking-[.06em] ${
          state === "updated" ? "text-v-success-deep" : "text-v-accent"
        }`}
      >
        {state === "updated" ? "Saved — this is now the real configuration" : "Proposed update — not yet saved"}
      </span>
      <span className="text-[14px] font-semibold text-v-fg">
        {draft.agent_name}
        {draft.new_name && draft.new_name !== draft.agent_name ? (
          <span className="font-normal text-v-muted"> → {draft.new_name}</span>
        ) : null}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {draft.changes.map((c) => (
          <span
            key={c}
            className="rounded-full border border-v-accent/40 bg-v-pale px-2.5 py-1 text-[11px] font-medium text-v-accent-deep"
          >
            {c}
          </span>
        ))}
      </div>

      {state === "updated" ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-v-success-deep">
              <Check className="size-3.5" strokeWidth={2.5} /> Updated
            </span>
            <Button size="sm" variant="outline" onClick={() => router.push(`/agents/${draft.agent_id}/edit`)}>
              Open agent
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-v-faint">
            Keep talking here for more changes — no need to open the page.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={handleConfirm} disabled={state === "busy"}>
            {state === "busy" ? <Spinner /> : "Update agent"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss} disabled={state === "busy"}>
            <X className="size-3.5" strokeWidth={2} /> Dismiss
          </Button>
        </div>
      )}
      {state === "error" && error ? (
        <span className="text-[12px] text-v-danger-deep">{error}</span>
      ) : null}
    </div>
  );
}

export interface CampaignDraft {
  draft_id: string;
  name: string;
  agent_id: string;
  agent_name?: string | null;
  source_id: string;
  rate_limit_per_second: number;
  max_concurrency: number;
}

/** Same propose -> preview -> confirm pattern as AgentDraftCard, for
 * campaigns proposed via propose_create_campaign. */
export function CampaignDraftCard({ draft }: { draft: CampaignDraft }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "created" | "dismissed" | "error">("idle");
  const [error, setError] = useState("");
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);

  async function handleConfirm() {
    setState("busy");
    setError("");
    try {
      const result = await confirmCampaignDraft(draft.draft_id);
      setCreatedCampaignId(result.campaign_id);
      setState("created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the campaign.");
      setState("error");
    }
  }

  async function handleDismiss() {
    setState("busy");
    try {
      await dismissCampaignDraft(draft.draft_id);
    } catch {
      /* draft may already be resolved — dismiss client-side regardless */
    }
    setState("dismissed");
  }

  if (state === "dismissed") {
    return (
      <div className="rounded-v-sm border border-v-line bg-v-soft px-3 py-2 text-[12px] text-v-muted">
        Draft dismissed — nothing was created.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-v-md border border-v-accent/30 bg-v-panel p-3.5">
      <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-accent">
        Proposed campaign — not yet created
      </span>
      <span className="text-[14px] font-semibold text-v-fg">{draft.name}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-v-faint">
        <span>Agent: {draft.agent_name ?? draft.agent_id}</span>
        <span>Rate: {draft.rate_limit_per_second}/s</span>
        <span>Max concurrency: {draft.max_concurrency}</span>
      </div>

      {state === "created" ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-v-success-deep">
            <Check className="size-3.5" strokeWidth={2.5} /> Created
          </span>
          <Button size="sm" variant="outline" onClick={() => createdCampaignId && router.push("/batches")}>
            Open campaigns
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={handleConfirm} disabled={state === "busy"}>
            {state === "busy" ? <Spinner /> : "Create campaign"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss} disabled={state === "busy"}>
            <X className="size-3.5" strokeWidth={2} /> Dismiss
          </Button>
        </div>
      )}
      {state === "error" && error ? (
        <span className="text-[12px] text-v-danger-deep">{error}</span>
      ) : null}
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-v-sm border border-v-line bg-v-panel px-3 py-2">
      <span className="text-[10px] uppercase tracking-[.08em] text-v-faint">{label}</span>
      <span className="text-[15px] font-semibold text-v-fg">{value}</span>
    </div>
  );
}

/** A row inside a tool-result card that navigates to the real page it
 * refers to — same "navigate and close" behaviour as CopilotMarkdownLink,
 * so a card full of agents/calls/campaigns is a set of real shortcuts,
 * not just a read-only dump. */
function NavRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const { hide } = useCopilotUi();
  return (
    <button
      type="button"
      onClick={() => {
        hide();
        router.push(href);
      }}
      className="flex w-full cursor-pointer items-center justify-between gap-3 border-t border-v-hairline pt-1.5 text-left transition-colors first:border-0 first:pt-0 hover:text-v-accent"
    >
      {children}
    </button>
  );
}

/** Renders each tool's structured result as a small, purpose-built card
 * instead of a text/JSON dump — the "generative UI" slice of the Copilot. */
function ToolResultCard({ event }: { event: CopilotToolEvent }) {
  const router = useRouter();
  const { hide } = useCopilotUi();
  const { session } = useAuth();

  if (event.status === "pending") {
    return (
      <div className="flex items-center gap-2 rounded-v-sm border border-v-line bg-v-soft px-3 py-2 text-[12px] text-v-muted">
        <ThinkingWave />
        {toolLabel(event.tool)}…
      </div>
    );
  }

  if (!event.ok) {
    const message =
      event.data && typeof event.data === "object" && "error" in (event.data as Record<string, unknown>)
        ? String((event.data as Record<string, unknown>).error)
        : (event.summary?.replace(/^error:\s*/, "") ?? "This lookup failed.");
    return (
      <div className="rounded-v-sm border border-v-danger-line bg-v-danger-pale px-3 py-2 text-[12px] text-v-danger-deep">
        {message}
      </div>
    );
  }

  const data = (event.data ?? {}) as Record<string, unknown>;
  const count = typeof data.count === "number" ? data.count : 0;

  if (event.tool === "propose_create_agent" && typeof data.draft_id === "string") {
    return <AgentDraftCard draft={data as unknown as AgentDraft} />;
  }

  if (event.tool === "propose_update_agent" && typeof data.draft_id === "string") {
    return <AgentUpdateDraftCard draft={data as unknown as AgentUpdateDraft} />;
  }

  if (event.tool === "propose_create_campaign" && typeof data.draft_id === "string") {
    return <CampaignDraftCard draft={data as unknown as CampaignDraft} />;
  }

  if (event.tool === "list_agents" && Array.isArray(data.agents)) {
    const agents = data.agents as AgentRow[];
    return (
      <div className="flex flex-col gap-1.5 rounded-v-sm border border-v-line bg-v-panel p-3">
        <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
          {count} agent{count === 1 ? "" : "s"}
        </span>
        {agents.map((a) => (
          <NavRow key={a.agent_id} href={`/agents/${a.agent_id}/edit`}>
            <span className="truncate text-[13px] font-medium text-v-fg">{a.name}</span>
            <span className="shrink-0 text-[11px] text-v-muted">
              {a.primary_language ?? "—"} · {a.llm ?? "—"}
            </span>
          </NavRow>
        ))}
      </div>
    );
  }

  if (event.tool === "get_agent" && typeof data.agent_id === "string") {
    const agent = data as unknown as AgentDetail;
    return (
      <button
        type="button"
        onClick={() => {
          hide();
          router.push(`/agents/${agent.agent_id}/edit`);
        }}
        className="flex w-full cursor-pointer flex-col gap-1 rounded-v-sm border border-v-line bg-v-panel p-3 text-left text-[12px] transition-colors hover:border-v-accent"
      >
        <span className="text-[13px] font-semibold text-v-fg">{agent.name}</span>
        <span className="text-v-muted">
          {agent.agent_category} · {agent.language?.primary} · {agent.models?.llm_config?.model}
        </span>
        {agent.knowledge_base?.enabled ? (
          <span className="text-v-faint">
            Knowledge base attached ({agent.knowledge_base.document_ids?.length ?? 0} docs)
          </span>
        ) : null}
      </button>
    );
  }

  if (event.tool === "list_calls" && Array.isArray(data.calls)) {
    const calls = data.calls as CallRow[];
    return (
      <div className="flex flex-col gap-1 rounded-v-sm border border-v-line bg-v-panel p-3">
        <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
          {count} call{count === 1 ? "" : "s"}
        </span>
        {calls.slice(0, 8).map((c) => (
          <NavRow key={c.call_id} href="/history">
            <span className="truncate text-[12px] text-v-fg">{callRowLabel(c)}</span>
            <span className="shrink-0 text-[12px] text-v-muted">
              {c.call_response ?? c.status}
              {typeof c.duration === "number" ? ` · ${Math.round(c.duration)}s` : ""}
            </span>
          </NavRow>
        ))}
      </div>
    );
  }

  if (event.tool === "get_call" && typeof data.call_id === "string") {
    const call = data as unknown as CallDetail;
    return (
      <button
        type="button"
        onClick={() => {
          hide();
          router.push("/history");
        }}
        className="flex w-full cursor-pointer flex-col gap-1 rounded-v-sm border border-v-line bg-v-panel p-3 text-left text-[12px] transition-colors hover:border-v-accent"
      >
        <span className="text-[13px] font-semibold text-v-fg">Call {call.call_id.slice(0, 8)}</span>
        <span className="text-v-muted">
          {call.call_response ?? call.status}
          {typeof call.duration === "number" ? ` · ${Math.round(call.duration)}s` : ""}
        </span>
        {call.error_message ? <span className="text-v-danger-deep">{call.error_message}</span> : null}
      </button>
    );
  }

  if (event.tool === "get_analytics_summary" && "calls_attempted" in data) {
    const summary = data as unknown as CallAnalyticsResponse;
    const agentBars = (summary.agent_performance ?? [])
      .slice(0, 6)
      .map((a) => ({ name: a.agent_name ?? "Unknown", count: a.call_count }));
    return (
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2">
          <KpiTile label="Attempted" value={summary.calls_attempted} />
          <KpiTile label="Connected" value={summary.calls_connected} />
          <KpiTile label="Connection rate" value={`${summary.connection_rate}%`} />
          <KpiTile label="Avg duration" value={`${Math.round(summary.average_duration_seconds || 0)}s`} />
        </div>
        {agentBars.length > 0 ? (
          <div className="rounded-v-sm border border-v-line bg-v-panel p-3">
            <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
              Calls by agent
            </span>
            <ResponsiveContainer width="100%" height={agentBars.length > 3 ? 160 : 110}>
              <BarChart data={agentBars} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--v-muted)" }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--v-muted)" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, borderColor: "var(--v-line)", fontSize: 12.5 }} />
                <Bar dataKey="count" fill="var(--v-accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-v-hairline pt-1.5">
          <button
            type="button"
            onClick={() => {
              hide();
              router.push("/analytics");
            }}
            className="cursor-pointer text-[12px] font-medium text-v-accent transition-colors hover:text-v-accent-deep"
          >
            View full analytics
          </button>
          <button
            type="button"
            onClick={() =>
              downloadAnalyticsPdf(summary, {
                orgName: session?.orgName ?? "VoicEra",
                email: session?.email ?? "",
              })
            }
            className="flex cursor-pointer items-center gap-1 text-[12px] font-medium text-v-muted transition-colors hover:text-v-fg"
          >
            <Download className="size-3.5" strokeWidth={1.8} /> PDF
          </button>
        </div>
      </div>
    );
  }

  if (event.tool === "list_campaigns" && Array.isArray(data.campaigns)) {
    const campaigns = data.campaigns as CampaignRow[];
    return (
      <div className="flex flex-col gap-1 rounded-v-sm border border-v-line bg-v-panel p-3">
        <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
          {count} campaign{count === 1 ? "" : "s"}
        </span>
        {campaigns.map((c) => (
          <NavRow key={c.campaign_id} href="/batches">
            <span className="truncate text-[12px] text-v-fg">{c.name}</span>
            <span className="shrink-0 text-[12px] text-v-muted">
              {c.state} · {c.processed_rows}/{c.total_rows}
            </span>
          </NavRow>
        ))}
      </div>
    );
  }

  if (event.tool === "list_knowledge_documents" && Array.isArray(data.documents)) {
    const documents = data.documents as DocumentRow[];
    return (
      <div className="flex flex-col gap-1 rounded-v-sm border border-v-line bg-v-panel p-3">
        <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
          {count} document{count === 1 ? "" : "s"}
        </span>
        {documents.map((d) => (
          <NavRow key={d.document_id} href="/knowledge-base">
            <span className="truncate text-[12px] text-v-fg">{d.original_filename}</span>
            <span className="shrink-0 text-[12px] text-v-muted">{d.status}</span>
          </NavRow>
        ))}
      </div>
    );
  }

  if (event.tool === "list_recent_activity" && Array.isArray(data.events)) {
    const events = data.events as ActivityEventRow[];
    return (
      <div className="flex flex-col gap-1.5 rounded-v-sm border border-v-line bg-v-panel p-3">
        <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
          {count} event{count === 1 ? "" : "s"}
        </span>
        {events.length === 0 ? (
          <p className="text-[12px] text-v-muted">No activity recorded yet.</p>
        ) : (
          events.map((e, i) => {
            const hrefFor = e.entity_id ? ACTIVITY_ENTITY_HREF[e.entity_type] : undefined;
            const body = (
              <>
                <span className="truncate text-[12.5px] text-v-fg">{activityLine(e)}</span>
                <span className="shrink-0 text-[10.5px] text-v-faint">
                  {new Date(e.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </>
            );
            return hrefFor && e.entity_id ? (
              <NavRow key={i} href={hrefFor(e.entity_id)}>
                {body}
              </NavRow>
            ) : (
              <div
                key={i}
                className="flex items-center justify-between gap-3 border-t border-v-hairline pt-1.5 first:border-0 first:pt-0"
              >
                {body}
              </div>
            );
          })
        )}
      </div>
    );
  }

  if (event.tool === "search_knowledge_base" && Array.isArray(data.results)) {
    const results = data.results as KbResultRow[];
    return (
      <div className="flex flex-col gap-1.5 rounded-v-sm border border-v-line bg-v-panel p-3">
        <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
          {count} matching passage{count === 1 ? "" : "s"}
        </span>
        {results.map((r, i) => (
          <div key={i} className="border-t border-v-hairline pt-1.5 text-[12px] first:border-0 first:pt-0">
            <div className="mb-0.5 text-[10px] uppercase tracking-[.06em] text-v-faint">{r.source_filename ?? "Document"}</div>
            <p className="text-v-muted">{r.text}</p>
          </div>
        ))}
      </div>
    );
  }

  // No shaped payload to build a rich card from — happens when a past
  // conversation is reloaded, since only a one-line summary is persisted,
  // not the full tool result. Fall back to that summary instead of
  // silently dropping the card (which made successful past turns look
  // like nothing happened).
  if (event.summary) {
    return (
      <div className="rounded-v-sm border border-v-line bg-v-panel px-3 py-2 text-[12px] text-v-muted">
        {toolLabel(event.tool)}: {event.summary}
      </div>
    );
  }

  return null;
}

// A link the model gave us to one of VoicERA's own pages (see engine.py's
// real route list) navigates in-app and closes the panel so the user
// actually lands on the page, instead of opening a same-origin duplicate tab.
function CopilotMarkdownLink({ children, href }: { children?: ReactNode; href?: string }) {
  const router = useRouter();
  const { hide } = useCopilotUi();
  const linkClass = "text-v-accent underline underline-offset-2 hover:text-v-accent-deep";

  if (href && href.startsWith("/")) {
    return (
      <button
        type="button"
        onClick={() => {
          hide();
          router.push(href);
        }}
        className={`${linkClass} cursor-pointer`}
      >
        {children}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

let mermaidInitialized = false;

/** Renders a ```mermaid fenced block as an actual diagram instead of raw
 * text — dynamically imported (mermaid pulls in d3/dagre/cytoscape, all
 * DOM-dependent) and run with securityLevel "strict" since the source text
 * ultimately comes from an LLM response, not code we wrote ourselves. Falls
 * back to the raw source in a code block if it fails to parse, rather than
 * breaking the rest of the message. */
function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const reactId = useId();
  const mermaidId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(async ({ default: mermaid }) => {
      if (!mermaidInitialized) {
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
        mermaidInitialized = true;
      }
      try {
        const { svg: rendered } = await mermaid.render(mermaidId, source);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source, mermaidId]);

  if (failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-v-danger-deep">Couldn&apos;t render this diagram — showing its source instead:</span>
        <code className="block overflow-x-auto rounded-v-sm bg-v-fg px-2.5 py-2 font-mono text-[12px] text-white">
          {source}
        </code>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="flex items-center gap-2 rounded-v-sm border border-v-line bg-v-soft px-3 py-2 text-[12px] text-v-muted">
        <ThinkingWave /> Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded-v-sm border border-v-line bg-white p-3 [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Compact markdown rendering styled with the app's own tokens, sized for a
// ~380px chat panel rather than a full article — headers step down instead
// of jumping to article-sized type, tables scroll horizontally instead of
// overflowing the panel.
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-v-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: CopilotMarkdownLink,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  // Real, distinct hierarchy — the old set squeezed h1-h3 into a 1px range
  // (14.5/14/13.5), which read as flat rather than an actual heading scale.
  h1: ({ children }) => <h3 className="mb-2 mt-3 text-[17px] font-semibold text-v-fg first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-[15px] font-semibold text-v-fg first:mt-0">{children}</h3>,
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-[12.5px] font-semibold uppercase tracking-[.04em] text-v-muted first:mt-0">
      {children}
    </h3>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <span className="mb-2 flex flex-col gap-1.5 last:mb-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary
            model-referenced URLs, not a local/optimizable asset */}
        <img
          src={src}
          alt={alt ?? ""}
          className="max-w-full rounded-v-sm border border-v-line shadow-[var(--v-shadow-card)]"
        />
        {alt ? <span className="text-[11px] text-v-faint">{alt}</span> : null}
      </span>
    ) : null,
  hr: () => <hr className="my-2.5 border-v-line" />,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-v-line pl-2.5 text-v-muted italic last:mb-0">{children}</blockquote>
  ),
  code: ({ children, className }) => {
    if (className === "language-mermaid") {
      return <MermaidDiagram source={String(children).trim()} />;
    }
    return className ? (
      <code className={`${className} block overflow-x-auto rounded-v-sm bg-v-fg px-2.5 py-2 font-mono text-[12px] text-white`}>
        {children}
      </code>
    ) : (
      <code className="rounded-sm bg-v-soft px-1 py-0.5 font-mono text-[12px] text-v-fg">{children}</code>
    );
  },
  pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto rounded-v-sm border border-v-line last:mb-0">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-v-soft">{children}</thead>,
  tr: ({ children }) => <tr className="even:bg-v-soft/50">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-v-line px-2.5 py-1.5 text-left font-medium text-v-faint">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-v-hairline px-2.5 py-1.5 align-top text-v-fg">{children}</td>,
};

export function CopilotMarkdown({ text }: { text: string }) {
  return (
    <div className="text-[13.5px] leading-relaxed text-v-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// The model may end a turn with a trailing quick_replies marker (see
// engine.py's system prompt) to offer 2-4 concrete next steps — e.g. "Walk
// me through it" vs "Create one with me". This is a plain text convention,
// not a tool call, so it's parsed client-side and stripped from the
// displayed text. Models vary on brace count / key quoting ({quick_replies:
// [...]} vs {{quick_replies: [...]}} vs {"quick_replies": [...]}), so this
// only anchors on the literal "quick_replies" key and then parses the `[...]`
// array on its own — that part is always valid JSON regardless of how the
// surrounding object was punctuated. A malformed or absent marker just means
// no buttons, never a rendering error.
const QUICK_REPLIES_KEY = /["']?quick_replies["']?\s*:/i;

function splitQuickReplies(content: string, isFinal: boolean): { text: string; replies: string[] } {
  const keyMatch = content.match(QUICK_REPLIES_KEY);
  if (!keyMatch || keyMatch.index === undefined) return { text: content, replies: [] };

  // Trim back to the start of whatever brace opens this marker, if any, so
  // stray `{`/`{{` before the key don't leak into the displayed text.
  let cut = keyMatch.index;
  while (cut > 0 && content[cut - 1] === "{") cut--;
  const text = content.slice(0, cut).trimEnd();
  if (!isFinal) return { text, replies: [] }; // hide the raw marker while it's still streaming in

  const arrayStart = content.indexOf("[", keyMatch.index);
  if (arrayStart === -1) return { text, replies: [] };
  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < content.length; i++) {
    if (content[i] === "[") depth++;
    else if (content[i] === "]") {
      depth--;
      if (depth === 0) {
        arrayEnd = i;
        break;
      }
    }
  }
  if (arrayEnd === -1) return { text, replies: [] }; // incomplete/malformed — no buttons

  try {
    const parsed = JSON.parse(content.slice(arrayStart, arrayEnd + 1));
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
      return { text, replies: parsed.map((s) => s.trim()).filter(Boolean).slice(0, 4) };
    }
  } catch {
    /* the model didn't follow the format exactly — fail silently, no buttons */
  }
  return { text, replies: [] };
}

function MessageBubble({
  message,
  onQuickReply,
  onEdit,
  editable,
}: {
  message: CopilotChatMessage;
  onQuickReply: (text: string) => void;
  onEdit?: (id: string, newText: string) => void;
  editable?: boolean;
}) {
  const isUser = message.role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (isUser) {
    if (isEditing) {
      return (
        <div className="flex flex-col items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) {
                  onEdit?.(message.id, draft.trim());
                  setIsEditing(false);
                }
              } else if (e.key === "Escape") {
                setDraft(message.content);
                setIsEditing(false);
              }
            }}
            rows={2}
            autoFocus
            className="max-w-[92%] min-w-[220px] resize-none rounded-v-md border border-v-accent bg-v-panel px-3.5 py-2.5 text-[13.5px] leading-relaxed text-v-fg outline-none"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDraft(message.content);
                setIsEditing(false);
              }}
              className="cursor-pointer rounded-v-sm px-2 py-1 text-[11.5px] font-medium text-v-muted hover:bg-v-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                onEdit?.(message.id, draft.trim());
                setIsEditing(false);
              }}
              className="cursor-pointer rounded-v-sm bg-v-fg px-2.5 py-1 text-[11.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save &amp; resend
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="group flex flex-col items-end gap-2">
        {message.attachments && message.attachments.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((a) => (
              <CopilotAttachmentImage key={a.attachment_id} attachment={a} />
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="flex items-center gap-1.5">
            {editable ? (
              <button
                type="button"
                title="Edit message"
                aria-label="Edit message"
                onClick={() => setIsEditing(true)}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-v-sm text-v-faint opacity-0 transition-opacity hover:bg-v-soft hover:text-v-fg group-hover:opacity-100"
              >
                <Pencil className="size-3" strokeWidth={1.8} />
              </button>
            ) : null}
            <div className="max-w-[92%] rounded-v-md bg-v-fg px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-white">
              {message.content}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const { text, replies } = splitQuickReplies(message.content, !message.streaming);

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-v-pale text-v-accent">
        <VoicEraMark size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {message.toolEvents.length > 0 ? (
          <>
            {message.streaming ? <ExecutionTrail events={message.toolEvents} /> : null}
            <div className="flex flex-col gap-1.5">
              {message.toolEvents
                .filter((event) => event.status === "done")
                .map((event, i) => (
                  <ToolResultCard key={`${event.tool}-${i}`} event={event} />
                ))}
            </div>
          </>
        ) : null}
        {text ? (
          <CopilotMarkdown text={text} />
        ) : message.streaming ? (
          message.statusText ? (
            // Orthogonal to the execution trail above — a retry can happen
            // before OR after a tool call, so this shows regardless of
            // whether toolEvents is empty.
            <div className="flex items-center gap-2.5 rounded-v-sm border border-v-line bg-v-soft px-3 py-2 text-[12px] text-v-muted">
              <BuilderOrb size={20} state="waiting" /> {message.statusText}
            </div>
          ) : message.toolEvents.length === 0 ? (
            <ThinkingWave />
          ) : null
        ) : null}
        {replies.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {replies.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onQuickReply(r)}
                className="cursor-pointer rounded-full border border-v-accent/40 bg-v-pale px-3 py-1.5 text-[12px] font-medium text-v-accent-deep transition-colors hover:bg-v-blue-soft"
              >
                {r}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CopilotPanel({
  open,
  onClose,
  pageContext,
}: {
  open: boolean;
  onClose: () => void;
  pageContext: CopilotContext;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const { restart: restartWalkthrough } = useWalkthrough();
  const { pendingMessage, clearPendingMessage, pendingIntent, clearPendingIntent } = useCopilotUi();
  const {
    messages,
    sending,
    error,
    conversationId,
    ephemeral,
    send,
    cancel,
    reset,
    loadConversation,
    startEphemeralChat,
    editMessage,
  } = useCopilot();
  const [input, setInput] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [introKey, setIntroKey] = useState(0);
  const {
    pending: pendingAttachments,
    error: attachmentError,
    addFiles,
    remove: removePendingAttachment,
    takeReady: takeReadyAttachments,
    ready: readyAttachments,
    uploading: attachmentsUploading,
  } = useCopilotAttachments();
  const fileDrop = useFileDrop(addFiles, !voiceActive);
  // Fast, deterministic "how would you like to build this?" entry — resolved
  // entirely client-side, no LLM round trip, before anything is sent to chat.
  const [agentFork, setAgentFork] = useState<"choose" | "conversational" | "campaign" | null>(null);
  const [campaignAgents, setCampaignAgents] = useState<AgentApiResponse[] | null>(null);
  const [campaignAgentsLoading, setCampaignAgentsLoading] = useState(false);
  const [campaignAgent, setCampaignAgent] = useState<AgentApiResponse | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const autoIntroShownRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Real name for whatever agent the user is currently looking at (from the
  // page route, not a guess) — shown in the header so the panel visibly
  // knows its own context instead of always reading as a generic assistant.
  const [contextAgentName, setContextAgentName] = useState<string | null>(null);
  // Deliberately fires setState directly — syncing local state to the real
  // page context (an external signal), same pattern as the pendingMessage
  // effects below, not deriving it from other React state.
  useEffect(() => {
    if (!pageContext.agent_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContextAgentName(null);
      return;
    }
    let cancelled = false;
    getAgent(pageContext.agent_id)
      .then((agent) => {
        if (!cancelled) setContextAgentName(agent.name);
      })
      .catch(() => {
        if (!cancelled) setContextAgentName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pageContext.agent_id]);

  function openIntro() {
    setIntroKey((k) => k + 1); // forces CopilotIntroTour to remount at step 0
    setIntroOpen(true);
  }


  function submit(text?: string) {
    const raw = (text ?? input).trim();
    if (!raw && readyAttachments.length === 0) return;
    if (attachmentsUploading) return;
    // Free-typed description after picking "Conversational agent" in the
    // fork — make the request unambiguous for the model so it goes straight
    // to a draft in one round trip instead of asking what kind of agent.
    const value = agentFork === "conversational" ? `Create a conversational agent: ${raw}` : raw;
    setInput("");
    const refs = takeReadyAttachments();
    setAgentFork(null);
    void send(value, pageContext, refs.length > 0 ? refs : undefined);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  // First-ever open of a fresh conversation gets the tour automatically;
  // after that it's only reachable via the "?" button. The ref (not state)
  // guards against re-showing it every time this effect's deps change.
  useEffect(() => {
    if (open && !voiceActive && messages.length === 0 && !hasSeenIntro() && !autoIntroShownRef.current) {
      autoIntroShownRef.current = true;
      openIntro();
    }
  }, [open, voiceActive, messages.length]);

  // An entry point elsewhere in the product (e.g. "Create with Ask VoicEra")
  // opened this panel with a message already queued up — send it once, and
  // skip the intro tour so it doesn't cover the response that's about to load.
  // Deliberately fires setState from within these two effects — they exist
  // solely to consume a one-shot external signal (an entry point elsewhere
  // in the product opened this panel with a message/intent queued up) into
  // local state exactly once. There's no user event to hang this off of.
  useEffect(() => {
    if (open && pendingMessage) {
      autoIntroShownRef.current = true;
      clearPendingMessage();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      submit(pendingMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingMessage]);

  // Same idea as pendingMessage, but for a named local flow (see
  // CopilotIntent) that CopilotPanel renders itself instead of sending
  // anything to the model — e.g. "which kind of agent?" resolves instantly,
  // client-side, before the first real chat turn happens at all.
  useEffect(() => {
    if (open && pendingIntent === "create_agent") {
      autoIntroShownRef.current = true;
      clearPendingIntent();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAgentFork("choose");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingIntent]);

  // Real product tour, not a Copilot simulation of one — same action the
  // sidebar's own "Walkthrough" entry triggers (WalkthroughProvider.restart
  // + navigate to /dashboard), just reachable from the Copilot too.
  function startTour() {
    restartWalkthrough();
    router.push("/dashboard");
    onClose();
  }

  // Real, org-scoped check — a campaign needs an agent that already has a
  // phone number attached (the copilot can't provision telephony from chat,
  // same boundary the wizard enforces), so this is resolved from actual
  // agent data, never assumed.
  function startCampaignFlow() {
    setAgentFork("campaign");
    setCampaignAgentsLoading(true);
    listAgents()
      .then((agents) => setCampaignAgents(agents))
      .catch(() => setCampaignAgents([]))
      .finally(() => setCampaignAgentsLoading(false));
  }

  function resetAgentFork() {
    setAgentFork(null);
    setCampaignAgents(null);
    setCampaignAgent(null);
    setCampaignName("");
  }

  const campaignReadyAgents = (campaignAgents ?? []).filter(
    (a) => !a.archived && a.status === "active" && a.linked_phone_number,
  );
  const campaignCsvAttachment = readyAttachments.find(
    (p) => p.ref!.content_type === "text/csv" || p.ref!.original_filename.toLowerCase().endsWith(".csv"),
  );

  function createCampaignFromFork() {
    if (!campaignAgent || !campaignCsvAttachment) return;
    const name = campaignName.trim() || `${campaignAgent.name} campaign`;
    submit(`Create a campaign called "${name}" using the ${campaignAgent.name} agent and the attached contacts file.`);
  }

  // Real route the user is actually looking at (not a guess) — drives both
  // the hero copy below and which quick actions make sense to offer. A
  // page this doesn't recognise falls back to the general-purpose set.
  const route = pageContext.route ?? "";
  const onAgentDetail = Boolean(pageContext.agent_id) && route.startsWith("/agents/");

  const onDashboard = route === "/dashboard";

  const homeCopy = onAgentDetail
    ? { eyebrow: "THIS AGENT", heading: contextAgentName ? `Let's improve ${contextAgentName}.` : "Let's improve this agent." }
    : onDashboard
      ? { eyebrow: "AGENT BUILDER", heading: "What do you want to build?" }
      : route.startsWith("/history")
        ? { eyebrow: "CALL HISTORY", heading: "Let's understand your calls." }
        : route.startsWith("/analytics")
          ? { eyebrow: "ANALYTICS", heading: "What would you like to investigate?" }
          : route.startsWith("/batches")
            ? { eyebrow: "CAMPAIGNS", heading: "Let's build or analyse a campaign." }
            : route.startsWith("/knowledge-base")
              ? { eyebrow: "KNOWLEDGE BASE", heading: "Let's improve your agents' knowledge." }
              : route.startsWith("/integrations")
                ? { eyebrow: "INTEGRATIONS", heading: "Let's configure your AI stack." }
                : { eyebrow: "AGENT BUILDER", heading: "What would you like to do?" };

  const primaryActions = onAgentDetail
    ? [
        {
          label: "Improve this agent",
          icon: Sparkles,
          chip: "bg-v-pale text-v-accent",
          onClick: () =>
            submit(
              `Take a look at the agent I'm currently viewing (agent_id ${pageContext.agent_id}) and suggest one concrete improvement to its prompt or behaviour.`,
            ),
        },
        {
          label: "Explain this agent's setup",
          icon: BookOpen,
          chip: "bg-v-success-pale text-v-success-deep",
          onClick: () =>
            submit(`Explain the current configuration of the agent I'm viewing (agent_id ${pageContext.agent_id}) in plain language.`),
        },
        {
          label: "Create another agent",
          icon: Bot,
          chip: "bg-v-warning-pale text-v-warning-deep",
          onClick: () => router.push("/agent-builder"),
        },
      ]
    : route === "/dashboard"
      ? [
          { label: "Create an agent", icon: Bot, chip: "bg-v-pale text-v-accent", onClick: () => router.push("/agent-builder") },
          {
            label: "Compare my agents",
            icon: TrendingUp,
            chip: "bg-v-success-pale text-v-success-deep",
            onClick: () => submit("Compare my agents' recent call performance."),
          },
          { label: "Give me a tour", icon: Compass, chip: "bg-v-warning-pale text-v-warning-deep", onClick: startTour },
        ]
      : route.startsWith("/history")
        ? [
            {
              label: "Analyse my recent calls",
              icon: TrendingUp,
              chip: "bg-v-success-pale text-v-success-deep",
              onClick: () => submit("Analyse my recent calls."),
            },
            {
              label: "Find calls that failed",
              icon: AlertTriangle,
              chip: "bg-v-danger-pale text-v-danger-deep",
              onClick: () => submit("Show me my recent calls that failed or didn't connect, and why."),
            },
            { label: "Create an agent", icon: Bot, chip: "bg-v-pale text-v-accent", onClick: () => setAgentFork("choose") },
          ]
        : route.startsWith("/analytics")
          ? [
              {
                label: "Explain my call performance",
                icon: TrendingUp,
                chip: "bg-v-success-pale text-v-success-deep",
                onClick: () => submit("Explain my call performance and analytics summary."),
              },
              {
                label: "Compare my agents",
                icon: LayoutGrid,
                chip: "bg-v-pale text-v-accent",
                onClick: () => submit("Compare my agents' call performance."),
              },
              { label: "Give me a tour", icon: Compass, chip: "bg-v-warning-pale text-v-warning-deep", onClick: startTour },
            ]
          : route.startsWith("/batches")
            ? [
                {
                  label: "Create a campaign",
                  icon: Megaphone,
                  chip: "bg-v-warning-pale text-v-warning-deep",
                  onClick: startCampaignFlow,
                },
                {
                  label: "Analyse my campaigns",
                  icon: TrendingUp,
                  chip: "bg-v-success-pale text-v-success-deep",
                  onClick: () => submit("Give me an overview of my campaigns and how they're performing."),
                },
                { label: "Create an agent", icon: Bot, chip: "bg-v-pale text-v-accent", onClick: () => setAgentFork("choose") },
              ]
            : route.startsWith("/knowledge-base")
              ? [
                  {
                    label: "What's in my knowledge base?",
                    icon: BookOpen,
                    chip: "bg-v-pale text-v-accent",
                    onClick: () => submit("List my knowledge base documents and their status."),
                  },
                  {
                    label: "Search my knowledge base",
                    icon: Search,
                    chip: "bg-v-success-pale text-v-success-deep",
                    onClick: () => setInput("Search my knowledge base for "),
                  },
                ]
              : route.startsWith("/integrations")
                ? [
                    {
                      label: "What's connected?",
                      icon: Check,
                      chip: "bg-v-success-pale text-v-success-deep",
                      onClick: () => submit("Which speech-to-text, text-to-speech, and LLM providers are connected for my organisation?"),
                    },
                    {
                      label: "Help me configure my stack",
                      icon: Compass,
                      chip: "bg-v-warning-pale text-v-warning-deep",
                      onClick: () => submit("Help me understand what I still need to configure to get my AI stack fully set up."),
                    },
                  ]
                : [
                    { label: "Create an agent", icon: Bot, chip: "bg-v-pale text-v-accent", onClick: () => setAgentFork("choose") },
                    { label: "Give me a tour", icon: Compass, chip: "bg-v-warning-pale text-v-warning-deep", onClick: startTour },
                    {
                      label: "Analyse my calls",
                      icon: TrendingUp,
                      chip: "bg-v-success-pale text-v-success-deep",
                      onClick: () => submit("Analyse my recent calls."),
                    },
                    {
                      label: "Explore my workspace",
                      icon: LayoutGrid,
                      chip: "bg-v-danger-pale text-v-danger-deep",
                      onClick: () =>
                        submit("Give me an overview of everything in my workspace — agents, calls, campaigns, and knowledge base."),
                    },
                  ];

  return (
    <Sheet open={open} onClose={onClose} widthClassName="max-w-md">
      <SheetHeader
        title="Agent Builder"
        subtitle={
          voiceActive
            ? "Live voice conversation"
            : ephemeral
              ? "Temporary session — nothing here is saved"
              : contextAgentName
                ? `Helping with ${contextAgentName}`
                : session?.orgName
                  ? `Grounded in ${session.orgName}'s live data`
                  : "Describe, speak, or paste a prompt — build a real agent"
        }
        icon={<VoicEraMark size={16} />}
        actions={
          voiceActive ? undefined : (
            <>
              <button
                type="button"
                title="Start a new chat"
                aria-label="Start a new chat"
                onClick={() => {
                  resetAgentFork();
                  reset();
                }}
                disabled={messages.length === 0 && !ephemeral && agentFork === null}
                className="flex size-8 cursor-pointer items-center justify-center rounded-v-sm text-v-muted transition-colors hover:bg-v-soft hover:text-v-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <SquarePen className="size-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                title={ephemeral ? "End temporary chat" : "Start a temporary chat (not saved to history)"}
                aria-label={ephemeral ? "End temporary chat" : "Start a temporary chat"}
                aria-pressed={ephemeral}
                onClick={() => {
                  resetAgentFork();
                  if (ephemeral) reset();
                  else startEphemeralChat();
                }}
                className={`flex size-8 cursor-pointer items-center justify-center rounded-v-sm transition-colors ${
                  ephemeral ? "text-v-accent" : "text-v-muted hover:bg-v-soft hover:text-v-fg"
                }`}
              >
                <Ghost className="size-4" strokeWidth={1.8} />
              </button>
              <span className="mx-0.5 h-5 w-px bg-v-line" aria-hidden="true" />
              <CopilotIntroTourButton onClick={openIntro} />
              <CopilotHistoryMenu onSelect={(id) => void loadConversation(id)} />
            </>
          )
        }
        onClose={onClose}
      />

      <div className="relative flex min-h-0 flex-1 flex-col" {...fileDrop.handlers}>
        {fileDrop.dragging ? <DropOverlay /> : null}
        <CopilotIntroTour key={introKey} active={introOpen} onClose={() => setIntroOpen(false)} />
        {voiceActive ? (
          <CopilotVoiceMode conversationId={conversationId} onClose={() => setVoiceActive(false)} />
        ) : (
          <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          agentFork === "choose" ? (
            <div className="flex h-full flex-col justify-center gap-5">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-v-pale text-v-accent">
                  <VoicEraMark size={22} />
                </span>
                <span className="text-[15px] font-semibold text-v-fg">How would you like to build this?</span>
                <p className="max-w-[280px] text-[12.5px] leading-relaxed text-v-muted">
                  Pick one — I&apos;ll walk you through the rest right here in chat.
                </p>
              </div>
              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => setAgentFork("conversational")}
                  className="group flex cursor-pointer flex-col gap-2 rounded-v-md border border-v-line bg-v-panel p-4 text-left transition-colors hover:border-v-accent hover:bg-v-soft"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-v-pale text-v-accent transition-transform group-hover:scale-105">
                    <MessageCircle className="size-4" strokeWidth={1.8} />
                  </span>
                  <span className="text-[13.5px] font-semibold text-v-fg">Conversational agent</span>
                  <span className="text-[12px] leading-relaxed text-v-muted">
                    Answers callers in real time. Describe it in one sentence and I&apos;ll draft the whole thing.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={startCampaignFlow}
                  className="group flex cursor-pointer flex-col gap-2 rounded-v-md border border-v-line bg-v-panel p-4 text-left transition-colors hover:border-v-accent hover:bg-v-soft"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-v-warning-pale text-v-warning-deep transition-transform group-hover:scale-105">
                    <Megaphone className="size-4" strokeWidth={1.8} />
                  </span>
                  <span className="text-[13.5px] font-semibold text-v-fg">Campaign / broadcast</span>
                  <span className="text-[12px] leading-relaxed text-v-muted">
                    Call a list of contacts automatically, using an agent you already have.
                  </span>
                </button>
              </div>
              <button
                type="button"
                onClick={resetAgentFork}
                className="mx-auto flex cursor-pointer items-center gap-1 text-[12px] font-medium text-v-muted hover:text-v-fg"
              >
                <ArrowLeft className="size-3.5" strokeWidth={2} /> Back
              </button>
            </div>
          ) : agentFork === "conversational" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-v-pale text-v-accent">
                <MessageCircle className="size-5" strokeWidth={1.8} />
              </span>
              <span className="text-[15px] font-semibold text-v-fg">Describe this agent</span>
              <p className="max-w-[280px] text-[12.5px] leading-relaxed text-v-muted">
                What should it help callers with? One sentence is enough — type it below and I&apos;ll draft the
                name, prompt, greeting, and everything else.
              </p>
              <p className="max-w-[280px] text-[11.5px] italic leading-relaxed text-v-faint">
                e.g. &ldquo;Answer pricing questions and explain our refund policy&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setAgentFork("choose")}
                className="mt-1 flex cursor-pointer items-center gap-1 text-[12px] font-medium text-v-muted hover:text-v-fg"
              >
                <ArrowLeft className="size-3.5" strokeWidth={2} /> Back
              </button>
            </div>
          ) : agentFork === "campaign" ? (
            <div className="flex h-full flex-col justify-center gap-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-v-warning-pale text-v-warning-deep">
                  <Megaphone className="size-5" strokeWidth={1.8} />
                </span>
                <span className="text-[15px] font-semibold text-v-fg">Campaign / broadcast</span>
              </div>

              {campaignAgentsLoading ? (
                <div className="flex items-center justify-center gap-2 text-[12.5px] text-v-muted">
                  <ThinkingWave /> Checking your agents…
                </div>
              ) : campaignReadyAgents.length === 0 ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="max-w-[280px] text-[12.5px] leading-relaxed text-v-muted">
                    You&apos;ll need an agent with a phone number attached before a campaign can call anyone —
                    that step happens outside chat, deliberately.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        onClose();
                        router.push("/agent-creation");
                      }}
                    >
                      Create an agent
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onClose();
                        router.push("/numbers");
                      }}
                    >
                      Go to Numbers
                    </Button>
                  </div>
                </div>
              ) : !campaignAgent ? (
                <div className="flex flex-col gap-2">
                  <p className="text-center text-[12.5px] text-v-muted">Which agent should make these calls?</p>
                  {campaignReadyAgents.map((a) => (
                    <button
                      key={a.agent_id}
                      type="button"
                      onClick={() => setCampaignAgent(a)}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-v-sm border border-v-line bg-v-panel px-3 py-2.5 text-left transition-colors hover:border-v-accent hover:bg-v-soft"
                    >
                      <span className="text-[13px] font-medium text-v-fg">{a.name}</span>
                      <span className="flex items-center gap-1 text-[11.5px] text-v-faint">
                        <Phone className="size-3" strokeWidth={2} /> {a.linked_phone_number}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2 rounded-v-sm border border-v-line bg-v-soft px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-v-fg">
                      <Check className="size-3.5 text-v-success-deep" strokeWidth={2.5} /> {campaignAgent.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCampaignAgent(null)}
                      className="cursor-pointer text-[11.5px] font-medium text-v-accent hover:text-v-accent-deep"
                    >
                      Change
                    </button>
                  </div>
                  <input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Campaign name"
                    className="rounded-v-sm border border-v-line bg-v-panel px-3 py-2 text-[13px] text-v-fg outline-none placeholder:text-v-faint focus:border-v-accent"
                  />
                  {campaignCsvAttachment ? (
                    <div className="flex items-center justify-between gap-2 rounded-v-sm border border-v-line bg-v-soft px-3 py-2">
                      <span className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-v-fg">
                        <FileSpreadsheet className="size-3.5 shrink-0 text-v-muted" strokeWidth={1.8} />
                        <span className="truncate">{campaignCsvAttachment.ref!.original_filename}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(campaignCsvAttachment.id)}
                        className="shrink-0 cursor-pointer text-v-faint hover:text-v-fg"
                      >
                        <X className="size-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <FileSpreadsheet className="size-3.5" strokeWidth={1.8} /> Attach contacts CSV
                    </Button>
                  )}
                  <Button size="sm" onClick={createCampaignFromFork} disabled={!campaignCsvAttachment}>
                    Create campaign
                  </Button>
                </div>
              )}

              <button
                type="button"
                onClick={resetAgentFork}
                className="mx-auto flex cursor-pointer items-center gap-1 text-[12px] font-medium text-v-muted hover:text-v-fg"
              >
                <ArrowLeft className="size-3.5" strokeWidth={2} /> Back
              </button>
            </div>
          ) : (
          <div className="flex h-full flex-col justify-center gap-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-v-pale text-v-accent">
                <VoicEraMark size={22} />
              </span>
              <span className="font-mono text-[10px] font-medium uppercase tracking-[.14em] text-v-faint">
                {homeCopy.eyebrow}
              </span>
              <span className="text-[17px] font-semibold tracking-tight text-v-fg">{homeCopy.heading}</span>
              <p className="max-w-[280px] text-[12.5px] leading-relaxed text-v-muted">
                {onAgentDetail
                  ? "I can see what you're working on — tell me to explain it, change something, or improve it."
                  : onDashboard
                    ? "Describe your use case, speak it, or paste existing instructions — VoicERA turns it into a working agent, grounded in this organisation's real data."
                    : "Grounded in this organisation's real data — agents, calls, campaigns, knowledge base — never a canned demo."}
              </p>
            </div>

            {onDashboard ? (
              <button
                type="button"
                onClick={() => router.push("/agent-builder")}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-v-md bg-v-fg py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-v-accent"
              >
                <Sparkles className="size-4" strokeWidth={1.8} /> Open Agent Builder
              </button>
            ) : null}

            <div className={`grid gap-2 ${primaryActions.length <= 2 ? "grid-cols-1" : "grid-cols-2"}`}>
              {primaryActions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={a.onClick}
                  className="group flex cursor-pointer flex-col items-start gap-2.5 rounded-v-md border border-v-line bg-v-panel p-3 text-left transition-colors hover:border-v-accent hover:bg-v-soft"
                >
                  <span
                    className={`flex size-8 items-center justify-center rounded-full transition-transform group-hover:scale-105 ${a.chip}`}
                  >
                    <a.icon className="size-4" strokeWidth={1.8} />
                  </span>
                  <span className="text-[12.5px] font-medium leading-snug text-v-fg">{a.label}</span>
                </button>
              ))}
            </div>

            {onDashboard ? null : (
              <button
                type="button"
                onClick={() => setVoiceActive(true)}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-v-md bg-v-fg py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-v-accent"
              >
                <Mic className="size-4" strokeWidth={1.8} /> Talk to Agent Builder
              </button>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[.06em] text-v-faint">
                <BookOpen className="size-3" strokeWidth={2} /> Or ask me anything
              </span>
              {STARTER_PROMPTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="cursor-pointer rounded-v-sm border border-v-line bg-v-panel px-3 py-2 text-left text-[13px] text-v-fg transition-colors hover:border-v-accent hover:bg-v-soft"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          )
        ) : (
          <div className="flex flex-col gap-5">
            {messages.map((m) => (
              <div key={m.id} className="animate-v-rise">
                <MessageBubble
                  message={m}
                  onQuickReply={submit}
                  editable={!sending}
                  onEdit={(id, newText) => void editMessage(id, newText, pageContext)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div className="mx-5 mb-2 rounded-v-sm border border-v-danger-line bg-v-danger-pale px-3 py-2 text-[12px] text-v-danger-deep">
          {error}
        </div>
      ) : null}
      {attachmentError ? (
        <div className="mx-5 mb-2 rounded-v-sm border border-v-danger-line bg-v-danger-pale px-3 py-2 text-[12px] text-v-danger-deep">
          {attachmentError}
        </div>
      ) : null}

      <PendingAttachmentStrip
        pending={pendingAttachments}
        onRemove={removePendingAttachment}
        className="border-t border-v-line px-4 pt-3"
      />

      <div className="flex items-end gap-2 border-t border-v-line px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <IconButton
          type="button"
          title="Attach images or documents (PDF, Word, PowerPoint, Excel, CSV, text)"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
        >
          <Paperclip className="size-4" strokeWidth={1.8} />
        </IconButton>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = filesFromClipboard(e.clipboardData);
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          rows={1}
          placeholder={
            onDashboard ? "Describe what you want to build…" : "Ask Agent Builder…"
          }
          className="max-h-28 min-h-[38px] flex-1 resize-none rounded-v-md border border-v-line bg-v-panel px-3 py-2 text-[13.5px] text-v-fg outline-none placeholder:text-v-faint focus:border-v-accent"
        />
        {sending ? (
          <Button type="button" variant="dark" size="md" onClick={cancel}>
            <Square className="size-3.5" strokeWidth={2} fill="currentColor" />
          </Button>
        ) : input.trim() || readyAttachments.length > 0 ? (
          <Button type="button" size="md" onClick={() => submit()} disabled={attachmentsUploading}>
            <Send className="size-4" strokeWidth={1.8} />
          </Button>
        ) : (
          <IconButton type="button" title="Talk to Agent Builder" onClick={() => setVoiceActive(true)}>
            <Mic className="size-4" strokeWidth={1.8} />
          </IconButton>
        )}
      </div>
        </>
        )}
      </div>
    </Sheet>
  );
}
