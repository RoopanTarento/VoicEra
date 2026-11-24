"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentsHome } from "@/components/dashboard/AgentsHome";
import { usePermissions } from "@/components/PermissionsProvider";
import { useToast } from "@/components/ui/useToast";
import { clearDemoDraft, readDemoDraft, readTryDraft, saveTriedAgent } from "@/lib/api/try-agent";

export default function DashboardPage() {
  const { notify, toastNode } = useToast();
  const router = useRouter();
  const { can, loaded } = usePermissions();
  // Bumped after saving a demo agent here, so the list reloads with it.
  const [listKey, setListKey] = useState(0);

  // Arriving from the demo builder after sign-in: confirm the agent was saved,
  // or say why it couldn't be (once).
  const savedShown = useRef(false);
  useEffect(() => {
    if (savedShown.current) return;
    const params = new URLSearchParams(window.location.search);
    const saved = params.get("saved");
    const unsaved = params.get("unsaved");
    if (!saved && !unsaved) return;
    savedShown.current = true;
    if (saved) notify(`${saved.slice(0, 80)} is in your workspace`, "Give it a phone number, then start a campaign.");
    else notify("Your demo agent isn't saved yet", `${(unsaved ?? "").slice(0, 200)} It will be saved the next time you open this page.`);
    router.replace("/dashboard");
  }, [notify, router]);

  // Someone who built an agent before signing in (from the top bar, say)
  // lands here: save it to this workspace now.
  const draftTried = useRef(false);
  useEffect(() => {
    if (!loaded || !can("agents:write") || draftTried.current) return;
    if (new URLSearchParams(window.location.search).get("unsaved")) return;
    const draft = readDemoDraft();
    if (draft) {
      draftTried.current = true;
      saveTriedAgent(draft)
        .then((saved) => {
          clearDemoDraft();
          notify(`${saved.name.slice(0, 80)} is in your workspace`, "Give it a phone number, then start a campaign.");
          setListKey((k) => k + 1);
        })
        .catch((err: unknown) =>
          notify("Your demo agent isn't saved yet", err instanceof Error ? err.message : "Try again in a moment."),
        );
      return;
    }
    // The earlier scheme-discovery preview: finish that agent in the quick setup.
    if (readTryDraft()) router.replace("/agent-creation?quick=1&from=try");
  }, [loaded, can, router, notify]);

  return (
    <main className="flex w-full flex-col gap-6">
      <AgentsHome key={listKey} onNotify={notify} />
      {toastNode}
    </main>
  );
}
