import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, DEPTHS, LAYERS, OPTIONS, OPTION_BY_ID, USE_CASES, PACKAGE_CARDS, capabilitiesOfDepth, optionsFor, reasonFor, suggestedUseCases } from "../catalog";
import { classify, capsOf, moveToPackage, notesFor, presetSelection, requiredDepth, type Selection } from "../canvas";
import { DEFAULT_PRICES, costFor, inr, rate, chipFor, type PriceBook } from "../pricing";
import { QUESTIONS, applyAnswer, type AnswerValue, emptyProfile, hintsFrom, nextQuestion, parseAmount, reactTo, recommend, reopen, selectionFor, type Profile } from "../profile";
import { KB, answerFor, matchQuestion } from "../kb";
import { buildPitch, pitchToMarkdown } from "../pitch";
import { growPath } from "../grow";
import { CHECKS, bringList, handoverFiles, stagesFor } from "../deploy";

const pb: PriceBook = JSON.parse(JSON.stringify(DEFAULT_PRICES));
const P = (over: Partial<Profile> = {}): Profile => ({ ...emptyProfile(), ...over });
const withWork = (s: Selection, calls: number | null, budget: number | null = null): Selection => ({ ...s, workload: { ...s.workload, callsPerMonth: calls, months: 3, budget } });

/* ------------------------------------------------------------------ catalogue */

test("capabilities are exactly the ICP's package contents: 5, 4 and 6", () => {
  assert.equal(CAPABILITIES.filter((c) => c.depth === "deploy").length, 5);
  assert.equal(CAPABILITIES.filter((c) => c.depth === "connect").length, 4);
  assert.equal(CAPABILITIES.filter((c) => c.depth === "orchestrate").length, 6);
  assert.equal(capabilitiesOfDepth("orchestrate").length, 15);
  assert.ok(CAPABILITIES.every((c) => c.id), "every ICP label maps to a capability id");
});

test("every option is well formed and every layer has options", () => {
  assert.equal(new Set(OPTIONS.map((o) => o.id)).size, OPTIONS.length);
  for (const l of LAYERS) assert.ok(optionsFor(l.id).length > 0, l.id);
  for (const o of OPTIONS) {
    assert.ok(o.check.length > 10, `${o.id} has something to check`);
    assert.ok(o.why.length > 10, o.id);
    for (const c of o.caps ?? []) assert.ok(CAPABILITIES.some((x) => x.id === c), `${o.id}: ${c}`);
  }
});

test("model options come from the documents' sample lists, and say so", () => {
  const names = (l: "listen" | "think" | "speak") => optionsFor(l).map((o) => o.name);
  for (const n of ["AI4Bharat", "Sarvam", "Eleven Labs"]) assert.ok(names("listen").includes(n), n);
  for (const n of ["Gemma", "Llama", "Qwen", "OpenAI"]) assert.ok(names("think").includes(n), n);
  for (const n of ["AI4Bharat", "Bodhan", "Sarvam", "Google Chirp"]) assert.ok(names("speak").includes(n), n);
  assert.ok(OPTION_BY_ID["llm-openai"].check.toLowerCase().includes("no price"));
});

test("commercial and unclassified models are never presented as free", () => {
  for (const o of OPTIONS.filter((x) => x.tier === "proprietary" || x.tier === "confirm")) assert.match(o.check.toLowerCase(), /price|confirm/, o.id);
});

test("the reason for OpenAI is use-case aware and honest about cost and data", () => {
  const g = reasonFor(OPTION_BY_ID["llm-openai"], ["grievance"]);
  assert.equal(g.specific, true);
  assert.match(g.text, /cost/i);
  assert.match(g.text, /where the data goes/i);
  const s = reasonFor(OPTION_BY_ID["llm-openai"], ["scheme"]);
  assert.match(s.text, /Rarely needed/);
  assert.equal(reasonFor(OPTION_BY_ID["asr-ai4bharat"], ["grievance"]).specific, false);
});

