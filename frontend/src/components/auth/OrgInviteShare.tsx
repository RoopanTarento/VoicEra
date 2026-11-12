"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Read-only link field with a copy button — used for one-time invite links. */
export function InviteLinkCopy({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the input is still selectable/copyable manually */
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={link}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-v-sm border border-v-line-strong bg-v-soft/50 px-3.5 py-2.5 font-mono text-[12.5px] text-v-fg"
      />
      <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0">
        {copied ? (
          <>
            <Check className="size-3.5" strokeWidth={1.75} /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3.5" strokeWidth={1.75} /> Copy link
          </>
        )}
      </Button>
    </div>
  );
}

/** Shown once a new organisation exists. Joining needs a personal invitation,
 * so this points at Members rather than handing out a shared link. */
export function OrgInviteShare({
  orgName,
  onContinue,
  continueLabel = "Continue",
}: {
  orgName: string;
  onContinue: () => void;
  continueLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-v-muted">
          Organisation created
        </span>
        <h2 className="m-0 text-3xl font-semibold tracking-tight">{orgName}</h2>
        <p className="m-0 text-sm font-light leading-relaxed text-v-muted">
          You&apos;re the Super admin of {orgName}. To bring in teammates, open Members and invite each person by email
          with the role they need. Every invite is a one-time link for that email.
        </p>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-v-sm bg-v-fg px-4.5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-v-accent"
      >
        {continueLabel}
      </button>
    </div>
  );
}
