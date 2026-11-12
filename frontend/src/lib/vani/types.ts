/** The shapes of everything Vani Anuvaad stores and computes. */

export type Role = "admin" | "product_manager" | "operations" | "reviewer" | "viewer";

export type InteractionMode = "inbound" | "outbound" | "broadcast";
export type Channel = "pstn" | "sip" | "web" | "whatsapp";
export type Complexity = "faq" | "transactional" | "reasoning";
export type VoicePref = "none" | "female" | "male";
export type Priority = "cost" | "balanced" | "quality";
export type LatencyTarget = "lt1" | "1-2" | "2-3" | "any";
export type HostingKind = "govcloud" | "onprem" | "approved";
export type RecordingPolicy = "off" | "consent" | "always";
export type TranscriptPolicy = "none" | "redacted" | "full";
export type DataType = "recordings" | "transcripts" | "logs" | "memory";
export type AccessGroup = "operations" | "auditors" | "platform_admin" | "product" | "nobody";
export type SupportModel = "unset" | "business" | "extended" | "24x7";
export type StepId = "requirements" | "hosting" | "recommendation" | "configure" | "quote";
export type PiiType = "phone" | "name" | "email" | "govid" | "address" | "custom";

export interface Requirements {
  serviceName: string;
  useCase: string;
  interaction: InteractionMode[];
  channel: Channel;
  complexity: Complexity;
  languages: string[];
  voice: VoicePref;
  dialects: boolean;
  codeSwitching: boolean;
  callsPerMonth: number | null;
  avgMinutes: number | null;
  peakConcurrent: number | null;
  growthPct: number | null;
  priority: Priority;
  latency: LatencyTarget;
  monthlyBudget: number | null;
  costPerMinute: number | null;
}

export interface RetentionRule {
  days: number | null;
  access: AccessGroup;
}

export interface Hosting {
  kind: HostingKind;
  region: string;
  operator: string;
  inCountry: boolean;
  recording: RecordingPolicy;
  transcripts: TranscriptPolicy;
  retention: Record<DataType, RetentionRule>;
  pii: PiiType[];
  piiCustom: string;
  integrations: { telephony: boolean; adapter: boolean; govApis: boolean; crm: boolean };
  availability: number;
  support: SupportModel;
  disasterRecovery: boolean;
  callerNotice: string;
  retentionConfirmedBy: string;
}

export interface Usage {
  callsPerMonth: number;
  avgMinutes: number;
  peakConcurrency: number;
  llmTokensPerCall: number;
  ttsCharsPerCall: number;
}

export interface Selection {
  asr: string;
  llm: string;
  tts: string;
  telephony: string;
  adapter: string;
  hostingProfile: string;
}

export type OpenItemState = "open" | "resolved" | "accepted";
export interface OpenItemRecord {
  state: OpenItemState;
  note?: string;
  by?: string;
  at?: string;
}

export interface CostLine {
  id: "asr" | "llm" | "tts" | "telephony" | "hosting" | "language" | "platform";
  label: string;
  unitRate: string;
  usage: string;
  monthly: number | null;
  note?: string;
}

export interface CostResult {
  lines: CostLine[];
  recurring: number;
  oneTime: number;
  budgetUsedPct: number | null;
  overBudget: boolean;
  perMinute: number;
  perMinuteOver: boolean;
  /** Projected recurring at month twelve, if growth is given. */
  recurringAt12: number | null;
  minutes: number;
  excluded: string[];
}

export interface VersionSnapshot {
  id: string;
  label: string;
  note: string;
  createdAt: string;
  createdBy: string;
  selection: Selection;
  usage: Usage;
  monthly: number;
  oneTime: number;
  latencyS: number;
  baseId: string;
}

export type ApprovalState = "draft" | "submitted" | "approved";
export interface ApprovalEvent {
  action: "created" | "submitted" | "approved" | "returned" | "withdrawn";
  by: string;
  at: string;
  note?: string;
}

export interface QuoteRecord {
  id: string;
  createdAt: string;
  validUntil: string;
  state: ApprovalState;
  versionLabel: string;
  events: ApprovalEvent[];
}

export interface Recommendation {
  generatedAt: string;
  inputHash: string;
  baseId: string;
  variant: "recommended" | "cost" | "quality" | "latency";
}

export interface PackageRecord {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  step: StepId;
  reached: StepId[];
  requirements: Requirements;
  hosting: Hosting;
  recommendation: Recommendation | null;
  selection: Selection | null;
  usage: Usage | null;
  versions: VersionSnapshot[];
  quote: QuoteRecord | null;
  openItems: Record<string, OpenItemRecord>;
  archived: boolean;
}

export interface User {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  verified: boolean;
  hash: string;
  salt: string;
  createdAt: string;
  lastSignIn: string | null;
  status: "active" | "invited";
}

export interface Org {
  id: string;
  name: string;
  environment: "Production" | "Sandbox";
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  remember: boolean;
}

export interface AuditEntry {
  id: string;
  orgId: string;
  at: string;
  by: string;
  action: string;
  target: string;
  detail?: string;
}

export interface Notice {
  id: string;
  orgId: string;
  at: string;
  title: string;
  body: string;
  href?: string;
  read: boolean;
}

export interface Agent {
  id: string;
  orgId: string;
  packageId: string;
  quoteId: string;
  name: string;
  versionLabel: string;
  createdAt: string;
  createdBy: string;
  status: "setup" | "testing" | "live";
  checklist: Record<string, boolean>;
}

export interface Simulation {
  network: boolean;
  recommendationDown: boolean;
  pricingDown: boolean;
  pdfFails: boolean;
  stalePricing: boolean;
  unavailableProviders: string[];
}

export interface Token {
  token: string;
  kind: "verify" | "reset";
  userId: string;
  expiresAt: string;
  used: boolean;
}

export interface Db {
  version: 1;
  orgs: Org[];
  users: User[];
  sessions: Session[];
  tokens: Token[];
  packages: PackageRecord[];
  audit: AuditEntry[];
  notices: Notice[];
  agents: Agent[];
  counters: { quote: number };
  attempts: Record<string, { count: number; until: number }>;
  simulation: Simulation;
  ratesAsOf: string;
}

export const STEPS: { id: StepId; n: number; label: string; short: string }[] = [
  { id: "requirements", n: 1, label: "Requirements", short: "Requirements" },
  { id: "hosting", n: 2, label: "Hosting & data", short: "Hosting & data" },
  { id: "recommendation", n: 3, label: "Recommendation", short: "Recommendation" },
  { id: "configure", n: 4, label: "Configure & price", short: "Configure" },
  { id: "quote", n: 5, label: "Quote", short: "Quote" },
];
export const stepIndex = (s: StepId) => STEPS.findIndex((x) => x.id === s);