test("use cases sit at the depths the ICP gives", () => {
  const d = (id: string) => USE_CASES.find((u) => u.id === id)!.depth;
  assert.equal(d("scheme"), "deploy");
  assert.equal(d("survey"), "deploy");
  assert.equal(d("forms"), "connect");
  assert.equal(d("status"), "connect");
  assert.equal(d("grievance"), "orchestrate");
});

test("a civic department is offered grievance first among its suggestions", () => {
  assert.ok(suggestedUseCases("civic").includes("grievance"));
  assert.deepEqual(suggestedUseCases(null), []);
});

/* ------------------------------------------------------------------ pricing */

test("the price book carries the provider's 5 paise per call and the documented setup and number prices", () => {
  assert.equal(DEFAULT_PRICES.usageUnit, "call");
  assert.equal(DEFAULT_PRICES.usageRate, 0.05);
  assert.equal(DEFAULT_PRICES.setup.deploy, 50000);
  assert.equal(DEFAULT_PRICES.perNumber, 500);
  assert.equal(rate(0.05, "call"), "5 paise per call");
  assert.equal(inr(0.05), "₹0.05");
});

test("Deploy cost is setup plus numbers plus calls at 5 paise, and is complete", () => {
  const s = withWork(presetSelection("deploy"), 5000);
  const c = costFor(s, pb);
  assert.equal(c.units, 15000);
  assert.equal(c.usage, 750);
  assert.equal(c.knownTotal, 50000 + 500 + 750);
  assert.equal(c.unresolved.length, 0);
  assert.equal(c.complete, true);
});

test("a million calls at 5 paise is exact to the paisa", () => {
  const c = costFor(withWork(presetSelection("deploy"), 333333), pb);
  assert.equal(c.usage, 49999.95);
});

test("per-minute unit uses minutes, and asks for them when missing", () => {
  const perMin: PriceBook = { ...pb, usageUnit: "minute", usageRate: 0.5 };
  let s = withWork(presetSelection("deploy"), 1000);
  assert.ok(costFor(s, perMin).unresolved.some((u) => u.id === "volume"));
  s = { ...s, workload: { ...s.workload, avgMinutes: 2 } };
  assert.equal(costFor(s, perMin).usage, 1000 * 3 * 2 * 0.5);
});

test("without volume, usage is unresolved and the volume item cannot take a typed figure", () => {
  const c = costFor(presetSelection("deploy"), pb);
  const v = c.unresolved.find((u) => u.id === "volume")!;
  assert.equal(v.figurable, false);
  assert.equal(c.complete, false);
});

test("Connect and Orchestrate implementation are never given an invented price", () => {
  for (const d of ["connect", "orchestrate"] as const) {
    const c = costFor(withWork(presetSelection(d), 1000), pb);
    assert.ok(c.unresolved.some((u) => u.id === "setup"), d);
    assert.equal(c.lines.find((l) => l.id === "setup"), undefined);
  }
});

test("a commercial model is unpriced until the provider sets a price, then it is added", () => {
  let s = withWork(presetSelection("deploy"), 1000);
  s = { ...s, think: "llm-openai" };
  const before = costFor(s, pb);
  assert.ok(before.unresolved.some((u) => u.id === "model-llm-openai"));
  const priced: PriceBook = { ...pb, modelExtra: { "llm-openai": 0.2 } };
  const after = costFor(s, priced);
  assert.ok(!after.unresolved.some((u) => u.id === "model-llm-openai"));
  assert.equal(after.lines.find((l) => l.id === "model-llm-openai")!.amount, 3000 * 0.2);
  assert.equal(after.knownTotal, before.knownTotal + 600);
});

test("bringing your own model: the adopter's figure is theirs, and VoicERA's fee stays open", () => {
  let s = withWork(presetSelection("deploy"), 1000);
  s = { ...s, think: "llm-own", ownFigures: { think: 0.4 } };
  const c = costFor(s, pb);
  assert.equal(c.adopter, 1200);
  assert.ok(c.unresolved.some((u) => u.id === "ownfee-think"));
  assert.equal(c.lines.find((l) => l.id === "own-think")!.source, "adopter");
  assert.ok(!c.lines.some((l) => l.id === "own-think" && l.source !== "adopter"));
});

