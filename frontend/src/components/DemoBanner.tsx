"use client";

import { Info } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { isDemoToken } from "@/lib/auth-storage";

/** Shown only for the local demo sign-in, so nobody mistakes an empty page
 * for real (empty) data. */
export function DemoBanner() {
  const { session } = useAuth();
  if (!session || !isDemoToken(session.accessToken)) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-v-line bg-v-panel px-[34px] py-2 text-[12.5px] text-v-muted"
    >
      <Info className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      Demo mode. No backend is connected, so agents, analytics and Copilot replies are unavailable.
    </div>
  );
}
