"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Conversation log for the Studio. Answers themselves live in the advisor store. */

const KEY = "voicera.studio.v1";

export type LogItem =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "agent"; text: string }
  | { id: number; kind: "read"; understood: { label: string; value: string; because: string }[]; missing: string[] }
  | { id: number; kind: "q"; qid: string }
  | { id: number; kind: "a"; qid: string; label: string }
  | { id: number; kind: "react"; text: string };

export type NewLogItem = LogItem extends infer T ? (T extends { id: number } ? Omit<T, "id"> : never) : never;

export interface StudioState {
  started: boolean;
  log: LogItem[];
  deepen: boolean;
  nextId: number;
  tab: "blueprint" | "hear" | "handover";
}

function initial(): StudioState {
  return { started: false, log: [], deepen: false, nextId: 1, tab: "blueprint" };
}

const SERVER = initial();
let current: StudioState = SERVER;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) current = { ...initial(), ...(JSON.parse(raw) as Partial<StudioState>) };
  } catch {
    current = initial();
  }
}

function commit(next: StudioState) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The studio still works for this page load.
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

export function useStudio() {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const push = useCallback((...items: NewLogItem[]) => {
    let id = current.nextId;
    const log = [...current.log, ...items.map((it) => ({ ...it, id: id++ }) as LogItem)];
    commit({ ...current, log, nextId: id });
  }, []);
  const start = useCallback(() => commit({ ...current, started: true }), []);
  const setTab = useCallback((tab: StudioState["tab"]) => commit({ ...current, tab }), []);
  const setDeepen = useCallback((deepen: boolean) => commit({ ...current, deepen }), []);
  const reset = useCallback(() => commit(initial()), []);

  const actions = useMemo(() => ({ push, start, setTab, setDeepen, reset }), [push, start, setTab, setDeepen, reset]);
  return { state, hydrated, actions };
}
