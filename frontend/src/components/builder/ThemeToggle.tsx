"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

/**
 * Light and dark. The choice is remembered and applied by a tiny script before the page paints (see the layout),
 * so there is no flash. The state lives on the html element as data-vb-theme, which only the builder reads.
 */
const KEY = "voicera.builder.theme";
export type Theme = "light" | "dark";

const listeners = new Set<() => void>();
const read = (): Theme => (typeof document !== "undefined" && document.documentElement.dataset.vbTheme === "light" ? "light" : "dark");
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function setTheme(t: Theme) {
  document.documentElement.dataset.vbTheme = t;
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    // Storage can be blocked. The theme still applies for this page load.
  }
  listeners.forEach((l) => l());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  return (
    <div role="group" aria-label="Colour theme" className="flex items-center rounded-full border border-[var(--vb-line-strong)] p-0.5">
      {(["light", "dark"] as Theme[]).map((t) => {
        const Icon = t === "light" ? Sun : Moon;
        return (
          <button key={t} type="button" aria-pressed={theme === t} aria-label={`${t === "light" ? "Light" : "Dark"} theme`} onClick={() => setTheme(t)} className={`flex size-7 items-center justify-center rounded-full transition-colors ${theme === t ? "bg-[var(--vb-ink)] text-[var(--vb-on-ink)]" : "text-[var(--vb-muted)] hover:text-[var(--vb-ink)]"}`}>
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">{theme === "dark" ? "Dark theme on" : "Light theme on"}</span>
    </div>
  );
}
