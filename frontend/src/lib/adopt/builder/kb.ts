import { LANGUAGES, LIMITS, NOT_IN_PACKAGE, STILL_OPEN, TELEPHONY_PARTNERS_SAMPLE, TELEPHONY_TECH, PACKAGE_CARDS } from "./catalog";
import { DOCUMENT_PRICES, inr, rate, type PriceBook } from "./pricing";
import type { Profile } from "./profile";

/**
 * The adopter's own questions, answered from the documents.
 * This is a curated set matched on keywords. It is not a language model and never makes anything up:
 * if no entry matches, the question is kept on a list for the VoicERA team.
 */

export interface KbContext {
  pb: PriceBook;
  profile: Profile;
}

export interface KbEntry {
  id: string;
  q: string;
  /** Groups of words. A group is satisfied when any of its words appears. */
  any: string[][];
  /** How many groups must be satisfied. */
  need: number;
  a: (c: KbContext) => string[];
  /** Where the answer comes from. */
  src: string;
  /** Other entries worth offering next. */
  follow?: string[];
  /** A broad answer that should lose a tie to a more specific one. */
  generic?: boolean;
}

const D = PACKAGE_CARDS;

export const KB: KbEntry[] = [
  { id: "what", q: "What is VoicERA?", any: [["voicera", "voice era", "voicera"], ["what is", "what's", "about", "explain", "tell me"]], need: 2, src: "ICP", generic: true,
    a: () => ["VoicERA is the open, sovereign conversational layer that lets a government turn citizen conversations into actions across the systems it already uses.", "Citizens talk to it by phone or browser in their own language. You supply the content and rules, and where needed connect the system you run. It does not replace your systems."], follow: ["packages", "which"] },
  { id: "packages", q: "What are the three packages?", any: [["package", "packages", "tier", "plans"], ["three", "3", "difference", "different", "compare", "deploy", "connect", "orchestrate", "options"]], need: 2, src: "ICP",
    a: () => [`They are one platform at three depths of integration. ${D.deploy.name}: ${D.deploy.integration.toLowerCase()}, typically ${D.deploy.launch.toLowerCase()}. ${D.connect.name}: ${D.connect.integration.toLowerCase()}, typically ${D.connect.launch.toLowerCase()}. ${D.orchestrate.name}: ${D.orchestrate.integration.toLowerCase()}, typically ${D.orchestrate.launch.toLowerCase()}.`, "Timings are typical ranges, not commitments."], follow: ["which", "upgrade"] },
  { id: "which", q: "Which package should I choose?", any: [["which", "choose", "pick", "right", "best", "recommend", "suit", "need"], ["package", "plan", "one"]], need: 2, src: "ICP", generic: true,
    a: () => ["It comes down to how far VoicERA must connect into your own systems. Information, FAQs, scheme discovery and surveys need little or no connection, which is Deploy. Forms and application status need an API, which is Connect. Grievances filed and tracked in your system need the full workflow, which is Orchestrate.", "Answer my questions and I will show which one fits you, and why."], follow: ["grievance", "scheme", "upgrade"] },
  { id: "grievance", q: "Which package suits grievances?", any: [["grievance", "complaint", "complaints"], ["package", "which", "need", "suit", "orchestrate", "handle"]], need: 2, src: "ICP",
    a: () => [`${D.orchestrate.name}. The ICP places grievances there because VoicERA takes the complaint, asks follow-up questions, classifies and routes it, creates the case in your system, follows up and confirms it was resolved.`, "If you have no system to file into yet, VoicERA can still take the complaint and capture it for your staff, and you can move up when your system is ready. That intake-only version is not one of the two use cases the package document names, so confirm it with the team."], follow: ["upgrade", "integration"] },
  { id: "scheme", q: "Which package suits scheme discovery?", any: [["scheme", "schemes", "welfare", "discovery"], ["package", "which", "need", "suit"]], need: 2, src: "ICP + PKG",
    a: () => [`${D.deploy.name}. Scheme discovery is a documented use case, inbound and outbound. VoicERA asks a few questions and names the schemes that may apply, from your approved files, then explains documents and where to apply.`], follow: ["bring", "cost"] },
  { id: "survey", q: "Which package suits surveys and feedback?", any: [["survey", "surveys", "feedback", "poll"], ["package", "which", "need", "suit", "outbound", "call"]], need: 2, src: "ICP + PKG",
    a: () => [`${D.deploy.name}. Surveys are a documented use case, suited for outbound calls. Answers are captured as a table you can download, with a dashboard of how the calls went.`], follow: ["outbound", "cost"] },
  { id: "forms", q: "Which package suits forms and application status?", any: [["form", "forms", "application", "applications", "status", "track"], ["package", "which", "need", "suit", "api"]], need: 2, src: "ICP",
    a: () => [`${D.connect.name}. VoicERA collects fields and checks them, sends structured data to your form or API, and looks up status in your system. It needs an endpoint that can accept and return data, an IT security review and a test environment.`], follow: ["integration", "upgrade"] },
  { id: "languages", q: "Which languages are supported?", any: [["language", "languages", "hindi", "tamil", "telugu", "marathi", "bengali", "regional", "indian", "multilingual", "code mixed", "code-mixed"]], need: 1, src: "PKG",
    a: () => [`The package document lists ${LANGUAGES.length}: ${LANGUAGES.join(", ")}. A caller can switch language in the middle of a call.`, "Other languages are not in the document, so they need confirming. How well each model handles each language is shown in a Voice Arena report that has not been supplied, so test your own languages."], follow: ["quality", "models"] },
  { id: "telephony", q: "How does telephony work?", any: [["telephony", "phone", "number", "numbers", "sip", "carrier", "provider", "dial", "line"]], need: 1, src: "PKG",
    a: () => [`VoicERA can give you a number through its telephony partners. The document lists these as samples: ${TELEPHONY_PARTNERS_SAMPLE.join(", ")}. The technologies are ${TELEPHONY_TECH.join(", ")}.`, `You can instead use your own provider and numbers. That is documented as ${LIMITS.ownTelephonyWeeks[0]} to ${LIMITS.ownTelephonyWeeks[1]} weeks, case by case.`, `A phone number costs ${inr(DOCUMENT_PRICES.perNumber)} in the package document.`], follow: ["ownprovider", "cost"] },
  { id: "ownprovider", q: "Can I use my own telephony provider?", any: [["own", "existing", "our"], ["telephony", "provider", "numbers", "carrier", "sim"]], need: 2, src: "PKG",
    a: () => [`Yes. It is documented as ${LIMITS.ownTelephonyWeeks[0]} to ${LIMITS.ownTelephonyWeeks[1]} weeks, case by case. No price is given for it, so the builder shows it as not set.`, "Ask who bills the line and which technology it uses: SIP trunk, Cloud SIP or WebSocket."] },
  { id: "glossary", q: "What do STT, ASR, LLM, TTS and RAG mean?", any: [["stt", "asr", "tts", "llm", "rag", "jargon", "acronym", "term", "terms", "mean", "means", "meaning"]], need: 1, src: "OURS",
    a: () => ["Listening is speech recognition, called STT or ASR: it turns the citizen's speech into text.", "Thinking is the language model, called an LLM: it decides what the citizen means and what to say.", "Speaking is text to speech, called TTS: it turns the answer back into a voice.", "RAG, or the knowledge base, looks up the right passage in your approved documents before the model answers, so it answers from your content and not from memory."], follow: ["models", "why-llm"] },
  { id: "models", q: "Which AI models do you offer?", any: [["model", "models", "openai", "gemma", "llama", "qwen", "sarvam", "ai4bharat", "chirp", "eleven", "bodhan", "bhashini", "raya", "stt", "tts", "llm", "asr"]], need: 1, src: "PKG + ICP",
    a: () => ["The package document lists these as samples, not a final list. Listening: AI4Bharat, Sarvam, Eleven Labs. Thinking: Gemma, Llama, Qwen, OpenAI. Speaking: AI4Bharat, Bodhan, Sarvam, Google Chirp. The ICP also names BHASHINI and Raya as providers.", "You can also bring your own: the platform supports custom OpenAI-compatible endpoints and self-hosted models. The actual list of options is to be confirmed by the VoicERA team."], follow: ["why-llm", "byo", "modelcost"] },
  { id: "why-llm", q: "Why would I choose a commercial model like OpenAI?", any: [["why", "when", "should"], ["openai", "gpt", "commercial", "proprietary", "llm", "model"]], need: 2, src: "OURS",
    a: () => ["Open-source models are covered by the standard price and are a sound start when the agent answers from your own documents, which is the case for scheme discovery, helplines and surveys.", "Teams reach for a commercial model when conversations are open-ended, such as a citizen describing a complaint in their own messy words, and they want the strongest understanding at extra cost. It is not a given: compare both on recordings of your own callers first.", "The package document gives no price for commercial models and does not say where data goes when one is used. Both are to be confirmed."], follow: ["modelcost", "byo"] },
  { id: "byo", q: "What if I bring my own model or API?", any: [["own", "bring", "byo", "custom", "self", "hosted", "our"], ["model", "api", "llm", "endpoint", "key"]], need: 2, src: "ICP",
    a: (c) => ["The ICP says the platform connects multiple model providers, including custom OpenAI-compatible endpoints and self-hosted models, and that you can switch components without lock-in.", `You pay your own provider directly, and you enter that cost on the canvas so it appears in your total, labelled as yours. VoicERA's fee for connecting it is ${c.pb.ownFee === null ? "not defined yet, so it is shown as open" : `${rate(c.pb.ownFee, c.pb.usageUnit)}`}.`], follow: ["modelcost"] },
  { id: "cost", q: "What does it cost?", any: [["cost", "price", "pricing", "how much", "pay", "fee", "charge", "rate", "expensive", "cheap", "budget"]], need: 1, src: "PKG + provider",
    a: (c) => [`Three prices are set. One-time setup: ${inr(c.pb.setup.deploy)}. Each phone number: ${inr(c.pb.perNumber)}. Usage: ${rate(c.pb.usageRate, c.pb.usageUnit)}, which covers the platform, the phone line and open-source models.`, c.pb.usageUnit === "call" && c.pb.usageRate !== null && c.pb.usageRate !== DOCUMENT_PRICES.openPerMinute ? `The package document had ${inr(DOCUMENT_PRICES.openPerMinute)} a minute. VoicERA has since set the usage price to ${rate(c.pb.usageRate, c.pb.usageUnit)}.` : "", "Commercial models, bringing your own model, and the Connect and Orchestrate implementation have no price yet, so they show as not set. No tax or other charge is added."].filter(Boolean), follow: ["modelcost", "upgrade"] },
  { id: "modelcost", q: "What does each model cost?", any: [["model", "models", "openai", "llm", "stt", "tts"], ["cost", "price", "pricing", "how much", "expensive", "charge"]], need: 2, src: "PKG",
    a: (c) => [`Open-source models are covered by the standard usage price of ${rate(c.pb.usageRate, c.pb.usageUnit)}. Choosing one costs nothing extra.`, "Commercial models, and models the documents list without detail, are priced separately. The package document says the pricing depends on the model and does not give a table, so each shows as not set until VoicERA sets a price.", "On the canvas, every option shows what it does to your cost in a few words."], follow: ["why-llm", "byo"] },
  { id: "bring", q: "What do I need to bring?", any: [["bring", "need", "require", "prepare", "ready", "provide", "supply"], ["bring", "from us", "department", "you need", "i need", "we need", "provide"]], need: 1, src: "PKG + ICP",
    a: () => ["Approved content: scheme details, FAQs or the survey questions. A script flow. A phone list with permission to call, for outbound campaigns. A named person who approves what the agent may say. People to test calls before launch.", "For Connect and Orchestrate you also bring API documentation, a test environment and credentials through your IT team, and for grievances your categories, routing and service levels."], follow: ["timeline", "deploy-steps"] },
  { id: "timeline", q: "How long does it take to go live?", any: [["how long", "time", "timeline", "launch", "live", "weeks", "days", "months", "quickly", "when", "duration"]], need: 1, src: "ICP + PKG",
    a: () => [`Typical ranges: ${D.deploy.name} ${D.deploy.launch.toLowerCase()}, ${D.connect.name} ${D.connect.launch.toLowerCase()}, ${D.orchestrate.name} ${D.orchestrate.launch.toLowerCase()}. They are not commitments: your approvals, integration access and content review set the real date.`, `For the packaged offer, the voice agent is set up in ${LIMITS.setupDays} working days after all requirements are provided. Using your own telephony adds ${LIMITS.ownTelephonyWeeks[0]} to ${LIMITS.ownTelephonyWeeks[1]} weeks.`], follow: ["deploy-steps"] },
  { id: "upgrade", q: "Can I upgrade later?", any: [["upgrade", "upgrading", "move up", "grow", "scale up", "later", "expand", "switch package", "change package", "start small", "progressive"]], need: 1, src: "ICP",
    a: () => ["Yes. The three packages are the same platform at different depths, so you start where your systems are today and move up when you are ready to connect more. Nothing is thrown away: the content, languages and telephony stay.", "The Grow step shows what you gain, what you must bring, and how the price would change at each step."], follow: ["packages", "cost"] },
  { id: "storage", q: "Where is call data stored?", any: [["data", "recording", "recordings", "transcript", "stored", "storage", "retention", "retain", "keep", "kept", "delete", "residency"]], need: 1, src: "PKG (open)",
    a: () => ["The package document leaves three answers blank: where call data is stored, whether it is used to train models, and how long it is kept. I cannot answer them from the documents.", "They go on your list of questions to confirm with the VoicERA team before launch. The ICP lists governance controls such as access control, audit trails, data controls and retention, which you should ask about by name."], follow: ["security", "hosting"] },
  { id: "security", q: "What about security and access control?", any: [["security", "secure", "access", "rbac", "audit", "role", "permission", "privacy", "dpdp", "compliance", "compliant", "safe"]], need: 1, src: "ICP",
    a: () => ["The ICP lists governance as part of the platform: role-based access, audit trails, data controls, retention and deployment controls. It does not give detail, and the package document does not describe them, so ask the VoicERA team to confirm each for your package.", "Compliance with data-protection law cannot be claimed from these documents. It is shown through contract, configuration and evidence, and the department stays accountable as the data fiduciary."], follow: ["storage", "hosting"] },
  { id: "hosting", q: "Where does it run? Can it run on our servers?", any: [["host", "hosting", "hosted", "cloud", "server", "servers", "premise", "on-prem", "onprem", "infrastructure", "sovereign", "data centre", "data center", "machine"]], need: 1, src: "PKG + ICP",
    a: () => ["The package document describes one option: hosted on Bhashini and billed to Bhashini.", "The ICP lists government cloud, private cloud, on-premise and sovereign or open-model environments as deployment options. The package document does not describe them, so whether the platform can be installed on your own infrastructure, and at what cost, is to be confirmed in writing."], follow: ["storage"] },
  { id: "handoff", q: "Can it pass a call to a person?", any: [["human", "person", "transfer", "handoff", "hand off", "escalat", "callback", "call back"]], need: 1, src: "ICP",
    a: () => ["Yes, at Orchestrate: the call is handed to a named person with the conversation attached. Below that, the agent can offer a staff callback or point to an office.", "Orchestrate needs named staff who take handoffs and the hours they are available."], follow: ["emergency"] },
  { id: "integration", q: "Can it connect to our existing systems?", any: [["integrat", "connect", "api", "webhook", "system", "systems", "portal", "database", "crm", "ticketing", "existing"]], need: 1, src: "ICP + PKG",
    a: () => ["Yes. Connect reads and writes through an API or webhook. Orchestrate connects the full workflow: routing, case creation and resolution tracking.", "The priced package offer does not include custom integration with department systems. That is separate work, scoped with you, and the documents give no price for it."], follow: ["upgrade", "forms"] },
  { id: "whatsapp", q: "Does it work on WhatsApp?", any: [["whatsapp", "sms", "telegram", "chat"]], need: 1, src: "PKG",
    a: () => ["WhatsApp calling is out of scope for the package. VoicERA works by phone or in a browser."] },
  { id: "emergency", q: "Can it handle emergencies?", any: [["emergency", "emergencies", "danger", "life", "urgent", "112", "ambulance", "police"]], need: 1, src: "ICP",
    a: () => ["No. Emergency and life-safety calls are out of scope. VoicERA cannot send help. The agent should point callers in danger to 112, and you should test that it does."] },
  { id: "scale", q: "How many calls can it handle?", any: [["scale", "capacity", "concurrent", "simultaneous", "volume", "latency", "uptime", "speed", "fast", "peak", "limit"]], need: 1, src: "PKG",
    a: () => [`For the packaged offer: up to ${LIMITS.concurrent} concurrent calls, a response-time target under ${LIMITS.latency} seconds, and ${LIMITS.uptime}% uptime as stated in the document.`, "The response time is a target, not a guarantee for every call. Limits for Connect and Orchestrate are not stated separately, so confirm them for your build."] },
  { id: "support", q: "What support do I get?", any: [["support", "sla", "operator", "programme manager", "troubleshoot", "maintenance", "managed operations"]], need: 1, src: "PKG",
    a: () => [`The package document includes one dedicated campaign operator and a shared programme manager, set-up in ${LIMITS.setupDays} working days after requirements are provided, ${LIMITS.troubleshootHours}-hour support to troubleshoot an issue, a post-campaign analysis within ${LIMITS.analysisDays} working days, and campaign set-up and monitoring support up to ${LIMITS.campaignsPerMonth} a month.`] },
  { id: "analytics", q: "What will I see on the dashboard?", any: [["dashboard", "analytics", "report", "reports", "metrics", "insight", "monitor", "monitoring", "results"]], need: 1, src: "PKG",
    a: () => ["Number of campaigns, calls overall and per campaign, calls split by attempted, connected, dropped and completed, average call length, and for surveys the answers as a downloadable table."] },
  { id: "kb", q: "How does the knowledge base work?", any: [["knowledge", "kb", "rag", "documents", "files", "content", "upload", "faq", "faqs"]], need: 1, src: "PKG",
    a: () => [`It answers from your approved documents, not from memory. The package document allows up to ${LIMITS.kbFiles} text files of up to ${LIMITS.kbMB} MB each.`, "Keeping the files up to date is your team's job. Larger or non-text files need a separate conversation."], follow: ["glossary", "bring"] },
  { id: "outbound", q: "What does an outbound campaign need?", any: [["outbound", "campaign", "campaigns", "call out", "reminder", "reminders", "consent", "dnd", "do not disturb", "permission"]], need: 1, src: "PKG + ICP",
    a: () => ["A phone list from you and permission to call it, which is yours to confirm. The ICP lists outbound compliance controls as a feature to confirm for your package.", `Campaign set-up and monitoring support is included up to ${LIMITS.campaignsPerMonth} a month.`] },
  { id: "length", q: "How long can a call be?", any: [["long", "length", "duration", "minutes", "minute"], ["call", "calls", "conversation", "conversations", "talk"]], need: 2, src: "PKG",
    a: () => [`The package document does not recommend conversations longer than ${LIMITS.callMinutes} minutes.`] },
  { id: "quality", q: "How good is the voice and understanding?", any: [["quality", "accuracy", "accurate", "good", "reliable", "arena", "benchmark", "mishear", "accent"]], need: 1, src: "PKG (open)",
    a: () => ["The package document does not commit model quality. It points to a Voice Arena report that has not been supplied. Test on recordings of your own callers, in your own languages, before you decide."] },
  { id: "custom", q: "What is a custom package?", any: [["custom", "customise", "customize", "mix", "combination", "tailor", "build my own", "cherry"]], need: 1, src: "OURS",
    a: () => ["A custom package takes one of the three as its base and adds capabilities from the others, such as Connect plus a live handover from Orchestrate. On the canvas, change any layer and the package label updates: it stays Deploy, Connect or Orchestrate only while the build matches that package exactly.", "The documents give no price for the Connect and Orchestrate parts, so a custom package is quoted by VoicERA."], follow: ["upgrade"] },
  { id: "lockin", q: "Are we locked in to one vendor?", any: [["lock", "lockin", "lock-in", "vendor", "open source", "open-source", "sovereign", "switch"]], need: 1, src: "ICP",
    a: () => ["The ICP positions VoicERA as open and sovereign with zero technology lock-in: you can use and switch between models, telephony providers and infrastructure. Whether the platform is formally recognised as a digital public good is not stated in the supplied documents."] },
  { id: "billing", q: "Who do we pay?", any: [["bill", "billing", "invoice", "pay", "payment", "bhashini"]], need: 1, src: "PKG",
    a: () => ["For the documented package, billing is through Bhashini. The ICP's commercial structure has four parts: a platform licence, voice usage, one-time implementation and managed operations, plus project-based custom development where needed."] },
  { id: "deploy-steps", q: "What happens after I choose a package?", any: [["after", "next", "then", "process", "steps", "deploy", "onboarding", "start", "begin", "execute", "execution"]], need: 1, src: "PKG + ICP",
    a: () => ["You hand over what you bring. The VoicERA team sets up the agent and campaign. You test calls before launch. You launch, then watch the dashboard and tune.", "The Deploy step shows each stage with who does what, and the hand-over pack you can download."], follow: ["bring", "timeline"] },
];

