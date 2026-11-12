import { PACKAGE_BY_ID, PACKAGES, SEGMENTS } from "../icp";
import { DOCUMENTED_LANGUAGES, PLATINUM } from "../advisor/source";

/**
 * Everything the Package Builder knows, in one place.
 *
 * Sources, in order of trust:
 *   ICP      "ICP - Voicera [Use Case Based] 6-Oct-26": the three packages, capabilities, architecture, commercial structure
 *   PKG      "VoicEra Fully Loaded (Platinum)" package document: limits, prices, sample model and telephony lists
 *   OURS     Plain-language wording we added. It never states a price or a measured result.
 *
 * Where a source leaves something blank, the catalogue says so instead of filling it in.
 */

export type Depth = "deploy" | "connect" | "orchestrate";
export const DEPTHS: Depth[] = ["deploy", "connect", "orchestrate"];
export const depthRank = (d: Depth) => DEPTHS.indexOf(d);
export const maxDepth = (a: Depth, b: Depth): Depth => (depthRank(a) >= depthRank(b) ? a : b);

export type PackageKey = Depth | "custom";

export interface PackageCard {
  id: Depth;
  name: string;
  tagline: string;
  bestFor: string;
  launch: string;
  integration: string;
  gains: string[];
  /** What you must bring that you would not for the one below. */
  extraBring: string[];
}

const P = PACKAGE_BY_ID;

export const PACKAGE_CARDS: Record<Depth, PackageCard> = {
  deploy: {
    id: "deploy",
    name: P.deploy.name,
    tagline: P.deploy.positioning,
    bestFor: P.deploy.bestFor,
    launch: P.deploy.typicalLaunch,
    integration: P.deploy.integration,
    gains: P.deploy.accomplish,
    extraBring: P.deploy.youProvide,
  },
  connect: {
    id: "connect",
    name: P.connect.name,
    tagline: P.connect.positioning,
    bestFor: P.connect.bestFor,
    launch: P.connect.typicalLaunch,
    integration: P.connect.integration,
    gains: P.connect.accomplish,
    extraBring: P.connect.youProvide,
  },
  orchestrate: {
    id: "orchestrate",
    name: P.orchestrate.name,
    tagline: P.orchestrate.positioning,
    bestFor: P.orchestrate.bestFor,
    launch: P.orchestrate.typicalLaunch,
    integration: P.orchestrate.integration,
    gains: P.orchestrate.accomplish,
    extraBring: P.orchestrate.youProvide,
  },
};

export const PACKAGE_NAME: Record<PackageKey, string> = { deploy: "Deploy", connect: "Connect", orchestrate: "Orchestrate", custom: "Custom" };

/* ------------------------------------------------------------------ use cases */

export type UseCaseId = "scheme" | "helpline" | "grievance" | "survey" | "forms" | "status" | "alerts" | "other";

export interface UseCase {
  id: UseCaseId;
  label: string;
  plain: string;
  /** The depth the ICP puts this at, when it is connected to the department's system. */
  depth: Depth;
  /** Honest note on how it sits against the packages. */
  note: string;
  direction: "in" | "out" | "both";
  /** What a citizen experiences, in plain words. */
  does: string[];
  /** The ICP application it maps to, if any. */
  app: "scheme-discovery" | "surveys" | "grievance" | "form-filling" | "application-support" | null;
}

