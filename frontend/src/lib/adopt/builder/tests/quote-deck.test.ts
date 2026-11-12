import test from "node:test";
import assert from "node:assert/strict";
import { presetSelection, type Selection } from "../canvas";
import { DEFAULT_PRICES, costFor, round2, type PriceBook } from "../pricing";
import { buildQuote, quoteToCsv, quoteToMarkdown } from "../quote";
import { buildDeck, deckToMarkdown } from "../deck";
import { buildPack } from "../pack";
import { buildPitch } from "../pitch";
import { recommend } from "../profile";
import { applyAnswer, emptyProfile, selectionFor, type Profile } from "../profile";

const pb: PriceBook = JSON.parse(JSON.stringify(DEFAULT_PRICES));
const NOW = new Date("2026-10-14T09:00:00Z");
const withCalls = (s: Selection, calls: number | null, budget: number | null = null): Selection => ({ ...s, workload: { ...s.workload, callsPerMonth: calls, months: 3, budget } });
const profile = (over: Partial<Profile> = {}): Profile => ({ ...emptyProfile(), sector: "civic", department: "Civic & local government", useCases: ["grievance", "scheme"], languages: ["Hindi", "English"], scale: "thousands", answered: ["who", "use", "lang", "scale"], ...over });

/* ------------------------------------------------------------------ quote */

test("a Deploy quote has a one-time and a usage section, and every priced row is quantity × rate", () => {
  const q = buildQuote(withCalls(presetSelection("deploy"), 5000), pb, NOW);
  assert.deepEqual(q.sections.map((s) => s.id), ["once", "usage"]);
  const once = q.sections[0], usage = q.sections[1];
  assert.equal(once.subtotal, 50500);
  assert.equal(usage.subtotal, 750);
  assert.equal(q.grand, 51250);
  assert.equal(q.openRows, 0);
  assert.equal(q.complete, true);
  for (const r of q.sections.flatMap((s) => s.rows).filter((x) => x.qty !== null && x.rate !== null)) assert.equal(r.amount, round2((r.qty as number) * (r.rate as number)), r.id);
});

test("unit economics: 5 paise a call, 50 rupees per thousand, and the monthly run rate", () => {
  const q = buildQuote(withCalls(presetSelection("deploy"), 5000), pb, NOW);
  assert.equal(q.perCall, 0.05);
  assert.equal(q.per1000, 50);
  assert.equal(q.monthlyRun, 250);
});

test("a row with no price stays in its section with no amount, and is not counted", () => {
  const q = buildQuote(withCalls(presetSelection("connect"), 1000), pb, NOW);
  const row = q.sections[0].rows.find((r) => r.id === "setup")!;
  assert.equal(row.status, "open");
  assert.equal(row.amount, null);
  assert.equal(q.openRows, 1);
  assert.equal(q.complete, false);
  assert.equal(q.sections[0].open, 1);
  assert.equal(q.knownTotal, costFor(withCalls(presetSelection("connect"), 1000), pb).knownTotal);
});

test("a figure the adopter types becomes their own row, and is kept out of the known total", () => {
  const s = { ...withCalls(presetSelection("connect"), 1000), figures: { setup: 200000 } };
  const q = buildQuote(s, pb, NOW);
  const row = q.sections[0].rows.find((r) => r.id === "setup")!;
  assert.equal(row.status, "yours");
  assert.equal(row.amount, 200000);
  assert.equal(q.yourTotal, 200000);
  assert.equal(q.grand, q.knownTotal + 200000);
  assert.equal(q.complete, true);
});

test("a commercial model is an open usage row until priced, then a priced row", () => {
  const s = { ...withCalls(presetSelection("deploy"), 1000), think: "llm-openai" };
  const open = buildQuote(s, pb, NOW).sections.find((x) => x.id === "usage")!.rows.find((r) => r.id === "model-llm-openai")!;
  assert.equal(open.status, "open");
  const priced = buildQuote(s, { ...pb, modelExtra: { "llm-openai": 0.2 } }, NOW).sections.find((x) => x.id === "usage")!.rows.find((r) => r.id === "model-llm-openai")!;
  assert.equal(priced.status, "priced");
  assert.equal(priced.amount, 600);
  assert.equal(priced.qty, 3000);
});

test("bringing your own model is the adopter's row, and VoicERA's connection fee stays open", () => {
  const s = { ...withCalls(presetSelection("deploy"), 1000), think: "llm-own", ownFigures: { think: 0.4 } as Selection["ownFigures"] };
  const usage = buildQuote(s, pb, NOW).sections.find((x) => x.id === "usage")!;
  assert.equal(usage.rows.find((r) => r.id === "own-think")!.status, "yours");
  assert.equal(usage.rows.find((r) => r.id === "ownfee-think")!.status, "open");
});

