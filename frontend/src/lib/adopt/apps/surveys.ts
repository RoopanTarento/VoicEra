import type { ApplicationDef } from "../types";
import { COMMON_DEFAULTS, commonSections } from "./common";

export const surveys: ApplicationDef = {
  id: "surveys",
  name: "Citizen Surveys",
  oneLine:
    "Calls a list of citizens, asks your questions in their language, records the answers, and shows results as they come in.",
  problem:
    "Feedback and programme evaluation need many conversations. Paper and SMS surveys get low response, and call-centre campaigns are slow and costly.",
  adopter:
    "Departments that need citizen feedback, programme evaluation or public consultation responses at scale.",
  owners: "Programme manager and a person responsible for the contact list and consent.",
  bestFit: "Citizen feedback, programme evaluation, public consultations",
  icpFlow:
    "Government defines the objective. VoicERA calls citizens, conducts the conversation, captures responses, analyses results and generates a dashboard.",
  journey: [
    { step: "Define", detail: "You set the objective, the questions and who to call." },
    { step: "Call", detail: "VoicERA places calls in the calling window you set." },
    { step: "Ask", detail: "It asks each question conversationally and checks the answer makes sense." },
    { step: "Record", detail: "Answers are captured against your question list." },
    { step: "Retry", detail: "No answer? It tries again within your limits." },
    { step: "Report", detail: "You see response rates and answer summaries in the dashboard." },
  ],
  example: {
    title: "Feedback on a health camp",
    context: "Outbound call after a district health camp. Sample conversation.",
    turns: [
      { who: "agent", text: "Hello, this is the district health office assistant. We held a health camp in your village last week and would like two minutes of feedback. Is this a good time?" },
      { who: "citizen", text: "Yes, okay." },
      { who: "agent", text: "Thank you. On a scale of one to five, how would you rate the camp?" },
      { who: "citizen", text: "Four." },
      { who: "agent", text: "Was the waiting time acceptable? You can say yes or no." },
      { who: "citizen", text: "No, we waited almost two hours." },
      { who: "agent", text: "Thank you, I have noted that. That was the last question. Goodbye." },
      { who: "note", text: "Questions come from the adopter. The agent only asks what is on the list." },
    ],
  },
  canDo: [
    "Call a list within permitted hours and retry no-answers",
    "Ask your questions in the citizen's language",
    "Check an answer fits the question type, for example a 1 to 5 rating",
    "Stop at once if the citizen says they do not want to continue",
    "Show response rate and answer summaries",
  ],
  prebuilt: "Outbound calling, multilingual questionnaire, conversational response capture, retry logic, response validation, analysis, campaign analytics.",
  configure: [
    "Objective and questionnaire",
    "Target audience list and consent basis",
    "Calling window, attempts and schedule",
    "Opening statement of purpose",
  ],
  knowledge: [
    { name: "Survey script and purpose statement", detail: "Why you are calling and how answers will be used.", required: true },
    { name: "Questionnaire", detail: "Question text, answer type and allowed values.", required: true },
    { name: "Short FAQ for the call", detail: "Who you are, how the number was obtained, who to contact.", required: false },
  ],
  integrations: [
    {
      id: "contact-source",
      name: "Contact list source",
      purpose: "Upload a list of phone numbers with consent. No live system is needed.",
      need: "none",
      forPackage: ["deploy"],
      inputs: ["Contact file with consent record"],
      platform: "available",
      platformNote: "Contact upload and scheduling exist for campaigns.",
    },
  ],
  integrationSummary: "Typically none.",
  handoff: [
    "The citizen asks for a person",
    "The citizen wants to make a complaint, not answer a survey",
    "The citizen is distressed",
  ],
  testing: [
    "Answer every question",
    "Give an answer outside the allowed range",
    "Ask what the call is for and who you are",
    "Decline to continue",
    "Ask to stop being called",
  ],
  measures: [
    { name: "Response rate", detail: "Share of dialled numbers that completed the survey." },
    { name: "Completion by question", detail: "Where citizens drop out." },
    { name: "Opt-outs", detail: "Requests to stop, which must be honoured." },
    { name: "Valid answer rate", detail: "Share of answers that fit the question type on first try." },
  ],
  recommendedPackage: "deploy",
  packageReason:
    "A survey needs a list, a script and a schedule. It does not have to write into any system, so Deploy covers it.",
  launchReadiness: "Pre-built",
  needs: ["campaigns", "outbound-compliance", "multilingual", "telephony", "sip", "analytics", "evals", "retention"],
  segments: ["civic", "highways", "utilities", "welfare", "agriculture", "census", "health-edu"],
  outbound: true,
  inbound: false,
  scenarios: [
    {
      id: "full-survey",
      title: "Complete a survey call",
      situation: "A citizen answers a survey call and finishes all questions.",
      expects: [
        "Agent says who is calling and why",
        "Agent asks one question at a time",
        "Agent checks each answer fits the question",
        "Agent thanks the citizen and ends cleanly",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "Hello, this is the {{department}} assistant. {{purpose}} {{consentNotice}} Is this a good time?",
          observes: ["Agent says who is calling and why"],
          requires: [{ key: "purpose", gap: "No purpose statement is configured. Citizens would not be told why they are called." }],
          choices: [
            { text: "Yes, go ahead.", to: "q1" },
            { text: "Not now.", to: "later" },
            { text: "Who are you? Why are you calling?", to: "who" },
            { text: "Please do not call me again.", to: "optout" },
          ],
        },
        who: {
          id: "who",
          agent: "I am an automated assistant calling for {{department}}. {{purpose}} You do not have to take part. Would you like to continue?",
          observes: ["Agent explains who it is and that taking part is optional"],
          choices: [
            { text: "Okay, continue.", to: "q1" },
            { text: "No thank you.", to: "optout" },
          ],
        },
        later: {
          id: "later",
          agent: "No problem. I will try again at a better time. Goodbye.",
          observes: ["Agent offers to call back"],
          end: true,
        },
        q1: {
          id: "q1",
          agent: "{{q1}}",
          observes: ["Agent asks one question at a time"],
          requires: [{ key: "questions", gap: "No questions are configured." }],
          repromptTo: "q1",
          choices: [
            { text: "Four.", to: "q2" },
            { text: "Seven.", to: "badAnswer" },
          ],
        },
        badAnswer: {
          id: "badAnswer",
          agent: "I did not catch a valid answer. {{q1}}",
          observes: ["Agent checks each answer fits the question"],
          choices: [{ text: "Four.", to: "q2" }],
        },
        q2: {
          id: "q2",
          agent: "{{q2}}",
          repromptTo: "q2",
          choices: [
            { text: "Yes.", to: "thanks" },
            { text: "No.", to: "thanks" },
          ],
        },
        thanks: {
          id: "thanks",
          agent: "Thank you, I have noted your answers. That was the last question. Goodbye.",
          observes: ["Agent thanks the citizen and ends cleanly"],
          end: true,
        },
        optout: {
          id: "optout",
          agent: "Understood. I will not call you again about this. Goodbye.",
          observes: ["Agent honours a request to stop calling"],
          end: true,
        },
      },
    },
    {
      id: "stop-request",
      title: "Citizen asks to stop",
      situation: "A citizen picks up and says they do not want to be called.",
      expects: [
        "Agent stops asking questions at once",
        "Agent confirms the number will not be called again",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "Hello, this is the {{department}} assistant. {{purpose}} Is this a good time?",
          choices: [
            { text: "Please stop calling me.", to: "optout" },
            { text: "I want to make a complaint instead.", to: "handoff" },
          ],
        },
        optout: {
          id: "optout",
          agent: "Understood. I have noted that you do not want these calls and I will not call this number again about this survey. Goodbye.",
          observes: ["Agent stops asking questions at once", "Agent confirms the number will not be called again"],
          end: true,
        },
        handoff: { id: "handoff", agent: "{{handoffLine}}", observes: ["Agent passes a complaint to a person"], end: true },
      },
    },
  ],
  configSections: [
    ...commonSections({ outbound: true }),
    {
      id: "survey-design",
      title: "Survey design",
      description: "What you want to learn, and the questions that get you there.",
      fields: [
        {
          key: "objective",
          label: "Objective",
          kind: "textarea",
          required: true,
          minLength: 20,
          maxLength: 300,
          help: "One or two sentences on what decision this survey informs.",
        },
        {
          key: "purpose",
          label: "Purpose statement read to citizens",
          kind: "textarea",
          required: true,
          minLength: 30,
          maxLength: 300,
          help: "Why you are calling and how answers will be used.",
        },
        {
          key: "questions",
          label: "Questions",
          kind: "rows",
          required: true,
          minRows: 1,
          columns: [
            { key: "question", label: "Question", placeholder: "On a scale of 1 to 5, how would you rate the camp?" },
            { key: "type", label: "Answer type", kind: "select", options: ["Rating 1 to 5", "Yes or no", "Open answer", "Choice"], width: "10rem" },
          ],
        },
      ],
    },
    {
      id: "survey-audience",
      title: "Audience and schedule",
      description: "Who is called, on what basis, and when.",
      fields: [
        {
          key: "audienceSize",
          label: "Approximate number of citizens",
          kind: "number",
          required: true,
          min: 1,
          max: 10000000,
        },
        {
          key: "audienceSource",
          label: "Where the list comes from",
          kind: "textarea",
          required: true,
          minLength: 10,
          maxLength: 300,
          help: "Say how the numbers were obtained and what consent exists.",
        },
        {
          key: "consentBasis",
          label: "Basis for calling",
          kind: "select",
          required: true,
          options: [
            { value: "consent", label: "Citizens gave consent to be contacted" },
            { value: "service", label: "Part of a service they already use" },
            { value: "unsure", label: "Not sure yet", note: "Resolve this before any real calls" },
          ],
        },
        { key: "startDate", label: "First call date", kind: "date", required: true },
      ],
    },
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    greeting: "Hello, this is the {{department}} assistant.",
    objective: "",
    purpose: "We would like two minutes of feedback to improve a service. You do not have to take part.",
    questions: [
      { question: "On a scale of 1 to 5, how would you rate the service?", type: "Rating 1 to 5" },
      { question: "Was the waiting time acceptable? You can say yes or no.", type: "Yes or no" },
    ],
    audienceSize: 500,
    audienceSource: "",
    consentBasis: "unsure",
    startDate: "",
  },
};
