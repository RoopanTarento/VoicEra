/** Password hashing and token helpers. Real SHA-256 with a random salt; this is a prototype store, not a production one. */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b as ArrayBuffer), (x) => x.toString(16).padStart(2, "0")).join("");

export function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return hex(a);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  return hex(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${password}`)));
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s: string) => EMAIL_RE.test(s.trim());

export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; hints: string[] }
export function passwordStrength(pw: string): Strength {
  const hints: string[] = [];
  if (pw.length < 10) hints.push("Use at least 10 characters");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) hints.push("Mix upper and lower case");
  if (!/\d/.test(pw)) hints.push("Add a number");
  if (!/[^A-Za-z0-9]/.test(pw)) hints.push("Add a symbol");
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) score = Math.min(score, 1) as number;
  if (/^(password|12345678|qwerty)/i.test(pw)) score = 0;
  const labels = ["Too weak", "Weak", "Fair", "Good", "Strong"];
  return { score: score as Strength["score"], label: pw ? labels[score] : "", hints };
}
export const passwordOk = (pw: string) => pw.length >= 10 && passwordStrength(pw).score >= 3;
