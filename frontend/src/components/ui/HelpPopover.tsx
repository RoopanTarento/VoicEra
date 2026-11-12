"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

/** A small "i" (or labelled) button that opens a panel of guidance on hover,
 * focus or click — for help that's longer than a one-line tooltip (upload
 * guidelines, naming rules). Closes on Escape or a click elsewhere. */
export function HelpPopover({
  label,
  title,
  children,
  align = "left",
}: {
  /** Text next to the icon; without it only the icon shows. */
  label?: string;
  title: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label ? undefined : title}
        onClick={() => {
          setPinned((p) => !p);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="inline-flex cursor-help items-center gap-1.5 rounded-full text-xs font-medium text-v-muted transition-colors hover:text-v-accent focus-visible:text-v-accent"
      >
        <Info className="size-4" strokeWidth={1.75} />
        {label ? <span>{label}</span> : null}
      </button>
      {open ? (
        <span
          id={id}
          role="dialog"
          aria-label={title}
          className={`animate-v-rise absolute top-[calc(100%+8px)] z-50 flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2 rounded-v-md border border-v-line bg-white p-4 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-v-fg shadow-[0_12px_34px_rgba(11,11,12,.16)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <span className="text-[13px] font-semibold">{title}</span>
          {children}
        </span>
      ) : null}
    </span>
  );
}
