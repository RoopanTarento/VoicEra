"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Ghost,
  Mic,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCopilot, type CopilotChatMessage } from "@/hooks/useCopilot";
import { deleteCopilotConversation, improveCopilotPrompt, listCopilotConversations } from "@/lib/api/copilot";
import type { CopilotConversationSummary } from "@/lib/api-types";
import {
  AgentDraftCard,
  AgentUpdateDraftCard,
  BuilderOrb,
  CampaignDraftCard,
  CopilotMarkdown,
  type AgentDraft,
  type AgentUpdateDraft,
  type CampaignDraft,
} from "@/components/copilot/CopilotPanel";
import { CopilotVoiceMode } from "@/components/copilot/CopilotVoiceMode";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { Button } from "@/components/ui/Button";
import { RequirePermission } from "@/components/PermissionsProvider";

/** "2h ago" / "3d ago" — no new date library for something this small. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The dedicated Agent Builder experience — a full-page canvas, not the
 * narrow sliding drawer the launcher opens elsewhere in the product. Same
 * real backend (useCopilot -> the same /copilot stream, the same tool
 * calls, the same draft -> confirm -> real-agent flow) — this page only
 * changes how much room the conversation and the live artifact get, and
 * how prominent building an agent is as its own destination rather than a
 * corner of the screen. */

type Draft =
  | { kind: "agent"; data: AgentDraft }
  | { kind: "agent_update"; data: AgentUpdateDraft }
  | { kind: "campaign"; data: CampaignDraft };

function latestDraft(messages: CopilotChatMessage[]): Draft | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const events = messages[i].toolEvents;
    for (let j = events.length - 1; j >= 0; j--) {
      const e = events[j];
      if (e.status !== "done" || !e.ok || !e.data || typeof e.data !== "object") continue;
      const data = e.data as Record<string, unknown>;
      if (typeof data.draft_id !== "string") continue;
      if (e.tool === "propose_create_agent") return { kind: "agent", data: data as unknown as AgentDraft };
      if (e.tool === "propose_update_agent") return { kind: "agent_update", data: data as unknown as AgentUpdateDraft };
      if (e.tool === "propose_create_campaign") return { kind: "campaign", data: data as unknown as CampaignDraft };
    }
  }
  return null;
}

function ActivityLine({ event }: { event: CopilotChatMessage["toolEvents"][number] }) {
  const label: Record<string, string> = {
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
  return (
    <div className="flex items-center gap-2 text-[12px] text-v-muted">
      {event.status === "done" ? (
        <span className={`size-1.5 rounded-full ${event.ok === false ? "bg-v-danger" : "bg-v-success"}`} />
      ) : (
        <span className="size-1.5 animate-v-live rounded-full bg-v-accent" />
      )}
      {label[event.tool] ?? event.tool}
    </div>
  );
}

function Avatar({ isUser }: { isUser: boolean }) {
  if (isUser) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-v-fg text-[11px] font-semibold text-white">
        You
      </span>
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-v-pale text-v-accent">
      <VoicEraMark size={14} />
    </span>
  );
}

/** Copy-to-clipboard, hover-revealed — real browser clipboard API, no
 * backend involved. Shows a brief checkmark instead of the icon so copying
 * has visible confirmation rather than a silent, unclear action. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      aria-label="Copy message"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard permission denied or unavailable — nothing to recover, just don't confirm */
        }
      }}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-v-sm text-v-faint opacity-0 transition-opacity hover:bg-v-soft hover:text-v-fg group-hover:opacity-100"
    >
      {copied ? <Check className="size-3.5 text-v-success" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.8} />}
    </button>
  );
}

/** Full-width, avatar-led rows (the same layout ChatGPT actually uses — a
 * left-aligned avatar next to full-width content, not alternating left/right
 * bubbles) rendered with VoicERA's own colours/mark, not a reskin. Editing a
 * past user message reuses the existing real editMessage flow (truncates
 * that message and everything after it, then resends) — same backend
 * capability the drawer already has, just newly surfaced here too. */
