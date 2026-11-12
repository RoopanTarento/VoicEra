"use client";

import { useState } from "react";
import { HelpCircle, MessageSquare, Mic, History as HistoryIcon, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const SEEN_KEY = "voicera_ask_voicera_intro_seen";

const STEPS = [
  {
    icon: MessageSquare,
    title: "Ask anything",
    body: "Questions about your agents, calls, campaigns, or knowledge base are answered from your organisation's real data — never a canned demo.",
  },
  {
    icon: Wand2,
    title: "Build with a conversation",
    body: "Describe what you want in plain language — e.g. \"Create a Kannada support agent.\" Agent Builder drafts it and always asks you to confirm before creating anything real.",
  },
  {
    icon: Mic,
    title: "Talk instead of type",
    body: "Tap the mic for a live spoken conversation. You can interrupt while it's speaking — no need to wait for it to finish.",
  },
  {
    icon: HistoryIcon,
    title: "Your history is saved",
    body: "Every conversation is kept. Reopen or delete past ones anytime from the history icon at the top of this panel.",
  },
];

function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markIntroSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private browsing / storage blocked — just won't persist, harmless */
  }
}

/** A short, self-contained tour of the Agent Builder's own interface —
 * separate from the product-wide WalkthroughProvider tour, which explains
 * VoicERA's pages, not the Agent Builder. Shown once automatically,
 * reopenable via the "?" button in the panel header.
 *
 * Pass a `key` from the parent that changes each time it's reopened (e.g. an
 * incrementing counter) — remounting is what resets stepIndex to 0, rather
 * than a useEffect keyed on `active` (avoids a setState-in-effect). */
export function CopilotIntroTour({ active, onClose }: { active: boolean; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);

  if (!active) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  function finish() {
    markIntroSeen();
    onClose();
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-v-panel/98 px-7 py-8 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close tour"
        onClick={finish}
        className="absolute right-4 top-4 flex size-7 cursor-pointer items-center justify-center rounded-v-sm text-v-muted transition-colors hover:bg-v-soft hover:text-v-fg"
      >
        <X className="size-4" strokeWidth={1.8} />
      </button>

      <span className="flex size-11 items-center justify-center rounded-full bg-v-soft text-v-accent">
        <step.icon className="size-5" strokeWidth={1.8} />
      </span>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="text-[14.5px] font-semibold text-v-fg">{step.title}</span>
        <p className="max-w-[260px] text-[12.5px] leading-relaxed text-v-muted">{step.body}</p>
      </div>

      <div className="flex items-center gap-1.5">
        {STEPS.map((_, i) => (
          <span
            key={i}
            className={`size-1.5 rounded-full transition-colors ${i === stepIndex ? "bg-v-accent" : "bg-v-line-strong"}`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        {stepIndex > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setStepIndex((i) => i - 1)}>
            Back
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={finish}>
            Skip
          </Button>
        )}
        <Button size="sm" onClick={isLast ? finish : () => setStepIndex((i) => i + 1)}>
          {isLast ? "Done" : "Next"}
        </Button>
      </div>
    </div>
  );
}

/** Header trigger for CopilotIntroTour — always available, not just first-run. */
export function CopilotIntroTourButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="How to use Agent Builder"
      aria-label="How to use Agent Builder"
      onClick={onClick}
      className="flex size-8 cursor-pointer items-center justify-center rounded-v-sm text-v-muted transition-colors hover:bg-v-soft hover:text-v-fg"
    >
      <HelpCircle className="size-4" strokeWidth={1.75} />
    </button>
  );
}

export { hasSeenIntro };
