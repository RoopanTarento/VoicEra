import { ASRS, PACKAGES, TTSS, LANGUAGES, type Language } from "./catalog";
import { langFit } from "./recommend";

/** What the catalogue knows about one language: how many speech and voice models are tested, and whether a whole package is. */
export interface LanguageInfo extends Language {
  asr: { tested: number; partial: number; of: number };
  tts: { tested: number; partial: number; of: number };
  dialects: boolean;
  codeSwitch: boolean;
  benchmarked: number;
  status: "tested" | "partial" | "none";
}

const count = <T extends { langs: Record<string, "tested" | "partial" | "none"> }>(list: T[], id: string) => ({
  tested: list.filter((x) => x.langs[id] === "tested").length,
  partial: list.filter((x) => x.langs[id] === "partial").length,
  of: list.length,
});

export function languageInfo(id: string): LanguageInfo | null {
  const l = LANGUAGES.find((x) => x.id === id);
  if (!l) return null;
  const levels = PACKAGES.map((p) => langFit(p, p.selection, id).level);
  return {
    ...l,
    asr: count(ASRS, id),
    tts: count(TTSS, id),
    dialects: ASRS.some((a) => a.langs[id] === "tested" && a.dialectsTested),
    codeSwitch: ASRS.some((a) => a.langs[id] && a.langs[id] !== "none" && a.codeSwitch),
    benchmarked: PACKAGES.filter((p) => p.benchmarkLangs.includes(id)).length,
    status: levels.includes("tested") ? "tested" : levels.includes("partial") ? "partial" : "none",
  };
}

export const ALL_LANGUAGE_INFO = LANGUAGES.map((l) => languageInfo(l.id) as LanguageInfo);
