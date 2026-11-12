"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { setUnknown, setValue } from "./answers";
import { defaultCostInput, type CostInput, type ModelCategory } from "./cost";
import { applyInterpretation, type Interpretation } from "./interpret";
import { emptyPoc, type PocData } from "./poc";
import { emptyAnswers } from "./usecases";
import type { Answers } from "./types";

/**
 * Advisor state. Kept in this browser's localStorage under its own key, so it never touches the
 * existing /adopt state. Nothing is sent anywhere.
 */

const KEY = "voicera.adopt.advisor.v1";

export interface CostState {
  /** Set once the person edits the estimator, so we stop re-deriving it from answers. */
  touched: boolean;
  numbers: number | null;
  minutes: number | null;
  minutesIsAssumption: boolean;
  category: ModelCategory;
}

export interface AdvisorState {
  answers: Answers;
  startMode: "describe" | "cards" | "sector" | null;
  freeText: string;
  interpretation: Interpretation | null;
  stepIndex: number;
  cost: CostState;
  poc: PocData;
  pocStep: number;
  pocPlayed: Record<string, boolean>;
  request: { text: string; preparedAt: string } | null;
  /** Set when the questions have been worked through at least once, so the result page is meaningful. */
  reachedResult: boolean;
}

function initial(): AdvisorState {
  return {
    answers: emptyAnswers(),
    startMode: null,
    freeText: "",
    interpretation: null,
    stepIndex: 0,
    cost: { touched: false, numbers: null, minutes: null, minutesIsAssumption: false, category: "unknown" },
    poc: emptyPoc(),
    pocStep: 0,
    pocPlayed: {},
    request: null,
    reachedResult: false,
  };
}

const SERVER: AdvisorState = initial();
let current: AdvisorState = SERVER;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AdvisorState>;
      if (p && p.answers) current = { ...initial(), ...p, poc: { ...emptyPoc(), ...(p.poc ?? {}) } } as AdvisorState;
    }
  } catch {
    current = initial();
  }
}

function commit(next: AdvisorState) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The advisor still works for this page load.
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  load();
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      loaded = false;
      load();
      listeners.forEach((l) => l());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function snapshot() {
  load();
  return current;
}

const noop = () => () => undefined;

export function useAdvisor() {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const setAnswer = useCallback((id: string, value: unknown) => {
    commit({ ...current, answers: setValue(current.answers, id, value), reachedResult: false });
  }, []);
  const markUnknown = useCallback((id: string, on: boolean) => {
    commit({ ...current, answers: setUnknown(current.answers, id, on), reachedResult: false });
  }, []);
  const replaceAnswers = useCallback((answers: Answers) => commit({ ...current, answers }), []);
  const setStepIndex = useCallback((stepIndex: number) => commit({ ...current, stepIndex }), []);
  const setStart = useCallback((startMode: AdvisorState["startMode"]) => commit({ ...current, startMode }), []);
  const setFreeText = useCallback((freeText: string) => commit({ ...current, freeText }), []);
  const setInterpretation = useCallback((interpretation: Interpretation | null) => commit({ ...current, interpretation }), []);

  const acceptInterpretation = useCallback((i: Interpretation) => {
    commit({ ...current, interpretation: i, answers: applyInterpretation(current.answers, i), stepIndex: 0 });
  }, []);

  const chooseObjective = useCallback((objectiveId: string, sector?: string) => {
    let a = setValue(current.answers, "objective", objectiveId);
    if (sector) a = setValue(a, "sector", sector);
    commit({ ...current, answers: a, stepIndex: 0 });
  }, []);

  const setCost = useCallback((patch: Partial<CostState>) => {
    commit({ ...current, cost: { ...current.cost, ...patch, touched: true } });
  }, []);

  const setPoc = useCallback((patch: Partial<PocData>) => commit({ ...current, poc: { ...current.poc, ...patch } }), []);
  const replacePoc = useCallback((poc: PocData) => commit({ ...current, poc }), []);
  const setPocStep = useCallback((pocStep: number) => commit({ ...current, pocStep }), []);
  const markPlayed = useCallback((id: string) => commit({ ...current, pocPlayed: { ...current.pocPlayed, [id]: true } }), []);

  const prepareRequest = useCallback((text: string) => {
    commit({ ...current, request: { text, preparedAt: new Date().toISOString() } });
  }, []);
  const markResult = useCallback(() => commit({ ...current, reachedResult: true }), []);
  const resetAdvisor = useCallback(() => commit(initial()), []);

  const actions = useMemo(
    () => ({
      setAnswer, markUnknown, replaceAnswers, setStepIndex, setStart, setFreeText, setInterpretation,
      acceptInterpretation, chooseObjective, setCost, setPoc, replacePoc, setPocStep, markPlayed,
      prepareRequest, markResult, resetAdvisor,
    }),
    [setAnswer, markUnknown, replaceAnswers, setStepIndex, setStart, setFreeText, setInterpretation, acceptInterpretation, chooseObjective, setCost, setPoc, replacePoc, setPocStep, markPlayed, prepareRequest, markResult, resetAdvisor],
  );

  // The cost the page works from: the person's own entries once they edit, otherwise values taken from their answers.
  const costInput: CostInput = state.cost.touched
    ? { numbers: state.cost.numbers, minutes: state.cost.minutes, minutesIsAssumption: state.cost.minutesIsAssumption, category: state.cost.category }
    : defaultCostInput(state.answers);

  return { state, hydrated, actions, costInput };
}