function Message({
  message,
  editable,
  onEdit,
}: {
  message: CopilotChatMessage;
  editable: boolean;
  onEdit: (id: string, newText: string) => void;
}) {
  const isUser = message.role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (isUser && isEditing) {
    return (
      <div className="flex gap-3">
        <Avatar isUser />
        <div className="min-w-0 flex-1 pt-0.5">
          <span className="mb-1 block text-[11px] font-medium text-v-faint">You</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) {
                  onEdit(message.id, draft.trim());
                  setIsEditing(false);
                }
              } else if (e.key === "Escape") {
                setDraft(message.content);
                setIsEditing(false);
              }
            }}
            rows={2}
            autoFocus
            className="w-full resize-none rounded-v-md border border-v-accent bg-v-panel px-3 py-2 text-[13.5px] leading-relaxed text-v-fg outline-none"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
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
                onEdit(message.id, draft.trim());
                setIsEditing(false);
              }}
              className="cursor-pointer rounded-v-sm bg-v-fg px-2.5 py-1 text-[11.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save &amp; resend
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3">
      <Avatar isUser={isUser} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-center gap-1">
          <span className="text-[11px] font-medium text-v-faint">{isUser ? "You" : "Agent Builder"}</span>
          {message.content ? (
            <>
              <CopyButton text={message.content} />
              {isUser && editable ? (
                <button
                  type="button"
                  title="Edit message"
                  aria-label="Edit message"
                  onClick={() => {
                    setDraft(message.content);
                    setIsEditing(true);
                  }}
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-v-sm text-v-faint opacity-0 transition-opacity hover:bg-v-soft hover:text-v-fg group-hover:opacity-100"
                >
                  <Pencil className="size-3" strokeWidth={1.8} />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        {isUser ? (
          <p className="text-[13.5px] leading-relaxed text-v-fg">{message.content}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {message.toolEvents.map((e, i) => (
              <ActivityLine key={`${e.tool}-${i}`} event={e} />
            ))}
            {message.content ? (
              <CopilotMarkdown text={message.content} />
            ) : message.streaming && message.toolEvents.length === 0 ? (
              <div className="flex items-center gap-2.5">
                <BuilderOrb size={22} state={message.statusText ? "waiting" : "thinking"} />
                <span className="text-[12.5px] text-v-muted">{message.statusText ?? "Thinking…"}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

const SIDEBAR_COLLAPSED_KEY = "voicera_agent_builder_sidebar_collapsed";

/** ChatGPT-style history rail: new chat, a real temporary-chat mode (the
 * existing `ephemeral` flag — nothing sent in it is ever persisted, exactly
 * ChatGPT's "Temporary Chat"), and the caller's own real past conversations
 * from the existing /copilot/conversations API — nothing new on the backend,
 * this was already fully built and just never had a UI surface. Collapses to
 * a slim icon-only rail, state persisted the same way AppSidebar does. */
function HistorySidebar({
  conversations,
  activeId,
  ephemeral,
  collapsed,
  onToggleCollapsed,
  onNewChat,
  onTemporaryChat,
  onSelect,
  onDelete,
}: {
  conversations: CopilotConversationSummary[];
  activeId: string | undefined;
  ephemeral: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNewChat: () => void;
  onTemporaryChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (collapsed) {
    return (
      <div className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-v-line py-2.5">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand history"
          className="flex size-9 cursor-pointer items-center justify-center rounded-v-sm text-v-faint transition-colors hover:bg-v-soft hover:text-v-fg"
        >
          <ChevronRight className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          title="New chat"
          className="flex size-9 cursor-pointer items-center justify-center rounded-v-sm text-v-fg transition-colors hover:bg-v-soft"
        >
          <Plus className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onTemporaryChat}
          title="Temporary chat"
          className={`flex size-9 cursor-pointer items-center justify-center rounded-v-sm transition-colors ${
            ephemeral ? "bg-v-pale text-v-accent" : "text-v-fg hover:bg-v-soft"
          }`}
        >
          <Ghost className="size-4" strokeWidth={1.8} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-[230px] shrink-0 flex-col border-r border-v-line">
      <div className="flex items-center justify-between px-2.5 pt-2.5">
        <span className="px-1 text-[10px] font-medium uppercase tracking-[.06em] text-v-faint">Agent Builder</span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse history"
          className="flex size-7 cursor-pointer items-center justify-center rounded-v-sm text-v-faint transition-colors hover:bg-v-soft hover:text-v-fg"
        >
          <ChevronLeft className="size-4" strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex flex-col gap-1 p-2.5">
        <button
          type="button"
          onClick={onNewChat}
          className="flex cursor-pointer items-center gap-2 rounded-v-sm px-2.5 py-2 text-left text-[13px] font-medium text-v-fg transition-colors hover:bg-v-soft"
        >
          <Plus className="size-4" strokeWidth={1.8} /> New chat
        </button>
        <button
          type="button"
          onClick={onTemporaryChat}
          className={`flex cursor-pointer items-center gap-2 rounded-v-sm px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
            ephemeral ? "bg-v-pale text-v-accent" : "text-v-fg hover:bg-v-soft"
          }`}
        >
          <Ghost className="size-4" strokeWidth={1.8} /> Temporary chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        <span className="mb-1 block px-2.5 text-[10px] font-medium uppercase tracking-[.06em] text-v-faint">
          Recent
        </span>
        {conversations.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] leading-relaxed text-v-faint">
            Nothing yet — your saved conversations will show up here.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {conversations.map((c) => (
              <div
                key={c.conversation_id}
                className={`group flex items-center gap-1 rounded-v-sm px-1 transition-colors ${
                  activeId === c.conversation_id ? "bg-v-pale" : "hover:bg-v-soft"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.conversation_id)}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 py-1.5 pl-1.5 text-left"
                >
                  <span
                    className={`w-full truncate text-[12.5px] ${
                      activeId === c.conversation_id ? "font-medium text-v-accent-deep" : "text-v-fg"
                    }`}
                  >
                    {c.title || "New conversation"}
                  </span>
                  <span className="text-[10.5px] text-v-faint">{timeAgo(c.updated_at)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.conversation_id)}
                  title="Delete conversation"
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-v-sm text-v-faint opacity-0 transition-opacity hover:text-v-danger group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Real VoicERA use cases — clicking one fills the input (doesn't auto-send)
 * so the user can still edit before building. */
const PROMPT_TEMPLATES = [
  {
    label: "Crop advisory for farmers",
    text: "I need an agent that helps Indian farmers understand government crop advisory schemes.",
  },
  {
    label: "Outbound EMI reminder",
    text: "Create an outbound Kannada EMI reminder agent that also answers basic payment questions.",
  },
  {
    label: "Insurance support",
    text: "Build a customer support agent for our insurance products that uses our policy documents and escalates when unsure.",
  },
] as const;

function LiveArtifact({ draft, onAgentInFocus }: { draft: Draft | null; onAgentInFocus: (agentId: string) => void }) {
  if (!draft) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Sparkles className="size-5 text-v-faint" strokeWidth={1.6} />
        <span className="text-[13px] font-medium text-v-muted">Nothing built yet</span>
        <p className="max-w-[220px] text-[12px] leading-relaxed text-v-faint">
          Describe what you want, paste a prompt, or speak — the agent takes shape here as soon as
          it&apos;s understood.
        </p>
      </div>
    );
  }
  return (
    <div className="p-4">
      {draft.kind === "agent" ? (
        <AgentDraftCard draft={draft.data} onCreated={onAgentInFocus} />
      ) : draft.kind === "agent_update" ? (
        <AgentUpdateDraftCard draft={draft.data} onUpdated={onAgentInFocus} />
      ) : (
        <CampaignDraftCard draft={draft.data} />
      )}
    </div>
  );
}

export default function AgentBuilderPage() {
  return (
    <RequirePermission permission="copilot:use" what="use the Agent Builder">
      <AgentBuilder />
    </RequirePermission>
  );
}

function AgentBuilder() {
  const {
    messages,
    sending,
    send,
    cancel,
    conversationId,
    ephemeral,
    reset,
    startEphemeralChat,
    loadConversation,
    editMessage,
  } = useCopilot();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"describe" | "prompt">("describe");
  const [voiceActive, setVoiceActive] = useState(false);
  const [conversations, setConversations] = useState<CopilotConversationSummary[]>([]);
  const [improving, setImproving] = useState(false);
  // The real agent_id from a create/update that just succeeded in this
  // session — threaded into every subsequent turn's context so "make it
  // more formal" resolves to this exact agent immediately, instead of the
  // model needing another list_agents round trip or the user naming it again.
  const [focusedAgentId, setFocusedAgentId] = useState<string | undefined>(undefined);
  const pageContext = { route: "/agent-builder", ...(focusedAgentId ? { agent_id: focusedAgentId } : {}) };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* private browsing / storage blocked — just won't persist, harmless */
      }
      return next;
    });
  }

  async function handleImprove() {
    const raw = input.trim();
    if (!raw || improving || sending) return;
    setImproving(true);
    try {
      const { improved } = await improveCopilotPrompt(raw);
      setInput(improved);
    } catch {
      /* leave the user's own text untouched on failure — never silently clear it */
    } finally {
      setImproving(false);
      textareaRef.current?.focus();
    }
  }

  const draft = useMemo(() => latestDraft(messages), [messages]);
  const started = messages.length > 0 || voiceActive;

  async function refreshConversations() {
    try {
      setConversations(await listCopilotConversations());
    } catch {
      /* history is a convenience list — a failed refresh isn't worth surfacing as an error */
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshConversations();
  }, []);

  // A turn that just created a new conversation (conversationId went from
  // unset to real) won't show up in the sidebar until this refetches it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (conversationId) void refreshConversations();
  }, [conversationId]);

  async function handleDelete(id: string) {
    setConversations((prev) => prev.filter((c) => c.conversation_id !== id));
    try {
      await deleteCopilotConversation(id);
    } catch {
      void refreshConversations();
      return;
    }
    if (id === conversationId) reset();
  }

  function submit(text?: string) {
    const raw = (text ?? input).trim();
    if (!raw || sending) return;
    const value =
      mode === "prompt"
        ? `The following is a raw agent prompt/instructions the user wants turned into a structured VoicERA agent — read it for purpose, persona, tone, responsibilities, boundaries, and language, then propose a draft:\n\n${raw}`
        : raw;
    setInput("");
    setMode("describe");
    void send(value, pageContext);
  }

  return (
    <div className="relative flex h-[calc(100vh-60px)] overflow-hidden rounded-v-md border border-v-line">
      {/* Slow-moving gradient wash — the same real technique as the sign-in
          hero (AuthHero.tsx). The chat/artifact panels below are opaque (for
          text contrast), so this alone would only ever show in the thin
          gaps/padding around them — genuinely too subtle to read as "there."
          Raised to a visible-but-still-restrained opacity, and the panels
          themselves carry a whisper of the same gradient under their solid
          colour (see bg-v-panel/bg-v-soft usage below) so the wash reads
          through the whole page, not just its edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14] animate-v-grad"
        style={{
          background: "linear-gradient(120deg, var(--v-accent) 0%, #22c58f 50%, var(--v-accent-deep) 100%)",
          backgroundSize: "220% 220%",
        }}
      />

      <HistorySidebar
        conversations={conversations}
        activeId={conversationId}
        ephemeral={ephemeral}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        onNewChat={reset}
        onTemporaryChat={startEphemeralChat}
        onSelect={(id) => void loadConversation(id)}
        onDelete={(id) => void handleDelete(id)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col gap-5 p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-v-pale text-v-accent">
          <VoicEraMark size={16} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-v-fg">Agent Builder</span>
        {ephemeral ? (
          <span className="flex items-center gap-1 rounded-full border border-v-line-strong px-2 py-0.5 text-[10.5px] font-medium text-v-muted">
            <Ghost className="size-3" strokeWidth={1.8} /> Temporary — not saved
          </span>
        ) : null}
      </div>

      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-[10vh]">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-[26px] font-semibold tracking-tight text-v-fg">
              What do you want to build?
            </span>
            <p className="max-w-[420px] text-[14px] leading-relaxed text-v-muted">
              Describe your use case, speak it, or paste existing instructions — VoicERA turns it into
              a working agent, grounded in this organisation&rsquo;s real data.
            </p>
          </div>

          <div className="flex w-full max-w-[560px] flex-col gap-3">
            <div className="flex items-center gap-2 rounded-v-md border border-v-line bg-v-panel p-2 shadow-[var(--v-shadow-card)]">
              <button
                type="button"
                onClick={() => setMode("describe")}
                title="Describe"
                className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-v-sm transition-colors ${
                  mode === "describe" ? "bg-v-pale text-v-accent" : "text-v-faint hover:bg-v-soft"
                }`}
              >
                <MessageCircle className="size-4" strokeWidth={1.8} />
              </button>
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
                rows={1}
                placeholder={
                  mode === "prompt" ? "Paste your agent instructions…" : "e.g. \"I need an agent for crop advisory schemes in India.\""
                }
                className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent text-[14px] text-v-fg outline-none placeholder:text-v-faint"
              />
              <button
                type="button"
                onClick={() => {
                  setMode((m) => (m === "prompt" ? "describe" : "prompt"));
                  textareaRef.current?.focus();
                }}
                title="Prompt mode"
                className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-v-sm transition-colors ${
                  mode === "prompt" ? "bg-v-pale text-v-accent" : "text-v-faint hover:bg-v-soft"
                }`}
              >
                <FileText className="size-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => void handleImprove()}
                disabled={!input.trim() || improving}
                title="Improve my prompt — fix spelling/grammar, keep the meaning"
                className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-v-sm text-v-faint transition-colors hover:bg-v-soft hover:text-v-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {improving ? <BuilderOrb size={16} /> : <Wand2 className="size-4" strokeWidth={1.8} />}
              </button>
              <button
                type="button"
                onClick={() => submit()}
                disabled={!input.trim()}
                title="Send"
                className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-v-sm bg-v-fg text-white transition-colors hover:bg-v-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="size-4" strokeWidth={1.8} />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {PROMPT_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => {
                    setInput(t.text);
                    textareaRef.current?.focus();
                  }}
                  className="cursor-pointer rounded-full border border-v-line px-2.5 py-1 text-[11.5px] font-medium text-v-muted transition-colors hover:border-v-accent hover:text-v-accent-deep"
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setVoiceActive(true)}
              className="mx-auto flex cursor-pointer items-center gap-2 text-[13px] font-medium text-v-muted hover:text-v-fg"
            >
              <Mic className="size-4" strokeWidth={1.8} /> or tap to speak
            </button>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-5 overflow-hidden lg:grid-cols-[1.3fr_1fr]">
          <div
            className="flex flex-col overflow-hidden rounded-v-md border border-v-line bg-v-panel"
            style={{ backgroundImage: "linear-gradient(120deg, rgba(31,78,232,0.05) 0%, transparent 60%)" }}
          >
            {voiceActive ? (
              <CopilotVoiceMode conversationId={conversationId} onClose={() => setVoiceActive(false)} />
            ) : (
              <>
                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                  {messages.map((m) => (
                    <Message
                      key={m.id}
                      message={m}
                      editable={!sending}
                      onEdit={(id, newText) => void editMessage(id, newText, pageContext)}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 border-t border-v-hairline p-3">
                  <button
                    type="button"
                    onClick={() => setVoiceActive(true)}
                    title="Switch to voice"
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-v-sm text-v-faint transition-colors hover:bg-v-soft hover:text-v-fg"
                  >
                    <Mic className="size-4" strokeWidth={1.8} />
                  </button>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    rows={1}
                    placeholder={mode === "prompt" ? "Paste your agent instructions…" : "Continue the conversation…"}
                    className="max-h-28 min-h-[38px] flex-1 resize-none rounded-v-md border border-v-line bg-v-bg px-3 py-2 text-[13.5px] text-v-fg outline-none placeholder:text-v-faint focus:border-v-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void handleImprove()}
                    disabled={!input.trim() || improving}
                    title="Improve my prompt — fix spelling/grammar, keep the meaning"
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-v-sm text-v-faint transition-colors hover:bg-v-soft hover:text-v-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {improving ? <BuilderOrb size={16} /> : <Wand2 className="size-4" strokeWidth={1.8} />}
                  </button>
                  {sending ? (
                    <Button type="button" variant="dark" size="md" onClick={cancel}>
                      <Square className="size-3.5" strokeWidth={2} fill="currentColor" />
                    </Button>
                  ) : (
                    <Button type="button" size="md" onClick={() => submit()} disabled={!input.trim()}>
                      <Send className="size-3.5" strokeWidth={1.8} />
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          <div
            className="flex flex-col overflow-hidden rounded-v-md border border-v-line bg-v-soft"
            style={{ backgroundImage: "linear-gradient(300deg, rgba(34,197,143,0.06) 0%, transparent 55%)" }}
          >
            <div className="border-b border-v-hairline px-4 py-3">
              <span className="text-[11px] font-medium uppercase tracking-[.06em] text-v-faint">
                Live agent
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sending && !draft ? (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                  <BuilderOrb size={56} />
                  <span className="text-[12.5px] font-medium text-v-muted">Building your agent…</span>
                </div>
              ) : (
                <LiveArtifact draft={draft} onAgentInFocus={setFocusedAgentId} />
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
