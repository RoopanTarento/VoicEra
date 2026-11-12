import { schemeDiscovery } from "../apps/scheme-discovery";
import { PLATINUM, isDocumentedLanguage } from "./source";
import { emptyAnswers } from "./usecases";
import { setValue } from "./answers";
import type { Answers } from "./types";

/**
 * Scheme Discovery proof-of-concept builder.
 *
 * The package asks the department to bring a conversation script flow and a basic knowledge
 * base. This turns a department's own scheme details into both, inside the documented limits:
 * up to 10 text files, up to 5 MB each. Nothing here is invented about the department's
 * schemes. Everything generated comes from what the person types, and the worked example is
 * clearly labelled as made-up.
 */

export interface PocScheme {
  id: string;
  name: string;
  summary: string;
  eligibility: string;
  documents: string;
  howToApply: string;
  deadline: string;
}

export interface QualifyingQuestion {
  id: string;
  question: string;
  why: string;
  custom?: boolean;
}

export interface PocData {
  department: string;
  /** Languages the conversation runs in. */
  languages: string[];
  /** Language the knowledge text is written in. */
  kbLanguage: string;
  agentName: string;
  schemes: PocScheme[];
  questions: QualifyingQuestion[];
  intro: string;
  holdMessage: string;
  notSure: string;
  noMatch: string;
  closing: string;
  noiseCancellation: boolean;
  example: boolean;
}

export const QUESTION_TEMPLATES: QualifyingQuestion[] = [
  { id: "t-age", question: "Could you tell me your age?", why: "Many schemes have an age range." },
  { id: "t-residence", question: "Do you live in a village or a town or city?", why: "Some schemes are for rural or urban residents only." },
  { id: "t-occupation", question: "What work do you do?", why: "Some schemes are for farmers, workers or the self-employed." },
  { id: "t-land", question: "Do you own the land you farm, or farm someone else's land?", why: "Some farming schemes depend on ownership." },
  { id: "t-income", question: "Roughly, is your household income below a certain level set by the scheme?", why: "Some schemes have an income limit. Replace this with the exact limit." },
  { id: "t-family", question: "Do you have children in school?", why: "Some schemes are tied to children's education." },
  { id: "t-category", question: "Is anyone in your household registered under a specific category the scheme covers?", why: "Some schemes cover a defined group. Replace this with the exact category." },
];

export function emptyPoc(): PocData {
  return {
    department: "",
    languages: ["English", "Hindi"],
    kbLanguage: "English",
    agentName: "",
    schemes: [],
    questions: [],
    intro: "Hello, this is the {{department}} assistant. I can tell you about schemes that may help you.",
    holdMessage: "One moment please, I am looking that up.",
    notSure: "I am not able to tell for certain from what I have. A person at the office can confirm this for you.",
    noMatch: "I do not have a scheme that matches that. A person at the office may be able to help.",
    closing: "Thank you for calling. Goodbye.",
    noiseCancellation: true,
    example: false,
  };
}

