import { APPLICATION_BY_ID } from "../applications";
import { PACKAGE_BY_ID } from "../icp";
import {
  LAYER_BY_ID, LIMITS, OPTION_BY_ID, PACKAGE_CARDS, PACKAGE_NAME, USE_CASE_BY_ID, reasonFor,
  type Depth, type LayerId, type UseCaseId,
} from "./catalog";
import { capsOf, classify, type Selection } from "./canvas";
import { CAPABILITY_BY_ID } from "./catalog";
import { WHO_LABEL, bringList, stagesFor, type Who } from "./deploy";
import { growPath } from "./grow";
import { buildPitch } from "./pitch";
import { inr, rate, type PriceBook } from "./pricing";
import { buildQuote } from "./quote";
import { recommend, type Profile } from "./profile";
import { STILL_OPEN } from "./catalog";

/**
 * The elevated pitch, end to end: a deck a VoicERA person can deliver to a department.
 * It is built entirely from the adopter's own answers and canvas, so no two decks are the same.
 * It states facts from the documents and consequences of the choices, and never a promise or a statistic
 * that the documents do not give. Each slide carries presenter notes: how to give it.
 */

export type Block =
  | { type: "lead"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "facts"; items: { k: string; v: string; sub?: string }[] }
  | { type: "pillars"; items: { title: string; text: string }[] }
  | { type: "chat"; title: string; context: string; turns: { who: "agent" | "citizen" | "note"; text: string }[] }
  | { type: "pipeline"; nodes: { id: string; name: string; tech: string; choice: string; chip: string }[] }
  | { type: "reasons"; items: { layer: string; choice: string; why: string; caution?: string }[] }
  | { type: "package"; label: string; want: Depth; startAt: Depth; path: Depth[]; capabilities: string[]; reasons: string[] }
  | { type: "money"; total: string; complete: boolean; budget: string | null; rows: { k: string; v: string; note?: string }[]; open: string[]; scenarios: { calls: string; total: string; planned: boolean }[]; perCall: string | null }
  | { type: "ladder"; steps: { to: string; gains: string[]; price: string; launch: string }[]; here: string }
  | { type: "stages"; items: { n: number; title: string; who: Who; whoLabel: string; timing: string; documented: boolean }[] }
  | { type: "two"; left: { title: string; items: string[] }; right: { title: string; items: string[] } }
  | { type: "close"; text: string; actions: string[] };

export interface Slide {
  id: string;
  kicker: string;
  title: string;
  blocks: Block[];
  /** How to give this slide. Shown to the presenter, never to the audience. */
  notes: string[];
}

export interface Deck {
  title: string;
  date: string;
  slides: Slide[];
}

const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));
const layerChoice = (s: Selection, l: LayerId): string => ({ channel: s.channel, listen: s.listen, think: s.think, speak: s.speak, know: s.know, act: s.act, handoff: s.handoff, watch: "w-dash", host: s.host } as Record<LayerId, string>)[l];

