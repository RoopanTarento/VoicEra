import type { SourceId } from "./source";

export type UseCaseId =
  | "survey-feedback"
  | "scheme-discovery"
  | "info-service"
  | "grievance"
  | "form-application"
  | "other";

export type Direction = "inbound" | "outbound" | "both";

export type GroupId =
  | "service"
  | "interaction"
  | "languages"
  | "content"
  | "outbound"
  | "inbound"
  | "volume"
  | "systems"
  | "governance"
  | "operations";

export type QKind =
  | "single"
  | "multi"
  | "yesno"
  | "number"
  | "range"
  | "shorttext"
  | "longtext"
  | "language"
  | "table"
  | "fileReadiness"
  | "assumption";

export interface QOption {
  value: string;
  label: string;
  hint?: string;
  /** Numeric meaning for range options, used by the rules. */
  numeric?: number;
}

export interface FileReadiness {
  count?: number | null;
  maxMB?: number | null;
  formats?: string[];
}

export type TableRow = Record<string, string>;

/**
 * What the person has told us so far.
 * `unknown[id]` means they chose "Not sure yet", which is different from not having been asked.
 */
export interface Answers {
  values: Record<string, unknown>;
  unknown: Record<string, boolean>;
  origin: Record<string, "user" | "interpreted">;
}

export interface Question {
  id: string;
  group: GroupId;
  label: string;
  /** Short plain-language reason this is being asked. */
  why: string;
  kind: QKind;
  options?: QOption[];
  unit?: string;
  min?: number;
  max?: number;
  columns?: { key: string; label: string; placeholder?: string }[];
  placeholder?: string;
  required: boolean;
  /** Offers "Not sure yet". */
  allowUnknown?: boolean;
  /** What happens in the result if they pick it. */
  onUnknown?: string;
  /** Use cases this question applies to. Omit for all. */
  appliesTo?: UseCaseId[];
  /** Earlier-answer trigger. */
  when?: (a: Answers) => boolean;
  /** Shown, but folded away until asked for. */
  optionalDetail?: boolean;
  /** Part of the optional technical section. */
  technical?: boolean;
  affects: { fit?: boolean; feasibility?: boolean; cost?: boolean; dependency?: boolean };
  /** Is this question something the supplied package document speaks to? */
  source: { supported: boolean; refs: SourceId[] };
}

export type Objective = {
  id: string;
  label: string;
  plain: string;
  useCase: UseCaseId;
  /** Direction the document supports, and so what we assume until told otherwise. */
  defaultDirection?: Direction;
  example: string;
  needsTopic?: boolean;
};

export type DimensionId =
  | "use-case"
  | "direction"
  | "duration"
  | "languages"
  | "knowledge"
  | "telephony"
  | "integration"
  | "usage"
  | "campaign-ops"
  | "hosting"
  | "data-security"
  | "commercial"
  | "readiness"
  | "dependencies";

export type DimResult = "fit" | "conditional" | "unresolved" | "review" | "blocked" | "na";

export interface DimensionOutcome {
  id: DimensionId;
  label: string;
  /** The person's answer, in words. */
  answer: string;
  /** What the package documents. */
  requirement: string;
  result: DimResult;
  consequence: string;
  nextAction: string;
  sources: SourceId[];
  /** Which rules fired, for "how we arrived at this". */
  ruleIds: string[];
  /** Questions that drove this result. */
  questionIds: string[];
}

export type Outcome =
  | "suitable"
  | "suitable-with-conditions"
  | "needs-review"
  | "outside-scope";

export interface Finding {
  id: string;
  severity: "blocker" | "review" | "condition" | "info";
  title: string;
  detail: string;
  dimension: DimensionId;
  sources: SourceId[];
}

export interface Evaluation {
  useCase: UseCaseId;
  direction: Direction | null;
  outcome: Outcome;
  /** Set when a mandatory data requirement cannot be verified. */
  pendingGovernance: boolean;
  dimensions: DimensionOutcome[];
  findings: Finding[];
  integrationNeeded: boolean;
  integrationReasons: string[];
  setupCanStart: boolean;
  setupBlockers: string[];
  answeredCount: number;
  unknownCount: number;
}
