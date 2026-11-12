"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  addCustom, applyTemplate, newCanvas, removeCustom, setReady, toggleModule,
  type Canvas, type LaneId, type ModelKind, type TemplateId,
} from "./canvas";
import type { Readiness } from "./compose";
import { canvasFromProfile, emptyProfile, type Profile } from "./pitch";

/** The Canvas builder's own state. Kept in this browser only, under its own key. Nothing is sent anywhere. */

const KEY = "voicera.canvas.v1";

/** pitch, about and plan come before the builder. canvas, cost and launch are the builder. */
export type Step = "pitch" | "about" | "plan" | "canvas" | "cost" | "launch";

export interface CanvasState {
  started: boolean;
  step: Step;
  canvas: Canvas;
  verify: Record<string, boolean>;
  signedOff: boolean;
  handedOver: boolean;
  target: "managed" | "own";
  /** The answers to the opening questions, kept until the plan is turned into a canvas. */
  profile: Profile;
}

const initial = (): CanvasState => ({ started: false, step: "pitch", canvas: newCanvas(), verify: {}, signedOff: false, handedOver: false, target: "managed", profile: emptyProfile() });
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
      const p = JSON.parse(raw) as Partial<CanvasState>;
      const base = initial();
      // Earlier versions had separate verify and deploy steps. They are one step now.
      const rawStep = p.step as string | undefined;
      const step = (rawStep === "verify" || rawStep === "deploy" ? "launch" : rawStep === "start" ? "pitch" : rawStep) as Step | undefined;
      current = {
        ...base,
        ...p,
        step: step ?? base.step,
        profile: { ...base.profile, ...(p.profile ?? {}) },
        canvas: { ...base.canvas, ...(p.canvas ?? {}), ready: { ...base.canvas.ready, ...(p.canvas?.ready ?? {}) }, kb: { ...base.canvas.kb, ...(p.canvas?.kb ?? {}) } },
      };
    }
  } catch {
    current = initial();
  }
}

function commit(next: CanvasState) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The canvas still works for this page load.
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

export function useCanvas() {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const set = useCallback((patch: Partial<CanvasState>) => commit({ ...current, ...patch }), []);
  const patch = useCallback((p: Partial<Canvas>) => commit({ ...current, canvas: { ...current.canvas, ...p } }), []);
  const profile = useCallback((p: Partial<Profile>) => commit({ ...current, profile: { ...current.profile, ...p } }), []);
  /** Turn the plan into a canvas and open the builder. */
  const build = useCallback(() => commit({ ...initial(), started: true, step: "canvas", profile: current.profile, canvas: canvasFromProfile(current.profile) }), []);
  const template = useCallback((id: TemplateId) => commit({ ...current, canvas: applyTemplate(current.canvas, id), verify: {}, signedOff: false, handedOver: false }), []);
  const toggle = useCallback((id: string) => commit({ ...current, canvas: toggleModule(current.canvas, id), signedOff: false }), []);
  const add = useCallback((id: string) => {
    if (!current.canvas.modules.includes(id)) commit({ ...current, canvas: toggleModule(current.canvas, id), signedOff: false });
  }, []);
  const addCust = useCallback((lane: LaneId, label: string, note: string) => commit({ ...current, canvas: addCustom(current.canvas, lane, label, note), signedOff: false }), []);
  const removeCust = useCallback((id: string) => commit({ ...current, canvas: removeCustom(current.canvas, id), signedOff: false }), []);
  const model = useCallback((which: "voiceModel" | "llmModel", v: ModelKind) => commit({ ...current, canvas: { ...current.canvas, [which]: v }, signedOff: false }), []);
  const models = useCallback((v: ModelKind) => commit({ ...current, canvas: { ...current.canvas, voiceModel: v, llmModel: v }, signedOff: false }), []);
  const figure = useCallback((id: string, v: number | null) => commit({ ...current, canvas: { ...current.canvas, figures: { ...current.canvas.figures, [id]: v } } }), []);
  const ready = useCallback((id: keyof Canvas["ready"], v: Readiness) => commit({ ...current, canvas: setReady(current.canvas, id, v) }), []);
  const tick = useCallback((id: string, on: boolean) => commit({ ...current, verify: { ...current.verify, [id]: on } }), []);
  const reset = useCallback(() => commit(initial()), []);

  const actions = useMemo(
    () => ({ set, patch, profile, build, template, toggle, add, addCust, removeCust, model, models, figure, ready, tick, reset }),
    [set, patch, profile, build, template, toggle, add, addCust, removeCust, model, models, figure, ready, tick, reset],
  );
  return { state, hydrated, actions };
}