export function buildDeck(p: Profile, pb: PriceBook, sel: Selection, now: Date = new Date()): Deck {
  const rec = recommend(p);
  const cls = classify(sel);
  const quote = buildQuote(sel, pb, now);
  const pitch = buildPitch(p, pb, sel, null, rec);
  const useCases: UseCaseId[] = p.useCases.length ? p.useCases : ["other"];
  const dept = p.department.trim();
  const pkgLabel = cls.key === "custom" ? cls.label : PACKAGE_NAME[cls.key];
  const slides: Slide[] = [];

  /* 1. cover */
  slides.push({
    id: "cover", kicker: "A proposal from VoicERA", title: pitch.headline,
    blocks: [
      { type: "lead", text: pitch.sub },
      { type: "facts", items: [{ k: "Prepared for", v: dept || "Your department" }, { k: "Package", v: pkgLabel }, { k: "Prepared", v: quote.date }] },
    ],
    notes: ["Open by reading the headline back in the department's own words: it is their service, not ours.", "Say what this session will do: show what the service sounds like, how it works, what it costs, and how it goes live. Promise nothing beyond that.", "Everything on these pages came from the answers given earlier, so it can be changed."],
  });

  /* 2. the need */
  const problems = uniq(useCases.map((u) => PACKAGE_BY_ID[USE_CASE_BY_ID[u].depth].problem));
  slides.push({
    id: "need", kicker: "The need", title: "The problems this is built to solve.",
    blocks: [
      { type: "bullets", items: problems },
      { type: "lead", text: "These are the patterns the VoicERA ICP describes for departments like yours. Tell us which of them you recognise." },
    ],
    notes: ["Read the problems aloud, then stop and ask which of them the department lives with. Their answer is the real opening of the conversation.", "Do not add numbers or percentages. The documents do not give any, and an invented figure will be remembered."],
  });

  /* 3. what VoicERA is */
  slides.push({
    id: "what", kicker: "What VoicERA is", title: "Open, sovereign, and built on what you already run.",
    blocks: [{
      type: "pillars",
      items: [
        { title: "Open and sovereign", text: "The conversational layer for government. You can switch models, telephony providers and infrastructure without being locked in." },
        { title: "One platform, many workflows", text: "Grievances, scheme discovery, surveys, forms and application support run on the same platform. Start with one and add more." },
        { title: "Works with your systems", text: "It does not replace the systems you use. It turns them into something citizens can talk to, connected step by step: Deploy, Connect, Orchestrate." },
      ],
    }],
    notes: ["This is the one slide about us. Keep it short.", "If asked about being a digital public good, say it is not stated in the documents we hold, and that you will confirm. Do not claim it."],
  });

  /* 4. what it sounds like */
  const withApp = useCases.map((u) => USE_CASE_BY_ID[u].app).find((a) => a && APPLICATION_BY_ID[a]);
  if (withApp) {
    const ex = APPLICATION_BY_ID[withApp].example;
    slides.push({
      id: "sounds", kicker: "What citizens will hear", title: "What it sounds like.",
      blocks: [
        { type: "chat", title: ex.title, context: ex.context, turns: ex.turns.slice(0, 7).map((t) => ({ who: t.who, text: t.text })) },
        { type: "lead", text: "An illustrative conversation with made-up details. A real service answers only from the content your department approves." },
      ],
      notes: ["Read the exchange aloud, taking both parts. Let the room hear the citizen's side.", "Point out the moment the agent says it does not know, or hands over. That is the safe behaviour, and it is designed in.", "State clearly that this is a scripted example. The Hear it step in the experience lets them try their own."],
    });
  }

  /* 5. how a call flows */
  const nodeFor = (l: LayerId) => {
    const o = OPTION_BY_ID[layerChoice(sel, l)];
    return { id: l, name: LAYER_BY_ID[l].name, tech: LAYER_BY_ID[l].tech, choice: o?.name ?? "Not chosen", chip: o ? chipText(o.tier, o.id, pb) : "" };
  };
  slides.push({
    id: "flow", kicker: "How it works", title: "How a call flows.",
    blocks: [
      { type: "lead", text: "A citizen speaks. VoicERA listens, thinks using your approved content, and answers in their language. Every step is a choice you control." },
      { type: "pipeline", nodes: (["channel", "listen", "think", "speak", "know", "act", "handoff", "watch", "host"] as LayerId[]).map(nodeFor) },
    ],
    notes: ["Walk the steps in order and say what each does in one sentence. Use the plain names first and the technical terms only if someone asks.", "The pricing chips show what each choice does to cost. Point at one commercial option and one open-source option so the difference is concrete."],
  });

  /* 6. why these choices */
  const reasoned = (["channel", "listen", "think", "speak", "know", "act", "handoff"] as LayerId[]).map((l) => {
    const o = OPTION_BY_ID[layerChoice(sel, l)];
    const why = reasonFor(o, useCases);
    return { layer: LAYER_BY_ID[l].name, choice: o.name, why: why.text, caution: o.tier === "proprietary" || o.tier === "confirm" || o.tier === "own" ? o.check : undefined };
  });
  slides.push({
    id: "why", kicker: "Why this configuration", title: "Why we set it up this way.",
    blocks: [
      { type: "lead", text: "Each choice has a reason, in plain words, for your use case. You can change any of them and the price follows." },
      { type: "reasons", items: reasoned },
    ],
    notes: ["This is the slide for the non-technical decision-maker. Say the reason, not the product name.", "If someone asks why not a commercial model, say it is a fair question: compare both on recordings of your own callers, and that commercial models are priced separately and the price is not yet set.", "These reasons are guidance, not measured results. Say so."],
  });

  /* 7. what you get */
  slides.push({
    id: "get", kicker: "What you get", title: "The platform, in numbers from the package document.",
    blocks: [
      {
        type: "facts",
        items: [
          { k: "Languages", v: "11", sub: "With switching mid-call" },
          { k: "At once", v: `${LIMITS.concurrent} calls`, sub: `Response target under ${LIMITS.latency} seconds` },
          { k: "Set up in", v: `${LIMITS.setupDays} working days`, sub: "Once everything is handed over" },
          { k: "Support", v: `${LIMITS.troubleshootHours} hours`, sub: "To troubleshoot an issue" },
          { k: "Analysis", v: `${LIMITS.analysisDays} working days`, sub: "After a campaign" },
          { k: "Campaigns", v: `${LIMITS.campaignsPerMonth} a month`, sub: "Set-up and monitoring support" },
        ],
      },
      { type: "lead", text: "Documented for the packaged offer. For Connect and Orchestrate, the limits are confirmed with you. The response time is a target, not a guarantee." },
    ],
    notes: ["Read the numbers exactly as written. Do not round up.", "If asked about uptime, the document states 99.8% and does not guarantee it call by call."],
  });

  /* 8. your package */
  slides.push({
    id: "package", kicker: "Your package", title: rec.want === rec.startAt ? `${PACKAGE_NAME[rec.want]} fits what you want to achieve.` : `${PACKAGE_NAME[rec.want]} is where you are heading. Start with ${PACKAGE_NAME[rec.startAt]}.`,
    blocks: [{ type: "package", label: pkgLabel, want: rec.want, startAt: rec.startAt, path: rec.path, capabilities: capsOf(sel).map((c) => CAPABILITY_BY_ID[c].label), reasons: rec.reasons.slice(0, 3).map((r) => r.text) }],
    notes: ["Say why, using the reasons on the page. They came from the department's own answers.", "If the start and the destination differ, stress that it is the same platform: nothing is thrown away when you move up.", cls.key === "custom" ? "The canvas is a custom mix. Say plainly that a custom package is quoted by VoicERA." : "The canvas matches the package exactly."],
  });

  /* 9. investment */
  const openRows = quote.sections.flatMap((s) => s.rows).filter((r) => r.status === "open").map((r) => r.item);
  const sec = (id: "once" | "usage" | "ongoing") => quote.sections.find((s) => s.id === id);
  const money: Block = {
    type: "money",
    total: inr(quote.grand),
    complete: quote.complete,
    budget: sel.workload.budget === null ? null : quote.grand > sel.workload.budget ? `Over your budget of ${inr(sel.workload.budget)} by ${inr(quote.grand - sel.workload.budget)}` : `Within your budget of ${inr(sel.workload.budget)}`,
    rows: [
      { k: "One-time", v: inr(sec("once")?.subtotal ?? 0), note: sec("once")?.open ? `${sec("once")!.open} not priced yet` : undefined },
      { k: `Usage over ${quote.period} month${quote.period === 1 ? "" : "s"}`, v: sec("usage") ? inr(sec("usage")!.subtotal) : inr(0), note: sec("usage")?.open ? `${sec("usage")!.open} not priced yet` : undefined },
      ...(sec("ongoing") ? [{ k: "Ongoing services", v: inr(sec("ongoing")!.subtotal), note: sec("ongoing")!.open ? `${sec("ongoing")!.open} not priced yet` : undefined }] : []),
      ...(quote.monthlyRun !== null ? [{ k: "Monthly run rate", v: inr(quote.monthlyRun) }] : []),
    ],
    open: openRows,
    scenarios: quote.scenarios.map((s) => ({ calls: s.callsPerMonth.toLocaleString("en-IN"), total: inr(s.total), planned: s.planned })),
    perCall: quote.perCall === null ? null : `${rate(pb.usageRate, "call")}`,
  };
  slides.push({
    id: "investment", kicker: "Investment", title: quote.complete ? "What it costs." : "What it costs, and what is not priced yet.",
    blocks: [money],
    notes: ["Start with the one-time and the per-call price. Then say what the per-call price covers: the platform, the phone line, and open-source models.", "Be direct about the rows that are not priced. Say they are waiting for a quote from VoicERA, not free and not zero.", "Offer the itemised quote: every line, with quantity, rate and amount.", "Never quote a price that is not on the page."],
  });

  /* 10. grow */
  const grow = growPath(sel, pb);
  slides.push({
    id: "grow", kicker: "How you grow", title: grow.length ? "Start where you are. Move up when you are ready." : "You are at the top, and there is room to widen.",
    blocks: [{
      type: "ladder", here: pkgLabel,
      steps: grow.map((g) => ({
        to: PACKAGE_NAME[g.to], gains: g.capsAdded.slice(0, 4), launch: PACKAGE_CARDS[g.to].launch,
        price: g.then.unresolved.some((u) => u.id === "setup") ? `${inr(g.then.knownTotal)} known, plus implementation quoted by VoicERA` : `${inr(g.then.knownTotal)} known`,
      })),
    }],
    notes: grow.length ? ["The key message: growing is adding a connection, not starting again.", "Say what carries over: content, languages, telephony, dashboard.", "Be clear that the implementation price for Connect and Orchestrate is not in the documents and will be quoted."] : ["Growth from here is more use cases, languages and departments on the same platform."],
  });

  /* 11. go live */
  slides.push({
    id: "live", kicker: "How it goes live", title: "From a decision to a live service.",
    blocks: [
      { type: "stages", items: stagesFor(sel).map((s, i) => ({ n: i + 1, title: s.title, who: s.who, whoLabel: WHO_LABEL[s.who], timing: s.timing, documented: s.documented })) },
      { type: "lead", text: `Typical launch: ${PACKAGE_CARDS[cls.needs].launch.toLowerCase()}. A range, not a commitment. Your own approvals, integration access and content review set the real date.` },
    ],
    notes: ["Name who does each step. The department is in most of them, and should hear that.", "Only two timings are documented: set-up in 2 working days once everything is handed over, and 24-hour troubleshooting. Everything else depends on the department's approvals. Say so.", "VoicERA sets it up, hosted on Bhashini. Running it on the department's own machines is not described in the documents."],
  });

  /* 12. asks */
  slides.push({
    id: "asks", kicker: "What we need", title: "What we need from you, and what we will confirm.",
    blocks: [{
      type: "two",
      left: { title: "From you", items: bringList(sel, p).map((b) => b.label) },
      right: { title: "We will confirm with you", items: uniq([...STILL_OPEN.slice(0, 3), ...p.openQuestions, ...rec.unknowns]) },
    }],
    notes: ["Ask for the one thing only they can bring: approved content. Everything else follows from that.", "Read their own questions back, the ones the documents could not answer. Promise a written answer, not an on-the-spot one.", "Say where call data is stored, whether it trains models, and how long it is kept: these are open in the documents and will be confirmed in writing before launch."],
  });

  /* 13. close */
  slides.push({
    id: "close", kicker: "Next step", title: "Anyone can now talk to intelligence.",
    blocks: [{
      type: "close",
      text: "Your next step is the hand-over pack: this pitch, your canvas, the itemised quote, the execution plan and your questions, in one download.",
      actions: ["Download the hand-over pack", "Open the itemised quote", "Agree who attends the scoping conversation"],
    }],
    notes: ["End on one clear next step. Do not offer three.", "Agree a date for the scoping conversation before you leave the room."],
  });

  return { title: pitch.headline, date: quote.date, slides };
}

