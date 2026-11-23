"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AgentsHome } from "@/components/dashboard/AgentsHome";
import { usePermissions } from "@/components/PermissionsProvider";
import { useToast } from "@/components/ui/useToast";
import { readTryDraft } from "@/lib/api/try-agent";

export default function DashboardPage() {
  const { notify, toastNode } = useToast();
  const router = useRouter();
  const { can, loaded } = usePermissions();

  // Arriving from /try after sign-in: confirm the tried agent was saved (once).
  const savedShown = useRef(false);
  useEffect(() => {
    if (savedShown.current) return;
    const params = new URLSearchParams(window.location.search);
    const saved = params.get("saved");
    if (!saved) return;
    savedShown.current = true;
    notify(`${saved.slice(0, 80)} is in your workspace`, "Give it a phone number, then start a campaign.");
    router.replace("/dashboard");
  }, [notify, router]);

  // Someone who tried an agent on /try before signing in lands here; take
  // them straight to finishing that agent in their workspace.
  useEffect(() => {
    if (loaded && can("agents:write") && readTryDraft()) router.replace("/agent-creation?quick=1&from=try");
  }, [loaded, can, router]);

  return (
    <main className="flex w-full flex-col gap-6">
      <AgentsHome onNotify={notify} />
      {toastNode}
    </main>
  );
}