export const USE_CASES: UseCase[] = [
  {
    id: "scheme",
    label: "Scheme discovery",
    plain: "Tell citizens which schemes they may qualify for.",
    depth: "deploy",
    note: "A documented use case at the Deploy depth.",
    direction: "both",
    does: ["A citizen says what they need in their own language.", "It asks a few questions and names the schemes that may apply, from your approved files.", "It explains the documents and where to apply, and says so when it does not know."],
    app: "scheme-discovery",
  },
  {
    id: "helpline",
    label: "Citizen helpline",
    plain: "Answer common questions: hours, documents, fees, where to go.",
    depth: "deploy",
    note: "Information and FAQs are what the Deploy package is for.",
    direction: "in",
    does: ["A citizen rings with a question.", "It answers from your approved content, in their language.", "It points to an office or offers a staff callback when it cannot help."],
    app: null,
  },
  {
    id: "grievance",
    label: "Grievance and complaints",
    plain: "Take complaints, route them, and follow up until they are closed.",
    depth: "orchestrate",
    note: "The ICP places grievance at Orchestrate, because it normally files the complaint in your system and follows it to closure.",
    direction: "in",
    does: ["A citizen describes a problem in their own words and says where it is.", "It asks follow-up questions, classifies the complaint and reads it back.", "It records or files it, gives a reference, and follows up until the citizen confirms it is resolved."],
    app: "grievance",
  },
  {
    id: "survey",
    label: "Surveys and feedback",
    plain: "Call citizens after a service and capture their answers.",
    depth: "deploy",
    note: "A documented use case at the Deploy depth, suited for outbound calls.",
    direction: "out",
    does: ["VoicERA calls citizens in their language.", "It asks your questions one at a time.", "Answers arrive as a table, with a dashboard of how the calls went."],
    app: "surveys",
  },
  {
    id: "forms",
    label: "Form filling",
    plain: "Collect form details by voice and check them before sending.",
    depth: "connect",
    note: "Passing details to your form or API puts this at Connect.",
    direction: "in",
    does: ["A citizen is guided through a form by voice.", "Each field is collected and checked.", "The structured details go to your form or endpoint."],
    app: "form-filling",
  },
  {
    id: "status",
    label: "Application support and status",
    plain: "Guide applications and tell citizens where theirs stands.",
    depth: "connect",
    note: "Looking up status in your system puts this at Connect.",
    direction: "both",
    does: ["A citizen asks where their application stands.", "VoicERA looks it up in your system and reads it back.", "It says which documents or details are missing."],
    app: "application-support",
  },
  {
    id: "alerts",
    label: "Reminders and alerts",
    plain: "Call citizens with a reminder or a notice.",
    depth: "deploy",
    note: "Campaigns and reminders sit in the base platform.",
    direction: "out",
    does: ["VoicERA calls a list of citizens.", "It delivers your message in their language.", "It records who picked up and who did not."],
    app: null,
  },
  {
    id: "other",
    label: "Something else",
    plain: "Describe it and we will place it with you.",
    depth: "deploy",
    note: "Not one of the named use cases, so it needs a conversation with the VoicERA team.",
    direction: "both",
    does: ["A citizen reaches the service by phone.", "It answers from your approved content.", "You add the steps you need on the canvas."],
    app: null,
  },
];

export const USE_CASE_BY_ID: Record<UseCaseId, UseCase> = Object.fromEntries(USE_CASES.map((u) => [u.id, u])) as Record<UseCaseId, UseCase>;

/** Use cases the ICP suggests for a department segment. */
export function suggestedUseCases(segmentId: string | null): UseCaseId[] {
  const seg = SEGMENTS.find((s) => s.id === segmentId);
  if (!seg) return [];
  const map: Record<string, UseCaseId> = { grievance: "grievance", "scheme-discovery": "scheme", surveys: "survey", "form-filling": "forms", "application-support": "status" };
  return Array.from(new Set(seg.applications.map((a) => map[a]).filter(Boolean) as UseCaseId[]));
}

export const SEGMENT_CHOICES = SEGMENTS.map((s) => ({ id: s.id, name: s.name, adopters: s.adopters, workflow: s.workflow, role: s.role }));

/* ------------------------------------------------------------------ capabilities */

/** The ICP's own list of what each package includes. Each capability belongs to the lowest package that has it. */
export type CapabilityId =
  | "workflow" | "knowledge" | "voice" | "telephony" | "analytics"
  | "api" | "capture" | "triggers" | "status"
  | "system" | "routing" | "case" | "escalation" | "handoff" | "tracking";

