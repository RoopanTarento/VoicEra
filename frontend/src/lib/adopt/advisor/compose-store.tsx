"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { emptyDesign, toggleBlock, setTopic, type BlockId, type Design, type Topic } from "./compose";

/** The Composer's own state. Kept in this browser only, under its own key. */

const KEY = "voicera.compose.v1";

export interface ComposeState {
  started: boolean;
  design: Design;
  tab: "canvas" | "hear" | "script";
}

const initial = (): ComposeState => ({ started: false, design: emptyDesign(), tab: "canvas" });
const SERVER = initial();
let current = SERVER;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ComposeState>;
      current = { ...initial(), ...p, design: { ...emptyDesign(), ...(p.design ?? {}), ready: { ...emptyDesign().ready, ...(p.design?.ready ?? {}) } } };
    }
  } catch {
    current = initial();
  }
}

function commit(next: ComposeState) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The composer still works for this page load.
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  load();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const snapshot = () => {
  load();
  return current;
};
const noop = () => () => undefined;

export function useCompose() {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const begin = useCallback((design: Design) => commit({ ...current, started: true, design, tab: "canvas" }), []);
  const patch = useCallback((p: Partial<Design>) => commit({ ...current, design: { ...current.design, ...p } }), []);
  const toggle = useCallback((id: BlockId) => commit({ ...current, design: toggleBlock(current.design, id) }), []);
  const add = useCallback((id: BlockId) => {
    if (!current.design.blocks.includes(id)) commit({ ...current, design: toggleBlock(current.design, id) });
  }, []);
  const topic = useCallback((t: Topic) => commit({ ...current, design: setTopic(current.design, t) }), []);
  const setTab = useCallback((tab: ComposeState["tab"]) => commit({ ...current, tab }), []);
  const reset = useCallback(() => commit(initial()), []);

  const actions = useMemo(() => ({ begin, patch, toggle, add, topic, setTab, reset }), [begin, patch, toggle, add, topic, setTab, reset]);
  return { state, hydrated, actions };
}