test("managed operations land in the ongoing section, prorated to the period", () => {
  const s = { ...withCalls(presetSelection("deploy"), 1000), managedOps: true };
  const q = buildQuote(s, { ...pb, managedOpsAnnual: 120000 }, NOW);
  const on = q.sections.find((x) => x.id === "ongoing")!;
  assert.equal(on.rows[0].amount, 30000);
  assert.equal(on.subtotal, 30000);
});

test("the volume ladder grows with volume and flags the planned figure", () => {
  const q = buildQuote(withCalls(presetSelection("deploy"), 5000), pb, NOW);
  const totals = q.scenarios.map((s) => s.total);
  assert.deepEqual([...totals].sort((a, b) => a - b), totals);
  assert.ok(q.scenarios.find((s) => s.callsPerMonth === 5000)!.planned);
  assert.equal(q.scenarios.find((s) => s.callsPerMonth === 500)!.usage, 75);
  assert.equal(q.scenarios.filter((s) => s.planned).length, 1);
});

test("the quote says what the standard price covers and what is included", () => {
  const q = buildQuote(withCalls(presetSelection("deploy"), 5000), pb, NOW);
  assert.ok(q.covered.some((x) => /phone line/i.test(x)));
  assert.ok(q.included.some((x) => /10 text files/.test(x)));
  assert.ok(q.rules.some((x) => /not free and not zero/i.test(x)));
});

test("the quote exports to a spreadsheet and a document without losing a row", () => {
  const q = buildQuote({ ...withCalls(presetSelection("connect"), 1000), think: "llm-openai" }, pb, NOW);
  const csv = quoteToCsv(q);
  const rowCount = q.sections.reduce((t, s) => t + s.rows.length, 0);
  assert.equal(csv.split("\n").filter((l) => l.startsWith('"')).length, rowCount);
  assert.match(csv, /Not priced yet/);
  const md = quoteToMarkdown(q, "Water Board");
  assert.match(md, /Prepared for: Water Board/);
  assert.match(md, /To be quoted/);
  assert.match(md, /Not an order and not an offer/);
});

test("per-minute pricing changes the usage row to minutes", () => {
  const s = { ...withCalls(presetSelection("deploy"), 1000), workload: { callsPerMonth: 1000, avgMinutes: 2, months: 3, budget: null } };
  const q = buildQuote(s, { ...pb, usageUnit: "minute", usageRate: 0.5 }, NOW);
  const row = q.sections.find((x) => x.id === "usage")!.rows[0];
  assert.equal(row.unit, "minutes");
  assert.equal(row.qty, 6000);
  assert.equal(row.amount, 3000);
  assert.equal(q.perCall, null);
});

/* ------------------------------------------------------------------ deck */

const deckFor = (p: Profile, tweak?: (s: Selection) => Selection, prices = pb) => {
  let sel = selectionFor(p, "deploy");
  if (tweak) sel = tweak(sel);
  return buildDeck(p, prices, sel, NOW);
};

test("the deck runs end to end: cover to close, in order", () => {
  const ids = deckFor(profile()).slides.map((s) => s.id);
  assert.deepEqual(ids, ["cover", "need", "what", "sounds", "flow", "why", "get", "package", "investment", "grow", "live", "asks", "close"]);
});

test("every slide has presenter notes and content, and titles are unique", () => {
  const d = deckFor(profile());
  for (const s of d.slides) { assert.ok(s.notes.length > 0, s.id); assert.ok(s.blocks.length > 0, s.id); assert.ok(s.title.length > 5, s.id); }
  assert.equal(new Set(d.slides.map((s) => s.title)).size, d.slides.length);
});

test("the sample conversation slide appears only when a use case has one", () => {
  assert.ok(deckFor(profile({ useCases: ["grievance"] })).slides.some((s) => s.id === "sounds"));
  assert.ok(!deckFor(profile({ useCases: ["helpline"] })).slides.some((s) => s.id === "sounds"));
  assert.ok(!deckFor(profile({ useCases: ["alerts"] })).slides.some((s) => s.id === "sounds"));
});

test("the conversation is labelled illustrative", () => {
  const s = deckFor(profile({ useCases: ["scheme"] })).slides.find((x) => x.id === "sounds")!;
  assert.ok(s.blocks.some((b) => b.type === "lead" && /illustrative/i.test(b.text)));
  assert.ok(s.notes.join(" ").toLowerCase().includes("scripted"));
});

test("the cover carries the department and the date", () => {
  const d = deckFor(profile());
  assert.match(d.slides[0].title, /Civic/);
  assert.equal(d.date, "14 October 2026");
});

test("the 'why' slide explains each choice, and warns about a commercial model's price and data", () => {
  const d = deckFor(profile({ useCases: ["grievance"] }), (s) => ({ ...s, think: "llm-openai" }));
  const why = d.slides.find((s) => s.id === "why")!;
  const reasons = why.blocks.find((b) => b.type === "reasons")!;
  assert.equal(reasons.type, "reasons");
  if (reasons.type === "reasons") {
    const think = reasons.items.find((i) => i.layer === "Thinks")!;
    assert.equal(think.choice, "OpenAI");
    assert.match(think.why, /messy words/i);
    assert.match(think.caution ?? "", /no price/i);
    assert.equal(reasons.items.length, 7);
  }
});

