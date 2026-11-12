import type {
  ApplicationId,
  PackageId,
  QuestionnaireAnswers,
  Recommendation,
} from "./types";
import { APPLICATION_BY_ID } from "./applications";
import { SEGMENTS } from "./icp";
import { LANGUAGES } from "./applications";

export type QuestionKind = "single" | "multi" | "text" | "languages";

export interface QuestionOption {
  value: string;
  label: string;
  hint?: string;
}

export interface Question {
  id: keyof QuestionnaireAnswers;
  group: "About you" | "What you want" | "Scale" | "Systems" | "Running it";
  title: string;
  help?: string;
  kind: QuestionKind;
  options?: (a: QuestionnaireAnswers) => QuestionOption[];
  /** Question appears only when this returns true. */
  when?: (a: QuestionnaireAnswers) => boolean;
  /** Returns an error message if the answer is not acceptable. */
  validate?: (a: QuestionnaireAnswers) => string | null;
  optional?: boolean;
}

const OBJECTIVE_TO_APP: Record<string, ApplicationId | "unsure"> = {
  report: "grievance",
  schemes: "scheme-discovery",
  survey: "surveys",
  form: "form-filling",
  application: "application-support",
  unsure: "unsure",
};

export function resolveApplication(a: QuestionnaireAnswers): ApplicationId | undefined {
  if (a.applicationId) return a.applicationId;
  const mapped = a.objective ? OBJECTIVE_TO_APP[a.objective] : undefined;
  if (mapped && mapped !== "unsure") return mapped;
  return undefined;
}

const usesSystems = (a: QuestionnaireAnswers) => {
  const app = resolveApplication(a);
  return !!app && app !== "surveys";
};

