/**
 * Shared types for the adopter experience (/adopt).
 *
 * Source of truth for content: "ICP - Voicera [Use Case Based] 6-Oct-26".
 * Anything that is NOT in that document is tagged `inferred` or `tbc`
 * (to be confirmed) rather than presented as fact.
 */

export type ApplicationId =
  | "grievance"
  | "scheme-discovery"
  | "surveys"
  | "form-filling"
  | "application-support";

export type PackageId = "deploy" | "connect" | "orchestrate";

/** Where a statement comes from, so the UI never blurs source and assumption. */
export type Provenance = "icp" | "repo" | "inferred" | "tbc";

/** How far a platform capability is available today. */
export type Availability = "available" | "partial" | "planned" | "unavailable";

export type ArchetypeId = "always-on" | "programme" | "complex";

export interface Archetype {
  id: ArchetypeId;
  name: string;
  tagline: string;
  interactionModel: string;
  coreNeed: string;
  opportunity: string;
  strategicRole: string;
  productFamily: ProductFamilyId | null;
}

export type ProductFamilyId = "resolution" | "engagement";

export interface ProductFamily {
  id: ProductFamilyId;
  name: string;
  need: string;
  workflow: string[];
  examples: string;
  deploymentModel: string;
  variants: { name: string; interaction: string; outbound: string; inbound: string; example: string }[];
}

export interface Segment {
  id: string;
  name: string;
  archetype: ArchetypeId;
  workflow: string;
  whyItWins: string;
  role: string;
  adopters: string;
  /** Ready-to-deploy applications that fit this segment. */
  applications: ApplicationId[];
  /** Why the mapping holds, or that it is our inference. */
  fitNote: string;
  fitSource: Provenance;
  /** For the complex-administrative archetype the ICP gives a challenge instead. */
  challenge?: string;
}

export interface PlatformLayer {
  id: string;
  name: string;
  question: string;
  items: string[];
}

export interface PackageDef {
  id: PackageId;
  name: string;
  positioning: string;
  bestFor: string;
  included: string[];
  integration: string;
  typicalLaunch: string;
  /** Adopter-perspective fields. `source` marks what the ICP states vs what we add. */
  who: string;
  problem: string;
  accomplish: string[];
  youProvide: string[];
  weConfigure: string[];
  dependencies: string[];
  outOfScope: string[];
  nextSteps: string[];
  applications: ApplicationId[];
  /** Short note on provenance of the adopter-perspective fields. */
  provenanceNote: string;
}

export interface Capability {
  id: string;
  label: string;
  layer: string;
  availability: Availability;
  /** What the ICP document says about it ("VoicEra today" column). */
  icpSays: string;
  /** What the repository check on 5 Oct 2026 found, when it adds anything. */
  repoNote?: string;
  priority?: "P0" | "P1" | "P2" | "Maintain" | "Deepen" | "Double down";
}

export interface ConversationTurn {
  who: "citizen" | "agent" | "note";
  text: string;
}

export interface ScenarioChoice {
  text: string;
  to: string;
  /** Values remembered for later `{{key}}` use, e.g. the complaint category. */
  set?: Record<string, string>;
}

export interface ScenarioStep {
  id: string;
  /** What the agent says. `{{key}}` is replaced from the saved configuration. */
  agent: string;
  /** Behaviours the adopter should confirm; recorded when the step is reached. */
  observes?: string[];
  choices?: ScenarioChoice[];
  /** The step ends the conversation. */
  end?: boolean;
  /** Configuration keys that must be filled for this step to be realistic. */
  requires?: { key: string; gap: string }[];
  /** A call to an adopter system that is only described, never made, in the simulation. */
  action?: { integrationId: string; label: string };
  /** Free text that does not match anything is treated as "not understood" here. */
  repromptTo?: string;
}

export interface ScenarioDef {
  id: string;
  title: string;
  situation: string;
  /** Behaviours the adopter should confirm across the whole run. */
  expects: string[];
  start: string;
  steps: Record<string, ScenarioStep>;
}

export interface ConfigRowColumn {
  key: string;
  label: string;
  placeholder?: string;
  kind?: "text" | "number" | "select";
  options?: string[];
  width?: string;
}

export type ConfigFieldKind =
  | "text"
  | "textarea"
  | "tags"
  | "languages"
  | "select"
  | "rows"
  | "toggle"
  | "time"
  | "number"
  | "date";