export interface Capability {
  id: CapabilityId;
  label: string;
  depth: Depth;
}

const incl = (d: Depth) => P[d].included.filter((x) => !x.startsWith("Everything in"));
const CAP_LABEL_TO_ID: Record<string, CapabilityId> = {
  "Pre-built conversational workflow": "workflow",
  "Knowledge base": "knowledge",
  "Multilingual voice": "voice",
  Telephony: "telephony",
  Analytics: "analytics",
  "API integration": "api",
  "Data capture": "capture",
  "Workflow triggers": "triggers",
  "Status checks": "status",
  "System integration": "system",
  Routing: "routing",
  "Case creation": "case",
  Escalation: "escalation",
  "Human handoff": "handoff",
  "Resolution tracking": "tracking",
};

export const CAPABILITIES: Capability[] = DEPTHS.flatMap((d) =>
  incl(d).map((label) => ({ id: CAP_LABEL_TO_ID[label], label, depth: d })),
);
export const CAPABILITY_BY_ID: Record<CapabilityId, Capability> = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c])) as Record<CapabilityId, Capability>;

/** Everything a package includes, cumulative. */
export function capabilitiesOfDepth(d: Depth): CapabilityId[] {
  return CAPABILITIES.filter((c) => depthRank(c.depth) <= depthRank(d)).map((c) => c.id);
}

/* ------------------------------------------------------------------ the pipeline */

export type LayerId = "channel" | "listen" | "think" | "speak" | "know" | "act" | "handoff" | "watch" | "host";

export interface Layer {
  id: LayerId;
  /** Plain name first. */
  name: string;
  /** The technical term, for those who know it. */
  tech: string;
  /** One sentence for a non-technical reader. */
  does: string;
  /** Why it exists in the pipeline. */
  whyItMatters: string;
}

export const LAYERS: Layer[] = [
  { id: "channel", name: "How citizens reach it", tech: "Telephony layer", does: "The phone line, or a web link, that carries the conversation.", whyItMatters: "Without a way in there is no service. This is also where numbers and your own telephony provider come in." },
  { id: "listen", name: "Listens", tech: "Speech recognition · ASR / STT", does: "Turns the citizen's speech into text.", whyItMatters: "Everything after this depends on getting the words right, in their language and accent." },
  { id: "think", name: "Thinks", tech: "Language model · LLM", does: "Decides what the citizen means and what to say next.", whyItMatters: "This is the brain. A heavier model costs more and is not always needed." },
  { id: "speak", name: "Speaks", tech: "Voice · TTS", does: "Turns the answer back into natural speech.", whyItMatters: "The voice is what the citizen actually hears. It sets trust and clarity." },
  { id: "know", name: "Knows your content", tech: "Knowledge base · RAG", does: "Looks up the right passage in your approved documents before it answers.", whyItMatters: "It answers from your content, not from memory, which keeps it accurate and on-policy." },
  { id: "act", name: "Acts in your systems", tech: "Action gateway · APIs", does: "Reads from and writes to your own systems: look up status, file a case, route a request.", whyItMatters: "This is what turns a conversation into an outcome. It is also what sets the package depth." },
  { id: "handoff", name: "Hands over to a person", tech: "Escalation · human handoff", does: "What happens when the agent cannot help.", whyItMatters: "A safe, kind exit protects citizens and staff." },
  { id: "watch", name: "Watches and improves", tech: "Analytics · operations", does: "A dashboard of what happened, and people who help you run it.", whyItMatters: "You see what works and fix what does not." },
  { id: "host", name: "Where it runs", tech: "Deployment environment", does: "The infrastructure the service runs on.", whyItMatters: "It decides where data lives and who can reach it." },
];

export const LAYER_BY_ID: Record<LayerId, Layer> = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, Layer>;

/* ------------------------------------------------------------------ options */