test("hosting other than Bhashini and your own telephony are unpriced, not free", () => {
  const s = { ...withWork(presetSelection("deploy"), 1000), host: "host-onprem", channel: "ch-own" as const };
  const c = costFor(s, pb);
  assert.ok(c.unresolved.some((u) => u.id === "host-host-onprem"));
  assert.ok(c.unresolved.some((u) => u.id === "own-telephony"));
});

test("a typed figure fills an unresolved item and completes the total", () => {
  let s = withWork(presetSelection("connect"), 1000);
  s = { ...s, figures: { setup: 200000 } };
  const c = costFor(s, pb);
  assert.equal(c.adopter, 200000);
  assert.equal(c.complete, true);
  assert.equal(c.grand, c.knownTotal + 200000);
});

test("budget states: none, short, fits, open", () => {
  const base = withWork(presetSelection("deploy"), 5000);
  assert.equal(costFor(base, pb).budget.state, "none");
  assert.equal(costFor({ ...base, workload: { ...base.workload, budget: 40000 } }, pb).budget.state, "short");
  assert.equal(costFor({ ...base, workload: { ...base.workload, budget: 100000 } }, pb).budget.state, "fits");
  const conn = withWork(presetSelection("connect"), 5000, 100000);
  assert.equal(costFor(conn, pb).budget.state, "open");
});

test("what the headroom pays for is headroom divided by the usage rate", () => {
  const c = costFor(withWork(presetSelection("deploy"), 1000, 100000), pb);
  assert.equal(c.budget.unitsCovered, Math.floor((100000 - c.grand) / 0.05));
});

test("option chips say what a choice does to cost", () => {
  assert.equal(chipFor(OPTION_BY_ID["llm-auto"], pb).text, "In the standard price");
  assert.equal(chipFor(OPTION_BY_ID["llm-openai"], pb).text, "Price not set");
  assert.match(chipFor(OPTION_BY_ID["llm-openai"], { ...pb, modelExtra: { "llm-openai": 0.2 } }).text, /^\+ 20 paise per call$/);
  assert.equal(chipFor(OPTION_BY_ID["llm-own"], pb).text, "Your provider bills you");
  assert.equal(chipFor(OPTION_BY_ID["act-api"], pb).text, "Project-based");
});

/* ------------------------------------------------------------------ canvas and classification */

test("each preset classifies as itself", () => {
  for (const d of DEPTHS) assert.equal(classify(presetSelection(d)).key, d);
});

test("a survey with no knowledge base is still Deploy", () => {
  assert.equal(classify({ ...presetSelection("deploy"), know: "kn-none" }).key, "deploy");
});

test("changing models, hosting or languages never changes the package label", () => {
  const s = { ...presetSelection("deploy"), think: "llm-openai", speak: "tts-chirp", host: "host-gov", languages: ["Hindi", "Tamil"] };
  assert.equal(classify(s).key, "deploy");
});

test("Deploy plus a live handover is a custom package that needs Orchestrate depth", () => {
  const s = { ...presetSelection("deploy"), handoff: "ho-live" as const };
  const c = classify(s);
  assert.equal(c.key, "custom");
  assert.equal(c.needs, "orchestrate");
  assert.equal(c.base, "deploy");
  assert.deepEqual([...c.extras].sort(), ["escalation", "handoff"]);
  assert.match(c.label, /Deploy plus 2 from Orchestrate/);
});

test("Connect plus a live handover reads as Connect plus 2", () => {
  const c = classify({ ...presetSelection("connect"), handoff: "ho-live" });
  assert.equal(c.key, "custom");
  assert.equal(c.base, "connect");
  assert.match(c.label, /Connect plus 2 from Orchestrate/);
});

test("live data in the knowledge base pulls in API integration only", () => {
  const c = classify({ ...presetSelection("deploy"), know: "kn-live" });
  assert.equal(c.key, "custom");
  assert.deepEqual(c.extras, ["api"]);
  assert.equal(requiredDepth({ ...presetSelection("deploy"), know: "kn-live" }), "connect");
});

