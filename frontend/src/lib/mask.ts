/** Mask personal details a tester says on the demo call before they're shown
 * (same rules as the server's app/services/demo/privacy.py): runs of 7+ digits
 * in any script (phone, Aadhaar, account and card numbers), short codes after
 * "OTP"/"PIN", and email addresses. Amounts and dates are left alone. */

const MASK = "•";

function asciiDigit(ch: string): string {
  if (ch >= "0" && ch <= "9") return ch;
  // Unicode decimal digits sit in blocks of ten starting at a code point ending in 0 (e.g. Kannada ೦ = U+0CE6).
  if (/\p{Nd}/u.test(ch)) {
    const code = ch.codePointAt(0) ?? 0;
    for (let zero = code; zero > code - 10; zero--) {
      if (!/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) return String(code - zero);
    }
  }
  return ch;
}

export function maskPersonal(text: string): string {
  if (!text) return text;
  // One entry per UTF-16 unit, so regex indexes line up (Indic digits are single units).
  const chars = text.split("");
  const flat = chars.map(asciiDigit).join("");
  const flatChars = flat.split("");
  const hide = new Set<number>();
  const mark = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (/\d/.test(flatChars[i])) hide.add(i);
  };
  for (const m of flat.matchAll(/(?<!\d)\d(?:[ -]?\d){6,}(?!\d)/g)) mark(m.index ?? 0, (m.index ?? 0) + m[0].length);
  for (const m of flat.matchAll(/\b(?:otp|pin|password|cvv)\b\D{0,12}(\d(?:[ -]?\d){2,7})/gi)) {
    const start = (m.index ?? 0) + m[0].length - m[1].length;
    mark(start, start + m[1].length);
  }
  const masked = chars.map((c, i) => (hide.has(i) ? MASK : c)).join("");
  return masked.replace(/([\w.+-])[\w.+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, "$1***@$2");
}