/**
 * How an option is priced.
 *   auto         VoicERA picks an open-source model. Covered by the standard usage price.
 *   open         An open-source model. Covered by the standard usage price.
 *   proprietary  A commercial model. The documents give no price.
 *   confirm      A model the documents list but do not classify. Whether the standard price applies is to be confirmed.
 *   own          You bring your own model or provider and your provider bills you.
 *   included     Part of the package, no separate charge documented.
 *   quote        No price in the documents. The provider quotes it.
 */
export type Tier = "auto" | "open" | "proprietary" | "confirm" | "own" | "included" | "quote";

export interface Option {
  id: string;
  layer: LayerId;
  name: string;
  /** Who makes it, where that is a fact in the documents. */
  maker?: string;
  tier: Tier;
  plain: string;
  /** Plain reasons to choose it, any use case. */
  why: string;
  /** Sharper reasons for a use case. */
  whyFor?: Partial<Record<UseCaseId, string>>;
  /** What to check before relying on it. */
  check: string;
  /** Where the fact comes from. */
  source: "PKG" | "ICP" | "OURS";
  /** Capabilities this option brings in, so the package depth is worked out from the canvas. */
  caps?: CapabilityId[];
}

const GUIDANCE_CHECK = "This is general guidance, not a measured result. Test it on recordings of your own callers.";
const LANGUAGE_CHECK = "Language coverage differs by model. The package document says quality is shown in a Voice Arena report that has not been supplied, so test your languages.";