test("moving to a package keeps the adopter's languages, models and volume", () => {
  const s = withWork({ ...presetSelection("deploy"), think: "llm-openai", languages: ["Tamil"] }, 777);
  const m = moveToPackage(s, "orchestrate");
  assert.equal(m.think, "llm-openai");
  assert.deepEqual(m.languages, ["Tamil"]);
  assert.equal(m.workload.callsPerMonth, 777);
  assert.equal(classify(m).key, "orchestrate");
});

test("notes warn about forms with no connection and outbound with no phone line", () => {
  assert.ok(notesFor(presetSelection("deploy"), ["forms"]).some((n) => n.layer === "act" && n.tone === "warn"));
  assert.ok(notesFor({ ...presetSelection("deploy"), outbound: true, channel: "ch-browser" }, ["survey"]).some((n) => n.layer === "channel" && n.tone === "warn"));
  assert.ok(notesFor({ ...presetSelection("deploy"), host: "host-onprem" }, []).some((n) => n.layer === "host"));
});

/* ------------------------------------------------------------------ questions */

test("a survey implies outbound, so the direction question is skipped", () => {
  let p = applyAnswer(emptyProfile(), "use", ["survey"]);
  assert.equal(p.direction, "out");
  assert.ok(!QUESTIONS.find((q) => q.id === "dir")!.when(p));
  p = applyAnswer(emptyProfile(), "use", ["scheme"]);
  assert.equal(p.direction, null);
  assert.ok(QUESTIONS.find((q) => q.id === "dir")!.when(p));
});

test("survey-only skips the systems and handover questions; grievance asks both", () => {
  const sv = applyAnswer(emptyProfile(), "use", ["survey"]);
  assert.ok(!QUESTIONS.find((q) => q.id === "systems")!.when(sv));
  assert.ok(!QUESTIONS.find((q) => q.id === "handoff")!.when(sv));
  const gr = applyAnswer(emptyProfile(), "use", ["grievance"]);
  assert.ok(QUESTIONS.find((q) => q.id === "systems")!.when(gr));
  assert.ok(QUESTIONS.find((q) => q.id === "handoff")!.when(gr));
});

test("the systems question reads differently for grievances, forms and schemes", () => {
  const q = QUESTIONS.find((x) => x.id === "systems")!;
  assert.match(q.prompt(P({ useCases: ["grievance"] })), /complaints/);
  assert.match(q.prompt(P({ useCases: ["forms"] })), /API/);
  assert.match(q.prompt(P({ useCases: ["scheme"] })), /schemes/);
});

test("the conversation walks the questions in order and ends at 'more'", () => {
  let p = emptyProfile();
  const seen: string[] = [];
  for (let guard = 0; guard < 30; guard++) {
    const q = nextQuestion(p);
    if (!q) break;
    seen.push(q.id);
    const v: AnswerValue = q.id === "who" ? "civic" : q.id === "use" ? ["grievance"] : q.kind === "multi" ? ["Hindi"] : q.kind === "number" ? 150000 : q.id === "more" ? null : q.choices!(p)[0].id;
    p = applyAnswer(p, q.id, v);
  }
  assert.equal(seen[0], "who");
  assert.equal(seen[1], "use");
  assert.equal(seen[seen.length - 1], "more");
  assert.ok(seen.includes("systems") && seen.includes("handoff"));
  assert.equal(new Set(seen).size, seen.length, "no question is asked twice");
});

test("languages outside the documented eleven are kept apart and flagged", () => {
  const p = applyAnswer(emptyProfile(), "lang", ["Hindi", "Tulu"]);
  assert.deepEqual(p.languages, ["Hindi"]);
  assert.equal(p.otherLanguages, "Tulu");
  assert.match(reactTo(p, "lang").join(" "), /not among the eleven/);
});

test("reopening changes one answer and keeps the rest", () => {
  let p = applyAnswer(applyAnswer(emptyProfile(), "who", "civic"), "use", ["scheme"]);
  p = reopen(p, "use");
  assert.ok(p.answered.includes("who") && !p.answered.includes("use"));
  assert.equal(nextQuestion(p)!.id, "use");
});