export interface ConfigField {
  key: string;
  label: string;
  kind: ConfigFieldKind;
  help?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: { regex: string; message: string };
  options?: { value: string; label: string; note?: string }[];
  columns?: ConfigRowColumn[];
  minRows?: number;
  minTags?: number;
  min?: number;
  max?: number;
}

export interface ConfigSection {
  id: string;
  title: string;
  description: string;
  fields: ConfigField[];
}

export interface IntegrationDef {
  id: string;
  name: string;
  purpose: string;
  /** "required" for this application at the recommended package, "optional", or "none". */
  need: "required" | "optional" | "none";
  forPackage: PackageId[];
  /** What the adopter's IT team must supply. */
  inputs: string[];
  /** Platform-side availability of the generic capability this relies on. */
  platform: Availability;
  platformNote: string;
}

export interface KnowledgeNeed {
  name: string;
  detail: string;
  required: boolean;
}

export interface ApplicationDef {
  id: ApplicationId;
  name: string;
  oneLine: string;
  problem: string;
  adopter: string;
  owners: string;
  bestFit: string;
  /** The ICP's own one-line flow. */
  icpFlow: string;
  journey: { step: string; detail: string }[];
  example: { title: string; context: string; turns: ConversationTurn[] };
  canDo: string[];
  prebuilt: string;
  configure: string[];
  knowledge: KnowledgeNeed[];
  integrations: IntegrationDef[];
  integrationSummary: string;
  handoff: string[];
  testing: string[];
  measures: { name: string; detail: string }[];
  recommendedPackage: PackageId;
  packageReason: string;
  launchReadiness: string;
  /** Capability ids this application depends on (see capabilities.ts). */
  needs: string[];
  segments: string[];
  scenarios: ScenarioDef[];
  configSections: ConfigSection[];
  defaults: Record<string, unknown>;
  outbound: boolean;
  inbound: boolean;
}

/* ---------- state ---------- */

export interface QuestionnaireAnswers {
  segmentId?: string;
  department?: string;
  objective?: string;
  direction?: "inbound" | "outbound" | "both";
  users?: string;
  applicationId?: ApplicationId;
  volume?: string;
  languages?: string[];
  systems?: string[];
  apiReadiness?: "ready" | "later" | "no" | "unsure";
  environment?: string;
  retention?: "yes" | "no" | "unsure";
  handoff?: "staffed" | "partial" | "none" | "unsure";
  approvals?: "yes" | "no" | "unsure";
  actions?: "talk" | "status" | "write";
}

export interface Recommendation {
  applicationId: ApplicationId;
  packageId: PackageId;
  whyApplication: string[];
  whyPackage: string[];
  configureNow: string[];
  dependencies: { text: string; severity: "blocker" | "needs-decision" | "note" }[];
  teamNeeds: string[];
  alternatives: { title: string; text: string; provenance: Provenance }[];
  openQuestions: string[];
}

export type ReadinessStatus = "done" | "in-progress" | "blocked" | "not-applicable";

export interface ScenarioResult {
  scenarioId: string;
  ran: boolean;
  /** Behaviours (from `expects`) the simulation observed. */
  observed: string[];
  gaps: string[];
  verdict: "unreviewed" | "passed" | "needs-work";
  reviewedAt?: string;
}

export interface KnowledgeSourceEntry {
  id: string;
  name: string;
  kind: string;
  status: "draft" | "in-review" | "approved";
  notes: string;
}

export interface IntegrationEntry {
  id: string;
  status: "not-started" | "details-entered" | "reviewed";
  endpoint: string;
  authMethod: string;
  owner: string;
  notes: string;
}

export interface ApprovalEntry {
  id: string;
  label: string;
  why: string;
  approver: string;
  date: string;
  confirmed: boolean;
}

export type DeployStage = "idle" | "running" | "done";

export interface WorkspaceState {
  started: boolean;
  applicationId: ApplicationId | null;
  packageId: PackageId | null;
  config: Record<string, unknown>;
  configSaved: boolean;
  knowledge: KnowledgeSourceEntry[];
  integrations: Record<string, IntegrationEntry>;
  results: Record<string, ScenarioResult>;
  approvals: ApprovalEntry[];
  accessChecked: boolean;
  handoffReviewed: boolean;
  environment: string;
  deploy: { stage: DeployStage; log: string[]; finishedAt?: string };
}
