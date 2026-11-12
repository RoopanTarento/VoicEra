/**
 * VoicEra Fully Loaded (Platinum): the package as documented.
 *
 * Everything the advisor treats as a fact about the package is defined here,
 * once, with a reference to the section of the supplied package document it
 * came from. The UI and the rules read from this file. Nothing here is
 * invented: items the document leaves open are listed under `unresolved` and
 * are never turned into commitments.
 *
 * Plain relative imports only, so this module can be compiled and tested
 * without React or the Next.js toolchain.
 */

export type SourceId =
  | "PKG-SUMMARY"
  | "PKG-INCLUDES"
  | "PKG-SUITED"
  | "PKG-BRING"
  | "PKG-SCALE"
  | "PKG-SUPPORT"
  | "PKG-SLA"
  | "PKG-LANG"
  | "PKG-KB"
  | "PKG-FEATURES"
  | "PKG-OOS"
  | "PKG-NOTREC"
  | "PKG-MODELS"
  | "PKG-TELEPHONY"
  | "PKG-COST"
  | "PKG-BILLING"
  | "PKG-QUALITY"
  | "PKG-DASH"
  | "PKG-FAQ"
  | "ICP"
  | "ASSUMPTION";

export const SOURCES: Record<SourceId, { label: string; note?: string }> = {
  "PKG-SUMMARY": { label: "Package document: Offer summary" },
  "PKG-INCLUDES": { label: "Package document: What's included" },
  "PKG-SUITED": { label: "Package document: Suited for" },
  "PKG-BRING": { label: "Package document: What the department needs to bring" },
  "PKG-SCALE": { label: "Package document: Latency and scale supported" },
  "PKG-SUPPORT": { label: "Package document: Setup and campaign operations support" },
  "PKG-SLA": { label: "Package document: SLA offered" },
  "PKG-LANG": { label: "Package document: Languages supported" },
  "PKG-KB": { label: "Package document: Knowledge base integration support" },
  "PKG-FEATURES": { label: "Package document: Other features supported" },
  "PKG-OOS": { label: "Package document: Out of scope" },
  "PKG-NOTREC": { label: "Package document: Not recommended or suitable for" },
  "PKG-MODELS": { label: "Package document: Models supported", note: "Marked in the document as a sample list, not the actual list." },
  "PKG-TELEPHONY": { label: "Package document: Telephony supported", note: "Marked in the document as a sample list, not the actual list." },
  "PKG-COST": { label: "Package document: Cost to be paid by the department" },
  "PKG-BILLING": { label: "Package document: Billing entity" },
  "PKG-QUALITY": { label: "Package document: Model quality parameters" },
  "PKG-DASH": { label: "Package document: Dashboard metrics" },
  "PKG-FAQ": { label: "Package document: FAQs", note: "Answers are blank in the supplied document." },
  ICP: { label: "VoicERA ICP document (6 Oct 2026)" },
  ASSUMPTION: { label: "Assumption, needs verification" },
};

export const DOCUMENTED_LANGUAGES = [
  "English",
  "Hindi",
  "Marathi",
  "Tamil",
  "Telugu",
  "Kannada",
  "Gujarati",
  "Bengali",
  "Punjabi",
  "Assamese",
  "Malayalam",
] as const;

/** Languages offered in the picker. Anything beyond the documented 11 is verified, not assumed. */
export const OTHER_LANGUAGES = ["Odia", "Urdu", "Konkani", "Maithili", "Sanskrit", "Santali", "Dogri", "Kashmiri", "Nepali", "Sindhi", "Manipuri", "Bodo"] as const;

