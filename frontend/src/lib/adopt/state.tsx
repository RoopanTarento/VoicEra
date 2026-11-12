"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  ApplicationId,
  ApprovalEntry,
  IntegrationEntry,
  KnowledgeSourceEntry,
  PackageId,
  QuestionnaireAnswers,
  ScenarioResult,
  WorkspaceState,
} from "./types";
import { APPLICATION_BY_ID } from "./applications";
import { cleanConfig } from "./config-schema";
import { emptyWorkspace, seedApprovals, seedKnowledge } from "./readiness";
import { isAnswered, pruneAnswers, recommend, resolveApplication, visibleQuestions } from "./questionnaire";

/**
 * Shared state for the whole /adopt experience: the selection answers, the
 * workspace and everything done in it. It lives in this browser's localStorage
 * only. Nothing is sent anywhere, and clearing site data resets it.
 */

const KEY = "voicera.adopt.v1";

export interface AdoptState {
  answers: QuestionnaireAnswers;
  /** Index into the visible question list, so Back returns to the same place. */
  step: number;
  workspace: WorkspaceState;
  /** Sectors browsed before the selection starts, to keep context across pages. */
  browsedSegment?: string;
}

function initial(): AdoptState {
  return { answers: {}, step: 0, workspace: emptyWorkspace() };
}

const SERVER: AdoptState = initial();
let current: AdoptState = SERVER;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AdoptState;
      if (parsed && parsed.answers && parsed.workspace) {
        current = { ...initial(), ...parsed, workspace: { ...emptyWorkspace(), ...parsed.workspace } };
      }
    }
  } catch {
    current = initial();
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function commit(next: AdoptState) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The experience still works for this page load.
  }
  emit();
}

function subscribe(cb: () => void) {
  load();
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      loaded = false;
      load();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  load();
  return current;
}

const subscribeNoop = () => () => undefined;

export function useAdopt() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);

  const setAnswer = useCallback(<K extends keyof QuestionnaireAnswers>(key: K, value: QuestionnaireAnswers[K]) => {
    const answers = pruneAnswers({ ...current.answers, [key]: value });
    commit({ ...current, answers });
  }, []);

  const setStep = useCallback((step: number) => commit({ ...current, step }), []);

  /** Moves to the first question that has no answer yet, so Back and resume land sensibly. */
  const resumeAtFirstUnanswered = useCallback(() => {
    const qs = visibleQuestions(current.answers);
    const idx = qs.findIndex((q) => !isAnswered(q, current.answers));
    commit({ ...current, step: idx === -1 ? Math.max(0, qs.length - 1) : idx });
  }, []);

  const resetSelection = useCallback(() => {
    commit({ ...current, answers: {}, step: 0 });
  }, []);

  const browseSegment = useCallback((id: string | undefined) => {
    commit({ ...current, browsedSegment: id });
  }, []);

  /** Starts a workspace from a recommendation, or from an application picked directly. */
  const startWorkspace = useCallback((appId: ApplicationId, packageId: PackageId) => {
    const app = APPLICATION_BY_ID[appId];
    const a = current.answers;
    const config: Record<string, unknown> = JSON.parse(JSON.stringify(app.defaults));
    if (a.department) config.department = a.department.trim();
    if (a.languages && a.languages.length) config.languages = a.languages;
    const ws: WorkspaceState = {
      ...emptyWorkspace(),
      started: true,
      applicationId: appId,
      packageId,
      config,
      knowledge: seedKnowledge(app),
      approvals: seedApprovals(app, packageId),
      environment: a.environment && a.environment !== "undecided" ? a.environment : "",
    };
    commit({ ...current, workspace: ws });
  }, []);

  const startFromRecommendation = useCallback(() => {
    const rec = recommend(current.answers);
    if (!rec) return false;
    startWorkspace(rec.applicationId, rec.packageId);
    return true;
  }, [startWorkspace]);

  const patchWorkspace = useCallback((patch: Partial<WorkspaceState>) => {
    commit({ ...current, workspace: { ...current.workspace, ...patch } });
  }, []);

  const setConfig = useCallback((config: Record<string, unknown>) => {
    // Editing invalidates "saved" until the person saves again.
    commit({ ...current, workspace: { ...current.workspace, config, configSaved: false } });
  }, []);

  const saveConfig = useCallback(() => {
    const ws = current.workspace;
    if (!ws.applicationId) return;
    const app = APPLICATION_BY_ID[ws.applicationId];
    commit({ ...current, workspace: { ...ws, config: cleanConfig(app, ws.config), configSaved: true } });
  }, []);

  const setKnowledge = useCallback((knowledge: KnowledgeSourceEntry[]) => {
    commit({ ...current, workspace: { ...current.workspace, knowledge } });
  }, []);

  const setIntegration = useCallback((entry: IntegrationEntry) => {
    commit({
      ...current,
      workspace: { ...current.workspace, integrations: { ...current.workspace.integrations, [entry.id]: entry } },
    });
  }, []);

  const setResult = useCallback((result: ScenarioResult) => {
    commit({
      ...current,
      workspace: { ...current.workspace, results: { ...current.workspace.results, [result.scenarioId]: result } },
    });
  }, []);

  const setApprovals = useCallback((approvals: ApprovalEntry[]) => {
    commit({ ...current, workspace: { ...current.workspace, approvals } });
  }, []);

  const changePackage = useCallback((packageId: PackageId) => {
    const ws = current.workspace;
    if (!ws.applicationId) return;
    const app = APPLICATION_BY_ID[ws.applicationId];
    // Keep entries people already made; add approvals the new package needs.
    const existing = new Map(ws.approvals.map((a) => [a.id, a]));
    const approvals = seedApprovals(app, packageId).map((a) => existing.get(a.id) ?? a);
    commit({ ...current, workspace: { ...ws, packageId, approvals, deploy: { stage: "idle", log: [] } } });
  }, []);

  const resetWorkspace = useCallback(() => {
    commit({ ...current, workspace: emptyWorkspace() });
  }, []);

  const resetAll = useCallback(() => {
    commit(initial());
  }, []);

  const actions = useMemo(
    () => ({
      setAnswer,
      setStep,
      resumeAtFirstUnanswered,
      resetSelection,
      browseSegment,
      startWorkspace,
      startFromRecommendation,
      patchWorkspace,
      setConfig,
      saveConfig,
      setKnowledge,
      setIntegration,
      setResult,
      setApprovals,
      changePackage,
      resetWorkspace,
      resetAll,
    }),
    [
      setAnswer,
      setStep,
      resumeAtFirstUnanswered,
      resetSelection,
      browseSegment,
      startWorkspace,
      startFromRecommendation,
      patchWorkspace,
      setConfig,
      saveConfig,
      setKnowledge,
      setIntegration,
      setResult,
      setApprovals,
      changePackage,
      resetWorkspace,
      resetAll,
    ],
  );

  const workspaceApp = state.workspace.applicationId ? APPLICATION_BY_ID[state.workspace.applicationId] : undefined;
  const answeredApp = resolveApplication(state.answers);

  return { state, hydrated, actions, workspaceApp, answeredApp };
}
