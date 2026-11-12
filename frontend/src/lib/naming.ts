/** The same name rules the API enforces (apps/api/app/services/naming.py), so
 * people see what's wrong while typing instead of after pressing Create. */

export const NAME_MIN = 3;
export const NAME_MAX = 80;
export const NAME_CHARACTERS = "letters, numbers, spaces and - – _ . , & ( ) / : ' # +";

const ALLOWED_PUNCTUATION = " -–—_.,&()/:'#+";
const COPY_SUFFIX = /\s*\(copy(?: (\d+))?\)$/i;

function allowed(ch: string): boolean {
  return ALLOWED_PUNCTUATION.includes(ch) || /[\p{L}\p{M}\p{Nd}]/u.test(ch);
}

/** Trimmed, single-spaced form of a name. */
export function tidyName(value: string): string {
  return value.normalize("NFC").split(/\s+/).filter(Boolean).join(" ");
}

/** What's wrong with a name ("" when it's fine). `taken` = other names, any case. */
export function nameProblem(value: string, taken: string[] = [], what = "campaign"): string {
  const name = tidyName(value);
  if (!name) return "";
  if (name.length < NAME_MIN) return `Use at least ${NAME_MIN} characters.`;
  if (name.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters.`;
  const bad = [...new Set([...name].filter((ch) => !allowed(ch)))];
  if (bad.length) return `Remove ${bad.slice(0, 5).join(" ")}. Use ${NAME_CHARACTERS}.`;
  const lower = name.toLocaleLowerCase();
  if (taken.some((t) => t.toLocaleLowerCase() === lower)) return `A ${what} with this name already exists.`;
  return "";
}

/** "X (copy)", then "X (copy 2)" … — matches the API's duplicate naming. */
export function copyName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLocaleLowerCase()));
  const base = name.replace(COPY_SUFFIX, "").trim() || name;
  const fit = (suffix: string) => base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
  let candidate = fit(" (copy)");
  for (let n = 2; lower.has(candidate.toLocaleLowerCase()); n += 1) candidate = fit(` (copy ${n})`);
  return candidate;
}

/** The free name the API suggests in a "already exists" error, if any. */
export function suggestedName(message: string): string | null {
  const match = /Try "(.+)"\.$/.exec(message);
  return match ? match[1] : null;
}

/** `voicera_<subject>_<kind>_<YYYY-MM-DD>.<ext>` for files the dashboard saves. */
export function downloadName(subject: string, kind: string, ext: string, on = new Date()): string {
  const slug = (v: string, max: number) =>
    v
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "");
  const day = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, "0")}-${String(on.getDate()).padStart(2, "0")}`;
  return `voicera_${slug(subject, 50) || "export"}_${slug(kind, 30)}_${day}.${ext}`;
}
