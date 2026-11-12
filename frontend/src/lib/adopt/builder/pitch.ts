import { LANGUAGES, LIMITS, PACKAGE_CARDS, PACKAGE_NAME, USE_CASE_BY_ID, type PackageKey } from "./catalog";
import { classify, type Selection } from "./canvas";
import { inr, rate, type Cost, type PriceBook } from "./pricing";
import { recommend, SEGMENT_NAME, type Profile, type Recommendation } from "./profile";

/**
 * The elevated pitch. It is built from the adopter's own answers, a little more of it with every answer,
 * so the adopter sees their own service take shape. It states facts from the documents and consequences of
 * the answers, and never a promise.
 */

export interface PitchSection {
  id: string;
  title: string;
  lines: string[];
  /** Short tags such as "Open item", shown beside the section. */
  flag?: "open";
}

export interface Pitch {
  headline: string;
  sub: string;
  sections: PitchSection[];
  /** 0 to 1: how much of the pitch the answers have filled in. */
  progress: number;
}

/** Short names for the headline, so a list reads cleanly. */
const SHORT: Record<string, string> = { scheme: "scheme discovery", helpline: "a citizen helpline", grievance: "grievances", survey: "surveys", forms: "form filling", status: "application status", alerts: "reminders", other: "your service" };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function buildPitch(p: Profile, pb: PriceBook, sel: Selection | null, cost: Cost | null, rec: Recommendation = recommend(p)): Pitch {
  const dept = p.department.trim() || (p.sector ? SEGMENT_NAME(p.sector) : "");
  const uses = p.useCases.map((u) => SHORT[u] ?? u);
  const langs = [...(p.languages ?? []), ...(p.otherLanguages ? [p.otherLanguages] : [])];

  const headline = uses.length
    ? `${dept ? `${dept}: ` : ""}${uses.length === 1 ? uses[0] : `${uses.slice(0, -1).join(", ")} and ${uses[uses.length - 1]}`}, by voice.`
    : dept ? `${dept}: citizens, talking to your service.` : "Anyone can now talk to intelligence.";
  const sub = langs.length ? `In ${list(langs)}, on a phone or in a browser, answering from content you approve.` : "VoicERA lets citizens talk to a government service in their own language, answering from content you approve.";

  const s: PitchSection[] = [];
  let filled = 0;
  const TOTAL = 7;

  if (p.sector || p.department) {
    filled++;
    s.push({ id: "who", title: "For", lines: [dept || "Your department"] });
  }

  if (p.useCases.length) {
    filled++;
    const first = p.useCases.slice(0, 2).flatMap((u) => USE_CASE_BY_ID[u].does.slice(0, 2));
    s.push({ id: "citizens", title: "What citizens will experience", lines: [...first.slice(0, 4), ...(p.useCases.length > 2 ? [`And ${p.useCases.length - 2} more use case${p.useCases.length - 2 === 1 ? "" : "s"} on the same platform.`] : [])] });
  }

  if (langs.length || p.scale) {
    filled++;
    const lines: string[] = [];
    if (langs.length) lines.push(`${list(langs)}. Callers can switch language mid-call.`);
    if (p.scale && p.scale !== "unsure") lines.push({ hundreds: "A few hundred calls a month.", thousands: "A few thousand calls a month.", tens: "Tens of thousands of calls a month.", lakhs: "Lakhs of calls a month." }[p.scale]);
    s.push({ id: "reach", title: "Who it reaches", lines });
  }

  if (p.useCases.length) {
    filled++;
    const lines = ["A citizen speaks. VoicERA listens, thinks using your approved content, and answers in their language."];
    if (rec.want !== "deploy" || p.systems === "api") lines.push("It then acts in your own system: " + (rec.want === "orchestrate" ? "routing, creating the case and following it to closure." : "reading status and sending structured data."));
    if (sel?.outbound) lines.push("It also calls citizens from your list, with permission you confirm.");
    s.push({ id: "how", title: "How it runs", lines });
  }

  if (p.useCases.length) {
    filled++;
    const lines = [`${PACKAGE_NAME[rec.want]} fits what you want to achieve.`, ...rec.reasons.slice(0, 2).map((r) => r.text)];
    if (rec.startAt !== rec.want) lines.push(`Fastest way to start: ${PACKAGE_NAME[rec.startAt]}, then move up.`);
    s.push({ id: "package", title: "Your package", lines });
  }

  if (p.timeline || p.content) {
    filled++;
    const key: PackageKey = sel ? classify(sel).key : rec.startAt;
    const launch = key === "custom" ? PACKAGE_CARDS[sel ? classify(sel).needs : rec.want].launch : PACKAGE_CARDS[key].launch;
    const lines = [`Typically ${launch.toLowerCase()} to go live. A range, not a commitment.`];
    if (p.content) lines.push({ ready: "Your content is ready, which is the most important thing you bring.", partly: "Your content is partly ready. Add the rest while we set up.", none: "You will need to prepare approved content before launch." }[p.content]);
    s.push({ id: "takes", title: "What it takes", lines });
  }

  if (cost) {
    filled++;
    const lines: string[] = [];
    lines.push(`${inr(cost.knownTotal)} known so far${cost.unresolved.length ? `, with ${cost.unresolved.length} item${cost.unresolved.length === 1 ? "" : "s"} not priced yet` : ""}.`);
    lines.push(`Usage is ${rate(pb.usageRate, pb.usageUnit)}, covering the platform, the phone line and open-source models.`);
    if (cost.budget.state === "short") lines.push(cost.budget.note);
    s.push({ id: "invest", title: "Investment", lines });
  }

  const open = !p.useCases.length ? [] : Array.from(new Set([...rec.unknowns, ...(p.sensitivity === "sensitive" || p.sensitivity === "personal" ? ["Where call data is stored and for how long"] : [])]));
  if (open.length) s.push({ id: "confirm", title: "Still to confirm", lines: open, flag: "open" });

  return { headline, sub, sections: s, progress: Math.min(1, filled / TOTAL) };
}

export function pitchToMarkdown(pitch: Pitch): string {
  const out = [`# ${pitch.headline}`, "", pitch.sub, ""];
  for (const sec of pitch.sections) {
    out.push(`## ${sec.title}`);
    for (const l of sec.lines) out.push(`- ${l}`);
    out.push("");
  }
  out.push("---", "A planning summary built from your answers. Not a quote, an order or an offer.");
  return out.join("\n");
}

export const DOCUMENTED = { languages: LANGUAGES.length, concurrent: LIMITS.concurrent };
