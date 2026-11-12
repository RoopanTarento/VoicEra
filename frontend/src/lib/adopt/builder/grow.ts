import { CAPABILITY_BY_ID, DEPTHS, PACKAGE_CARDS, depthRank, type Depth } from "./catalog";
import { capsOf, classify, moveToPackage, type Selection } from "./canvas";
import { costFor, round2, type Cost, type PriceBook } from "./pricing";

/**
 * The upgrade path: what moving up one package would add, ask of you, and do to the price.
 * Because the three packages are one platform at different depths, the content, languages, models and
 * telephony you chose carry over. Only the connection into your systems grows.
 */

export interface GrowStep {
  from: Depth;
  to: Depth;
  gains: string[];
  capsAdded: string[];
  bring: string[];
  launch: string;
  now: Cost;
  then: Cost;
  /** Change in the known total. Positive means it costs more. */
  deltaKnown: number;
  /** Items that become unpriced at this step. */
  newUnpriced: string[];
}

export const CARRIES_OVER = [
  "Your approved content and knowledge base",
  "Your languages and voice choices",
  "Your phone numbers and telephony",
  "Your dashboard and what you have learned from it",
  "The agent's conversation, which you extend rather than rebuild",
];

export function currentDepth(sel: Selection): Depth {
  const c = classify(sel);
  return c.key === "custom" ? (c.base ?? c.needs) : c.key;
}

export function growPath(sel: Selection, pb: PriceBook): GrowStep[] {
  const cls = classify(sel);
  const base = cls.key === "custom" ? (cls.base ?? "deploy") : cls.key;
  const now = costFor(sel, pb);
  return DEPTHS.filter((d) => depthRank(d) > depthRank(base)).map((to) => {
    const moved = moveToPackage(sel, to);
    const then = costFor(moved, pb);
    const before = capsOf(sel);
    const added = capsOf(moved).filter((c) => !before.includes(c));
    const nowIds = new Set(now.unresolved.map((u) => u.id));
    return {
      from: base,
      to,
      gains: PACKAGE_CARDS[to].gains,
      capsAdded: added.map((c) => CAPABILITY_BY_ID[c].label),
      bring: PACKAGE_CARDS[to].extraBring,
      launch: PACKAGE_CARDS[to].launch,
      now,
      then,
      deltaKnown: round2(then.knownTotal - now.knownTotal),
      newUnpriced: then.unresolved.filter((u) => !nowIds.has(u.id)).map((u) => u.label),
    };
  });
}
