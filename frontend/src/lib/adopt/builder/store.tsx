"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Depth, LayerId } from "./catalog";
import { moveToPackage, type Selection, type Workload } from "./canvas";
import { DEFAULT_PRICES, type PriceBook } from "./pricing";
import {
  QUESTION_BY_ID, applyAnswer, emptyProfile, nextQuestion, parseAmount, reactTo, recommend, reopen, selectionFor,
  type AnswerValue, type Choice, type Profile, type QId,
} from "./profile";
import { KB_BY_ID, answerFor, matchQuestion } from "./kb";

/** The builder's state, kept in this browser only. Nothing is sent anywhere. */

export type Stage = "discover" | "package" | "canvas" | "cost" | "deploy" | "pitch";
export type CostTab = "cost" | "quote" | "grow";

export interface LogItem {
  id: string;
  who: "agent" | "user";
  kind: "text" | "question" | "note" | "kb" | "open";
  text: string;
  qid?: QId;
  paragraphs?: string[];
  src?: string;
  follow?: string[];
}

export interface BuilderState {
  stage: Stage;
  profile: Profile;
  log: LogItem[];
  sel: Selection | null;
  /** The package the adopter started the canvas from, or null for a custom start. */
  base: Depth | null;
  costTab: CostTab;
  bring: Record<string, "yes" | "no" | "unsure">;
  checks: Record<string, boolean>;
  signed: boolean;
  handed: boolean;
}

const KEY = "voicera.builder.v1";
const PRICE_KEY = "voicera.builder.prices.v1";

const initial = (): BuilderState => ({ stage: "discover", profile: emptyProfile(), log: [], sel: null, base: null, costTab: "cost", bring: {}, checks: {}, signed: false, handed: false });
const SERVER = initial();
let current = SERVER;
let loaded = false;
const listeners = new Set<() => void>();

let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<BuilderState>;
      const b = initial();
      current = { ...b, ...p, profile: { ...b.profile, ...(p.profile ?? {}) } };
    }
  } catch {
    current = initial();
  }
  if (current.log.length === 0) current = { ...current, log: opening(current.profile) };
}

function opening(p: Profile): LogItem[] {
  const q = nextQuestion(p);
  return q ? [{ id: uid(), who: "agent", kind: "question", qid: q.id, text: q.prompt(p) }] : [];
}

function commit(next: BuilderState) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The builder still works for this page load.
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

/* ------------------------------------------------------------------ free text */

const QUESTIONISH = /^(what|which|why|how|can|could|does|do|is|are|will|would|who|where|when|should|tell|explain)\b/i;
const looksLikeQuestion = (t: string) => t.includes("?") || QUESTIONISH.test(t.trim());

