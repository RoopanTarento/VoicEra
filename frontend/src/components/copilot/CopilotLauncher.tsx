"use client";

import { X } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { VoicEraMark } from "@/components/ui/VoicEraMark";

/** Fixed launcher for the Copilot panel. Deliberately restrained — no glow,
 * no gradient, no motion loop — a plain dark pill consistent with the rest
 * of the "Signal" design system (see Button's "dark" variant), with the
 * real VoicEra frequency-bar mark (the same brand asset used on the sign-in
 * screen and success states) so it reads as "VoicEra" rather than a generic
 * chatbot icon. */
export function CopilotLauncher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const button = (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Close Agent Builder" : "Open Agent Builder"}
      aria-expanded={open}
      className="flex size-13 cursor-pointer items-center justify-center rounded-full bg-v-fg text-white shadow-[var(--v-shadow-card)] transition-all duration-150 hover:scale-105 hover:bg-v-accent active:scale-95"
      style={{ width: 52, height: 52 }}
    >
      {open ? <X className="size-5" strokeWidth={1.8} /> : <VoicEraMark size={22} />}
    </button>
  );

  // Only worth naming the launcher when it's closed — once open it's just
  // a close button, and "Agent Builder" as a tooltip on an X would be noise.
  // The fixed positioning lives on this outer wrapper, not on Tooltip's own
  // span, so it never collides with Tooltip's own `relative` utility.
  return (
    <div className="fixed bottom-6 right-6 z-[95]">
      {open ? button : (
        <Tooltip text="Agent Builder" side="top">
          {button}
        </Tooltip>
      )}
    </div>
  );
}