export const QUESTIONS: Question[] = [
  {
    id: "segmentId",
    group: "About you",
    title: "Which part of government are you in?",
    help: "These are the segments in the VoicERA ICP. Pick the closest one.",
    kind: "single",
    options: () => SEGMENTS.map((s) => ({ value: s.id, label: s.name, hint: s.adopters })),
  },
  {
    id: "department",
    group: "About you",
    title: "What is your department or organisation called?",
    help: "Used to fill in the agent's opening line. You can change it later.",
    kind: "text",
    validate: (a) =>
      !a.department || a.department.trim().length < 3 ? "Enter at least 3 characters." : null,
  },
  {
    id: "objective",
    group: "What you want",
    title: "What should citizens be able to do?",
    kind: "single",
    options: (a) => {
      const seg = SEGMENTS.find((s) => s.id === a.segmentId);
      const suggested = new Set(seg?.applications ?? []);
      const tag = (id: ApplicationId) => (suggested.has(id) ? "Suggested for your segment" : undefined);
      return [
        { value: "report", label: "Report a problem and hear when it is fixed", hint: tag("grievance") },
        { value: "schemes", label: "Find out which schemes they may qualify for", hint: tag("scheme-discovery") },
        { value: "survey", label: "Answer a feedback or programme survey", hint: tag("surveys") },
        { value: "form", label: "Fill in a form or register by voice", hint: tag("form-filling") },
        { value: "application", label: "Get help completing and tracking an application", hint: tag("application-support") },
        { value: "unsure", label: "I am not sure yet", hint: "We will show what fits your segment" },
      ];
    },
  },
  {
    id: "applicationId",
    group: "What you want",
    title: "Which of these fits best?",
    help: "These are the ready-made applications that suit your segment.",
    kind: "single",
    when: (a) => a.objective === "unsure",
    options: (a) => {
      const seg = SEGMENTS.find((s) => s.id === a.segmentId);
      const ids = seg?.applications ?? (Object.keys(APPLICATION_BY_ID) as ApplicationId[]);
      return ids.map((id) => ({
        value: id,
        label: APPLICATION_BY_ID[id].name,
        hint: APPLICATION_BY_ID[id].oneLine,
      }));
    },
  },
  {
    id: "direction",
    group: "What you want",
    title: "Who starts the conversation?",
    kind: "single",
    when: (a) => {
      const app = resolveApplication(a);
      return !!app && APPLICATION_BY_ID[app].inbound && APPLICATION_BY_ID[app].outbound;
    },
    options: () => [
      { value: "inbound", label: "Citizens call us" },
      { value: "outbound", label: "We call citizens" },
      { value: "both", label: "Both" },
    ],
  },
  {
    id: "actions",
    group: "What you want",
    title: "Beyond talking, what should the agent do?",
    help: "Answering questions and running surveys needs no connection to your systems. Looking up or writing records does.",
    kind: "single",
    when: (a) => {
      const app = resolveApplication(a);
      return app === "scheme-discovery" || app === "surveys";
    },
    options: () => [
      { value: "talk", label: "Only talk and record the conversation", hint: "No system connection" },
      { value: "status", label: "Also look up a citizen's status or record", hint: "Needs an API" },
      { value: "write", label: "Also create or update records", hint: "Needs an API and approvals" },
    ],
  },
  {
    id: "users",
    group: "Scale",
    title: "Who will use it first?",
    kind: "single",
    options: () => [
      { value: "staff", label: "Our own staff, as a trial" },
      { value: "group", label: "A limited group of citizens" },
      { value: "public", label: "The general public" },
    ],
  },
  {
    id: "volume",
    group: "Scale",
    title: "How many calls do you expect each month?",
    help: "A rough guess is fine. This is only used to flag planning questions.",
    kind: "single",
    options: () => [
      { value: "lt1k", label: "Under 1,000" },
      { value: "1k-10k", label: "1,000 to 10,000" },
      { value: "10k-100k", label: "10,000 to 100,000" },
      { value: "gt100k", label: "More than 100,000" },
      { value: "unknown", label: "I do not know yet" },
    ],
  },
  {
    id: "languages",
    group: "Scale",
    title: "Which languages do citizens need?",
    help: "Voice readiness varies by language and provider. The implementation team confirms each.",
    kind: "languages",
    options: () => LANGUAGES.map((l) => ({ value: l, label: l })),
    validate: (a) => (!a.languages || a.languages.length === 0 ? "Choose at least one language." : null),
  },
  {
    id: "systems",
    group: "Systems",
    title: "Which systems would the agent need to work with?",
    help: "Choose all that apply. If none, the agent works from your content alone.",
    kind: "multi",
    when: usesSystems,
    options: () => [
      { value: "grievance", label: "Grievance or ticketing system" },
      { value: "scheme", label: "Scheme or application portal" },
      { value: "form", label: "A form or database that should receive data" },
      { value: "messaging", label: "SMS or messaging gateway" },
      { value: "none", label: "None of these" },
    ],
    validate: (a) => (!a.systems || a.systems.length === 0 ? "Choose at least one option, or 'None of these'." : null),
  },
  {
    id: "apiReadiness",
    group: "Systems",
    title: "Can your IT team provide API access to those systems?",
    help: "An API is a documented way for another program to read or write the system.",
    kind: "single",
    when: (a) => {
      const sys = a.systems ?? [];
      const needsSystem = sys.length > 0 && !sys.includes("none");
      return needsSystem || a.actions === "status" || a.actions === "write";
    },
    options: () => [
      { value: "ready", label: "Yes, documentation and a test environment exist" },
      { value: "later", label: "Possibly, but it will take time to arrange" },
      { value: "no", label: "No, the system has no API" },
      { value: "unsure", label: "I do not know" },
    ],
  },
  {
    id: "environment",
    group: "Running it",
    title: "Where does it need to run?",
    kind: "single",
    options: () => [
      { value: "gov-cloud", label: "Government cloud" },
      { value: "private-cloud", label: "Private cloud" },
      { value: "on-prem", label: "On our own premises" },
      { value: "undecided", label: "Not decided" },
    ],
  },
  {
    id: "retention",
    group: "Running it",
    title: "Do you have rules on how long recordings and transcripts may be kept?",
    kind: "single",
    options: () => [
      { value: "yes", label: "Yes, we have rules" },
      { value: "no", label: "No specific rules" },
      { value: "unsure", label: "I am not sure" },
    ],
  },
  {
    id: "handoff",
    group: "Running it",
    title: "Will people be available to take over calls?",
    help: "A citizen can always ask for a person.",
    kind: "single",
    options: () => [
      { value: "staffed", label: "Yes, a staffed line during set hours" },
      { value: "partial", label: "Only some staff, some of the time" },
      { value: "none", label: "No one is available yet" },
      { value: "unsure", label: "Not decided" },
    ],
  },
  {
    id: "approvals",
    group: "Running it",
    title: "Does the content or any system connection need formal approval?",
    kind: "single",
    options: () => [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unsure", label: "I do not know" },
    ],
  },
];

export function visibleQuestions(a: QuestionnaireAnswers): Question[] {
  return QUESTIONS.filter((q) => !q.when || q.when(a));
}