test("amounts are read in rupees, lakhs, crores and thousands", () => {
  assert.equal(parseAmount("2 lakh"), 200000);
  assert.equal(parseAmount("50k"), 50000);
  assert.equal(parseAmount("₹1,50,000"), 150000);
  assert.equal(parseAmount("1.5 crore"), 15000000);
  assert.equal(parseAmount("Rs. 75000"), 75000);
  assert.equal(parseAmount("not sure"), null);
});

test("reactions cite the documented figures", () => {
  assert.match(reactTo(P({ scale: "lakhs" }), "scale").join(" "), /500/);
  assert.match(reactTo(P({ length: "long" }), "length").join(" "), /3 minutes/);
  assert.match(reactTo(P({ budget: 10000 }), "budget").join(" "), /₹50,000/);
  assert.match(reactTo(P({ telephony: "own" }), "tel").join(" "), /2 to 4 weeks/);
});

/* ------------------------------------------------------------------ recommendation */

test("scheme discovery alone points to Deploy", () => {
  const r = recommend(P({ useCases: ["scheme"], systems: "none" }));
  assert.equal(r.want, "deploy");
  assert.deepEqual(r.path, ["deploy"]);
});

test("grievance with an API points to Orchestrate and starts there", () => {
  const r = recommend(P({ useCases: ["grievance"], systems: "api" }));
  assert.equal(r.want, "orchestrate");
  assert.equal(r.startAt, "orchestrate");
});

test("grievance with no API yet: best fit Orchestrate, start at Deploy, climb through Connect", () => {
  const r = recommend(P({ useCases: ["grievance"], systems: "planned" }));
  assert.equal(r.want, "orchestrate");
  assert.equal(r.startAt, "deploy");
  assert.deepEqual(r.path, ["deploy", "connect", "orchestrate"]);
  assert.ok(r.reasons.some((x) => x.rule === "R4"));
});

test("grievance with nothing to file into is an intake line at Deploy, with a caution", () => {
  const r = recommend(P({ useCases: ["grievance"], systems: "none", handoff: "callback" }));
  assert.equal(r.want, "deploy");
  assert.ok(r.cautions.some((c) => c.rule === "C-grievance-intake"));
});

test("a live handover pulls the recommendation up to Orchestrate", () => {
  assert.equal(recommend(P({ useCases: ["helpline"], handoff: "live" })).want, "orchestrate");
});

test("forms and status with an API are Connect; with no system they warn", () => {
  assert.equal(recommend(P({ useCases: ["forms"], systems: "api" })).want, "connect");
  const r = recommend(P({ useCases: ["status"], systems: "none" }));
  assert.equal(r.want, "connect");
  assert.ok(r.cautions.some((c) => c.rule === "C-endpoint"));
});

test("several use cases take the deepest one", () => {
  assert.equal(recommend(P({ useCases: ["scheme", "survey", "forms"], systems: "api" })).want, "connect");
});

test("cautions come only from the answers and the documents", () => {
  const r = recommend(P({ useCases: ["grievance"], systems: "api", timeline: "days", budget: 10000, length: "long", otherLanguages: "Tulu", sensitivity: "sensitive", host: "onprem", telephony: "own", models: "own" }));
  const rules = r.cautions.map((c) => c.rule);
  for (const x of ["C-time", "C-budget", "C-length", "C-lang", "C-data", "C-host", "C-tel", "C-models", "C-emergency"]) assert.ok(rules.includes(x), x);
});

test("nothing chosen is an open recommendation", () => {
  assert.equal(recommend(emptyProfile()).confidence, "open");
});

test("answers shape the starting canvas", () => {
  const p = P({ useCases: ["survey"], languages: ["Hindi"], scale: "thousands", length: "short", budget: 200000, telephony: "own", host: "gov", models: "own" });
  const h = hintsFrom(p);
  assert.equal(h.scriptOnly, true);
  assert.equal(h.outbound, true);
  const s = selectionFor(p, "deploy");
  assert.equal(s.know, "kn-none");
  assert.equal(s.channel, "ch-own");
  assert.equal(s.host, "host-gov");
  assert.equal(s.think, "llm-own");
  assert.equal(s.workload.callsPerMonth, 5000);
  assert.equal(s.workload.budget, 200000);
  assert.deepEqual(s.languages, ["Hindi"]);
});