/** A made-up example so a first-time user can see the whole flow in a minute. Clearly labelled as sample. */
export function samplePoc(): PocData {
  return {
    ...emptyPoc(),
    department: "Sample Agriculture Department",
    example: true,
    languages: ["English", "Hindi"],
    kbLanguage: "English",
    agentName: "the Sample Agriculture Department assistant",
    schemes: [
      {
        id: "s1",
        name: "Farmer Input Support (sample)",
        summary: "Help with the cost of seeds and fertiliser.",
        eligibility: "Landowning farmers with up to five acres.",
        documents: "Land record, bank passbook.",
        howToApply: "At the block agriculture office or on the scheme portal.",
        deadline: "",
      },
      {
        id: "s2",
        name: "Senior Citizen Pension (sample)",
        summary: "A monthly pension for older residents.",
        eligibility: "Residents aged 60 and above who receive no other pension.",
        documents: "Age proof, residence proof.",
        howToApply: "At the ward or panchayat office.",
        deadline: "",
      },
    ],
    questions: [QUESTION_TEMPLATES[3], QUESTION_TEMPLATES[0]],
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(sample\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "scheme";

/* ---------------- validation ---------------- */

export interface PocIssue {
  step: "basics" | "schemes" | "questions" | "voice";
  field: string;
  message: string;
  blocking: boolean;
}

export function validatePoc(p: PocData): PocIssue[] {
  const out: PocIssue[] = [];
  if (p.department.trim().length < 3) out.push({ step: "basics", field: "department", message: "Enter your department or organisation name.", blocking: true });
  if (p.languages.length === 0) out.push({ step: "basics", field: "languages", message: "Choose at least one language.", blocking: true });
  const bad = p.languages.filter((l) => !isDocumentedLanguage(l));
  if (bad.length) out.push({ step: "basics", field: "languages", message: `${bad.join(", ")} is not in the documented list, so it needs verifying.`, blocking: false });
  if (!isDocumentedLanguage(p.kbLanguage)) out.push({ step: "basics", field: "kbLanguage", message: "Knowledge text must be in a documented language.", blocking: false });
  if (p.schemes.length === 0) out.push({ step: "schemes", field: "schemes", message: "Add at least one scheme.", blocking: true });
  p.schemes.forEach((s, i) => {
    const n = i + 1;
    if (s.name.trim().length < 3) out.push({ step: "schemes", field: `schemes.${i}.name`, message: `Scheme ${n}: enter a name.`, blocking: true });
    if (s.eligibility.trim().length < 10) out.push({ step: "schemes", field: `schemes.${i}.eligibility`, message: `Scheme ${n}: say who it is for, in at least a sentence.`, blocking: true });
    if (!s.howToApply.trim()) out.push({ step: "schemes", field: `schemes.${i}.howToApply`, message: `Scheme ${n}: say how to apply.`, blocking: true });
    if (!s.documents.trim()) out.push({ step: "schemes", field: `schemes.${i}.documents`, message: `Scheme ${n}: list the documents needed, or write "none".`, blocking: false });
  });
  const dup = new Set<string>();
  p.schemes.forEach((s, i) => {
    const k = s.name.trim().toLowerCase();
    if (k && dup.has(k)) out.push({ step: "schemes", field: `schemes.${i}.name`, message: `Scheme ${i + 1}: this name is used twice.`, blocking: true });
    dup.add(k);
  });
  if (p.questions.length === 0) out.push({ step: "questions", field: "questions", message: "Pick at least one question the agent should ask. Without one it cannot narrow anything down.", blocking: false });
  p.questions.forEach((q, i) => {
    if (q.question.trim().length < 8) out.push({ step: "questions", field: `questions.${i}`, message: `Question ${i + 1} is too short to be a question.`, blocking: true });
  });
  if (p.intro.trim().length < 20) out.push({ step: "voice", field: "intro", message: "The introduction needs at least a sentence.", blocking: true });
  if (p.closing.trim().length < 5) out.push({ step: "voice", field: "closing", message: "Add a closing line.", blocking: true });
  return out;
}

export const hasBlocking = (p: PocData) => validatePoc(p).some((i) => i.blocking);

/* ---------------- script ---------------- */

export interface ScriptBlock {
  id: string;
  title: string;
  who: "agent" | "note";
  text: string;
}

const fill = (t: string, p: PocData) => t.replace(/\{\{department\}\}/g, p.department.trim() || "the department");

export function generateScript(p: PocData): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  blocks.push({ id: "intro", title: "Introduction", who: "agent", text: fill(p.intro, p) });
  blocks.push({
    id: "notice",
    title: "Notice before anything is collected",
    who: "agent",
    text: `This is an automated assistant for ${p.department.trim() || "the department"}. Your call may be recorded. You can ask for a person at any time.`,
  });
  blocks.push({ id: "need", title: "Understand the need", who: "agent", text: "What do you need help with? You can describe it in your own words." });
  p.questions.forEach((q, i) => blocks.push({ id: `q${i}`, title: `Question ${i + 1}`, who: "agent", text: q.question }));
  blocks.push({
    id: "match",
    title: "Explain a matching scheme",
    who: "agent",
    text: "Based on what you said, [scheme name] may apply to you. It is for [who it is for]. You may need [documents]. Would you like to hear how to apply?",
  });
  blocks.push({ id: "apply", title: "How to apply", who: "agent", text: "[How to apply, from the scheme details]. Would you like a reminder call?" });
  blocks.push({ id: "hold", title: "Hold message", who: "agent", text: p.holdMessage });
  blocks.push({ id: "unsure", title: "When it cannot tell", who: "agent", text: p.notSure });
  blocks.push({ id: "nomatch", title: "When no scheme matches", who: "agent", text: p.noMatch });
  blocks.push({ id: "closing", title: "Closing", who: "agent", text: p.closing });
  blocks.push({
    id: "note",
    title: "Languages",
    who: "note",
    text: `Wording above is written once. Have it translated and approved for: ${p.languages.join(", ") || "your languages"}. The package detects the speaker's language and can switch mid-call.`,
  });
  return blocks;
}

export function scriptAsText(p: PocData): string {
  const lines = [`Conversation script flow: ${p.department || "Department"}`, `Use case: Scheme discovery`, ""];
  for (const b of generateScript(p)) {
    lines.push(`[${b.title}]`, b.text, "");
  }
  lines.push("Review and approve this script before setup. Square brackets mean the agent fills in details from the knowledge base.");
  return lines.join("\n");
}

/* ---------------- knowledge files ---------------- */

export interface KbFile {
  name: string;
  content: string;
  bytes: number;
  kind: "overview" | "schemes" | "faq" | "limits";
}

const bytesOf = (s: string) => new TextEncoder().encode(s).length;

function schemeBlock(s: PocScheme): string {
  const L = [`Scheme: ${s.name.trim()}`];
  if (s.summary.trim()) L.push(`What it offers: ${s.summary.trim()}`);
  L.push(`Who it is for: ${s.eligibility.trim()}`);
  L.push(`Documents needed: ${s.documents.trim() || "None listed"}`);
  L.push(`How to apply: ${s.howToApply.trim()}`);
  if (s.deadline.trim()) L.push(`Last date: ${s.deadline.trim()}`);
  return L.join("\n");
}

/** Builds text knowledge files that stay inside the package limits. Returns the files and any limit problems. */
export function generateKnowledgeFiles(p: PocData): { files: KbFile[]; problems: string[] } {
  const problems: string[] = [];
  const dept = p.department.trim() || "the department";
  const head = `Department: ${dept}\nLanguage of this file: ${p.kbLanguage}\n`;
  const files: KbFile[] = [];
  const add = (name: string, content: string, kind: KbFile["kind"]) => files.push({ name, content, bytes: bytesOf(content), kind });

  const schemes = p.schemes.filter((s) => s.name.trim());
  add(
    "00-scheme-list.txt",
    `${head}\nSchemes covered by this service\n\n${schemes.map((s, i) => `${i + 1}. ${s.name.trim()}${s.summary.trim() ? `: ${s.summary.trim()}` : ""}`).join("\n")}\n\nIf a citizen asks about a scheme that is not on this list, say you do not have information about it and offer a person at the office.\n`,
    "overview",
  );

  // Reserve two files (list + FAQ/limits). Group the rest so the total never passes the limit.
  const max = PLATINUM.limits.maxKnowledgeFiles.value;
  const detailSlots = Math.max(1, max - 3);
  const perFile = Math.max(1, Math.ceil(schemes.length / detailSlots));
  for (let i = 0; i < schemes.length; i += perFile) {
    const group = schemes.slice(i, i + perFile);
    const name = group.length === 1 ? `scheme-${slug(group[0].name)}.txt` : `schemes-part-${Math.floor(i / perFile) + 1}.txt`;
    add(name, `${head}\n${group.map(schemeBlock).join("\n\n---\n\n")}\n`, "schemes");
  }

  const faq: string[] = [`${head}\nCommon questions and approved answers`, ""];
  for (const s of schemes) {
    faq.push(`Q: Who can get ${s.name.trim()}?`, `A: ${s.eligibility.trim()}`, "");
    faq.push(`Q: What documents do I need for ${s.name.trim()}?`, `A: ${s.documents.trim() || "No documents are listed."}`, "");
    faq.push(`Q: How do I apply for ${s.name.trim()}?`, `A: ${s.howToApply.trim()}`, "");
    if (s.deadline.trim()) faq.push(`Q: What is the last date for ${s.name.trim()}?`, `A: ${s.deadline.trim()}`, "");
  }
  add("90-common-questions.txt", faq.join("\n"), "faq");

  add(
    "99-what-the-agent-must-not-do.txt",
    `${head}\nLimits of this service\n\n- The service explains schemes from the information in these files only.\n- It does not check a citizen's records, decide eligibility, or submit an application.\n- If the information is not in these files, say so. ${p.notSure}\n- If a citizen asks for a person, offer a person at the office.\n- If someone says they are in danger, tell them to call 112. This service cannot send help.\n`,
    "limits",
  );

  const maxMB = PLATINUM.limits.maxKnowledgeFileMB.value;
  if (files.length > max) problems.push(`${files.length} files is more than the ${max}-file limit.`);
  for (const f of files) if (f.bytes > maxMB * 1024 * 1024) problems.push(`${f.name} is over ${maxMB} MB.`);
  if (!isDocumentedLanguage(p.kbLanguage)) problems.push(`${p.kbLanguage} is not a documented knowledge-base language.`);
  return { files, problems };
}

/* ---------------- connect to the rest of the experience ---------------- */

/** Config for the existing Scheme Discovery workspace and conversation simulation. */
export function pocToWorkspaceConfig(p: PocData): Record<string, unknown> {
  const cfg: Record<string, unknown> = JSON.parse(JSON.stringify(schemeDiscovery.defaults));
  cfg.department = p.department.trim() || "the department";
  cfg.languages = p.languages;
  if (p.agentName.trim()) cfg.agentName = p.agentName.trim();
  cfg.greeting = fill(p.intro, p);
  cfg.schemes = p.schemes
    .filter((s) => s.name.trim())
    .map((s) => ({ name: s.name.trim(), eligibility: s.eligibility.trim(), documents: s.documents.trim(), apply: s.howToApply.trim() }));
  cfg.questions = p.questions.map((q) => ({ question: q.question.trim(), why: q.why }));
  cfg.notSure = p.notSure;
  cfg.noMatchLine = p.noMatch;
  return cfg;
}

/** Pre-fills the advisor so a department that has built a PoC does not answer the same things twice. */
export function pocToAnswers(p: PocData, base: Answers | null): Answers {
  let a = base ?? emptyAnswers();
  const put = (id: string, v: unknown) => {
    a = setValue(a, id, v, "interpreted");
  };
  const { files } = generateKnowledgeFiles(p);
  put("objective", "scheme-discover");
  if (p.department.trim()) put("department", p.department.trim());
  put("eligibilityMode", "rules");
  put("languages", p.languages);
  // The script is generated, not yet approved. Say so rather than claiming it is ready.
  put("scriptStatus", "draft");
  put("kbStatus", "unapproved");
  put("kbFiles", { count: files.length, maxMB: Math.max(0.01, Math.round((Math.max(...files.map((f) => f.bytes)) / 1024 / 1024) * 100) / 100), formats: ["Text"] });
  put("schemeScope", p.schemes.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), audience: s.eligibility.trim().slice(0, 80) })));
  return a;
}

export function pocProgress(p: PocData) {
  const issues = validatePoc(p);
  const blocking = issues.filter((i) => i.blocking).length;
  return {
    blocking,
    ready: blocking === 0,
    schemeCount: p.schemes.length,
    questionCount: p.questions.length,
  };
}
