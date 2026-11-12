"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CopilotPanel } from "./CopilotPanel";
import { CopilotLauncher } from "./CopilotLauncher";
import { usePermissions } from "@/components/PermissionsProvider";
import type { CopilotContext as CopilotPageContext } from "@/lib/api-types";

/** A named, client-only entry flow CopilotPanel renders itself — no LLM
 * round trip to get there. Add new values here as more of these exist. */
export type CopilotIntent = "create_agent";

interface CopilotContextValue {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  /** Opens the panel with a message ready to send immediately — for entry
   * points elsewhere in the product (e.g. "Create with Ask VoicEra") that
   * want to land the user straight into a specific request, not a blank chat. */
  showWithMessage: (message: string) => void;
  /** The message set by showWithMessage, consumed once by CopilotPanel. */
  pendingMessage: string | null;
  clearPendingMessage: () => void;
  /** Opens the panel straight into a named local flow (see CopilotIntent) —
   * for entry points that want a fast, deterministic UI step (e.g. "which
   * kind of agent?") before anything is sent to the model at all. */
  showWithIntent: (intent: CopilotIntent) => void;
  pendingIntent: CopilotIntent | null;
  clearPendingIntent: () => void;
}

const CopilotUiContext = createContext<CopilotContextValue>({
  open: false,
  show: () => {},
  hide: () => {},
  toggle: () => {},
  showWithMessage: () => {},
  pendingMessage: null,
  clearPendingMessage: () => {},
  showWithIntent: () => {},
  pendingIntent: null,
  clearPendingIntent: () => {},
});

/** Best-effort "what is the user looking at" hint for Mode 2 ("Understand") —
 * only route + a resolved agent_id today; call/campaign ids are ready on the
 * wire (see CopilotContext) for a follow-up once those have dedicated routes. */
function derivePageContext(pathname: string | null): CopilotPageContext {
  if (!pathname) return {};
  const agentMatch = pathname.match(/^\/agents\/([^/]+)/);
  return {
    route: pathname,
    agent_id: agentMatch ? agentMatch[1] : undefined,
  };
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The copilot is the Agent Builder's assistant: Super admin and Admin only.
  const canUseCopilot = usePermissions().can("copilot:use");
  const [open, setOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<CopilotIntent | null>(null);

  const pageContext = useMemo(() => derivePageContext(pathname), [pathname]);

  const value = useMemo<CopilotContextValue>(
    () => ({
      open,
      show: () => setOpen(true),
      hide: () => setOpen(false),
      toggle: () => setOpen((v) => !v),
      showWithMessage: (message: string) => {
        setPendingMessage(message);
        setOpen(true);
      },
      pendingMessage,
      clearPendingMessage: () => setPendingMessage(null),
      showWithIntent: (intent: CopilotIntent) => {
        setPendingIntent(intent);
        setOpen(true);
      },
      pendingIntent,
      clearPendingIntent: () => setPendingIntent(null),
    }),
    [open, pendingMessage, pendingIntent],
  );

  return (
    <CopilotUiContext.Provider value={value}>
      {children}
      {canUseCopilot ? (
        <>
          <CopilotLauncher open={open} onToggle={value.toggle} />
          <CopilotPanel open={open} onClose={value.hide} pageContext={pageContext} />
        </>
      ) : null}
    </CopilotUiContext.Provider>
  );
}

export function useCopilotUi() {
  return useContext(CopilotUiContext);
}
