import type {
  ApplicationDef,
  IntegrationEntry,
  PackageId,
  ScenarioDef,
  ScenarioStep,
} from "./types";
import { isBlank } from "./config-schema";

/**
 * Local conversation simulation.
 *
 * This is a scripted walkthrough built from the adopter's saved configuration.
 * No speech, language model or telephony is involved, and no system is called.
 * It exists so an adopter can check what the agent would say and spot gaps in
 * their configuration. It is NOT the platform's evaluation engine.
 */

export type MsgWho = "agent" | "citizen" | "note";

export interface Msg {
  id: number;
  who: MsgWho;
  text: string;
  tone?: "default" | "warning" | "emergency";
}

export interface RunState {
  scenarioId: string;
  stepId: string;
  transcript: Msg[];
  vars: Record<string, string>;
  observed: string[];
  gaps: string[];
  actions: string[];
  misses: number;
  ended: boolean;
  endedBy?: "script" | "emergency" | "optout" | "handoff";
  nextId: number;
}

export interface SimContext {
  app: ApplicationDef;
  config: Record<string, unknown>;
  integrations: Record<string, IntegrationEntry>;
  packageId: PackageId | null;
}

const PKG_RANK: Record<PackageId, number> = { deploy: 0, connect: 1, orchestrate: 2 };

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

function lower(s: string): string {
  return s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
}

/** Builds every `{{value}}` the scripts may use, from saved config plus choices made so far. */
export function buildValues(ctx: SimContext, vars: Record<string, string>): Record<string, string> {
  const c = ctx.config;
  const dept = str(c.department, "your department");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  Object.assign(out, vars);
  out.department = dept;

  const interpolateOnce = (t: string) =>
    t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in out && !/\{\{/.test(out[k] ?? "") ? out[k] : k === "department" ? dept : m));
  for (const k of ["greeting", "consentNotice", "purpose", "emergencyNotice", "handoffOutside"]) {
    if (out[k]) out[k] = interpolateOnce(out[k]);
  }

  // Grievance
  const cats = rows(c.categories);
  const cat = cats.find((r) => str(r.name).toLowerCase() === (vars.category ?? "").toLowerCase()) ?? cats[0];
  out.sla = cat && Number(cat.sla) > 0 ? String(cat.sla) : "48";
  out.ref = `${str(c.referencePrefix, "GRV")}-1042`;

  // Scheme discovery
  const schemes = rows(c.schemes);
  if (schemes.length) {
    const need = words(vars.need ?? "");
    const score = (r: Row) => {
      const hay = words(`${str(r.name)} ${str(r.eligibility)} ${str(r.documents)}`);
      return need.filter((w) => hay.some((h) => h.includes(w) || w.includes(h))).length;
    };
    const pick = [...schemes].sort((a, b) => score(b) - score(a))[0];
    out.schemeName = str(pick.name, "a scheme");
    out.schemeEligibility = str(pick.eligibility) ? `It is for: ${lower(str(pick.eligibility)).replace(/\.$/, "")}.` : "";
    out.schemeDocs = str(pick.documents, "no documents listed").replace(/[.\s]+$/, "");
    out.schemeApply = str(pick.apply, "Please ask at the department office.");
  } else {
    out.schemeName = "a scheme";
    out.schemeEligibility = "";
    out.schemeDocs = "no documents listed";
    out.schemeApply = "Please ask at the department office.";
  }
  const qs = rows(c.questions);
  out.q1 = str(qs[0]?.question, "[no question configured]");
  out.q2 = str(qs[1]?.question, "That was the last question.");

  // Form filling
  const fields = rows(c.fields);
  const label = (i: number) => str(fields[i]?.label, `detail ${i + 1}`);
  out.f1 = `Could you tell me ${lower(label(0))}?`;
  out.f2 = `Could you tell me ${lower(label(1))}?`;
  out.rule2 = str(fields[1]?.rule) ? `The rule is: ${str(fields[1]?.rule)}.` : "";
  out.readback = `${label(0)}: ${vars.v1 ?? "(not given)"}. ${label(1)}: ${vars.v2 ?? "(not given)"}.`;
  out.submitLine =
    c.destination === "webhook"
      ? "Your details have been sent."
      : "Your details have been noted, and a member of staff will review them.";
  out.formName = str(c.formName, "this form");

  // Application support
  const stages = rows(c.stages);
  const stage = stages[1] ?? stages[0];
  out.stage = lower(str(stage?.stage, "review"));
  out.stageMeaning = str(stage?.meaning);
  const docs = rows(c.documents);
  out.missingDoc = lower(str(docs[0]?.document, "a required document"));
  out.provideLine = str(docs[0]?.how, "Please check with the office.");
  out.followDays = String(Number(c.followDays) > 0 ? c.followDays : 3);
  if (!out.schemeName || out.schemeName === "a scheme") out.schemeName = str(c.schemeName, out.schemeName);

  // Handoff
  if (str(c.handoffNumber)) {
    out.handoffLine = `I will connect you to a member of staff now and pass on a summary so you do not have to repeat yourself. Staff are available from ${str(c.handoffStart, "10:00")} to ${str(c.handoffEnd, "17:00")}.`;
  } else {
    out.handoffLine = `${out.handoffOutside || "I will note your request and someone will call you back."}`;
  }
  return out;
}