export const PLATINUM = {
  id: "platinum-fully-loaded",
  name: "VoicEra Fully Loaded (Platinum)",
  shortName: "Platinum",
  summary:
    "A fully loaded voice AI package for government departments, hosted on Bhashini and billed to Bhashini, with platform and services support included.",
  limits: {
    maxConcurrentCalls: { value: 500, src: "PKG-SCALE" as SourceId },
    latencyTargetSeconds: { value: 1.5, src: "PKG-SCALE" as SourceId },
    uptimePercent: { value: 99.8, src: "PKG-SCALE" as SourceId },
    setupSlaWorkingDays: { value: 2, src: "PKG-SLA" as SourceId },
    troubleshootingHours: { value: 24, src: "PKG-SLA" as SourceId },
    postCampaignAnalysisWorkingDays: { value: 3, src: "PKG-SLA" as SourceId },
    maxCampaignOpsPerMonth: { value: 10, src: "PKG-SUPPORT" as SourceId },
    maxKnowledgeFiles: { value: 10, src: "PKG-KB" as SourceId },
    maxKnowledgeFileMB: { value: 5, src: "PKG-KB" as SourceId },
    knowledgeFileTypes: { value: ["Text"], src: "PKG-KB" as SourceId },
    maxConversationMinutes: { value: 3, src: "PKG-NOTREC" as SourceId },
    customTelephonyTimelineWeeks: { value: [2, 4] as [number, number], src: "PKG-TELEPHONY" as SourceId },
  },
  voiceModelChoices: { value: 3, src: "PKG-INCLUDES" as SourceId },
  llmModelChoices: { value: 2, src: "PKG-INCLUDES" as SourceId },
  support: {
    dedicatedCampaignOperators: 1,
    sharedProgrammeManagers: 1,
    src: "PKG-SUPPORT" as SourceId,
  },
  hosting: { value: "Hosted on Bhashini", src: "PKG-SUMMARY" as SourceId },
  billingEntity: { value: "Bhashini", src: "PKG-BILLING" as SourceId },
  commercial: {
    oneTimeSetupInr: { value: 50000, src: "PKG-COST" as SourceId },
    perNumberInr: { value: 500, src: "PKG-COST" as SourceId },
    openSourcePerMinuteInr: {
      value: 0.5,
      src: "PKG-COST" as SourceId,
      note: "End to end, including telephony.",
    },
    proprietaryPerMinuteInr: null as null,
    proprietaryNote: "Depends on model choices. The pricing table the document refers to has not been supplied.",
  },
  documentedUseCases: [
    { id: "survey-feedback", label: "Citizen feedback and surveys", directions: ["outbound"] as const },
    { id: "scheme-discovery", label: "Scheme discovery", directions: ["inbound", "outbound"] as const },
  ],
  outOfScope: [
    { id: "custom-integration", label: "Custom integration to any department system", src: "PKG-OOS" as SourceId },
    { id: "whatsapp-calling", label: "Integration with WhatsApp calling", src: "PKG-OOS" as SourceId },
  ],
  notRecommended: [
    { id: "long-conversation", label: "Conversations beyond 3 minutes", src: "PKG-NOTREC" as SourceId },
    { id: "multimodal", label: "Multi-modality", src: "PKG-NOTREC" as SourceId },
    {
      id: "partial-stack",
      label: "Used as a partial stack",
      src: "PKG-NOTREC" as SourceId,
      note: "The document says to refer to other packages for this request. Those packages are not defined in the supplied material.",
    },
  ],
  departmentBrings: [
    { id: "use-case", label: "A use case", src: "PKG-BRING" as SourceId },
    { id: "script", label: "Conversation script flow", src: "PKG-BRING" as SourceId },
    { id: "knowledge-base", label: "A basic knowledge base", src: "PKG-BRING" as SourceId },
    { id: "phone-numbers", label: "Citizens' phone numbers for outbound campaigns", src: "PKG-BRING" as SourceId },
    { id: "test-resources", label: "Resources to test calls after agent setup and before launch", src: "PKG-BRING" as SourceId },
  ],
  features: [
    { id: "language-switch", label: "Automatic detection of the speaker's language and switching mid-call", src: "PKG-FEATURES" as SourceId },
    { id: "hold-messages", label: "Hold messages", src: "PKG-FEATURES" as SourceId },
    { id: "custom-intro", label: "Custom introduction message", src: "PKG-FEATURES" as SourceId },
    { id: "noise-cancellation", label: "Noise cancellation configuration", src: "PKG-FEATURES" as SourceId },
    { id: "browser-or-telephony", label: "Browser or telephony delivery", src: "PKG-FEATURES" as SourceId },
  ],
  included: [
    {
      group: "Voice AI and orchestration",
      items: [
        { label: "Full-stack voice AI engine for citizen service", src: "PKG-INCLUDES" as SourceId },
        { label: "VoicERA orchestration", src: "PKG-INCLUDES" as SourceId },
        { label: "End-to-end latency target under 1.5 seconds (a target, not a guarantee for every case)", src: "PKG-SCALE" as SourceId },
      ],
    },
    {
      group: "Languages and models",
      items: [
        { label: "English and ten Indian languages", src: "PKG-LANG" as SourceId },
        { label: "Automatic language detection and mid-call switching", src: "PKG-FEATURES" as SourceId },
        { label: "Three pre-integrated voice model choices", src: "PKG-INCLUDES" as SourceId },
        { label: "Two pre-integrated LLM choices", src: "PKG-INCLUDES" as SourceId },
      ],
    },
    {
      group: "Telephony",
      items: [
        { label: "Telephony integration with phone numbers", src: "PKG-INCLUDES" as SourceId },
        { label: "Delivery over browser or telephony", src: "PKG-FEATURES" as SourceId },
        { label: "Option to use your own telephony provider and numbers (2 to 4 weeks, case by case)", src: "PKG-TELEPHONY" as SourceId },
      ],
    },
    {
      group: "Agent and campaign configuration",
      items: [
        { label: "Agent and campaign builder", src: "PKG-INCLUDES" as SourceId },
        { label: "Custom introduction message and hold messages", src: "PKG-FEATURES" as SourceId },
        { label: "Noise cancellation configuration", src: "PKG-FEATURES" as SourceId },
        { label: "Knowledge base: up to 10 text files, up to 5 MB each", src: "PKG-KB" as SourceId },
      ],
    },
    {
      group: "Monitoring and analysis",
      items: [
        { label: "Campaign monitoring and analysis dashboard", src: "PKG-INCLUDES" as SourceId },
        { label: "Post-campaign analysis shared within 3 working days", src: "PKG-SLA" as SourceId },
        { label: "Structured dataset collected, downloadable (surveys and feedback)", src: "PKG-DASH" as SourceId },
      ],
    },
    {
      group: "Hosting",
      items: [{ label: "Hosted on Bhashini, billed to Bhashini", src: "PKG-SUMMARY" as SourceId }],
    },
    {
      group: "Setup and campaign operations support",
      items: [
        { label: "One dedicated campaign operator and one shared programme manager", src: "PKG-SUPPORT" as SourceId },
        { label: "Campaign setup and monitoring support, up to 10 a month", src: "PKG-SUPPORT" as SourceId },
        { label: "Voice agent set up in 2 working days after all requirements are provided", src: "PKG-SLA" as SourceId },
        { label: "24-hour support to troubleshoot an issue", src: "PKG-SLA" as SourceId },
      ],
    },
  ],
  dashboardMetrics: [
    "Number of campaigns (date selector)",
    "Number of calls, overall and per campaign (date selector)",
    "Calls broken down by attempted, connected, dropped and completed",
    "Average call length",
    "Structured dataset collected, as columns and rows (surveys and feedback only, downloadable)",
  ],
  telephonySample: ["BSNL", "Tata", "Vobiz", "Plivo", "Vodafone", "Ubona"],
  telephonyTech: ["SIP trunk", "Cloud SIP", "WebSocket"],
  modelSample: {
    asr: ["AI4Bharat", "Sarvam", "Eleven Labs"],
    llm: ["Gemma", "Llama", "Qwen", "OpenAI"],
    tts: ["AI4Bharat", "Bodhan", "Sarvam", "Google Chirp"],
  },
  /** Open items. The document either leaves these blank or marks them as samples. */
  unresolved: [
    { id: "data-storage", label: "Where call data is stored", src: "PKG-FAQ" as SourceId },
    { id: "model-training", label: "Whether call data is used to train models", src: "PKG-FAQ" as SourceId },
    { id: "retention", label: "How long call data is kept", src: "PKG-FAQ" as SourceId },
    { id: "number-file-api", label: "Whether a caller-number file can be read through an API instead of a supplied list", src: "PKG-FAQ" as SourceId },
    { id: "model-list", label: "The actual voice and LLM model options (the document lists samples only)", src: "PKG-MODELS" as SourceId },
    { id: "proprietary-pricing", label: "Per-minute pricing for proprietary models", src: "PKG-COST" as SourceId },
    { id: "telephony-partners", label: "The actual pre-integrated telephony partners (the document lists samples only)", src: "PKG-TELEPHONY" as SourceId },
    { id: "model-quality", label: "Model quality, which the document defers to a Voice Arena report not yet supplied", src: "PKG-QUALITY" as SourceId },
  ],
} as const;

export const CONFIRMATION_LINE =
  "This needs confirmation from the responsible VoicEra/Bhashini team before the department can make a decision.";

export const INTEGRATION_GAP_LINE =
  "Platinum does not include custom integration with departmental systems. Your requirement needs a separate feasibility assessment.";

export function isDocumentedLanguage(name: string): boolean {
  return (DOCUMENTED_LANGUAGES as readonly string[]).includes(name);
}
