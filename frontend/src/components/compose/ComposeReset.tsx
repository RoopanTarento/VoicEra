"use client";

import { useState } from "react";
import { useCompose } from "@/lib/adopt/advisor/compose-store";

export function ComposeReset() {
  const { hydrated, state, actions } = useCompose();
  const [confirm, setConfirm] = useState(false);
  if (!hydrated || !state.started) return null;
  if (confirm)
    return (
      <span className="flex items-center gap-2" role="alertdialog" aria-label="Confirm start over">
        <span>Clear this build?</span>
        <button type="button" className="font-semibold text-v-danger" onClick={() => { actions.reset(); setConfirm(false); }}>Clear</button>
        <button type="button" onClick={() => setConfirm(false)}>Keep</button>
      </span>
    );
  return <button type="button" onClick={() => setConfirm(true)} className="hover:text-v-danger">Start over</button>;
}
