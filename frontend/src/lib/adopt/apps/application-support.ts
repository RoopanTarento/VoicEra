import type { ApplicationDef } from "../types";
import { COMMON_DEFAULTS, commonSections } from "./common";

export const applicationSupport: ApplicationDef = {
  id: "application-support",
  name: "Scheme Application Support",
  oneLine:
    "Helps citizens through an application: what documents to bring, what is missing, and where it stands, with follow-ups.",
  problem:
    "Applications stall because documents are missing or citizens do not understand the next step. Staff spend time chasing and answering the same status questions.",
  adopter:
    "Welfare, agriculture and benefit programmes with an application process and a system that holds each application's status.",
  owners: "Scheme officer, the team that processes applications, and IT for the application system.",
  bestFit: "Welfare, agriculture, benefit programmes",
  icpFlow:
    "Citizen calls, identifies the application. VoicERA checks for missing information, guides the citizen, captures required inputs and follows up.",
  journey: [
    { step: "Identify", detail: "The citizen says which application they are asking about." },
    { step: "Check", detail: "The agent looks at what is recorded and what is still missing." },
    { step: "Guide", detail: "It lists missing documents or the next step in plain words." },
    { step: "Capture", detail: "It can take a missing detail by voice and pass it on." },
    { step: "Follow up", detail: "It calls back if documents are still missing after a set time." },
    { step: "Escalate", detail: "Anything it cannot resolve goes to a named person." },
  ],
  example: {
    title: "Missing document on a pension application",
    context: "Inbound call. Sample conversation with made-up application details.",
    turns: [
      { who: "agent", text: "Hello, this is the welfare department assistant. Which application would you like to ask about?" },
      { who: "citizen", text: "My pension application. I applied two weeks ago." },
      { who: "agent", text: "May I use the number you are calling from to find it?" },
      { who: "citizen", text: "Yes." },
      { who: "agent", text: "I found it. It is at the verification stage. One document is still missing: proof of residence. Can you send it to your ward office?" },
      { who: "citizen", text: "Which ward office?" },
      { who: "agent", text: "The office for your ward, which is on the application. Shall I call in three days to check that it arrived?" },
      { who: "note", text: "The application record in this example is invented. In use it comes from the adopter's system." },
    ],
  },
  canDo: [
    "Find an application with the citizen's permission",
    "Say which stage it is at, in plain words",
    "List documents still missing and how to provide them",
    "Take a missing detail by voice and pass it to staff",
    "Call back about missing items",
    "Escalate when it cannot resolve the question",
  ],
  prebuilt: "Application guidance, document checklist, information capture, missing-document follow-up, status support, FAQs, escalation, reminders.",
  configure: [
    "Application stages and what each means",
    "Required documents per scheme",
    "How status is found and the follow-up timing",
    "Escalation contact",
  ],
  knowledge: [
    { name: "Application workflow", detail: "Stages from submission to decision, in plain language.", required: true },
    { name: "Required documents", detail: "Per scheme, with who needs which.", required: true },
    { name: "Process information and FAQs", detail: "How long steps take, what a stage means.", required: false },
    { name: "Escalation rules", detail: "Who handles what the agent cannot.", required: true },
  ],
  integrations: [
    {
      id: "application-system",
      name: "Scheme or application system",
      purpose: "Look up an application, read stage and missing items, pass back captured details.",
      need: "required",
      forPackage: ["connect"],
      inputs: ["API documentation", "Test environment with sample applications", "How a citizen is matched to an application", "Authentication method decided by your IT team"],
      platform: "partial",
      platformNote: "Reading status from your system needs API calling, which is not yet available in the product.",
    },
  ],
  integrationSummary: "Scheme or application system.",
  handoff: [
    "The citizen asks for a person",
    "The application cannot be found after two attempts",
    "The citizen disputes a decision or says an officer asked for money",
  ],
  testing: [
    "Look up an application with a missing document",
    "Look up an application that is complete",
    "Give an application that cannot be found",
    "Ask about a decision on an application",
    "Ask for a person",
  ],
  measures: [
    { name: "Applications completed after a call", detail: "Missing items supplied within the follow-up window." },
    { name: "Status calls handled without staff", detail: "Calls answered fully by the agent." },
    { name: "Repeat calls per application", detail: "Citizens calling again about the same one." },
    { name: "Escalations", detail: "And their reasons." },
  ],
  recommendedPackage: "connect",
  packageReason:
    "Application support needs to read the status of a real application and pass details back. That is the API integration and status-check work that Connect adds.",
  launchReadiness: "Pre-built",
  needs: ["api-calling", "integrations", "workflow", "handoff", "sip", "evals", "retention", "knowledge-base"],
  segments: ["welfare", "agriculture", "revenue", "health-edu"],
  outbound: true,
  inbound: true,
  scenarios: [
    {
      id: "missing-document",
      title: "Application with a missing document",
      situation: "A citizen asks about an application that is waiting on a document.",
      expects: [
        "Agent asks permission before looking up personal data",
        "Agent says the stage in plain words",
        "Agent names the missing document and how to provide it",
        "Agent offers a follow-up call",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} {{consentNotice}} Which application would you like to ask about?",
          observes: ["Agent says who it is and gives the consent notice"],
          choices: [
            { text: "My pension application.", to: "permission" },
            { text: "I want to speak to a person.", to: "handoff" },
          ],
        },
        permission: {
          id: "permission",
          agent: "I can look that up with the number you are calling from. May I?",
          observes: ["Agent asks permission before looking up personal data"],
          choices: [
            { text: "Yes, go ahead.", to: "found" },
            { text: "No.", to: "handoff" },
          ],
        },
        found: {
          id: "found",
          agent: "I found it. It is at the {{stage}} stage. One document is still missing: {{missingDoc}}. {{provideLine}} Shall I call you in {{followDays}} days to check?",
          observes: ["Agent says the stage in plain words", "Agent names the missing document and how to provide it"],
          action: { integrationId: "application-system", label: "Read application stage and missing items" },
          requires: [{ key: "stages", gap: "No application stages are configured, so the stage shown is a placeholder." }],
          choices: [
            { text: "Yes, please call me.", to: "follow" },
            { text: "No, I will manage.", to: "close" },
            { text: "Why was my application delayed?", to: "dispute" },
          ],
        },
        dispute: {
          id: "dispute",
          agent: "I cannot give reasons for a decision or a delay. I can connect you to someone who can. Would you like that?",
          observes: ["Agent does not speak for the officer on a decision"],
          choices: [
            { text: "Yes, please.", to: "handoff" },
            { text: "No, thank you.", to: "close" },
          ],
        },
        follow: {
          id: "follow",
          agent: "I have noted a call in {{followDays}} days. Goodbye.",
          observes: ["Agent offers a follow-up call"],
          action: { integrationId: "application-system", label: "Schedule a follow-up on the application" },
          end: true,
        },
        close: { id: "close", agent: "Thank you for calling. Goodbye.", end: true },
        handoff: { id: "handoff", agent: "{{handoffLine}}", observes: ["Agent offers a person when asked"], end: true },
      },
    },
    {
      id: "not-found",
      title: "Application not found",
      situation: "The agent cannot find the citizen's application.",
      expects: [
        "Agent does not guess or invent a status",
        "Agent offers a second way to find it",
        "Agent offers a person after two attempts",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} Which application would you like to ask about?",
          choices: [{ text: "My housing scheme application.", to: "nf1" }],
        },
        nf1: {
          id: "nf1",
          agent: "I could not find an application for this number. I will not guess. Do you have the application number?",
          observes: ["Agent does not guess or invent a status", "Agent offers a second way to find it"],
          action: { integrationId: "application-system", label: "Search for the application" },
          choices: [
            { text: "I do not have it.", to: "nf2" },
            { text: "It is 5 5 0 2.", to: "nf2" },
          ],
        },
        nf2: {
          id: "nf2",
          agent: "I still cannot find it. I can connect you to someone who can search properly. Would you like that?",
          observes: ["Agent offers a person after two attempts"],
          choices: [
            { text: "Yes.", to: "handoff" },
            { text: "No, thank you.", to: "close" },
          ],
        },
        close: { id: "close", agent: "Thank you for calling. Goodbye.", end: true },
        handoff: { id: "handoff", agent: "{{handoffLine}}", end: true },
      },
    },
  ],
  configSections: [
    ...commonSections({ outbound: true }),
    {
      id: "application-process",
      title: "Application process",
      description: "How an application moves, and what citizens need to provide.",
      fields: [
        {
          key: "schemeName",
          label: "Scheme name",
          kind: "text",
          required: true,
          minLength: 3,
          maxLength: 80,
        },
        {
          key: "stages",
          label: "Application stages",
          kind: "rows",
          required: true,
          minRows: 2,
          help: "In order. The agent explains each stage using the plain-language line you write here.",
          columns: [
            { key: "stage", label: "Stage", placeholder: "Verification" },
            { key: "meaning", label: "What it means for the citizen", placeholder: "Officers are checking your documents" },
          ],
        },
        {
          key: "documents",
          label: "Required documents",
          kind: "rows",
          required: true,
          minRows: 1,
          columns: [
            { key: "document", label: "Document", placeholder: "Proof of residence" },
            { key: "how", label: "How to provide it", placeholder: "Submit to your ward office" },
          ],
        },
      ],
    },
    {
      id: "application-followup",
      title: "Status and follow-up",
      description: "How status is found and when the agent calls back.",
      fields: [
        {
          key: "statusSource",
          label: "Where status comes from",
          kind: "select",
          required: true,
          options: [
            { value: "sample", label: "Sample records (demonstration)" },
            { value: "api", label: "Application system API", note: "Needs API calling, not yet available in the product" },
          ],
        },
        {
          key: "followDays",
          label: "Follow up after (days)",
          kind: "number",
          required: true,
          min: 1,
          max: 30,
        },
        {
          key: "escalationContact",
          label: "Escalation contact",
          kind: "text",
          required: true,
          minLength: 3,
          maxLength: 80,
          help: "A role or team, such as 'Scheme officer, district office'.",
        },
      ],
    },
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    greeting: "Hello, this is the {{department}} assistant. I can help with your application.",
    schemeName: "",
    stages: [
      { stage: "Submitted", meaning: "We have received your application." },
      { stage: "Verification", meaning: "Officers are checking your documents." },
      { stage: "Decision", meaning: "A decision is being made." },
    ],
    documents: [{ document: "Proof of residence", how: "Submit it to your ward office." }],
    statusSource: "sample",
    followDays: 3,
    escalationContact: "",
  },
};