export function isAnswered(q: Question, a: QuestionnaireAnswers): boolean {
  const v = a[q.id];
  if (q.kind === "languages" || q.kind === "multi") return Array.isArray(v) && v.length > 0;
  if (q.kind === "text") return typeof v === "string" && v.trim().length > 0;
  return v !== undefined && v !== "";
}

export function questionError(q: Question, a: QuestionnaireAnswers): string | null {
  if (!isAnswered(q, a)) {
    return q.kind === "text" ? "Enter an answer to continue." : "Choose an option to continue.";
  }
  return q.validate ? q.validate(a) : null;
}

/** Clears answers for questions that are no longer visible after a change. */
export function pruneAnswers(a: QuestionnaireAnswers): QuestionnaireAnswers {
  const visible = new Set(visibleQuestions(a).map((q) => q.id));
  const next: Record<string, unknown> = { ...a };
  for (const q of QUESTIONS) {
    if (!visible.has(q.id)) delete next[q.id];
  }
  return next as QuestionnaireAnswers;
}

export function allAnswered(a: QuestionnaireAnswers): boolean {
  return visibleQuestions(a).every((q) => isAnswered(q, a) && !questionError(q, a));
}

/* ---------- recommendation ---------- */

const PKG_RANK: Record<PackageId, number> = { deploy: 0, connect: 1, orchestrate: 2 };