/* ------------------------------------------------------------------ questions from the adopter */

test("the adopter's own questions find their answers", () => {
  const id = (t: string) => matchQuestion(t)?.entry.id;
  assert.equal(id("Which package should I choose for grievances?"), "grievance");
  assert.equal(id("what does openai cost"), "modelcost");
  assert.equal(id("can I upgrade later"), "upgrade");
  assert.equal(id("where is the call data stored?"), "storage");
  assert.equal(id("what is a custom package"), "custom");
  assert.equal(id("what do STT and TTS mean"), "glossary");
  assert.equal(id("does it work on whatsapp"), "whatsapp");
  assert.equal(id("how long does it take to go live"), "timeline");
});

test("a question the documents do not answer is not answered", () => {
  assert.equal(matchQuestion("banana smoothie recipe"), null);
  assert.equal(matchQuestion("ok"), null);
});

test("price answers read the live price book", () => {
  const e = matchQuestion("what does it cost")!.entry;
  const a = answerFor(e, { pb, profile: emptyProfile() }).paragraphs.join(" ");
  assert.match(a, /5 paise per call/);
  assert.match(a, /₹50,000/);
  assert.match(a, /₹0\.50 a minute/);
  const changed = answerFor(e, { pb: { ...pb, usageRate: 0.1 }, profile: emptyProfile() }).paragraphs.join(" ");
  assert.match(changed, /10 paise per call/);
});

test("answers about data say it is open rather than inventing a policy", () => {
  const a = answerFor(matchQuestion("where is call data stored")!.entry, { pb, profile: emptyProfile() }).paragraphs.join(" ");
  assert.match(a, /leaves three answers blank/);
  assert.ok(!/we (store|delete|keep)/i.test(a));
});

test("every follow-up points to a real entry", () => {
  const ids = new Set(KB.map((e) => e.id));
  for (const e of KB) for (const f of e.follow ?? []) assert.ok(ids.has(f), `${e.id} -> ${f}`);
  for (const e of KB) assert.ok(e.a({ pb, profile: emptyProfile() }).length > 0, e.id);
});

/* ------------------------------------------------------------------ pitch, grow, deploy */

test("the pitch fills in as answers arrive and never promises", () => {
  const empty = buildPitch(emptyProfile(), pb, null, null);
  let p = applyAnswer(emptyProfile(), "who", "civic");
  p = applyAnswer(p, "use", ["grievance"]);
  p = applyAnswer(p, "lang", ["Hindi", "English"]);
  p = applyAnswer(p, "systems", "planned");
  const sel = selectionFor(p, "deploy");
  const mid = buildPitch(p, pb, sel, costFor(sel, pb));
  assert.ok(mid.progress > empty.progress);
  assert.ok(mid.sections.length > empty.sections.length);
  assert.match(mid.headline, /Civic/);
  assert.match(mid.sub, /Hindi and English/);
  const md = pitchToMarkdown(mid);
  assert.ok(!/guarantee/i.test(md));
  assert.match(md, /Not a quote/);
});

test("the pitch flags open items", () => {
  let p = applyAnswer(emptyProfile(), "use", ["grievance"]);
  p = applyAnswer(p, "sens", "sensitive");
  const pitch = buildPitch(p, pb, null, null);
  assert.ok(pitch.sections.some((s) => s.id === "confirm" && s.flag === "open"));
});

test("the upgrade path from Deploy lists Connect and Orchestrate with what is added", () => {
  const sel = withWork(presetSelection("deploy"), 5000, 300000);
  const steps = growPath(sel, pb);
  assert.deepEqual(steps.map((x) => x.to), ["connect", "orchestrate"]);
  const toConnect = steps[0];
  assert.ok(toConnect.capsAdded.includes("API integration"));
  assert.ok(toConnect.newUnpriced.some((x) => /Implementation/.test(x)));
  assert.equal(toConnect.deltaKnown, -50000, "the priced setup is replaced by a quote, so the known total falls");
  assert.ok(steps[1].capsAdded.includes("Case creation"));
});

