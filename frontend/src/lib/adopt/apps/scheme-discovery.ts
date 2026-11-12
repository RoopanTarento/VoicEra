import type { ApplicationDef } from "../types";
import { COMMON_DEFAULTS, commonSections } from "./common";

export const schemeDiscovery: ApplicationDef = {
  id: "scheme-discovery",
  name: "Scheme Discovery",
  oneLine:
    "Listens to what a citizen needs, asks a few questions, and explains which schemes may apply and how to take the next step.",
  problem:
    "Citizens do not know which schemes exist or whether they qualify. Eligibility rules are long, and staff repeat the same explanations all day.",
  adopter:
    "Welfare, agriculture and social programme departments that publish schemes and want citizens to find the right one by voice.",
  owners: "Scheme owner or programme manager, plus whoever approves public-facing content.",
  bestFit: "Welfare, agriculture, social programmes",
  icpFlow:
    "Citizen calls, describes the need. VoicERA identifies relevant schemes, asks qualifying questions, explains eligibility, guides the next step and follows up.",
  journey: [
    { step: "Ask", detail: "The citizen says what they need, for example help with a farm loan or a pension." },
    { step: "Narrow", detail: "The agent asks a few qualifying questions drawn from your eligibility rules." },
    { step: "Match", detail: "It names the schemes that may apply and says why." },
    { step: "Explain", detail: "Eligibility, documents and the application steps in plain language." },
    { step: "Next step", detail: "Where to apply, or an offer to send the details." },
    { step: "Follow up", detail: "Optional reminder call if the citizen asked for one." },
  ],
  example: {
    title: "Farmer asking about income support",
    context: "Inbound call to an agriculture helpline. Sample conversation using made-up scheme details.",
    turns: [
      { who: "agent", text: "Hello, this is the agriculture department assistant. I can tell you about schemes that may help you. What do you need help with?" },
      { who: "citizen", text: "I have two acres. Is there any help for seeds and fertiliser?" },
      { who: "agent", text: "There may be. To check, do you own the land, or do you farm land that belongs to someone else?" },
      { who: "citizen", text: "I own it." },
      { who: "agent", text: "Thank you. Based on that, the Farmer Input Support scheme may apply to you. It is for landowners with up to five acres. You would need your land record and a bank passbook. Shall I explain how to apply?" },
      { who: "citizen", text: "Yes." },
      { who: "agent", text: "You can apply at your block agriculture office or through the scheme portal. Would you like me to call you in a week to check how it went?" },
      { who: "note", text: "Scheme name and rules are invented for this example. A real deployment uses your approved catalogue only." },
    ],
  },
  canDo: [
    "Understand a need described in the citizen's words, not scheme names",
    "Ask qualifying questions and explain why they are being asked",
    "Name schemes that may apply, and say plainly when it cannot tell",
    "Explain eligibility, documents and where to apply",
    "Answer common questions from your approved content",
    "Offer a follow-up call or hand off to a person",
  ],
  prebuilt: "Scheme discovery flow, need-based questioning, eligibility guidance, document requirements, FAQs, follow-up.",
  configure: [
    "Scheme catalogue with eligibility summaries",
    "Qualifying questions",
    "Application process and documents per scheme",
    "What the agent says when it cannot match a scheme",
  ],
  knowledge: [
    { name: "Scheme catalogue", detail: "Names, purpose and who it is for. Source documents should be approved.", required: true },
    { name: "Eligibility rules", detail: "In plain statements the agent can check against.", required: true },
    { name: "Application process and documents", detail: "Where to apply, what to bring, any deadlines.", required: true },
    { name: "FAQs and approved answers", detail: "Questions staff are asked most often.", required: false },
  ],
  integrations: [
    {
      id: "scheme-portal",
      name: "Scheme or application portal",
      purpose: "Optional. Link to, or later read from, the portal where citizens apply.",
      need: "optional",
      forPackage: ["connect"],
      inputs: ["Portal URL or API documentation", "Test access if reading data"],
      platform: "partial",
      platformNote: "Not needed for Deploy. Reading from a portal needs API calling, which is not yet available in the product.",
    },
  ],
  integrationSummary: "Optional scheme or application portal.",
  handoff: [
    "The citizen asks for a person",
    "The citizen describes a situation the rules do not cover",
    "The agent cannot decide eligibility from what it has been given",
  ],
  testing: [
    "Ask about a scheme with a clear match",
    "Answer qualifying questions so the citizen does not qualify",
    "Ask something outside your catalogue",
    "Ask for the documents list",
    "Ask for a person",
  ],
  measures: [
    { name: "Calls that end with a named scheme", detail: "Share of calls where the citizen learns of at least one scheme that may apply." },
    { name: "Accuracy against your rules", detail: "Reviewed sample of calls compared with your eligibility statements." },
    { name: "Calls handed to a person", detail: "And the reasons, to improve the catalogue." },
    { name: "Follow-up completion", detail: "Share of requested reminder calls answered." },
  ],
  recommendedPackage: "deploy",
  packageReason:
    "Discovery is about explaining your approved content. It works without connecting a back-end system, so it can start with Deploy.",
  launchReadiness: "Pre-built",
  needs: ["knowledge-base", "multilingual", "indian-languages", "telephony", "sip", "handoff", "evals", "retention"],
  segments: ["welfare", "agriculture", "census"],
  outbound: true,
  inbound: true,
  scenarios: [
    {
      id: "match",
      title: "Citizen who qualifies",
      situation: "A citizen asks what help is available for their farm.",
      expects: [
        "Agent asks qualifying questions rather than listing every scheme",
        "Agent names a scheme and says why it may apply",
        "Agent lists the documents needed",
        "Agent says when it is not certain",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} {{consentNotice}} What do you need help with?",
          observes: ["Agent says who it is and gives the consent notice"],
          choices: [
            { text: "I farm two acres. Is there any help for seeds and fertiliser?", to: "q1", set: { need: "farm inputs" } },
            { text: "Is there a pension for my mother?", to: "q1", set: { need: "old age pension" } },
            { text: "I want to speak to a person.", to: "handoff" },
          ],
        },
        q1: {
          id: "q1",
          agent: "{{q1}}",
          observes: ["Agent asks qualifying questions rather than listing every scheme"],
          requires: [{ key: "questions", gap: "No qualifying questions are configured. The agent would have nothing to ask." }],
          repromptTo: "q1",
          choices: [
            { text: "Yes.", to: "match" },
            { text: "No.", to: "noMatch" },
            { text: "I am not sure.", to: "unsure" },
          ],
        },
        unsure: {
          id: "unsure",
          agent: "That is fine. I cannot tell for certain without that detail, so I will not guess. {{notSure}}",
          observes: ["Agent says when it is not certain"],
          choices: [
            { text: "Please tell me about the scheme anyway.", to: "match" },
            { text: "I will check and call again.", to: "close" },
          ],
        },
        match: {
          id: "match",
          agent: "Based on what you said, {{schemeName}} may apply to you. {{schemeEligibility}} You may need: {{schemeDocs}}. Would you like to hear how to apply?",
          observes: ["Agent names a scheme and says why it may apply", "Agent lists the documents needed"],
          requires: [{ key: "schemes", gap: "No schemes are configured. The agent would have nothing to recommend." }],
          choices: [
            { text: "Yes, how do I apply?", to: "apply" },
            { text: "What documents should I bring again?", to: "docsAgain" },
          ],
        },
        docsAgain: {
          id: "docsAgain",
          agent: "You may need: {{schemeDocs}}. Would you like to hear how to apply?",
          observes: ["Agent repeats information when asked"],
          choices: [{ text: "Yes, how do I apply?", to: "apply" }],
        },
        apply: {
          id: "apply",
          agent: "{{schemeApply}} Would you like a reminder call in a week?",
          choices: [
            { text: "Yes, please.", to: "followUp" },
            { text: "No, thank you.", to: "close" },
          ],
        },
        followUp: {
          id: "followUp",
          agent: "I have noted a reminder call for a week from now. Goodbye.",
          observes: ["Agent offers a follow-up"],
          end: true,
        },
        noMatch: {
          id: "noMatch",
          agent: "I'm sorry. From what I can see, that scheme may not apply to you. {{noMatchLine}}",
          observes: ["Agent says plainly when no scheme matches"],
          choices: [
            { text: "I want to talk to someone.", to: "handoff" },
            { text: "Thank you.", to: "close" },
          ],
        },
        close: { id: "close", agent: "Thank you for calling. Goodbye.", end: true },
        handoff: { id: "handoff", agent: "{{handoffLine}}", observes: ["Agent offers a person when asked"], end: true },
      },
    },
    {
      id: "outside",
      title: "Question outside the catalogue",
      situation: "A citizen asks about something your scheme list does not cover.",
      expects: [
        "Agent does not invent a scheme",
        "Agent says it does not have the information",
        "Agent offers a person or another channel",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} What do you need help with?",
          choices: [
            { text: "Can I get a free laptop for my son?", to: "outside" },
            { text: "I want to speak to a person.", to: "handoff" },
          ],
        },
        outside: {
          id: "outside",
          agent: "I do not have information about that, and I do not want to give you a wrong answer. {{noMatchLine}}",
          observes: ["Agent does not invent a scheme", "Agent says it does not have the information"],
          choices: [
            { text: "Please connect me to someone.", to: "handoff" },
            { text: "Never mind, thank you.", to: "close" },
          ],
        },
        close: { id: "close", agent: "Thank you for calling. Goodbye.", end: true },
        handoff: { id: "handoff", agent: "{{handoffLine}}", observes: ["Agent offers a person or another channel"], end: true },
      },
    },
    {
      id: "outbound-reminder",
      title: "Follow-up reminder call",
      situation: "VoicERA calls a citizen who asked for a reminder to apply.",
      expects: [
        "Agent says why it is calling",
        "Agent asks whether the citizen applied",
        "Agent offers help if they did not",
        "Agent honours a request to stop",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "Hello, this is the {{department}} assistant. You asked me to call about {{schemeName}}. Is now a good time?",
          observes: ["Agent says why it is calling"],
          choices: [
            { text: "Yes, go ahead.", to: "ask" },
            { text: "Please do not call me again.", to: "optout" },
          ],
        },
        ask: {
          id: "ask",
          agent: "Have you been able to apply?",
          observes: ["Agent asks whether the citizen applied"],
          choices: [
            { text: "Yes, I applied.", to: "done" },
            { text: "No, I did not understand the form.", to: "help" },
          ],
        },
        done: { id: "done", agent: "That is good to hear. Thank you. Goodbye.", end: true },
        help: {
          id: "help",
          agent: "I can go through it again, or connect you to someone who can help with the form. Which would you prefer?",
          observes: ["Agent offers help if they did not"],
          choices: [
            { text: "Connect me to someone.", to: "handoff" },
            { text: "Explain it again.", to: "apply" },
          ],
        },
        apply: { id: "apply", agent: "{{schemeApply}} Goodbye.", end: true },
        optout: { id: "optout", agent: "Understood. I will not call you again about this. Goodbye.", observes: ["Agent honours a request to stop"], end: true },
        handoff: { id: "handoff", agent: "{{handoffLine}}", end: true },
      },
    },
  ],
  configSections: [
    ...commonSections({ outbound: true }),
    {
      id: "scheme-catalogue",
      title: "Scheme catalogue",
      description: "Only schemes listed here are ever described. Use approved wording.",
      fields: [
        {
          key: "schemes",
          label: "Schemes",
          kind: "rows",
          required: true,
          minRows: 1,
          help: "Sample entries are made up. Replace them with your own approved scheme details.",
          columns: [
            { key: "name", label: "Scheme", placeholder: "Farmer Input Support" },
            { key: "eligibility", label: "Who it is for", placeholder: "Landowners with up to 5 acres" },
            { key: "documents", label: "Documents", placeholder: "Land record, bank passbook" },
            { key: "apply", label: "How to apply", placeholder: "At the block agriculture office or on the portal" },
          ],
        },
        {
          key: "questions",
          label: "Qualifying questions",
          kind: "rows",
          required: true,
          minRows: 1,
          columns: [
            { key: "question", label: "Question the agent asks", placeholder: "Do you own the land you farm?" },
            { key: "why", label: "Why it is asked", placeholder: "Scheme is for landowners" },
          ],
        },
        {
          key: "notSure",
          label: "When the agent cannot tell",
          kind: "textarea",
          required: true,
          minLength: 20,
          maxLength: 300,
        },
        {
          key: "noMatchLine",
          label: "When no scheme matches",
          kind: "textarea",
          required: true,
          minLength: 20,
          maxLength: 300,
          help: "Point to a person, an office or another channel.",
        },
      ],
    },
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    greeting: "Hello, this is the {{department}} assistant. I can tell you about schemes that may help you.",
    schemes: [
      { name: "Farmer Input Support (sample)", eligibility: "Landowners with up to five acres.", documents: "land record, bank passbook", apply: "You can apply at your block agriculture office or on the scheme portal." },
      { name: "Senior Citizen Pension (sample)", eligibility: "Residents aged 60 and above with no other pension.", documents: "age proof, residence proof", apply: "You can apply at your ward or panchayat office." },
    ],
    questions: [
      { question: "Do you own the land you farm, or farm someone else's land?", why: "Sample scheme is for landowners" },
    ],
    notSure: "A person at the office can confirm this for you. Would you like me to connect you?",
    noMatchLine: "A person at the office may be able to help. Would you like me to connect you?",
  },
};