export function recommend(a: QuestionnaireAnswers): Recommendation | null {
  const appId = resolveApplication(a);
  if (!appId) return null;
  const app = APPLICATION_BY_ID[appId];
  const seg = SEGMENTS.find((s) => s.id === a.segmentId);

  let pkg: PackageId = app.recommendedPackage;
  const whyPackage: string[] = [app.packageReason];
  if (appId === "scheme-discovery" || appId === "surveys") {
    if (a.actions === "status") {
      pkg = "connect";
      whyPackage.push("You want the agent to look up status or records. That is the API integration and status-check work in Connect.");
    } else if (a.actions === "write") {
      pkg = "connect";
      whyPackage.push("You want the agent to create or update records. Connect covers light API integration and data capture. If this grows into case creation and routing across systems, Orchestrate would apply.");
    } else {
      whyPackage.push("You said the agent only needs to talk, so no system connection is needed.");
    }
  }

  const whyApplication: string[] = [];
  whyApplication.push(app.oneLine);
  if (seg) {
    whyApplication.push(
      seg.applications.includes(appId)
        ? `${app.name} is one of the applications that fit ${seg.name.toLowerCase()}. ${seg.fitSource === "icp" ? "The ICP lists this combination." : "This pairing is our suggestion, not an ICP statement."}`
        : `${app.name} is not one of the usual applications for ${seg.name.toLowerCase()}. It can still be configured, but check the fit with the implementation team.`,
    );
  }

  const deps: Recommendation["dependencies"] = [];
  const openQuestions: string[] = [];
  const sys = (a.systems ?? []).filter((s) => s !== "none");
  const needsIntegration = PKG_RANK[pkg] >= 1;

  if (needsIntegration) {
    if (a.apiReadiness === "no") {
      deps.push({ severity: "blocker", text: "Your system has no API. Connect and Orchestrate need a way to read or write it. Until that exists, the closest option is to hold results for staff review." });
    } else if (a.apiReadiness === "later" || a.apiReadiness === "unsure" || !a.apiReadiness) {
      deps.push({ severity: "needs-decision", text: "API access has not been confirmed. Integration work cannot start until your IT team provides documentation and a test environment." });
    } else {
      deps.push({ severity: "note", text: "API documentation and a test environment are available, which is the usual first dependency." });
    }
    deps.push({ severity: "needs-decision", text: "The product cannot yet be given your own API calls or webhooks through its interface. Each integration is project work with the implementation team." });
  }

  if (a.retention === "yes") {
    deps.push({ severity: "blocker", text: "You have retention rules. Retention and deletion controls are not yet confirmed in the platform, so those rules cannot be enforced automatically." });
  } else if (a.retention === "unsure") {
    deps.push({ severity: "needs-decision", text: "Find out your retention rules before real calls. Recordings and transcripts currently stay until removed manually." });
  }

  if (a.handoff === "none" || a.handoff === "unsure" || !a.handoff) {
    deps.push({ severity: pkg === "orchestrate" ? "blocker" : "needs-decision", text: "No staffed handoff line is planned. Citizens can always ask for a person, so something has to answer. Orchestrate in particular depends on this." });
  } else if (a.handoff === "partial") {
    deps.push({ severity: "needs-decision", text: "Handoff staffing is partial. Decide what the agent says outside staffed hours." });
  }
  deps.push({ severity: "note", text: "Handoff with the conversation attached is listed as a priority gap in the ICP. Confirm what will be live for your launch." });

  if (a.approvals === "yes") {
    deps.push({ severity: "note", text: "You said approvals are needed. Your launch date depends on how long they take, so the timing range for your package is a guide only." });
  } else if (a.approvals === "unsure") {
    deps.push({ severity: "needs-decision", text: "Find out who has to approve the content and any system connection." });
  }

  const outbound = appId === "surveys" || a.direction === "outbound" || a.direction === "both";
  if (outbound) {
    deps.push({ severity: "needs-decision", text: "Outbound calling needs a consent basis, a calling-hours policy and an opt-out route. Outbound compliance controls are not yet confirmed in the platform, so these are on your side for now." });
  }

  if (a.volume === "gt100k" || a.volume === "10k-100k") {
    deps.push({ severity: "needs-decision", text: "At this volume, call quality, concurrency and cost monitoring matter. The ICP lists these as priority gaps. Agree a staged rollout." });
  }

  if ((a.languages?.length ?? 0) > 3) {
    deps.push({ severity: "note", text: "You chose several languages. Voice readiness differs by language and provider, so each needs testing before launch." });
  }
  if (a.environment === "on-prem" || a.environment === "private-cloud") {
    deps.push({ severity: "needs-decision", text: "Private or on-premise deployment is supported in principle. Setting it up is infrastructure and environment work with the implementation team." });
  } else if (a.environment === "undecided" || !a.environment) {
    openQuestions.push("Where should this run: government cloud, private cloud or on-premise?");
  }
  deps.push({ severity: "note", text: "Production government telephony usually needs SIP. Two carriers are integrated today and SIP is listed as a priority gap." });

  if (sys.length > 0 && PKG_RANK[pkg] === 0) {
    deps.push({ severity: "note", text: "You listed systems, but this package does not connect to them. Start here and add a connection later if you need it." });
  }

  if (!a.volume || a.volume === "unknown") openQuestions.push("What call volume do you expect once it is live?");
  if (a.users === "public") openQuestions.push("Will there be a limited pilot before the general public is invited?");
  openQuestions.push("Who in your department signs off on what the agent says?");

  const configureNow = [
    "Department details, opening line and consent notice",
    "Languages offered",
    ...app.configure,
  ];
  if (!configureNow.some((x) => /handoff/i.test(x))) configureNow.push("Handoff number and hours");

  const teamNeeds = [
    ...app.knowledge.filter((k) => k.required).map((k) => `${k.name}: ${k.detail}`),
    ...(needsIntegration
      ? app.integrations.filter((i) => i.need === "required").flatMap((i) => i.inputs.map((x) => `${i.name}: ${x}`))
      : []),
    "A named owner who approves what the agent may say",
    "Handoff staff, number and hours",
  ];

  const alternatives: Recommendation["alternatives"] = [];
  if (needsIntegration && (a.apiReadiness === "no" || a.apiReadiness === "later" || a.apiReadiness === "unsure")) {
    alternatives.push({
      title: "Start with Deploy",
      text: "Launch an information conversation first, from your approved content, while API access is arranged. In Deploy the agent answers questions and explains the process. It cannot create or read records in your system.",
      provenance: "inferred",
    });
  }
  if (appId === "grievance" && (a.handoff === "none" || a.handoff === "unsure")) {
    alternatives.push({
      title: "Pilot with staff first",
      text: "Run the grievance conversation with your own team for a trial period to learn what handoff cover you need before inviting citizens.",
      provenance: "inferred",
    });
  }
  if (appId === "grievance" && pkg === "orchestrate") {
    alternatives.push({
      title: "Citizen Grievance below Orchestrate",
      text: "The ICP places grievances under Orchestrate because they need case creation, routing and tracking. We do not suggest a lower package for a grievance that must reach your system.",
      provenance: "icp",
    });
  }

  return {
    applicationId: appId,
    packageId: pkg,
    whyApplication,
    whyPackage,
    configureNow,
    dependencies: deps,
    teamNeeds,
    alternatives,
    openQuestions,
  };
}
