import { SEGMENTS } from "../icp";
import type { Answers, Direction, Objective, UseCaseId } from "./types";

/**
 * The objective is what a department officer says they want. The use case is
 * how the package document would classify it. The hierarchy follows the brief:
 *
 *   Government adopter > Department or sector > Public-service objective >
 *   Use case > Interaction type > Package requirements > Recommendation > Plan
 */
export const HIERARCHY = [
  { id: "adopter", label: "Government adopter" },
  { id: "sector", label: "Department or sector" },
  { id: "objective", label: "Service objective" },
  { id: "use-case", label: "Use case" },
  { id: "interaction", label: "Interaction" },
  { id: "requirements", label: "Package requirements" },
  { id: "recommendation", label: "Recommendation" },
  { id: "plan", label: "Adoption plan" },
] as const;

export const OBJECTIVES: Objective[] = [
  {
    id: "feedback-service",
    label: "Collect feedback after a public-service interaction",
    plain: "Call citizens after they used a service and ask how it went.",
    useCase: "survey-feedback",
    defaultDirection: "outbound",
    example: "Call people a few days after they visited a government office.",
  },
  {
    id: "citizen-survey",
    label: "Run a citizen survey",
    plain: "Ask a group of citizens a set of questions and collect their answers.",
    useCase: "survey-feedback",
    defaultDirection: "outbound",
    example: "A programme evaluation across a district.",
  },
  {
    id: "scheme-discover",
    label: "Help citizens discover government schemes",
    plain: "Citizens say what they need. The service tells them which schemes may apply.",
    useCase: "scheme-discovery",
    example: "A farmer asks what support is available for seeds.",
  },
  {
    id: "scheme-questions",
    label: "Answer questions about scheme eligibility or benefits",
    plain: "Answer common questions from approved scheme information.",
    useCase: "scheme-discovery",
    example: "Who qualifies for a pension, and what do they need to bring?",
  },
  {
    id: "outbound-info",
    label: "Run an outbound information campaign",
    plain: "Call citizens to tell them about something, and answer their questions.",
    useCase: "info-service",
    defaultDirection: "outbound",
    example: "Tell eligible families about a scheme and the last date to apply.",
    needsTopic: true,
  },
  {
    id: "inbound-info",
    label: "Provide an inbound voice information service",
    plain: "A phone number citizens can call to get information.",
    useCase: "info-service",
    defaultDirection: "inbound",
    example: "A helpline that answers questions about a service.",
    needsTopic: true,
  },
  {
    id: "complaints",
    label: "Register or track citizen complaints",
    plain: "Take a complaint by phone and file it in your system.",
    useCase: "grievance",
    defaultDirection: "inbound",
    example: "Report a pothole and get a reference number.",
  },
  {
    id: "forms",
    label: "Help citizens complete a form or application",
    plain: "Collect details by voice and pass them to your form or system.",
    useCase: "form-application",
    defaultDirection: "inbound",
    example: "Register for a camp over the phone.",
  },
  {
    id: "other",
    label: "Something else",
    plain: "Describe it in your own words and we will check it against the package.",
    useCase: "other",
    example: "Anything not on this list.",
  },
];

export const OBJECTIVE_BY_ID: Record<string, Objective> = Object.fromEntries(OBJECTIVES.map((o) => [o.id, o]));

export interface UseCaseInfo {
  id: UseCaseId;
  label: string;
  /** Is it one of the two documented use cases? */
  documented: boolean;
  documentedDirections: Direction[];
  note: string;
  /** Existing ICP application, for linking into the rest of the experience. */
  icpApplication?: "surveys" | "scheme-discovery" | "grievance" | "form-filling";
}

