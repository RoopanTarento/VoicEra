import type { AccessGroup, Channel, Complexity, DataType, HostingKind, InteractionMode, PiiType, Priority, SupportModel, VoicePref } from "./types";

/**
 * The catalogue the recommendation and the price are made from.
 *
 * SAMPLE DATA. Provider names are real, but every model label, rate, benchmark figure and test date
 * below is illustrative, so the product can be shown and tested. Nothing here is a real price list
 * or a real benchmark, and the interface says so wherever it shows one.
 */

export const RATES_AS_OF_DEFAULT = "2026-10-01";
export const RATES_STALE_AFTER_DAYS = 30;

export type Support = "tested" | "partial" | "none";
export type Layer = "asr" | "llm" | "tts" | "telephony" | "adapter" | "hostingProfile";
export type CompStatus = "available" | "degraded" | "unavailable";

/* ------------------------------------------------------------------ languages */

export interface Language {
  id: string;
  name: string;
  native: string;
  /** Whether personal data can be redacted from transcripts in this language. */
  redaction: boolean;
}

export const LANGUAGES: Language[] = [
  { id: "hi", name: "Hindi", native: "हिन्दी", redaction: true },
  { id: "en", name: "English", native: "English", redaction: true },
  { id: "mr", name: "Marathi", native: "मराठी", redaction: true },
  { id: "ta", name: "Tamil", native: "தமிழ்", redaction: true },
  { id: "te", name: "Telugu", native: "తెలుగు", redaction: true },
  { id: "kn", name: "Kannada", native: "ಕನ್ನಡ", redaction: true },
  { id: "gu", name: "Gujarati", native: "ગુજરાતી", redaction: true },
  { id: "bn", name: "Bengali", native: "বাংলা", redaction: true },
  { id: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", redaction: true },
  { id: "ml", name: "Malayalam", native: "മലയാളം", redaction: true },
  { id: "or", name: "Odia", native: "ଓଡ଼ିଆ", redaction: true },
  { id: "ur", name: "Urdu", native: "اردو", redaction: true },
  { id: "as", name: "Assamese", native: "অসমীয়া", redaction: false },
  { id: "ne", name: "Nepali", native: "नेपाली", redaction: false },
  { id: "mai", name: "Maithili", native: "मैथिली", redaction: false },
  { id: "kok", name: "Konkani", native: "कोंकणी", redaction: false },
  { id: "brx", name: "Bodo", native: "बर'", redaction: false },
  { id: "sat", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", redaction: false },
];
export const LANGUAGE_BY_ID: Record<string, Language> = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));

const lm = (tested: string[], partial: string[] = []): Record<string, Support> => ({
  ...Object.fromEntries(partial.map((l) => [l, "partial" as Support])),
  ...Object.fromEntries(tested.map((l) => [l, "tested" as Support])),
});

/* ------------------------------------------------------------------ components */

interface Base {
  id: string;
  layer: Layer;
  provider: string;
  model: string;
  hosting: HostingKind[];
  /** True when the data stays in India. */
  inCountry: boolean;
  latencyMs: number;
  benchmarkDate: string | null;
  /** Rate in rupees. Null when the rate is not known. */
  rate: number | null;
  unit: string;
}

export interface Asr extends Base { layer: "asr"; langs: Record<string, Support>; dialectsTested: boolean; codeSwitch: boolean; openSource: boolean }
export interface Llm extends Base { layer: "llm"; tier: 1 | 2 | 3; openSource: boolean }
export interface Tts extends Base { layer: "tts"; langs: Record<string, Support>; streaming: boolean; naturalness: number; voice: VoicePref | "neutral" }
export interface Telephony extends Base { layer: "telephony"; channels: Channel[]; broadcast: boolean }
export interface Adapter extends Base { layer: "adapter" }
export type Component = Asr | Llm | Tts | Telephony | Adapter;

const ALL: HostingKind[] = ["govcloud", "onprem", "approved"];