function fill(text: string, values: Record<string, string>, onMissing: (k: string) => void): string {
  let out = text;
  for (let i = 0; i < 3; i++) {
    out = out.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m));
  }
  out = out.replace(/\{\{(\w+)\}\}/g, (_m, k) => {
    onMissing(k);
    return `[${k} not set]`;
  });
  return out;
}

function addUnique(list: string[], item: string) {
  if (!list.includes(item)) list.push(item);
}

function pushMsg(run: RunState, who: MsgWho, text: string, tone?: Msg["tone"]) {
  run.transcript.push({ id: run.nextId++, who, text, tone });
}

function enterStep(run: RunState, ctx: SimContext, scenario: ScenarioDef, stepId: string, prefix?: string) {
  const step: ScenarioStep | undefined = scenario.steps[stepId];
  if (!step) {
    run.ended = true;
    run.endedBy = "script";
    return;
  }
  run.stepId = stepId;
  const values = buildValues(ctx, run.vars);
  const text = fill(step.agent, values, (k) => addUnique(run.gaps, `A value used in the conversation is not set: ${k}.`));
  pushMsg(run, "agent", prefix ? `${prefix} ${text}` : text);

  step.observes?.forEach((o) => addUnique(run.observed, o));
  step.requires?.forEach((r) => {
    if (isBlank(ctx.config[r.key])) addUnique(run.gaps, r.gap);
  });

  if (step.action) {
    const integ = ctx.app.integrations.find((i) => i.id === step.action!.integrationId);
    run.actions.push(step.action.label);
    let note = `Demonstration only. In production this step would: ${lower(step.action.label)}. No system was contacted, so anything it returns here is sample data.`;
    if (integ) {
      const minRank = Math.min(...integ.forPackage.map((p) => PKG_RANK[p]));
      const entry = ctx.integrations[integ.id];
      if (ctx.packageId && PKG_RANK[ctx.packageId] < minRank && integ.need === "required") {
        const needed = integ.forPackage[0];
        addUnique(run.gaps, `This step needs the ${needed[0].toUpperCase()}${needed.slice(1)} package. Your workspace is on ${ctx.packageId[0].toUpperCase()}${ctx.packageId.slice(1)}.`);
        note += ` It is not part of your current package.`;
      } else if (integ.need === "required" && (!entry || entry.status === "not-started")) {
        addUnique(run.gaps, `${integ.name} has not been set up. This step could not run in production yet.`);
      }
      if (integ.platform !== "available" && integ.need === "required") {
        addUnique(run.gaps, `${integ.name}: ${integ.platformNote}`);
      }
    }
    pushMsg(run, "note", note);
  }

  if (stepId === "handoff" || /handoffLine/.test(step.agent)) {
    pushMsg(run, "note", "Demonstration only. No call is transferred.");
    if (isBlank(ctx.config.handoffNumber)) {
      addUnique(run.gaps, "No handoff number is configured, so a citizen who asks for a person would not be transferred.");
    }
    run.endedBy = "handoff";
  }

  if (step.end) {
    run.ended = true;
    run.endedBy = run.endedBy ?? "script";
  }
}

export function startRun(ctx: SimContext, scenario: ScenarioDef): RunState {
  const run: RunState = {
    scenarioId: scenario.id,
    stepId: scenario.start,
    transcript: [],
    vars: {},
    observed: [],
    gaps: [],
    actions: [],
    misses: 0,
    ended: false,
    nextId: 1,
  };
  const langs = Array.isArray(ctx.config.languages) ? (ctx.config.languages as string[]) : [];
  pushMsg(
    run,
    "note",
    `Simulation. Shown in English as text. A real call would be spoken${langs.length ? ` in ${langs.join(", ")}` : ""}, depending on the language the citizen chooses.`,
  );
  enterStep(run, ctx, scenario, scenario.start);
  return run;
}

export function choicesFor(ctx: SimContext, scenario: ScenarioDef, run: RunState) {
  if (run.ended) return [];
  const step = scenario.steps[run.stepId];
  if (!step?.choices) return [];
  const values = buildValues(ctx, run.vars);
  return step.choices.map((c, index) => ({
    index,
    text: fill(c.text, values, () => undefined),
  }));
}