export const USE_CASES: Record<UseCaseId, UseCaseInfo> = {
  "survey-feedback": {
    id: "survey-feedback",
    label: "Citizen feedback and surveys",
    documented: true,
    documentedDirections: ["outbound"],
    note: "Documented as suited for outbound.",
    icpApplication: "surveys",
  },
  "scheme-discovery": {
    id: "scheme-discovery",
    label: "Scheme discovery",
    documented: true,
    documentedDirections: ["inbound", "outbound", "both"],
    note: "Documented as suited for inbound and outbound.",
    icpApplication: "scheme-discovery",
  },
  "info-service": {
    id: "info-service",
    label: "Information service (not about schemes)",
    documented: false,
    documentedDirections: [],
    note: "Not one of the two documented use cases. Needs confirmation.",
  },
  grievance: {
    id: "grievance",
    label: "Complaint registration and tracking",
    documented: false,
    documentedDirections: [],
    note: "Not documented for this package, and it normally needs a connection to a complaints system.",
    icpApplication: "grievance",
  },
  "form-application": {
    id: "form-application",
    label: "Form filling and application support",
    documented: false,
    documentedDirections: [],
    note: "Not documented for this package, and it normally needs a connection to a form or application system.",
    icpApplication: "form-filling",
  },
  other: {
    id: "other",
    label: "Another use case",
    documented: false,
    documentedDirections: [],
    note: "Not one of the two documented use cases.",
  },
};

export function emptyAnswers(): Answers {
  return { values: {}, unknown: {}, origin: {} };
}

export function getValue<T = unknown>(a: Answers, id: string): T | undefined {
  return a.values[id] as T | undefined;
}

export function isUnknown(a: Answers, id: string): boolean {
  return !!a.unknown[id];
}

/** The use case, worked out from the objective (and the topic, for information services). */
export function deriveUseCase(a: Answers): UseCaseId | null {
  const objId = getValue<string>(a, "objective");
  if (!objId) return null;
  const obj = OBJECTIVE_BY_ID[objId];
  if (!obj) return null;
  if (obj.needsTopic) {
    const topic = getValue<string>(a, "infoTopic");
    if (topic === "schemes") return "scheme-discovery";
    if (topic === "other") return "info-service";
    return null;
  }
  return obj.useCase;
}

/**
 * The direction in play. For surveys the document says outbound, so we assume that
 * until the person says otherwise in the assumption question.
 */
export function deriveDirection(a: Answers): Direction | null {
  const uc = deriveUseCase(a);
  if (!uc) return null;
  if (uc === "survey-feedback") {
    const confirm = getValue<string>(a, "surveyOutbound");
    if (confirm === "not-correct") {
      const d = getValue<Direction>(a, "direction");
      return d ?? "inbound";
    }
    return "outbound";
  }
  const d = getValue<Direction>(a, "direction");
  if (d) return d;
  const obj = OBJECTIVE_BY_ID[getValue<string>(a, "objective") ?? ""];
  return obj?.defaultDirection ?? null;
}

export const isOutbound = (d: Direction | null) => d === "outbound" || d === "both";
export const isInbound = (d: Direction | null) => d === "inbound" || d === "both";

/** ICP segments, each with the objectives that are documented for Platinum, for "explore by sector". */
export function objectivesForSegment(segmentId: string): { objective: Objective; documented: boolean }[] {
  const seg = SEGMENTS.find((s) => s.id === segmentId);
  const apps = new Set(seg?.applications ?? []);
  const relevant: string[] = [];
  if (apps.has("surveys")) relevant.push("feedback-service", "citizen-survey");
  if (apps.has("scheme-discovery")) relevant.push("scheme-discover", "scheme-questions");
  if (apps.has("grievance")) relevant.push("complaints");
  if (apps.has("form-filling") || apps.has("application-support")) relevant.push("forms");
  relevant.push("outbound-info", "inbound-info", "other");
  return Array.from(new Set(relevant)).map((id) => {
    const objective = OBJECTIVE_BY_ID[id];
    return { objective, documented: USE_CASES[objective.useCase].documented || objective.needsTopic === true };
  });
}

export { SEGMENTS };