test("a build already at Orchestrate has nowhere further to go", () => {
  assert.equal(growPath(presetSelection("orchestrate"), pb).length, 0);
});

test("a custom build grows from its base", () => {
  const steps = growPath({ ...presetSelection("deploy"), handoff: "ho-live" }, pb);
  assert.deepEqual(steps.map((x) => x.to), ["connect", "orchestrate"]);
});

test("the execution plan grows with the package, and only documented timings are marked documented", () => {
  const d = stagesFor(presetSelection("deploy")).map((s) => s.id);
  const o = stagesFor(presetSelection("orchestrate")).map((s) => s.id);
  assert.ok(!d.includes("connect") && !d.includes("rules"));
  assert.ok(o.includes("connect") && o.includes("rules"));
  const setup = stagesFor(presetSelection("deploy")).find((s) => s.id === "setup")!;
  assert.equal(setup.documented, true);
  assert.match(setup.timing, /2 working days/);
  assert.equal(stagesFor(presetSelection("orchestrate")).find((s) => s.id === "setup")!.documented, false);
  assert.ok(stagesFor({ ...presetSelection("deploy"), channel: "ch-own" }).some((s) => s.id === "tel"));
  assert.ok(stagesFor({ ...presetSelection("deploy"), host: "host-onprem" }).some((s) => s.id === "env"));
});

test("what you bring grows with the package and includes the phone list only for outbound", () => {
  const p = emptyProfile();
  assert.ok(!bringList(presetSelection("deploy"), p).some((b) => b.id === "phones"));
  assert.ok(bringList({ ...presetSelection("deploy"), outbound: true }, p).some((b) => b.id === "phones"));
  assert.ok(bringList(presetSelection("orchestrate"), p).some((b) => b.id === "staff"));
  assert.equal(CHECKS.length, 7);
});

test("the hand-over pack has seven files, valid JSON, and states it is not a quote", () => {
  const p = applyAnswer(emptyProfile(), "use", ["scheme"]);
  const sel = withWork(selectionFor(p, "deploy"), 5000, 100000);
  const cost = costFor(sel, pb);
  const rec = recommend(p);
  const files = handoverFiles({ profile: { ...p, openQuestions: ["Can it run on our servers?"] }, sel, pb, cost, rec, pitch: buildPitch(p, pb, sel, cost, rec) });
  assert.deepEqual(files.map((f) => f.name), ["01-pitch.md", "02-package-and-canvas.md", "03-cost-sheet.md", "04-execution-plan.md", "05-bring-checklist.csv", "06-questions-to-confirm.md", "canvas-config.json"]);
  JSON.parse(files[6].content);
  assert.match(files[2].content, /Not a quote/i);
  assert.match(files[2].content, /5 paise per call/);
  assert.match(files[5].content, /Can it run on our servers\?/);
  assert.match(files[1].content, /Model names are placeholders/);
});

test("the three package cards come straight from the ICP", () => {
  assert.equal(PACKAGE_CARDS.deploy.launch, "Days");
  assert.equal(PACKAGE_CARDS.connect.launch, "Weeks");
  assert.equal(PACKAGE_CARDS.orchestrate.launch, "Weeks to months");
});

test("capsOf always includes the base platform", () => {
  const c = capsOf(presetSelection("deploy"));
  for (const x of ["workflow", "voice", "telephony", "analytics"]) assert.ok(c.includes(x as never));
});

test("the hand-over step mentions a phone list only when the service calls citizens", () => {
  const inbound = stagesFor(presetSelection("deploy")).find((x) => x.id === "bring")!;
  assert.ok(!/phone list/i.test(inbound.plain));
  const outbound = stagesFor({ ...presetSelection("deploy"), outbound: true }).find((x) => x.id === "bring")!;
  assert.match(outbound.plain, /phone list with permission to call/);
});

test("typed figures raise the grand total but never the known total", () => {
  const s = { ...withWork(presetSelection("orchestrate"), 1000), figures: { setup: 100000 } };
  const c = costFor(s, pb);
  assert.equal(c.adopter, 100000);
  assert.equal(c.grand, c.knownTotal + 100000);
  assert.ok(c.knownTotal < c.grand);
});
