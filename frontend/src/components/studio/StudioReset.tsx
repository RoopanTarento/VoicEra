"use client";

import { useState } from "react";
import { useAdvisor } from "@/lib/adopt/advisor/store";
import { useStudio } from "@/lib/adopt/advisor/studio-store";

export function StudioReset() {
  const advisor = useAdvisor();
  const studio = useStudio();
  const [confirm, setConfirm] = useState(false);
  if (!studio.hydrated) return null;
  if (confirm)
    return (
      <span className="flex items-center gap-2" role="alertdialog" aria-label="Confirm start over">
        <span>Clear this session?</span>
        <button type="button" className="font-semibold text-v-danger" onClick={() => { advisor.actions.resetAdvisor(); studio.actions.reset(); setConfirm(false); }}>Clear</button>
        <button type="button" onClick={() => setConfirm(false)}>Keep</button>
      </span>
    );
  return (
    <button type="button" onClick={() => setConfirm(true)} className="hover:text-v-danger">
      Start over
    </button>
  );
}