export const KB_BY_ID: Record<string, KbEntry> = Object.fromEntries(KB.map((e) => [e.id, e]));

/** Suggested questions for the "ask anything" chips. */
export const SUGGESTED = ["which", "packages", "modelcost", "why-llm", "upgrade", "storage", "timeline", "bring"];

const norm = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9+\-₹]+/g, " ").replace(/\s+/g, " ").trim()} `;

export interface KbMatch {
  entry: KbEntry;
  score: number;
}

/** Best matching entry, or null when nothing in the documents answers the question. */
export function matchQuestion(text: string): KbMatch | null {
  const t = norm(text);
  if (t.trim().length < 3) return null;
  let best: KbMatch | null = null;
  for (const e of KB) {
    let score = 0;
    for (const group of e.any) {
      if (group.some((w) => t.includes(norm(w).trimEnd()) || t.includes(` ${w.toLowerCase()}`))) score++;
    }
    const beats = !best || score > best.score || (score === best.score && !e.generic && !!best.entry.generic);
    if (score >= e.need && beats) best = { entry: e, score };
  }
  return best;
}

export function answerFor(entry: KbEntry, ctx: KbContext): { paragraphs: string[]; src: string; follow: KbEntry[] } {
  return { paragraphs: entry.a(ctx), src: entry.src, follow: (entry.follow ?? []).map((id) => KB_BY_ID[id]).filter(Boolean) };
}

/** What the documents leave open, for the "questions to confirm" list. */
export const OPEN_ITEMS = STILL_OPEN;
export const OUT_OF_PACKAGE = NOT_IN_PACKAGE;