function chipText(tier: string, id: string, pb: PriceBook): string {
  if (tier === "auto" || tier === "open") return "In the standard price";
  if (tier === "included") return id === "ch-partner" ? (pb.perNumber === null ? "Number price not set" : `${inr(pb.perNumber)} per number`) : "No separate charge";
  if (tier === "own") return "Your provider bills you";
  if (tier === "proprietary" || tier === "confirm") { const x = pb.modelExtra[id] ?? null; return x === null ? "Price not set" : `+ ${rate(x, pb.usageUnit)}`; }
  return "Quoted";
}

/** The deck as a document, for downloading or pasting. */
export function deckToMarkdown(d: Deck): string {
  const out: string[] = [`# ${d.title}`, "", `A proposal from VoicERA. ${d.date}.`, ""];
  d.slides.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, `*${s.kicker}*`, "");
    for (const b of s.blocks) {
      switch (b.type) {
        case "lead": out.push(b.text, ""); break;
        case "bullets": out.push(...b.items.map((x) => `- ${x}`), ""); break;
        case "facts": out.push(...b.items.map((x) => `- **${x.k}:** ${x.v}${x.sub ? ` (${x.sub})` : ""}`), ""); break;
        case "pillars": out.push(...b.items.map((x) => `- **${x.title}.** ${x.text}`), ""); break;
        case "chat": out.push(`**${b.title}.** ${b.context}`, "", ...b.turns.map((t) => (t.who === "note" ? `> ${t.text}` : `- **${t.who === "agent" ? "VoicERA" : "Citizen"}:** ${t.text}`)), ""); break;
        case "pipeline": out.push(...b.nodes.map((n) => `- **${n.name}** (${n.tech}): ${n.choice}. ${n.chip}`), ""); break;
        case "reasons": out.push(...b.items.map((x) => `- **${x.layer}: ${x.choice}.** ${x.why}${x.caution ? ` *Check: ${x.caution}*` : ""}`), ""); break;
        case "package": out.push(`**${b.label}.** Heading for ${PACKAGE_NAME[b.want]}, starting at ${PACKAGE_NAME[b.startAt]}.`, "", ...b.reasons.map((x) => `- ${x}`), "", `Includes: ${b.capabilities.join(", ")}.`, ""); break;
        case "money": out.push(`**${b.complete ? "Indicative total" : "Known so far"}: ${b.total}**${b.budget ? `. ${b.budget}.` : ""}`, "", ...b.rows.map((r) => `- ${r.k}: ${r.v}${r.note ? ` (${r.note})` : ""}`), ...(b.perCall ? [`- Usage: ${b.perCall}`] : []), ...(b.open.length ? ["", "Not priced yet:", ...b.open.map((x) => `- ${x}`)] : []), ""); break;
        case "ladder": out.push(`You are at ${b.here}.`, "", ...b.steps.map((x) => `- **${x.to}** (${x.launch.toLowerCase()}): adds ${x.gains.join(", ")}. ${x.price}.`), ""); break;
        case "stages": out.push(...b.items.map((x) => `${x.n}. **${x.title}** (${x.whoLabel}): ${x.timing}`), ""); break;
        case "two": out.push(`**${b.left.title}**`, ...b.left.items.map((x) => `- ${x}`), "", `**${b.right.title}**`, ...b.right.items.map((x) => `- ${x}`), ""); break;
        case "close": out.push(b.text, "", ...b.actions.map((x) => `- ${x}`), ""); break;
      }
    }
  });
  out.push("---", "A planning pitch built from your answers. Not a quote, an order or an offer.");
  return out.join("\n");
}
