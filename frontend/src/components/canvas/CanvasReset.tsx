"use client";

import { useState } from "react";
import { useCanvas } from "@/lib/adopt/advisor/canvas-store";

export function CanvasReset() {
  const { hydrated, state, actions } = useCanvas();
  const [confirm, setConfirm] = useState(false);
  if (!hydrated || !state.started) return null;
  if (confirm)
    return (
      <span className="flex items-center gap-2" role="alertdialog" aria-label="Confirm start over">
        <span>Clear this package?</span>
        <button type="button" className="font-semibold text-v-danger" onClick={() => { actions.reset(); setConfirm(false); }}>Clear</button>
        <button type="button" onClick={() => setConfirm(false)}>Keep</button>
      </span>
    );
  return <button type="button" onClick={() => setConfirm(true)} className="hover:text-v-danger">Start over</button>;
}