export function chooseOption(ctx: SimContext, scenario: ScenarioDef, prev: RunState, index: number): RunState {
  const run: RunState = structuredClone(prev);
  if (run.ended) return run;
  const step = scenario.steps[run.stepId];
  const choice = step?.choices?.[index];
  if (!choice) return run;
  const values = buildValues(ctx, run.vars);
  pushMsg(run, "citizen", fill(choice.text, values, () => undefined));
  if (choice.set) Object.assign(run.vars, choice.set);
  run.misses = 0;
  enterStep(run, ctx, scenario, choice.to);
  return run;
}

const EMERGENCY = /\b(fire|accident|ambulance|emergency|bleeding|injured|injury|attack|drowning|unconscious|heart attack|suicide|kill)\b/i;
const HUMAN = /\b(person|human|officer|staff|someone|operator|representative|agent|speak to|talk to)\b/i;
const STOP = /(stop calling|do not call|don't call|dont call|remove my number|unsubscribe|leave me alone)/i;
const REPEAT = /\b(repeat|again|pardon|slowly|did not understand|didn't understand|what)\b/i;
const SENSITIVE_SAY = /\b(otp|password|cvv|aadhaar|aadhar|account number|card number|pin number)\b/i;

export function sayFreeText(ctx: SimContext, scenario: ScenarioDef, prev: RunState, text: string): RunState {
  const run: RunState = structuredClone(prev);
  const t = text.trim();
  if (run.ended || !t) return run;
  pushMsg(run, "citizen", t);
  const values = buildValues(ctx, run.vars);
  const step = scenario.steps[run.stepId];

  if (EMERGENCY.test(t)) {
    const notice = str(ctx.config.emergencyNotice, "If anyone is in danger, please hang up and call 112 now.");
    pushMsg(run, "agent", fill(notice, values, () => undefined), "emergency");
    addUnique(run.observed, "Agent redirects emergencies");
    run.ended = true;
    run.endedBy = "emergency";
    return run;
  }
  if (SENSITIVE_SAY.test(t)) {
    pushMsg(
      run,
      "agent",
      "Please stop. I do not need bank details, identity numbers or any one-time code, and you should not share them with anyone on a call.",
      "warning",
    );
    addUnique(run.observed, "Agent interrupts and says it does not need that");
    addUnique(run.observed, "Agent tells the citizen not to share codes or passwords");
    if (step) pushMsg(run, "agent", fill(step.agent, values, () => undefined));
    return run;
  }
  if (STOP.test(t)) {
    if (scenario.steps.optout) {
      enterStep(run, ctx, scenario, "optout");
    } else {
      pushMsg(run, "agent", "Understood. I will not call you again about this. Goodbye.");
      addUnique(run.observed, "Agent honours a request to stop calling");
      run.ended = true;
      run.endedBy = "optout";
    }
    return run;
  }
  if (HUMAN.test(t)) {
    if (scenario.steps.handoff) {
      enterStep(run, ctx, scenario, "handoff");
    } else {
      pushMsg(run, "agent", fill("{{handoffLine}}", values, () => undefined));
      pushMsg(run, "note", "Demonstration only. No call is transferred.");
      addUnique(run.observed, "Agent offers a person when asked");
      if (isBlank(ctx.config.handoffNumber)) {
        addUnique(run.gaps, "No handoff number is configured, so a citizen who asks for a person would not be transferred.");
      }
      run.ended = true;
      run.endedBy = "handoff";
    }
    return run;
  }
  if (REPEAT.test(t) && step) {
    pushMsg(run, "agent", fill(step.agent, values, () => undefined));
    addUnique(run.observed, "Agent repeats information when asked");
    return run;
  }

  // Not understood.
  run.misses += 1;
  addUnique(run.observed, "Agent handles an unclear answer");
  if (run.misses >= 3 && scenario.steps.handoff) {
    pushMsg(run, "agent", "I am sorry, I am still not following. I will connect you to a person.");
    addUnique(run.observed, "Agent offers a person after repeated failure");
    enterStep(run, ctx, scenario, "handoff");
    return run;
  }
  if (run.misses === 2) {
    pushMsg(run, "agent", "I am sorry, I did not catch that again. You can tap one of the answers, or say 'person' if you would like to speak to someone.");
    addUnique(run.observed, "Agent offers a person after repeated failure");
    return run;
  }
  pushMsg(run, "agent", `I am sorry, I did not catch that. ${step ? fill(step.agent, values, () => undefined) : ""}`);
  return run;
}

/** What the run covered, and what it did not. */
export function coverage(scenario: ScenarioDef, run: RunState) {
  const seen = scenario.expects.filter((e) => run.observed.includes(e));
  const missed = scenario.expects.filter((e) => !run.observed.includes(e));
  return { seen, missed };
}