function words(t: string) {
  return ` ${t.toLowerCase().replace(/[^a-z0-9+\-]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function pickChoices(choices: Choice[], text: string): string[] {
  const t = words(text);
  const hits: { id: string; n: number }[] = [];
  for (const c of choices) {
    let n = 0;
    for (const k of c.keys ?? []) if (t.includes(` ${k.toLowerCase().replace(/[^a-z0-9+\- ]+/g, "")}`)) n++;
    if (t.includes(words(c.label).trimEnd())) n += 2;
    if (n > 0) hits.push({ id: c.id, n });
  }
  return hits.sort((a, b) => b.n - a.n).map((h) => h.id);
}

/* ------------------------------------------------------------------ the hook */

export function useBuilder() {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const patch = useCallback((p: Partial<BuilderState>) => commit({ ...current, ...p }), []);
  const goto = useCallback((stage: Stage) => commit({ ...current, stage }), []);

  /** Answer the question being asked: update the profile, say what that means, ask the next. */
  const answer = useCallback((qid: QId, value: AnswerValue, extra?: { text?: string }) => {
    const before = current.profile;
    const after = applyAnswer(before, qid, value, extra);
    const q = QUESTION_BY_ID[qid];
    const log = [...current.log, { id: uid(), who: "user", kind: "text", qid, text: q.summary(after) } as LogItem];
    for (const line of reactTo(after, qid)) log.push({ id: uid(), who: "agent", kind: "note", text: line });
    const nq = nextQuestion(after);
    if (nq) log.push({ id: uid(), who: "agent", kind: "question", qid: nq.id, text: nq.prompt(after) });
    // The canvas, if already open, keeps the adopter's own changes. Only an unopened canvas follows the answers.
    commit({ ...current, profile: after, log });
  }, []);

  /** Change an earlier answer. */
  const edit = useCallback((qid: QId) => {
    const p = reopen(current.profile, qid);
    const q = QUESTION_BY_ID[qid];
    commit({ ...current, stage: "discover", profile: p, log: [...current.log, { id: uid(), who: "agent", kind: "question", qid, text: `Of course. ${q.prompt(p)}` }] });
  }, []);

  /** Anything the adopter types: an answer, one of their own questions, or something the documents do not cover. */
  const ask = useCallback((raw: string) => {
    const text = raw.trim().slice(0, 400);
    if (!text) return;
    const st = current;
    const q = nextQuestion(st.profile);
    const userItem: LogItem = { id: uid(), who: "user", kind: "text", text };
    const ctx = { pb: readPrices(), profile: st.profile };

    const kbReply = (): LogItem[] | null => {
      const m = matchQuestion(text);
      if (!m) return null;
      const a = answerFor(m.entry, ctx);
      return [{ id: uid(), who: "agent", kind: "kb", text: m.entry.q, paragraphs: a.paragraphs, src: a.src, follow: a.follow.map((f) => f.id) }];
    };
    const openReply = (): { log: LogItem[]; profile: Profile } => {
      const profile = st.profile.openQuestions.includes(text) ? st.profile : { ...st.profile, openQuestions: [...st.profile.openQuestions, text] };
      return {
        profile,
        log: [{ id: uid(), who: "agent", kind: "open", text: "I do not have that in the documents I work from, so I will not guess. I have added it to the list of questions for your VoicERA contact, and it will be in your hand-over pack." }],
      };
    };

    // 1. Questions go to the documents first.
    if (looksLikeQuestion(text) || !q) {
      const kb = kbReply();
      if (kb) return commit({ ...st, log: [...st.log, userItem, ...kb] });
      if (looksLikeQuestion(text) || !q) {
        const o = openReply();
        return commit({ ...st, profile: o.profile, log: [...st.log, userItem, ...o.log] });
      }
    }

    // 2. Otherwise try to read it as an answer to the question in hand.
    if (q) {
      if (q.kind === "number") {
        const n = parseAmount(text);
        if (n !== null && n > 0) return answer(q.id, n);
      } else if (q.kind === "single" || q.kind === "multi") {
        const hits = pickChoices(q.choices!(st.profile), text);
        if (hits.length) return answer(q.id, q.kind === "multi" ? hits : hits[0]);
        if (q.id === "who") return answer("who", "other", { text });
        if (q.id === "lang") return answer("lang", [...(st.profile.languages ?? []), text]);
      }
      const kb = kbReply();
      if (kb) return commit({ ...st, log: [...st.log, userItem, ...kb] });
      return commit({ ...st, log: [...st.log, userItem, { id: uid(), who: "agent", kind: "note", text: "I did not quite catch that. You can pick one of the options below, or type a question and I will answer from the documents." }] });
    }
  }, [answer]);

  /** Start the canvas from a package, or from the recommended one. */
  const choosePackage = useCallback((depth: Depth | null) => {
    const rec = recommend(current.profile);
    const d = depth ?? rec.startAt;
    const sel = selectionFor(current.profile, d);
    commit({ ...current, sel, base: depth, stage: "canvas", signed: false, handed: false, costTab: "cost" });
  }, []);

  const setSel = useCallback((fn: (s: Selection) => Selection) => {
    if (!current.sel) return;
    commit({ ...current, sel: fn(current.sel), signed: false });
  }, []);

  const setLayer = useCallback((layer: LayerId, optionId: string) => {
    setSel((s) => {
      const key = ({ channel: "channel", listen: "listen", think: "think", speak: "speak", know: "know", act: "act", handoff: "handoff", host: "host" } as Partial<Record<LayerId, keyof Selection>>)[layer];
      if (!key) return s;
      const next = { ...s, [key]: optionId } as Selection;
      if (layer === "channel") next.numbers = optionId === "ch-browser" ? 0 : Math.max(s.numbers, s.inbound ? 1 : 0);
      return next;
    });
  }, [setSel]);

  const toggleLanguage = useCallback((l: string) => setSel((s) => ({ ...s, languages: s.languages.includes(l) ? s.languages.filter((x) => x !== l) : [...s.languages, l] })), [setSel]);
  const patchSel = useCallback((p: Partial<Selection>) => setSel((s) => ({ ...s, ...p })), [setSel]);
  const setWorkload = useCallback((w: Partial<Workload>) => setSel((s) => ({ ...s, workload: { ...s.workload, ...w } })), [setSel]);
  const setOwnFigure = useCallback((layer: LayerId, v: number | null) => setSel((s) => ({ ...s, ownFigures: { ...s.ownFigures, [layer]: v } })), [setSel]);
  const setFigure = useCallback((id: string, v: number | null) => setSel((s) => ({ ...s, figures: { ...s.figures, [id]: v } })), [setSel]);
  const moveTo = useCallback((d: Depth) => {
    if (!current.sel) return;
    commit({ ...current, sel: moveToPackage(current.sel, d), base: d, signed: false });
  }, []);
  const resetCanvas = useCallback(() => {
    const rec = recommend(current.profile);
    commit({ ...current, sel: selectionFor(current.profile, current.base ?? rec.startAt), signed: false });
  }, []);

  const setBring = useCallback((id: string, v: "yes" | "no" | "unsure") => commit({ ...current, bring: { ...current.bring, [id]: v } }), []);
  const tick = useCallback((id: string, on: boolean) => commit({ ...current, checks: { ...current.checks, [id]: on } }), []);
  const reset = useCallback(() => {
    const fresh = initial();
    commit({ ...fresh, log: opening(fresh.profile) });
  }, []);

  const actions = useMemo(
    () => ({ patch, goto, answer, edit, ask, choosePackage, setLayer, toggleLanguage, patchSel, setWorkload, setOwnFigure, setFigure, moveTo, resetCanvas, setBring, tick, reset }),
    [patch, goto, answer, edit, ask, choosePackage, setLayer, toggleLanguage, patchSel, setWorkload, setOwnFigure, setFigure, moveTo, resetCanvas, setBring, tick, reset],
  );
  return { state, hydrated, actions };
}

export { KB_BY_ID };

/* ------------------------------------------------------------------ the provider's price book */

let prices: PriceBook = DEFAULT_PRICES;
let pricesLoaded = false;
const priceListeners = new Set<() => void>();

function loadPrices() {
  if (pricesLoaded || typeof window === "undefined") return;
  pricesLoaded = true;
  try {
    const raw = window.localStorage.getItem(PRICE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PriceBook>;
      prices = { ...DEFAULT_PRICES, ...p, setup: { ...DEFAULT_PRICES.setup, ...(p.setup ?? {}) }, modelExtra: { ...(p.modelExtra ?? {}) }, hostExtra: { ...(p.hostExtra ?? {}) } };
    }
  } catch {
    prices = DEFAULT_PRICES;
  }
}

export function readPrices(): PriceBook {
  loadPrices();
  return prices;
}

function commitPrices(next: PriceBook) {
  prices = next;
  try {
    window.localStorage.setItem(PRICE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked. The prices still apply for this page load.
  }
  priceListeners.forEach((l) => l());
}

export function usePrices() {
  const pb = useSyncExternalStore(
    (cb) => {
      loadPrices();
      priceListeners.add(cb);
      return () => {
        priceListeners.delete(cb);
      };
    },
    () => {
      loadPrices();
      return prices;
    },
    () => DEFAULT_PRICES,
  );
  const set = useCallback((fn: (p: PriceBook) => PriceBook) => commitPrices(fn(prices)), []);
  const restore = useCallback(() => commitPrices(DEFAULT_PRICES), []);
  return { pb, set, restore };
}