export const OPTIONS: Option[] = [
  // ---- channel
  { id: "ch-partner", layer: "channel", name: "A number from VoicERA's telephony partners", tier: "included", plain: "VoicERA sets up the number and the routing.", why: "The quickest way to a working phone line. It is the path the package document describes, with set-up in 2 working days once you have handed over what is needed.", check: "The document lists partners as samples only (BSNL, Tata, Vobiz, Plivo, Vodafone, Ubona). The actual partners are to be confirmed.", source: "PKG", caps: ["telephony"] },
  { id: "ch-own", layer: "channel", name: "Your own telephony provider and numbers", tier: "quote", plain: "Use the provider and numbers your department already has.", why: "Choose this if your department must keep its existing numbers or has a contract with a provider. The package document describes it as taking 2 to 4 weeks, case by case.", check: "No price is given for connecting your own provider. Ask who bills the line and what technology it uses: SIP trunk, Cloud SIP or WebSocket.", source: "PKG", caps: ["telephony"] },
  { id: "ch-browser", layer: "channel", name: "A browser link, no phone line", tier: "included", plain: "Citizens talk from a web page.", why: "Good for trying the service, for kiosks, and for web use. There is no number to buy.", check: "Citizens who only have a basic phone cannot use it. You can add a number later.", source: "PKG", caps: ["telephony"] },

  // ---- listen (speech recognition)
  { id: "asr-auto", layer: "listen", name: "VoicERA chooses (open-source)", tier: "auto", plain: "VoicERA picks an open-source speech model that suits your languages.", why: "The simplest and least expensive start. It is covered by the standard usage price.", whyFor: { grievance: "Complaints are spoken loosely, in mixed languages. Start here and listen to how it does on real recordings. Move to another model only if it mishears.", scheme: "Scheme names and eligibility terms matter. Start here and test your most common scheme names.", survey: "Survey answers are short and often one word, which a standard model usually handles. Start here." }, check: LANGUAGE_CHECK, source: "OURS" },
  { id: "asr-ai4bharat", layer: "listen", name: "AI4Bharat", maker: "AI4Bharat", tier: "open", plain: "An open initiative for Indian-language AI.", why: "An open-source option for Indian languages, covered by the standard usage price.", check: LANGUAGE_CHECK, source: "PKG" },
  { id: "asr-bhashini", layer: "listen", name: "BHASHINI", maker: "BHASHINI", tier: "confirm", plain: "India's national language platform.", why: "Appeals when you want the speech model to come from the national platform.", check: "The documents list it but do not say whether the standard price applies. To be confirmed.", source: "ICP" },
  { id: "asr-sarvam", layer: "listen", name: "Sarvam", maker: "Sarvam", tier: "confirm", plain: "An Indian speech and language company.", why: "An option you might choose for Indian-language speech.", check: "The documents list it but do not say whether the standard price applies. To be confirmed.", source: "PKG" },
  { id: "asr-raya", layer: "listen", name: "Raya", maker: "Raya", tier: "confirm", plain: "Listed in the architecture as a provider.", why: "Listed as a provider in the ICP architecture.", check: "The documents give no detail or price. To be confirmed.", source: "ICP" },
  { id: "asr-elevenlabs", layer: "listen", name: "Eleven Labs", maker: "Eleven Labs", tier: "proprietary", plain: "A commercial speech provider.", why: "Choose it if your tests show it understands your callers better than the open-source options.", whyFor: { grievance: "Worth testing if citizens speak in noisy places, such as roadsides, and the standard model keeps mishearing.", scheme: "Only if the standard model fails your tests." }, check: "A commercial model. The package document gives no price. To be confirmed. " + GUIDANCE_CHECK, source: "PKG" },
  { id: "asr-own", layer: "listen", name: "Your own speech model (your API)", tier: "own", plain: "You bring the model. VoicERA connects it.", why: "Choose it if your department must use a particular model, or runs one itself. The ICP says the platform connects multiple providers.", check: "You pay your provider directly. VoicERA's fee for connecting it is not defined yet.", source: "ICP" },

  // ---- think (language model)
  { id: "llm-auto", layer: "think", name: "VoicERA chooses (open-source)", tier: "auto", plain: "VoicERA picks an open-source language model.", why: "Open-source models are covered by the standard usage price and can run in a sovereign setting. A sound default when the agent answers from your approved documents.", whyFor: {
      scheme: "Scheme discovery is mostly looking things up in your own scheme files and explaining them, so an open-source model is usually enough. Test it on your languages first.",
      helpline: "A helpline answers common questions from your content, which an open-source model handles well. Start here.",
      survey: "A survey follows a fixed script and captures answers as a table, so you rarely need a heavier model.",
      grievance: "A complaint is open-ended: people ramble, mix languages and describe places loosely. Start here and test it on real recordings. If it classifies badly, try a proprietary model.",
      forms: "Collecting fields and reading back status needs accuracy more than creativity. Start here.",
      status: "Reading status back needs accuracy more than creativity. Start here.",
      alerts: "A reminder is a short fixed message. An open-source model is more than enough.",
    }, check: GUIDANCE_CHECK, source: "OURS" },
  { id: "llm-gemma", layer: "think", name: "Gemma", maker: "Google (open weights)", tier: "open", plain: "An open-source language model.", why: "Open-source, covered by the standard usage price.", check: GUIDANCE_CHECK, source: "PKG" },
  { id: "llm-llama", layer: "think", name: "Llama", maker: "Meta (open weights)", tier: "open", plain: "An open-source language model.", why: "Open-source, covered by the standard usage price.", check: GUIDANCE_CHECK, source: "PKG" },
  { id: "llm-qwen", layer: "think", name: "Qwen", maker: "Alibaba (open weights)", tier: "open", plain: "An open-source language model.", why: "Open-source, covered by the standard usage price.", check: GUIDANCE_CHECK, source: "PKG" },
  { id: "llm-openai", layer: "think", name: "OpenAI", maker: "OpenAI", tier: "proprietary", plain: "A commercial language model.", why: "Teams pick a commercial model when conversations are open-ended and they want the strongest understanding, and accept the extra cost.", whyFor: {
      grievance: "People describe complaints in their own messy words. A commercial model may classify them and ask follow-ups better. The trade-offs are cost, which the documents do not give, and where the data goes, which must be confirmed. Compare it with an open-source model on your own sample calls before paying for it.",
      scheme: "Rarely needed for scheme discovery, because the answers come from your own files. Consider it only if the open-source option fails your tests.",
      survey: "Not usually needed: a survey follows a script.",
      helpline: "Rarely needed for common questions answered from your files.",
      forms: "Rarely needed. Fields are collected and checked one at a time.",
      status: "Rarely needed. It reads status back from your system.",
      alerts: "Not needed for a fixed reminder.",
    }, check: "The package document gives no price for commercial models, and does not say where data goes when one is used. Both are to be confirmed. " + GUIDANCE_CHECK, source: "PKG" },
  { id: "llm-own", layer: "think", name: "Your own model or endpoint", tier: "own", plain: "Bring a model you host or pay for yourself.", why: "Choose it if your department must keep a specific model or host it itself. The ICP says the platform supports custom OpenAI-compatible endpoints and self-hosted models.", check: "You pay your provider directly. VoicERA's fee for connecting it is not defined yet.", source: "ICP" },

  // ---- speak (voice)
  { id: "tts-auto", layer: "speak", name: "VoicERA chooses (open-source)", tier: "auto", plain: "VoicERA picks an open-source voice for your languages.", why: "Covered by the standard usage price. Pick specific voices later once you have heard them.", whyFor: { grievance: "Citizens calling to complain may be upset. A calm, clear voice matters more than a fancy one. Listen to samples with your own staff first.", scheme: "Clarity matters most: scheme names and document lists must be easy to follow. Listen to samples first.", survey: "A neutral, friendly voice keeps people on the line. Listen to samples first." }, check: LANGUAGE_CHECK, source: "OURS" },
  { id: "tts-ai4bharat", layer: "speak", name: "AI4Bharat", maker: "AI4Bharat", tier: "open", plain: "An open initiative for Indian-language AI.", why: "An open-source voice for Indian languages, covered by the standard usage price.", check: LANGUAGE_CHECK, source: "PKG" },
  { id: "tts-bodhan", layer: "speak", name: "Bodhan", maker: "Bodhan", tier: "confirm", plain: "Listed as a voice option.", why: "A voice option listed in the package document.", check: "The document lists it but gives no detail or price. To be confirmed.", source: "PKG" },
  { id: "tts-sarvam", layer: "speak", name: "Sarvam", maker: "Sarvam", tier: "confirm", plain: "An Indian speech and language company.", why: "A voice option for Indian languages.", check: "The documents list it but do not say whether the standard price applies. To be confirmed.", source: "PKG" },
  { id: "tts-bhashini", layer: "speak", name: "BHASHINI", maker: "BHASHINI", tier: "confirm", plain: "India's national language platform.", why: "Appeals when you want the voice to come from the national platform.", check: "The documents list it but do not say whether the standard price applies. To be confirmed.", source: "ICP" },
  { id: "tts-chirp", layer: "speak", name: "Google Chirp", maker: "Google", tier: "proprietary", plain: "A commercial voice.", why: "Choose it if you have heard it and prefer it to the open-source voices.", check: "A commercial model. The package document gives no price. To be confirmed.", source: "PKG" },
  { id: "tts-own", layer: "speak", name: "Your own voice model (your API)", tier: "own", plain: "You bring the voice. VoicERA connects it.", why: "Choose it if your department has a voice it must use, such as a recorded official voice.", check: "You pay your provider directly. VoicERA's fee for connecting it is not defined yet.", source: "ICP" },

  // ---- know (knowledge base / RAG)
  { id: "kn-files", layer: "know", name: "Your approved documents", tier: "included", plain: "Scheme details, FAQs and policies, in text files.", why: "It answers from your content instead of from memory. The package document allows up to 10 text files of up to 5 MB each.", whyFor: { scheme: "Scheme discovery lives or dies on the quality of your scheme files. This is the most important thing you bring.", helpline: "Your FAQs and process documents are the whole service.", grievance: "Categories, departments and what each complaint type needs.", survey: "Usually not needed. A survey follows a fixed script." }, check: "Larger or non-text files need a separate conversation. Keeping files up to date is your team's job.", source: "PKG", caps: ["knowledge"] },
  { id: "kn-none", layer: "know", name: "No knowledge base, a script only", tier: "included", plain: "The agent follows a fixed script.", why: "Right for surveys and reminders, where the agent asks and records rather than answers.", check: "It cannot answer open questions from your content.", source: "OURS" },
  { id: "kn-live", layer: "know", name: "Your content plus live data from your system", tier: "quote", plain: "Answers can use data fetched from your portal or database.", why: "Choose it when the answer depends on a citizen's own record, such as eligibility or status.", check: "This needs an API connection to your system, which is Connect depth. No price is given.", source: "ICP", caps: ["knowledge", "api"] },

  // ---- act (actions in your systems)
  { id: "act-none", layer: "act", name: "Talks only", tier: "included", plain: "No connection to your systems.", why: "The quickest, cheapest way to start. The package document's priced offer is this: no custom integration with department systems.", check: "It cannot look up or change anything in your systems.", source: "PKG" },
  { id: "act-api", layer: "act", name: "Reads and writes through an API", tier: "quote", plain: "Collects data, checks status, triggers a workflow.", why: "Choose it when citizens need to give structured information or check where an application stands. This is the Connect package.", whyFor: { forms: "Forms need each field captured and sent to your endpoint.", status: "Status needs a look-up in your system.", grievance: "A first step toward filing complaints in your system: capture the details and send them on." }, check: "Needs an endpoint that accepts and returns data, an IT security review and a test environment. No price is given.", source: "ICP", caps: ["api", "capture", "triggers", "status"] },
  { id: "act-full", layer: "act", name: "The full workflow into your systems", tier: "quote", plain: "Routes, creates cases and tracks them to closure.", why: "Choose it when VoicERA should manage the conversation from intake to resolution. This is the Orchestrate package.", whyFor: { grievance: "This is what grievances need: classify, route by your matrix, create the case, follow up and confirm closure." }, check: "Needs deep integration with your systems, agreed service levels, named staff for handoffs and a staged rollout. No price is given.", source: "ICP", caps: ["api", "capture", "triggers", "status", "system", "routing", "case", "tracking"] },

  // ---- handoff
  { id: "ho-callback", layer: "handoff", name: "Staff call the citizen back", tier: "included", plain: "The agent notes the request and staff ring back later.", why: "Simple and safe. It needs no live staffing.", check: "Needs someone to make the callbacks and a way to pass them the notes.", source: "OURS" },
  { id: "ho-office", layer: "handoff", name: "Point to an office", tier: "included", plain: "The agent says where to go or who to contact.", why: "The simplest exit. It needs nothing from your side.", check: "Citizens must make the trip or the call themselves.", source: "OURS" },
  { id: "ho-live", layer: "handoff", name: "Pass the call to a person, with the conversation attached", tier: "quote", plain: "A live handover, so the person already knows the case.", why: "Choose it for sensitive or urgent cases. It is part of the Orchestrate package.", whyFor: { grievance: "Upset citizens and serious complaints deserve a person quickly, with the details already in front of them." }, check: "Needs named staff who take handoffs, and the hours they are available. No price is given. VoicERA does not handle emergencies: those go to 112.", source: "ICP", caps: ["escalation", "handoff"] },

  // ---- watch
  { id: "w-dash", layer: "watch", name: "Dashboard and analysis", tier: "included", plain: "Calls attempted, connected, dropped and completed, and an analysis after a campaign.", why: "You see what is happening. The package document says the analysis is shared within 3 working days.", check: "Survey answers can be downloaded as a table.", source: "PKG", caps: ["analytics"] },

  // ---- host
  { id: "host-bhashini", layer: "host", name: "Hosted on Bhashini", tier: "included", plain: "The package as documented.", why: "The only hosting the package document describes. It is billed to Bhashini.", check: "Where call data is stored, and for how long, is not stated in the document. To be confirmed.", source: "PKG" },
  { id: "host-gov", layer: "host", name: "Government cloud", tier: "quote", plain: "An Indian government cloud environment.", why: "Listed in the ICP as a deployment option, for when policy requires a government cloud.", check: "Not described in the package document. Availability and cost are to be confirmed.", source: "ICP" },
  { id: "host-private", layer: "host", name: "Private cloud", tier: "quote", plain: "A private cloud your department controls.", why: "Listed in the ICP as a deployment option.", check: "Not described in the package document. Availability and cost are to be confirmed.", source: "ICP" },
  { id: "host-onprem", layer: "host", name: "On-premise, in your own data centre", tier: "quote", plain: "It runs on your own machines.", why: "Listed in the ICP as a deployment option, for the strictest data rules.", check: "Not described in the package document. Whether the platform can be installed on your infrastructure is to be confirmed in writing.", source: "ICP" },
];

