"use client";

import { useRouter } from "next/navigation";
import {
  Bot,
  ClipboardPen,
  Compass,
  HandCoins,
  LifeBuoy,
  Megaphone,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUseCaseCatalogue } from "@/hooks/useUseCaseCatalogue";
import type { AgentUseCase, SchemeIntent } from "@/lib/api-types";
import { schemeLimitLabel, type IntentInfo } from "@/lib/api/use-cases";

// Icons and fallback text for the six scheme agents; names, descriptions and
// scheme limits come from the catalogue once it has loaded.
const INTENT_CARDS: Record<SchemeIntent, { icon: LucideIcon; fallback: Pick<IntentInfo, "name" | "description" | "max_schemes"> }> = {
  awareness: {
    icon: Megaphone,
    fallback: { name: "Awareness", description: "Tell people a scheme exists and what it gives, in under a minute.", max_schemes: 3 },
  },
  discovery: {
    icon: Compass,
    fallback: { name: "Discovery", description: "Ask a few questions to find which schemes may fit the family, and how to apply.", max_schemes: null },
  },
  enrolment: {
    icon: ClipboardPen,
    fallback: { name: "Enrolment", description: "Help people who may be eligible apply or register, step by step.", max_schemes: 1 },
  },
  utilisation: {
    icon: HandCoins,
    fallback: { name: "Utilisation", description: "Make sure people already in the scheme know how to actually get the benefit.", max_schemes: 1 },
  },
  support: {
    icon: LifeBuoy,
    fallback: { name: "Support", description: "Check whether people in the scheme have had a problem, and send it to the right channel.", max_schemes: 1 },
  },
  feedback: {
    icon: MessageSquareText,
    fallback: { name: "Feedback", description: "A two-minute survey on whether the benefit reached people and how the process felt.", max_schemes: 1 },
  },
};

const ORDER: SchemeIntent[] = ["awareness", "discovery", "enrolment", "utilisation", "support", "feedback"];

/** The six scheme agents as cards: clickable in the wizard, a plain
 * explanation (no onPick) on the first-time home screen. */
export function IntentCards({ onPick }: { onPick?: (intent: SchemeIntent) => void }) {
  const { catalogue } = useUseCaseCatalogue();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ORDER.map((id) => {
        const { icon: Icon, fallback } = INTENT_CARDS[id];
        const info = catalogue?.intents.find((i) => i.id === id) ?? fallback;
        const body = (
          <>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-v-accent text-white transition-transform group-hover:scale-105">
              <Icon className="size-[18px]" strokeWidth={1.8} />
            </span>
            <span className="flex flex-1 flex-col gap-1">
              <span className="text-[16px] font-semibold tracking-tight">{info.name}</span>
              <span className="text-[12.5px] font-light leading-relaxed text-v-muted">{info.description}</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[.1em] text-v-accent">
              {schemeLimitLabel(info.max_schemes)}
            </span>
          </>
        );
        return onPick ? (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className="group flex cursor-pointer flex-col gap-3 rounded-v-md border border-v-line bg-white p-4 text-left transition-colors hover:border-v-accent"
          >
            {body}
          </button>
        ) : (
          <div key={id} className="flex flex-col gap-3 rounded-v-md border border-v-line bg-white p-4">
            {body}
          </div>
        );
      })}
    </div>
  );
}

interface StartStepProps {
  onStartScratch: () => void;
  onPickUseCase: (useCase: AgentUseCase) => void;
}

export function StartStep({ onStartScratch, onPickUseCase }: StartStepProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-7 animate-v-rise">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-semibold tracking-tight">What should this agent do?</h1>
        <p className="max-w-2xl text-sm font-light leading-relaxed text-v-muted-2">
          Pick what the call is for and choose the scheme. VoicEra writes the agent and attaches the scheme&apos;s
          knowledge pack. During a call, any of these agents can switch to another path if the person needs it.
        </p>
      </div>

      <IntentCards onPick={(id) => onPickUseCase({ type: "scheme", intent: id, scheme_ids: [], survey_id: null })} />

      <div className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[.14em] text-v-muted">Or</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            data-tour="start-from-scratch"
            onClick={onStartScratch}
            className="flex cursor-pointer items-start gap-3.5 rounded-v-md border border-v-line bg-white p-4 text-left transition-colors hover:border-v-accent"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-v-fg text-white">+</span>
            <span className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold tracking-tight">Start from scratch</span>
              <span className="text-[13px] font-light leading-relaxed text-v-muted">
                Write your own prompt, one screen at a time.
              </span>
            </span>
          </button>

          <Tooltip text="Agent Builder" className="w-full">
            <button
              type="button"
              onClick={() => router.push("/agent-builder")}
              className="group relative flex w-full cursor-pointer items-start gap-3.5 overflow-hidden rounded-v-md border border-v-line bg-white p-4 text-left transition-colors hover:border-v-accent"
            >
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-v-accent/[0.06] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-v-soft text-v-fg">
                <Bot className="size-[18px]" strokeWidth={1.8} />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold tracking-tight">Agent Builder</span>
                <span className="text-[13px] font-light leading-relaxed text-v-muted">
                  Describe, speak, or paste instructions — VoicERA drafts an agent for you to review.
                </span>
              </span>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
