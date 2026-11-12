import { DEMO_MESSAGE, getAccessToken, isDemoToken } from "@/lib/auth-storage";
import { apiFetch, apiFetchBlob } from "@/lib/api/http";
import type {
  CopilotAgentDraftConfirmResponse,
  CopilotAttachmentRef,
  CopilotCampaignDraftConfirmResponse,
  CopilotContext,
  CopilotConversationDetail,
  CopilotConversationSummary,
  CopilotStreamEvent,
  CopilotVoiceSessionCreateResponse,
} from "@/lib/api-types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

export function listCopilotConversations(): Promise<CopilotConversationSummary[]> {
  return apiFetch<CopilotConversationSummary[]>("/copilot/conversations");
}

export function getCopilotConversation(conversationId: string): Promise<CopilotConversationDetail> {
  return apiFetch<CopilotConversationDetail>(`/copilot/conversations/${conversationId}`);
}

export function deleteCopilotConversation(conversationId: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/copilot/conversations/${conversationId}`, { method: "DELETE" });
}

/** Real, tiny, non-streaming LLM call (its own dedicated micro-prompt on the
 * backend, no tool schemas) — fixes spelling/grammar in a draft message
 * before the user sends it. Never a local/fabricated text transform. */
export function improveCopilotPrompt(text: string): Promise<{ improved: string }> {
  return apiFetch("/copilot/improve-prompt", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** Drops stored messages from keepCount onward — called right before
 * resending an edited past message, so the old (now-stale) reply and
 * anything after it don't linger in history or get replayed as context. */
export function truncateCopilotConversation(
  conversationId: string,
  keepCount: number,
): Promise<{ truncated: boolean }> {
  return apiFetch(`/copilot/conversations/${conversationId}/truncate`, {
    method: "POST",
    body: JSON.stringify({ keep_count: keepCount }),
  });
}

/** Turns a Copilot-proposed agent draft into a real agent — the only Copilot
 * action that writes anything, and only ever called from an explicit user click. */
export function confirmAgentDraft(draftId: string): Promise<CopilotAgentDraftConfirmResponse> {
  return apiFetch(`/copilot/agent-drafts/${draftId}/confirm`, { method: "POST" });
}

export function dismissAgentDraft(draftId: string): Promise<{ dismissed: boolean }> {
  return apiFetch(`/copilot/agent-drafts/${draftId}/dismiss`, { method: "POST" });
}

/** Turns a Copilot-proposed campaign draft into a real campaign. */
export function confirmCampaignDraft(draftId: string): Promise<CopilotCampaignDraftConfirmResponse> {
  return apiFetch(`/copilot/campaign-drafts/${draftId}/confirm`, { method: "POST" });
}

export function dismissCampaignDraft(draftId: string): Promise<{ dismissed: boolean }> {
  return apiFetch(`/copilot/campaign-drafts/${draftId}/dismiss`, { method: "POST" });
}

/** Creates a short-lived voice session; the browser hands the bare session_id
 * to the runtime over a WebSocket, it never sees a model/provider credential. */
export function createCopilotVoiceSession(
  conversationId?: string,
): Promise<CopilotVoiceSessionCreateResponse> {
  const query = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : "";
  return apiFetch(`/copilot/voice/session${query}`, { method: "POST" });
}

export function endCopilotVoiceSession(sessionId: string): Promise<{ ended: boolean }> {
  return apiFetch(`/copilot/voice/session/${sessionId}/end`, { method: "POST" });
}

/** Uploads one image (png/jpeg/webp/gif, up to the backend's size limit) and
 * returns its id — pass that id in streamCopilotChat's attachmentIds. */
export function uploadCopilotAttachment(file: File): Promise<CopilotAttachmentRef> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<CopilotAttachmentRef>("/copilot/attachments", {
    method: "POST",
    body: formData,
  });
}

/** The raw image bytes for a previously-uploaded attachment — org-scoped,
 * so this needs the same Bearer auth as everything else (no public URL). */
export function fetchCopilotAttachment(attachmentId: string): Promise<Blob> {
  return apiFetchBlob(`/copilot/attachments/${encodeURIComponent(attachmentId)}`);
}

/**
 * Stream a Copilot turn over Server-Sent Events. Not built on apiFetch: SSE
 * needs the raw response body reader, not a single parsed JSON payload.
 * Mirrors apiFetch's auth-header + 401 handling so behavior stays consistent.
 */
export async function streamCopilotChat(
  params: {
    message: string;
    conversationId?: string;
    context?: CopilotContext;
    ephemeral?: boolean;
    history?: { role: string; content: string }[];
    attachmentIds?: string[];
  },
  onEvent: (event: CopilotStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAccessToken();
  if (isDemoToken(token)) {
    onEvent({ type: "error", message: DEMO_MESSAGE });
    return;
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/copilot/chat`, {
    method: "POST",
    headers,
    signal,
    cache: "no-store",
    body: JSON.stringify({
      message: params.message,
      conversation_id: params.conversationId,
      context: params.context,
      ephemeral: params.ephemeral ?? false,
      history: params.history ?? [],
      attachment_ids: params.attachmentIds ?? [],
    }),
  });

  if (res.status === 401) {
    onEvent({ type: "error", message: "Your session expired. Please sign in again." });
    return;
  }
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `Copilot request failed (${res.status}).` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; each frame may itself span
    // multiple "data: " lines, but the engine only ever emits one per frame.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (frame.startsWith("data:")) {
        const payload = frame.slice(5).trim();
        try {
          onEvent(JSON.parse(payload) as CopilotStreamEvent);
        } catch {
          // Ignore a malformed frame rather than aborting the whole stream.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