export const OPTION_BY_ID: Record<string, Option> = Object.fromEntries(OPTIONS.map((o) => [o.id, o]));
export const optionsFor = (layer: LayerId) => OPTIONS.filter((o) => o.layer === layer);

/** The reason to show for an option, sharpened for the first use case that has one. */
export function reasonFor(o: Option, useCases: UseCaseId[]): { text: string; specific: boolean } {
  for (const u of useCases) {
    const t = o.whyFor?.[u];
    if (t) return { text: t, specific: true };
  }
  return { text: o.why, specific: false };
}

/* ------------------------------------------------------------------ languages and limits */

export const LANGUAGES = [...DOCUMENTED_LANGUAGES];
export const OTHER_LANGUAGE_NOTE = "Languages beyond the documented eleven are not in the package document, so they need confirming.";

const L = PLATINUM.limits;
export const LIMITS = {
  concurrent: L.maxConcurrentCalls.value,
  latency: L.latencyTargetSeconds.value,
  uptime: L.uptimePercent.value,
  setupDays: L.setupSlaWorkingDays.value,
  troubleshootHours: L.troubleshootingHours.value,
  analysisDays: L.postCampaignAnalysisWorkingDays.value,
  campaignsPerMonth: L.maxCampaignOpsPerMonth.value,
  kbFiles: L.maxKnowledgeFiles.value,
  kbMB: L.maxKnowledgeFileMB.value,
  callMinutes: L.maxConversationMinutes.value,
  ownTelephonyWeeks: L.customTelephonyTimelineWeeks.value,
} as const;

export const TELEPHONY_PARTNERS_SAMPLE = [...PLATINUM.telephonySample, "Smartping"];
export const TELEPHONY_TECH = [...PLATINUM.telephonyTech];

/** Still-open answers in the supplied documents. Said aloud, never hidden. */
export const STILL_OPEN = [
  "Where call data is stored",
  "Whether call data is used to train models",
  "How long call data is kept",
  "The actual list of voice and language models (the documents give samples)",
  "Prices for commercial models and for connecting your own model",
  "Prices for Connect and Orchestrate implementation",
];

export const NOT_IN_PACKAGE = [
  "Connecting to your department's systems is not part of the priced offer. It is the Connect and Orchestrate work, scoped separately.",
  "WhatsApp calling.",
  `Calls longer than ${L.maxConversationMinutes.value} minutes are not recommended.`,
  "Photos and video are not recommended.",
  "Emergency and life-safety calls. VoicERA cannot send help. Emergencies go to 112.",
];

export const PRICE_POINTS_NOTE = "Commercial models and the Connect and Orchestrate implementation are not priced in the documents, so they show as not set.";

export { PACKAGES };
