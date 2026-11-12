"use client";

import { HelpPopover } from "@/components/ui/HelpPopover";
import { Input } from "@/components/ui/Field";
import { NAME_CHARACTERS, NAME_MAX, NAME_MIN, nameProblem, tidyName } from "@/lib/naming";

/** A name input with the standard naming rules: live check, character count
 * and a "Naming rules" tip. `taken` = names already in use (any case). */
export function NameField({
  label,
  value,
  onChange,
  taken = [],
  what = "campaign",
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  taken?: string[];
  what?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const problem = nameProblem(value, taken, what);
  const length = tidyName(value).length;
  return (
    <div className="flex flex-col gap-1.5 text-[13px] font-medium">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          {label}
          <HelpPopover title="Naming rules">
            <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-v-body">
              <li>
                {NAME_MIN} to {NAME_MAX} characters; extra spaces are removed.
              </li>
              <li>Use {NAME_CHARACTERS}. Hindi and other scripts are fine; no emoji or quotes.</li>
              <li>Unique in your organisation, ignoring capital letters.</li>
              <li>Lead with what and where, then when: &ldquo;Kharif advisory – Belagavi – Nov 2026&rdquo;.</li>
            </ul>
          </HelpPopover>
        </span>
        <span className={`font-mono text-[10.5px] font-normal ${length > NAME_MAX ? "text-v-danger" : "text-v-muted"}`}>
          {length}/{NAME_MAX}
        </span>
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={Boolean(problem)}
        className={problem ? "!border-v-danger" : ""}
      />
      {problem ? <span className="text-xs font-normal text-v-danger">{problem}</span> : null}
    </div>
  );
}

/** True when the name is usable (non-empty and passes the rules). */
export function nameReady(value: string, taken: string[] = [], what = "campaign"): boolean {
  return tidyName(value).length > 0 && !nameProblem(value, taken, what);
}