export const ASRS: Asr[] = [
  { id: "asr-ai4b", layer: "asr", provider: "AI4Bharat", model: "IndicConformer", hosting: ALL, inCountry: true, latencyMs: 340, benchmarkDate: "2026-08-14", rate: 0.16, unit: "/ audio min", langs: lm(["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "pa", "ml"], ["or", "as", "ur"]), dialectsTested: false, codeSwitch: true, openSource: true },
  { id: "asr-sarvam", layer: "asr", provider: "Sarvam", model: "Saarika", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 260, benchmarkDate: "2026-09-02", rate: 0.24, unit: "/ audio min", langs: lm(["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "pa", "ml", "or"], ["as", "ur"]), dialectsTested: true, codeSwitch: true, openSource: false },
  { id: "asr-bhashini", layer: "asr", provider: "Bhashini", model: "ASR via COSS", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 520, benchmarkDate: "2026-07-21", rate: 0.1, unit: "/ audio min", langs: lm(["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "pa", "ml", "or", "as", "ur"], ["ne", "mai", "kok"]), dialectsTested: false, codeSwitch: false, openSource: false },
  { id: "asr-eleven", layer: "asr", provider: "Eleven Labs", model: "Scribe", hosting: ["approved"], inCountry: false, latencyMs: 240, benchmarkDate: "2026-08-30", rate: 0.3, unit: "/ audio min", langs: lm(["hi", "en", "ta", "te", "bn", "mr"], ["kn", "gu", "pa", "ml", "ur"]), dialectsTested: false, codeSwitch: true, openSource: false },
  { id: "asr-whisper", layer: "asr", provider: "Open weights", model: "Whisper-class (self-hosted)", hosting: ALL, inCountry: true, latencyMs: 610, benchmarkDate: "2026-06-18", rate: 0.08, unit: "/ audio min", langs: lm(["hi", "en"], ["mr", "ta", "te", "kn", "gu", "bn", "pa", "ml", "ur", "or"]), dialectsTested: false, codeSwitch: false, openSource: true },
];

export const LLMS: Llm[] = [
  { id: "llm-gemma9", layer: "llm", provider: "Gemma", model: "9B class", hosting: ALL, inCountry: true, latencyMs: 180, benchmarkDate: "2026-08-10", rate: 0.012, unit: "/ 1k tokens", tier: 1, openSource: true },
  { id: "llm-gemma27", layer: "llm", provider: "Gemma", model: "27B class", hosting: ALL, inCountry: true, latencyMs: 300, benchmarkDate: "2026-08-10", rate: 0.03, unit: "/ 1k tokens", tier: 2, openSource: true },
  { id: "llm-llama70", layer: "llm", provider: "Llama", model: "70B class", hosting: ALL, inCountry: true, latencyMs: 420, benchmarkDate: "2026-08-22", rate: 0.045, unit: "/ 1k tokens", tier: 2, openSource: true },
  { id: "llm-qwen72", layer: "llm", provider: "Qwen", model: "72B class", hosting: ALL, inCountry: true, latencyMs: 460, benchmarkDate: "2026-08-28", rate: 0.05, unit: "/ 1k tokens", tier: 3, openSource: true },
  { id: "llm-openai", layer: "llm", provider: "OpenAI", model: "Flagship (hosted)", hosting: ["approved"], inCountry: false, latencyMs: 380, benchmarkDate: "2026-09-15", rate: 0.12, unit: "/ 1k tokens", tier: 3, openSource: false },
];

export const TTSS: Tts[] = [
  { id: "tts-ai4b1", layer: "tts", provider: "AI4Bharat", model: "Indic voice 1", hosting: ALL, inCountry: true, latencyMs: 380, benchmarkDate: "2026-08-14", rate: 0.04, unit: "/ 1k chars", langs: lm(["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "ml"], ["pa", "or"]), streaming: false, naturalness: 3.7, voice: "female" },
  { id: "tts-ai4b2", layer: "tts", provider: "AI4Bharat", model: "Indic voice 2", hosting: ALL, inCountry: true, latencyMs: 380, benchmarkDate: "2026-08-14", rate: 0.04, unit: "/ 1k chars", langs: lm(["hi", "en", "ta", "te", "kn", "ml", "bn"], ["mr", "gu", "pa", "or"]), streaming: false, naturalness: 3.6, voice: "male" },
  { id: "tts-sarvam1", layer: "tts", provider: "Sarvam", model: "Voice 1", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 220, benchmarkDate: "2026-09-02", rate: 0.09, unit: "/ 1k chars", langs: lm(["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "ml", "pa", "or"], ["ur"]), streaming: true, naturalness: 4.3, voice: "female" },
  { id: "tts-sarvam2", layer: "tts", provider: "Sarvam", model: "Voice 2", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 220, benchmarkDate: "2026-09-02", rate: 0.09, unit: "/ 1k chars", langs: lm(["hi", "en", "ta", "te", "kn", "ml", "bn", "gu"], ["mr", "pa", "or"]), streaming: true, naturalness: 4.2, voice: "male" },
  { id: "tts-chirp", layer: "tts", provider: "Google", model: "Chirp HD", hosting: ["approved"], inCountry: false, latencyMs: 200, benchmarkDate: "2026-09-10", rate: 0.16, unit: "/ 1k chars", langs: lm(["hi", "en", "ta", "te", "kn", "ml", "bn", "mr", "gu", "pa"], ["ur"]), streaming: true, naturalness: 4.5, voice: "female" },
  { id: "tts-bodhan", layer: "tts", provider: "Bodhan", model: "Voice 1", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 400, benchmarkDate: "2026-08-04", rate: 0.05, unit: "/ 1k chars", langs: lm(["hi", "en", "ta", "te"], ["mr", "kn", "ml", "bn"]), streaming: false, naturalness: 3.4, voice: "female" },
  { id: "tts-bhashini", layer: "tts", provider: "Bhashini", model: "TTS via COSS", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 560, benchmarkDate: "2026-07-30", rate: 0.03, unit: "/ 1k chars", langs: lm(["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "pa", "ml", "or", "as", "ur"], ["ne"]), streaming: false, naturalness: 3.1, voice: "female" },
];

export const TELEPHONY: Telephony[] = [
  { id: "tel-vobiz", layer: "telephony", provider: "Vobiz", model: "Voice trunk", hosting: ALL, inCountry: true, latencyMs: 90, benchmarkDate: "2026-09-01", rate: 0.14, unit: "/ call min", channels: ["pstn", "sip"], broadcast: true },
  { id: "tel-plivo", layer: "telephony", provider: "Plivo", model: "Voice API", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 80, benchmarkDate: "2026-09-12", rate: 0.16, unit: "/ call min", channels: ["pstn", "sip", "web", "whatsapp"], broadcast: true },
  { id: "tel-tata", layer: "telephony", provider: "Tata Communications", model: "Cloud voice", hosting: ALL, inCountry: true, latencyMs: 100, benchmarkDate: "2026-08-18", rate: 0.13, unit: "/ call min", channels: ["pstn", "sip"], broadcast: true },
  { id: "tel-bsnl", layer: "telephony", provider: "BSNL", model: "Enterprise voice", hosting: ["govcloud", "onprem"], inCountry: true, latencyMs: 130, benchmarkDate: "2026-07-14", rate: 0.12, unit: "/ call min", channels: ["pstn"], broadcast: false },
  { id: "tel-ubona", layer: "telephony", provider: "Ubona", model: "Cloud telephony", hosting: ["govcloud", "approved"], inCountry: true, latencyMs: 110, benchmarkDate: "2026-08-25", rate: 0.15, unit: "/ call min", channels: ["pstn", "sip"], broadcast: true },
];

export const ADAPTERS: Adapter[] = [
  { id: "adapter-coss", layer: "adapter", provider: "Bhashini / COSS", model: "Language adapter", hosting: ALL, inCountry: true, latencyMs: 40, benchmarkDate: "2026-08-14", rate: null, unit: "rate unknown" },
  { id: "adapter-none", layer: "adapter", provider: "None", model: "Direct models only", hosting: ALL, inCountry: true, latencyMs: 0, benchmarkDate: null, rate: 0, unit: "no charge" },
];

export const COMPONENTS: Component[] = [...ASRS, ...LLMS, ...TTSS, ...TELEPHONY, ...ADAPTERS];
export const COMPONENT_BY_ID: Record<string, Component> = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));
export const compLabel = (c: Component): string => (c.layer === "adapter" && c.provider === "None" ? "No language adapter" : `${c.provider} · ${c.model}`);

/* ------------------------------------------------------------------ hosting profiles */

export type ProfileSize = "small" | "standard" | "large";
export interface HostingProfile {
  id: string;
  kind: HostingKind;
  size: ProfileSize;
  name: string;
  capacity: number;
  monthly: number;
  setup: number;
  needsApproval: boolean;
  note: string;
}

export const HOSTING_PROFILES: HostingProfile[] = [
  { id: "gov-small", kind: "govcloud", size: "small", name: "Gov cloud · Small (CPU only)", capacity: 25, monthly: 9000, setup: 40000, needsApproval: true, note: "Up to 25 calls at once. No GPU, so only light models fit." },
  { id: "gov-standard", kind: "govcloud", size: "standard", name: "Gov cloud · Standard (1 GPU)", capacity: 60, monthly: 18000, setup: 60000, needsApproval: true, note: "Up to 60 calls at once." },
  { id: "gov-large", kind: "govcloud", size: "large", name: "Gov cloud · Large (4 GPU)", capacity: 200, monthly: 46000, setup: 110000, needsApproval: true, note: "Up to 200 calls at once." },
  { id: "onprem-standard", kind: "onprem", size: "standard", name: "On-prem · Customer-provided", capacity: 150, monthly: 0, setup: 180000, needsApproval: true, note: "Your hardware and power are excluded from this price." },
  { id: "approved-standard", kind: "approved", size: "standard", name: "Approved cloud · Standard", capacity: 80, monthly: 21000, setup: 45000, needsApproval: false, note: "Up to 80 calls at once." },
  { id: "approved-large", kind: "approved", size: "large", name: "Approved cloud · Large", capacity: 250, monthly: 52000, setup: 90000, needsApproval: false, note: "Up to 250 calls at once." },
];
export const PROFILE_BY_ID: Record<string, HostingProfile> = Object.fromEntries(HOSTING_PROFILES.map((p) => [p.id, p]));
const SIZE_RANK: Record<ProfileSize, number> = { small: 0, standard: 1, large: 2 };
export const sizeRank = (s: ProfileSize) => SIZE_RANK[s];

/* ------------------------------------------------------------------ packages */

export interface CatalogPackage {
  id: string;
  name: string;
  version: string;
  tagline: string;
  bias: "cost" | "balanced" | "quality" | "latency";
  selection: { asr: string; llm: string; tts: string; telephony: string; adapter: string };
  metrics: { turnLatencyS: number; taskCompletion: number; voiceQuality: number; testCalls: number; testDate: string; maxPeak: number };
  minProfile: ProfileSize;
  /** Highest task complexity the language model handles well. */
  maxTier: 1 | 2 | 3;
  benchmarkLangs: string[];
  support: SupportModel[];
}

export const PACKAGES: CatalogPackage[] = [
  { id: "pkg-balanced", name: "Samvad Balanced", version: "1.2", tagline: "Open-source stack with measured Indic quality.", bias: "balanced", selection: { asr: "asr-ai4b", llm: "llm-llama70", tts: "tts-ai4b1", telephony: "tel-vobiz", adapter: "adapter-coss" }, metrics: { turnLatencyS: 1.6, taskCompletion: 88, voiceQuality: 3.7, testCalls: 420, testDate: "2026-09-11", maxPeak: 120 }, minProfile: "standard", maxTier: 2, benchmarkLangs: ["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "ml"], support: ["business", "extended", "24x7"] },
  { id: "pkg-economy", name: "Samvad Economy", version: "1.1", tagline: "Lowest running cost for simple, high-volume calls.", bias: "cost", selection: { asr: "asr-whisper", llm: "llm-gemma9", tts: "tts-bodhan", telephony: "tel-bsnl", adapter: "adapter-none" }, metrics: { turnLatencyS: 2.5, taskCompletion: 74, voiceQuality: 3.4, testCalls: 260, testDate: "2026-08-04", maxPeak: 60 }, minProfile: "small", maxTier: 1, benchmarkLangs: ["hi", "en", "ta", "te"], support: ["business", "extended"] },
  { id: "pkg-premium", name: "Samvad Premium", version: "1.0", tagline: "Best measured task completion and voice quality.", bias: "quality", selection: { asr: "asr-sarvam", llm: "llm-qwen72", tts: "tts-sarvam1", telephony: "tel-plivo", adapter: "adapter-coss" }, metrics: { turnLatencyS: 1.5, taskCompletion: 93, voiceQuality: 4.3, testCalls: 510, testDate: "2026-09-20", maxPeak: 250 }, minProfile: "large", maxTier: 3, benchmarkLangs: ["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "ml", "pa", "or"], support: ["extended", "24x7"] },
  { id: "pkg-rapid", name: "Samvad Rapid", version: "1.3", tagline: "Fastest turns, with streaming speech.", bias: "latency", selection: { asr: "asr-sarvam", llm: "llm-gemma27", tts: "tts-sarvam2", telephony: "tel-plivo", adapter: "adapter-coss" }, metrics: { turnLatencyS: 1.1, taskCompletion: 84, voiceQuality: 4.1, testCalls: 330, testDate: "2026-09-05", maxPeak: 150 }, minProfile: "standard", maxTier: 2, benchmarkLangs: ["hi", "en", "ta", "te", "bn", "mr"], support: ["business", "extended", "24x7"] },
  { id: "pkg-global", name: "Hosted Global", version: "2.0", tagline: "Top commercial models on an approved cloud.", bias: "quality", selection: { asr: "asr-eleven", llm: "llm-openai", tts: "tts-chirp", telephony: "tel-plivo", adapter: "adapter-none" }, metrics: { turnLatencyS: 1.4, taskCompletion: 95, voiceQuality: 4.5, testCalls: 380, testDate: "2026-09-15", maxPeak: 300 }, minProfile: "standard", maxTier: 3, benchmarkLangs: ["hi", "en", "ta", "te", "bn", "mr", "gu", "pa", "kn", "ml"], support: ["extended", "24x7"] },
  { id: "pkg-sovereign", name: "Sovereign On-prem", version: "1.0", tagline: "Everything self-hosted, built for strict data rules.", bias: "balanced", selection: { asr: "asr-ai4b", llm: "llm-llama70", tts: "tts-ai4b2", telephony: "tel-tata", adapter: "adapter-coss" }, metrics: { turnLatencyS: 2.0, taskCompletion: 85, voiceQuality: 3.6, testCalls: 300, testDate: "2026-08-25", maxPeak: 150 }, minProfile: "standard", maxTier: 2, benchmarkLangs: ["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "ml"], support: ["business", "extended"] },
  { id: "pkg-bhashini", name: "Public Stack", version: "1.0", tagline: "Built on Bhashini services, widest language reach.", bias: "cost", selection: { asr: "asr-bhashini", llm: "llm-gemma27", tts: "tts-bhashini", telephony: "tel-bsnl", adapter: "adapter-coss" }, metrics: { turnLatencyS: 2.6, taskCompletion: 79, voiceQuality: 3.1, testCalls: 220, testDate: "2026-07-30", maxPeak: 80 }, minProfile: "standard", maxTier: 2, benchmarkLangs: ["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "pa", "ml", "or", "as", "ur"], support: ["business", "extended"] },
  { id: "pkg-regional", name: "Indic Regional", version: "1.1", tagline: "Strong across many Indian languages.", bias: "balanced", selection: { asr: "asr-ai4b", llm: "llm-qwen72", tts: "tts-ai4b2", telephony: "tel-tata", adapter: "adapter-coss" }, metrics: { turnLatencyS: 1.9, taskCompletion: 86, voiceQuality: 3.6, testCalls: 340, testDate: "2026-09-01", maxPeak: 160 }, minProfile: "standard", maxTier: 3, benchmarkLangs: ["hi", "en", "mr", "ta", "te", "kn", "gu", "bn", "pa", "ml"], support: ["business", "extended", "24x7"] },
];
export const PACKAGE_BY_ID: Record<string, CatalogPackage> = Object.fromEntries(PACKAGES.map((p) => [p.id, p]));

/* ------------------------------------------------------------------ choices for the forms */

export interface UseCase {
  id: string;
  label: string;
  complexity: Complexity;
  interaction: InteractionMode[];
  help: string;
}
export const USE_CASES: UseCase[] = [
  { id: "faq", label: "Answer citizen FAQs", complexity: "faq", interaction: ["inbound"], help: "Callers ask common questions and get answers from approved content." },
  { id: "status", label: "Application status helpline", complexity: "transactional", interaction: ["inbound"], help: "Callers check where an application stands. Needs a status lookup." },
  { id: "grievance", label: "Grievance intake and routing", complexity: "reasoning", interaction: ["inbound"], help: "Callers describe a problem in their own words. The agent classifies and routes it." },
  { id: "appointment", label: "Appointment booking", complexity: "transactional", interaction: ["inbound", "outbound"], help: "Book, move or cancel a slot, with a reminder call." },
  { id: "eligibility", label: "Scheme eligibility screening", complexity: "reasoning", interaction: ["inbound", "outbound"], help: "Ask a few questions and say which schemes may apply." },
  { id: "reminders", label: "Outbound reminders and alerts", complexity: "faq", interaction: ["broadcast"], help: "Call a list with a fixed message and record who picked up." },
  { id: "survey", label: "Surveys and feedback", complexity: "faq", interaction: ["outbound"], help: "Ask short questions after a service and capture answers." },
  { id: "collections", label: "Fee and bill reminders", complexity: "transactional", interaction: ["outbound"], help: "Remind about dues and take a promise to pay." },
];
export const USE_CASE_BY_ID: Record<string, UseCase> = Object.fromEntries(USE_CASES.map((u) => [u.id, u]));

export const CHANNELS: { id: Channel; label: string; help: string }[] = [
  { id: "pstn", label: "Phone (PSTN)", help: "Ordinary phone calls on a number." },
  { id: "sip", label: "SIP trunk", help: "Connects to your existing phone system." },
  { id: "web", label: "Web or app voice", help: "Citizens talk from a web page or an app." },
  { id: "whatsapp", label: "WhatsApp voice", help: "Voice calls inside WhatsApp." },
];

export const COMPLEXITIES: { id: Complexity; label: string; help: string; tokens: number; chars: number }[] = [
  { id: "faq", label: "Answer questions (FAQ)", help: "Short answers from fixed content. A small model is enough.", tokens: 1800, chars: 900 },
  { id: "transactional", label: "Transactional", help: "Look something up or complete a task in a few steps.", tokens: 2500, chars: 1200 },
  { id: "reasoning", label: "Complex reasoning", help: "Open-ended conversations that need judgement. Needs a stronger model.", tokens: 3600, chars: 1500 },
];
export const COMPLEXITY_TIER: Record<Complexity, 1 | 2 | 3> = { faq: 1, transactional: 2, reasoning: 3 };

export const VOICES: { id: VoicePref; label: string }[] = [
  { id: "none", label: "No preference" },
  { id: "female", label: "Female voice" },
  { id: "male", label: "Male voice" },
];

export const PRIORITIES: { id: Priority; label: string; help: string }[] = [
  { id: "cost", label: "Lowest cost", help: "Rank the cheapest packages that work first." },
  { id: "balanced", label: "Balanced", help: "Weigh cost, speed and quality equally." },
  { id: "quality", label: "Highest quality", help: "Rank the best measured task completion and voice first." },
];

export const LATENCIES: { id: "lt1" | "1-2" | "2-3" | "any"; label: string; maxS: number | null }[] = [
  { id: "lt1", label: "Under 1 second", maxS: 1 },
  { id: "1-2", label: "1 to 2 seconds", maxS: 2 },
  { id: "2-3", label: "2 to 3 seconds", maxS: 3 },
  { id: "any", label: "No limit", maxS: null },
];

export const HOSTING_OPTIONS: { id: HostingKind; label: string; where: string; confirm: string; approvals: string }[] = [
  { id: "govcloud", label: "Government cloud", where: "Runs in a government-approved cloud region in India.", confirm: "Confirm region, connectivity, required approvals and available services.", approvals: "Needs department and cloud-owner approval." },
  { id: "onprem", label: "On-prem / state cloud", where: "Runs in your own or a state data centre.", confirm: "Confirm capacity, GPU and CPU, storage, network and who operates it.", approvals: "Needs a capacity review and an operations owner." },
  { id: "approved", label: "Other approved cloud", where: "Runs in a commercial cloud your organisation has approved.", confirm: "Confirm provider, region, compute profile and data-transfer terms.", approvals: "Needs security approval for the provider." },
];

export const REGIONS: Record<HostingKind, { id: string; inCountry: boolean }[]> = {
  govcloud: [{ id: "Mumbai", inCountry: true }, { id: "Pune", inCountry: true }, { id: "Hyderabad", inCountry: true }, { id: "Delhi NCR", inCountry: true }, { id: "Chennai", inCountry: true }],
  onprem: [{ id: "Your data centre (India)", inCountry: true }, { id: "State data centre (India)", inCountry: true }],
  approved: [{ id: "Mumbai", inCountry: true }, { id: "Hyderabad", inCountry: true }, { id: "Singapore", inCountry: false }, { id: "Frankfurt", inCountry: false }],
};

export const OPERATORS = ["Platform-managed", "Department-operated", "Joint operation", "System integrator"];

export const DATA_TYPES: { id: DataType; label: string; help: string }[] = [
  { id: "recordings", label: "Recordings", help: "Audio of the call." },
  { id: "transcripts", label: "Transcripts", help: "Text of what was said." },
  { id: "logs", label: "Operational logs", help: "Technical records of how calls ran." },
  { id: "memory", label: "Agent memory", help: "What the agent remembers between calls." },
];
export const RETENTION_DAYS = [7, 30, 60, 90, 180, 365];
export const ACCESS_GROUPS: { id: AccessGroup; label: string }[] = [
  { id: "operations", label: "Operations" },
  { id: "auditors", label: "Auditors" },
  { id: "platform_admin", label: "Platform admin" },
  { id: "product", label: "Product team" },
  { id: "nobody", label: "Nobody" },
];

export const PII_TYPES: { id: PiiType; label: string }[] = [
  { id: "phone", label: "Phone numbers" },
  { id: "name", label: "Names" },
  { id: "email", label: "Email addresses" },
  { id: "govid", label: "Government IDs" },
  { id: "address", label: "Addresses" },
  { id: "custom", label: "Custom patterns" },
];

export const AVAILABILITY = [99, 99.5, 99.9, 99.95];
export const SUPPORT_MODELS: { id: SupportModel; label: string; fee: number; help: string }[] = [
  { id: "unset", label: "Not chosen yet", fee: 0, help: "Choose one before approval. The estimate assumes business hours." },
  { id: "business", label: "Business hours", fee: 8000, help: "Support on working days, 9 to 6." },
  { id: "extended", label: "Extended hours", fee: 12000, help: "Support 7 days a week, 8 to 10." },
  { id: "24x7", label: "24 × 7", fee: 20000, help: "Round-the-clock support with on-call engineers." },
];
export const AVAILABILITY_FEE: Record<number, number> = { 99: 0, 99.5: 2000, 99.9: 6000, 99.95: 12000 };

export const SETUP_FEES = { base: 80000, govApis: 30000, crm: 30000, telephony: 10000, adapter: 15000, disasterRecovery: 40000 };
export const DR_MONTHLY = 10000;

export const SAMPLE_NOTICE = "This call may be recorded and processed by an automated assistant to help with your request. Your details are used only for this service. You can ask for a person at any time.";
