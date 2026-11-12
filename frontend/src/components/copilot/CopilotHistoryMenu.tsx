"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { History as HistoryIcon, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { deleteCopilotConversation, listCopilotConversations } from "@/lib/api/copilot";
import type { CopilotConversationSummary } from "@/lib/api-types";

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Past-conversation list + resume, backed by the real /copilot/conversations
 * endpoints that already existed server-side with no frontend UI until now. */
export function CopilotHistoryMenu({ onSelect }: { onSelect: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<CopilotConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  function loadConversations() {
    setLoading(true);
    listCopilotConversations()
      .then(setConversations)
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }

  // Fetch is triggered by the click that opens the menu (a real user event,
  // not a useEffect keyed on `open` state) — simpler and sidesteps
  // synchronizing-with-an-effect entirely for what's just a response to a click.
  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next) loadConversations();
      return next;
    });
  }

  useEffect(() => {
    function onClickOutside(e: globalThis.MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleDelete(e: MouseEvent, conversationId: string) {
    e.stopPropagation();
    setConversations((prev) => prev.filter((c) => c.conversation_id !== conversationId));
    try {
      await deleteCopilotConversation(conversationId);
    } catch {
      /* list is just stale until the menu is reopened — not worth blocking on */
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Past conversations"
        aria-label="Past conversations"
        onClick={toggleOpen}
        className="flex size-8 cursor-pointer items-center justify-center rounded-v-sm text-v-muted transition-colors hover:bg-v-soft hover:text-v-fg"
      >
        <HistoryIcon className="size-4" strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-10 max-h-80 w-64 overflow-y-auto rounded-v-md border border-v-line bg-v-panel p-1.5 shadow-[var(--v-shadow-card)]">
          <span className="block px-2 py-1.5 text-[10px] font-medium uppercase tracking-[.06em] text-v-faint">
            Past conversations
          </span>
          {loading ? (
            <div className="flex justify-center py-4">
              <Spinner light={false} />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-[12.5px] text-v-muted">No past conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.conversation_id}
                type="button"
                onClick={() => {
                  onSelect(c.conversation_id);
                  setOpen(false);
                }}
                className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-v-sm px-2 py-2 text-left transition-colors hover:bg-v-soft"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] text-v-fg">{c.title}</span>
                  <span className="text-[10.5px] text-v-faint">{relativeTime(c.updated_at)}</span>
                </span>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => void handleDelete(e, c.conversation_id)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-v-sm text-v-faint opacity-0 transition-opacity hover:bg-v-danger-pale hover:text-v-danger-deep group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} />
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