test("the investment slide matches the quote to the rupee and lists what is not priced", () => {
  const sel = withCalls({ ...selectionFor(profile(), "deploy"), think: "llm-openai" }, 5000, 60000);
  const d = buildDeck(profile(), pb, sel, NOW);
  const q = buildQuote(sel, pb, NOW);
  const inv = d.slides.find((s) => s.id === "investment")!.blocks[0];
  assert.equal(inv.type, "money");
  if (inv.type === "money") {
    assert.equal(inv.total, `₹${q.grand.toLocaleString("en-IN")}`);
    assert.equal(inv.complete, false);
    assert.ok(inv.open.some((x) => /OpenAI/.test(x)));
    assert.equal(inv.perCall, "5 paise per call");
    assert.match(inv.budget ?? "", /Within your budget/);
  }
});

test("an over-budget plan says so on the investment slide", () => {
  const sel = withCalls(selectionFor(profile(), "deploy"), 5000, 40000);
  const inv = buildDeck(profile(), pb, sel, NOW).slides.find((s) => s.id === "investment")!.blocks[0];
  assert.ok(inv.type === "money" && /Over your budget/.test(inv.budget ?? ""));
});

test("the grow slide lists the steps up, and says so when there are none", () => {
  const up = buildDeck(profile(), pb, selectionFor(profile(), "deploy"), NOW).slides.find((s) => s.id === "grow")!.blocks[0];
  assert.ok(up.type === "ladder" && up.steps.length === 2);
  const top = buildDeck(profile(), pb, selectionFor(profile(), "orchestrate"), NOW).slides.find((s) => s.id === "grow")!;
  assert.ok(top.blocks[0].type === "ladder" && top.blocks[0].steps.length === 0);
  assert.match(top.title, /top/);
});

test("the package slide names where to start and where to head when they differ", () => {
  const p = applyAnswer(profile({ useCases: ["grievance"] }), "systems", "planned");
  const slide = buildDeck(p, pb, selectionFor(p, "deploy"), NOW).slides.find((s) => s.id === "package")!;
  assert.match(slide.title, /Orchestrate/);
  assert.match(slide.title, /Start with Deploy/);
});

test("the asks slide carries the adopter's own unanswered questions", () => {
  const p = profile({ openQuestions: ["Can it run on our servers?"] });
  const asks = deckFor(p).slides.find((s) => s.id === "asks")!.blocks[0];
  assert.ok(asks.type === "two" && asks.right.items.includes("Can it run on our servers?"));
});

test("the go-live slide marks only the documented timings", () => {
  const live = deckFor(profile()).slides.find((s) => s.id === "live")!.blocks[0];
  assert.ok(live.type === "stages");
  if (live.type === "stages") {
    const documented = live.items.filter((i) => i.documented).map((i) => i.title);
    assert.ok(documented.includes("VoicERA sets up your agent"));
    assert.ok(!documented.includes("Hand over what you bring"));
  }
});

test("the deck never makes a promise or an unsourced claim", () => {
  const md = deckToMarkdown(deckFor(profile()));
  assert.ok(!/guarantee[sd]?\b/i.test(md.replace(/not a guarantee/gi, "")));
  assert.ok(!/\b\d+% (faster|cheaper|savings|reduction)/i.test(md));
  assert.match(md, /Not a quote, an order or an offer/);
  assert.match(md, /response time is a target/i);
});

test("the markdown deck has every slide title", () => {
  const d = deckFor(profile());
  const md = deckToMarkdown(d);
  d.slides.forEach((s, i) => assert.ok(md.includes(`## ${i + 1}. ${s.title}`), s.id));
});

test("presenter notes never repeat audience copy as a promise", () => {
  const d = deckFor(profile());
  for (const s of d.slides) assert.ok(!/we guarantee|will definitely|always works/i.test(s.notes.join(" ")), s.id);
});

test("the full pack adds the pitch deck and the itemised quote to the seven working files", () => {
  const p = profile();
  const sel = withCalls(selectionFor(p, "deploy"), 5000, 100000);
  const rec = recommend(p);
  const cost = costFor(sel, pb);
  const files = buildPack({ profile: p, sel, pb, cost, rec, pitch: buildPitch(p, pb, sel, cost, rec) }, NOW);
  assert.equal(files.length, 10);
  assert.deepEqual(files.slice(7).map((f) => f.name), ["07-pitch-deck.md", "08-itemised-quote.csv", "09-itemised-quote.md"]);
  assert.match(files[7].content, /## 13\. Anyone can now talk to intelligence\./);
  assert.match(files[8].content, /Grand total \(INR\),51250/);
  assert.match(files[9].content, /Quotation \(indicative\)/);
  assert.equal(new Set(files.map((f) => f.name)).size, 10);
});
