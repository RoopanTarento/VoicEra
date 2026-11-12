"use client";

import { useCallback, useRef, useState } from "react";
import { streamCopilotChat, getCopilotConversation, truncateCopilotConversation } from "@/lib/api/copilot";
import type { CopilotAttachmentRef, CopilotContext, CopilotStreamEvent } from "@/lib/api-types";

export interface CopilotToolEvent {
  tool: string;
  status: "pending" | "done";
  ok?: boolean;
  data?: unknown;
  /** Set only when reconstructed from stored history, where the full result
   * payload isn't persisted — a one-line fallback for ToolResultCard. */
  summary?: string;
}

export interface CopilotChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolEvents: CopilotToolEvent[];
  streaming?: boolean;
  attachments?: CopilotAttachmentRef[];
  /** Transient "the provider rate-limited this, retrying automatically…"
   * status from a retry_wait event — cleared as soon as anything real
   * (a token, tool call, error, or done) arrives for this message. */
  statusText?: string;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Copilot conversation state — same local-state + manual-async shape as
 * useCampaigns/useKnowledgeBase, adapted for a token stream instead of polling. */
export function useCopilot() {
  const [messages, setMessages] = useState<CopilotChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [ephemeral, setEphemeral] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateAssistant = useCallback((id: string, patch: Partial<CopilotChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const send = useCallback(
    async (
      message: string,
      context?: CopilotContext,
      attachments?: CopilotAttachmentRef[],
      historyOverride?: CopilotChatMessage[],
    ) => {
      const trimmed = message.trim();
      if ((!trimmed && !attachments?.length) || sending) return;

      setError("");
      const assistantId = newId();
      // historyOverride lets a caller (editMessage) supply the already-
      // truncated transcript explicitly — the state variable below can still
      // hold the pre-truncation array at this point in the same tick.
      const baseHistory = historyOverride ?? messages;
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", content: trimmed, toolEvents: [], attachments },
        { id: assistantId, role: "assistant", content: "", toolEvents: [], streaming: true },
      ]);
      setSending(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let sawError = false;
      // Captured before the user/assistant placeholder messages above are
      // appended — an ephemeral turn's own history is everything already in
      // the transcript, not including the message just sent.
      const priorHistory = ephemeral
        ? baseHistory.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }))
        : undefined;

      try {
        await streamCopilotChat(
          {
            // The backend requires non-empty text; an image-only send still
            // needs something for the model to react to.
            message: trimmed || "Please look at the attached image(s).",
            conversationId,
            context,
            ephemeral,
            history: priorHistory,
            attachmentIds: attachments?.map((a) => a.attachment_id),
          },
          (event: CopilotStreamEvent) => {
            if (event.type === "start") {
              setConversationId(event.conversation_id ?? undefined);
            } else if (event.type === "retry_wait") {
              // The provider rate-limited this turn and the engine is
              // waiting out its own stated retry time — real status, not
              // an error, since it usually recovers on its own.
              updateAssistant(assistantId, { statusText: event.message });
            } else if (event.type === "token") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + event.text, statusText: undefined }
                    : m,
                ),
              );
            } else if (event.type === "tool_call") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolEvents: [...m.toolEvents, { tool: event.tool, status: "pending" }],
                        statusText: undefined,
                      }
                    : m,
                ),
              );
            } else if (event.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const idx = [...m.toolEvents].reverse().findIndex((t) => t.status === "pending");
                  if (idx === -1) return m;
                  const realIdx = m.toolEvents.length - 1 - idx;
                  const toolEvents = [...m.toolEvents];
                  toolEvents[realIdx] = { tool: event.tool, status: "done", ok: event.ok, data: event.data };
                  return { ...m, toolEvents };
                }),
              );
            } else if (event.type === "error") {
              sawError = true;
              setError(event.message);
              updateAssistant(assistantId, {
                content: event.message,
                streaming: false,
                statusText: undefined,
              });
            } else if (event.type === "done") {
              setConversationId(event.conversation_id ?? undefined);
              updateAssistant(assistantId, { content: event.text, streaming: false, statusText: undefined });
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (!sawError) {
          const text = err instanceof Error ? err.message : "The Copilot connection was interrupted.";
          setError(text);
          updateAssistant(assistantId, { content: text, streaming: false });
        }
      } finally {
        updateAssistant(assistantId, { streaming: false });
        setSending(false);
        abortRef.current = null;
      }
    },
    [conversationId, sending, ephemeral, messages, updateAssistant],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Edits a past user message and resends it — drops that message, the
   * (now-stale) reply, and everything after it, both locally and (if this
   * conversation is saved) on the server, before sending the edit as a
   * fresh turn from that point. */
  const editMessage = useCallback(
    async (messageId: string, newText: string, context?: CopilotContext) => {
      if (sending) return;
      const index = messages.findIndex((m) => m.id === messageId);
      if (index === -1) return;

      if (conversationId) {
        try {
          await truncateCopilotConversation(conversationId, index);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't update that conversation.");
          return;
        }
      }
      const truncated = messages.slice(0, index);
      setMessages(truncated);
      await send(newText, context, undefined, truncated);
    },
    [messages, conversationId, sending, send],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    setError("");
    setEphemeral(false);
  }, []);

  /** Starts a fresh, unsaved chat — nothing sent in it reaches
   * CopilotConversations, for a quick question the user doesn't want kept. */
  const startEphemeralChat = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    setError("");
    setEphemeral(true);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setError("");
    try {
      const detail = await getCopilotConversation(id);
      setConversationId(detail.conversation_id);
      setEphemeral(false);
      setMessages(
        detail.messages.map((m) => ({
          id: newId(),
          role: m.role,
          content: m.content,
          toolEvents: (m.tool_calls || []).map((t) => ({
            tool: t.tool,
            status: "done" as const,
            ok: t.ok,
            data: undefined,
            summary: t.summary ?? undefined,
          })),
          attachments: m.attachments,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that conversation.");
    }
  }, []);

  return {
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
  };
}
