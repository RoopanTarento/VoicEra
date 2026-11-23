import type { TryCatalogue } from "@/lib/api/try-agent";

/** What a visitor's description tells us, matched against the catalogue:
 * departments and schemes to preselect, and the language. Plain keyword
 * matching, so the same words always give the same answer. */
export interface DescriptionMatch {
  departments: string[];
  schemeIds: string[];
  language: string | null;
}

const DEPARTMENT_WORDS: Record<string, string[]> = {
  Farmers: ["farmer", "farm", "kisan", "crop", "agri", "fasal", "krishi", "cultivat", "harvest"],
  Health: ["health", "hospital", "treatment", "ayushman", "medical", "illness", "disease"],
  Housing: ["house", "housing", "home", "awas", "shelter", "pucca"],
  Women: ["women", "woman", "mother", "pregnan", "girl", "daughter", "lpg", "ujjwala", "cooking gas"],
  Workers: ["worker", "labour", "labor", "shram", "construction", "migrant", "unorganised", "unorganized"],
  Pension: ["pension", "elderly", "old age", "old-age", "senior citizen", "aged"],
  Insurance: ["insurance", "bima", "accident cover", "life cover"],
  Livelihood: ["livelihood", "vendor", "loan", "business", "artisan", "mudra", "svanidhi", "entrepreneur", "self-employ"],
};

const LANGUAGE_WORDS: Record<string, string[]> = {
  bn: ["bangla", "bengal"],
  od: ["oriya", "odisha", "orissa"],
};

function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ")} `;
}

export function matchDescription(text: string, catalogue: TryCatalogue): DescriptionMatch {
  const t = words(text);
  const has = (w: string) => t.includes(w.toLowerCase());

  const schemeIds = catalogue.schemes
    .filter((s) => {
      const name = s.name.toLowerCase();
      const id = s.id.toLowerCase();
      return has(name) || has(id) || has(id.replace(/-/g, " ")) || has(name.replace(/-/g, " "));
    })
    .map((s) => s.id);

  const departments = new Set<string>();
  for (const s of catalogue.schemes) if (schemeIds.includes(s.id)) departments.add(s.category);
  const known = new Set(catalogue.schemes.map((s) => s.category));
  for (const [dept, list] of Object.entries(DEPARTMENT_WORDS)) {
    if (known.has(dept) && list.some(has)) departments.add(dept);
  }

  const language =
    catalogue.languages.find(
      (l) => has(l.name) || t.includes(l.native) || (LANGUAGE_WORDS[l.code] ?? []).some(has),
    )?.code ?? null;

  return { departments: [...departments], schemeIds, language };
}
