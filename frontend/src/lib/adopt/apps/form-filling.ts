import type { ApplicationDef } from "../types";
import { COMMON_DEFAULTS, commonSections } from "./common";

export const formFilling: ApplicationDef = {
  id: "form-filling",
  name: "Basic Form Filling",
  oneLine:
    "Fills in a form by asking for each detail in conversation, checks the answers, and hands over clean structured data.",
  problem:
    "Long forms put citizens off, especially on a phone or in a language they do not read well. Incomplete forms lead to rework.",
  adopter:
    "Departments that take registrations, applications or service requests through a form and want a voice route to it.",
  owners: "Service owner who knows the form, and IT if the result goes to an endpoint.",
  bestFit: "Applications, registrations, service requests",
  icpFlow:
    "Citizen calls, provides information conversationally. VoicERA validates, structures the data, then submits or hands off.",
  journey: [
    { step: "Start", detail: "The citizen says they want to register or apply." },
    { step: "Collect", detail: "The agent asks for one field at a time, in order." },
    { step: "Validate", detail: "Each answer is checked against your rule, and the agent asks again if it fails." },
    { step: "Read back", detail: "The agent reads the details back for confirmation." },
    { step: "Submit", detail: "Structured data goes to your endpoint, or is held for a person to review." },
    { step: "Confirm", detail: "The citizen is told what happens next." },
  ],
  example: {
    title: "Camp registration",
    context: "Inbound call to register for a vaccination camp. Sample conversation with made-up data.",
    turns: [
      { who: "agent", text: "Hello, this is the district assistant. I can register you for the camp. This call may be recorded. May I start with your name?" },
      { who: "citizen", text: "Meena Devi." },
      { who: "agent", text: "Thank you, Meena Devi. What is your age?" },
      { who: "citizen", text: "Forty two." },
      { who: "agent", text: "Which village or ward do you live in?" },
      { who: "citizen", text: "Rampur." },
      { who: "agent", text: "Let me read that back. Meena Devi, age 42, Rampur. Is that correct?" },
      { who: "citizen", text: "Yes." },
      { who: "agent", text: "You are registered. You will receive details of the camp date. Goodbye." },
      { who: "note", text: "Name, age and ward are enough for this example. The agent never asks for identity numbers, passwords or one-time codes." },
    ],
  },
  canDo: [
    "Ask for each field in order and rephrase when the citizen is unsure",
    "Validate number, date, phone and choice fields as they are given",
    "Spot missing required fields before finishing",
    "Read everything back and accept corrections",
    "Produce structured output for an endpoint or for staff review",
  ],
  prebuilt: "Conversational data collection, dynamic questioning, field validation, missing-information detection, confirmation, structured output.",
  configure: [
    "Form fields, their types and which are required",
    "Validation rules",
    "Where the result goes",
    "What to do when a citizen cannot answer a required field",
  ],
  knowledge: [
    { name: "Form field definitions", detail: "Label, type, whether required, plain-language explanation.", required: true },
    { name: "Validation rules", detail: "For example, a PIN code has six digits.", required: true },
    { name: "Form instructions and FAQs", detail: "Eligibility, deadlines, what happens after submission.", required: false },
  ],
  integrations: [
    {
      id: "form-endpoint",
      name: "Form endpoint or API",
      purpose: "Receive the completed submission. Without one, the output is held for staff to review.",
      need: "required",
      forPackage: ["connect"],
      inputs: ["Endpoint URL", "Expected data format", "Test environment", "Authentication method decided by your IT team"],
      platform: "partial",
      platformNote: "Sending data to your endpoint needs API or webhook calling, which is not yet available in the product.",
    },
  ],
  integrationSummary: "Form or API endpoint where submission is required.",
  handoff: [
    "The citizen asks for a person",
    "A required field cannot be captured after two attempts",
    "The citizen asks about eligibility or a decision, which the agent cannot give",
  ],
  testing: [
    "Complete the form with valid answers",
    "Give an invalid answer and see the re-ask",
    "Correct a field at the read-back",
    "Ask for a person",
    "Offer a sensitive identifier and confirm the agent declines it",
  ],
  measures: [
    { name: "Completion rate", detail: "Share of started forms that finish." },
    { name: "First-time valid answers", detail: "Fields accepted without a re-ask." },
    { name: "Corrections at read-back", detail: "Fields changed after the citizen heard them back." },
    { name: "Rework by staff", detail: "Submissions staff had to correct." },
  ],
  recommendedPackage: "connect",
  packageReason:
    "The value of form filling is that the data lands in your form or system. That needs the data capture and API integration that Connect adds.",
  launchReadiness: "Pre-built",
  needs: ["api-calling", "integrations", "workflow", "handoff", "sip", "evals", "retention", "knowledge-base"],
  segments: ["civic", "utilities", "welfare", "agriculture", "revenue", "health-edu", "safety"],
  outbound: false,
  inbound: true,
  scenarios: [
    {
      id: "valid-form",
      title: "Complete the form",
      situation: "A citizen registers by voice and all answers are valid.",
      expects: [
        "Agent asks for one field at a time",
        "Agent explains what it is collecting and why",
        "Agent reads everything back before submitting",
        "Agent tells the citizen what happens next",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} {{consentNotice}} I will ask a few questions for {{formName}}. Shall we start?",
          observes: ["Agent explains what it is collecting and why"],
          requires: [{ key: "consentNotice", gap: "No consent notice is configured." }],
          choices: [
            { text: "Yes, let us start.", to: "f1" },
            { text: "I want to speak to a person.", to: "handoff" },
          ],
        },
        f1: {
          id: "f1",
          agent: "{{f1}}",
          observes: ["Agent asks for one field at a time"],
          requires: [{ key: "fields", gap: "No form fields are configured." }],
          repromptTo: "f1",
          choices: [
            { text: "Meena Devi.", to: "f2", set: { v1: "Meena Devi" } },
          ],
        },
        f2: {
          id: "f2",
          agent: "{{f2}}",
          repromptTo: "f2",
          choices: [
            { text: "Forty two.", to: "confirm", set: { v2: "42" } },
            { text: "I am not telling you.", to: "skip" },
          ],
        },
        skip: {
          id: "skip",
          agent: "That is your choice. This field is needed to complete the form. I can note that you declined and pass this to a person. Would you like that?",
          observes: ["Agent handles a refusal without pressure"],
          choices: [
            { text: "Yes, please.", to: "handoff" },
            { text: "Fine, it is forty two.", to: "confirm", set: { v2: "42" } },
          ],
        },
        confirm: {
          id: "confirm",
          agent: "Let me read that back. {{readback}} Is that correct?",
          observes: ["Agent reads everything back before submitting"],
          choices: [
            { text: "Yes, that is correct.", to: "submit" },
            { text: "No, one detail is wrong.", to: "f1" },
          ],
        },
        submit: {
          id: "submit",
          agent: "Thank you. {{submitLine}}",
          observes: ["Agent tells the citizen what happens next"],
          action: { integrationId: "form-endpoint", label: "Send structured data to the form endpoint" },
          end: true,
        },
        handoff: { id: "handoff", agent: "{{handoffLine}}", observes: ["Agent offers a person when asked"], end: true },
      },
    },
    {
      id: "invalid-answer",
      title: "Invalid answer",
      situation: "A citizen gives an answer that fails validation.",
      expects: [
        "Agent says what was wrong in plain words",
        "Agent asks again without repeating the whole form",
        "Agent offers a person after repeated failure",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} Let us begin. {{f1}}",
          choices: [{ text: "Meena Devi.", to: "f2", set: { v1: "Meena Devi" } }],
        },
        f2: {
          id: "f2",
          agent: "{{f2}}",
          choices: [
            { text: "I am hundred and fifty.", to: "bad1" },
          ],
        },
        bad1: {
          id: "bad1",
          agent: "I could not accept that answer. {{rule2}} {{f2}}",
          observes: ["Agent says what was wrong in plain words", "Agent asks again without repeating the whole form"],
          choices: [
            { text: "Forty two.", to: "ok", set: { v2: "42" } },
            { text: "I am hundred and fifty again.", to: "bad2" },
          ],
        },
        bad2: {
          id: "bad2",
          agent: "I am sorry, I still cannot take that. I can connect you to someone who can help. Would you like that?",
          observes: ["Agent offers a person after repeated failure"],
          choices: [
            { text: "Yes.", to: "handoff" },
            { text: "No, I will try once more. Forty two.", to: "ok", set: { v2: "42" } },
          ],
        },
        ok: { id: "ok", agent: "Thank you. That is noted. Goodbye.", end: true },
        handoff: { id: "handoff", agent: "{{handoffLine}}", end: true },
      },
    },
    {
      id: "sensitive-data",
      title: "Sensitive information offered",
      situation: "A citizen starts reading out a bank account number and a one-time code.",
      expects: [
        "Agent interrupts and says it does not need that",
        "Agent tells the citizen not to share codes or passwords",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} {{f1}}",
          choices: [
            { text: "Sure, my bank account number is 1234 and the OTP I just got is 5678.", to: "stop" },
          ],
        },
        stop: {
          id: "stop",
          agent: "Please stop. I do not need your bank details or any one-time code, and you should not share them with anyone on a call. I will only ask for the details in this form. {{f1}}",
          observes: ["Agent interrupts and says it does not need that", "Agent tells the citizen not to share codes or passwords"],
          choices: [{ text: "Meena Devi.", to: "close", set: { v1: "Meena Devi" } }],
        },
        close: { id: "close", agent: "Thank you. That is noted. Goodbye.", end: true },
      },
    },
  ],
  configSections: [
    ...commonSections({ outbound: false }),
    {
      id: "form-design",
      title: "Form design",
      description: "The fields the agent collects. Do not ask for identity numbers, passwords or one-time codes.",
      fields: [
        {
          key: "formName",
          label: "Form name",
          kind: "text",
          required: true,
          minLength: 3,
          maxLength: 80,
          placeholder: "Vaccination camp registration",
        },
        {
          key: "fields",
          label: "Fields",
          kind: "rows",
          required: true,
          minRows: 2,
          help: "The agent asks in this order. Mark a field optional if a citizen can skip it.",
          columns: [
            { key: "label", label: "Field", placeholder: "Full name" },
            { key: "type", label: "Type", kind: "select", options: ["Text", "Number", "Date", "Phone", "Choice"], width: "8rem" },
            { key: "required", label: "Required", kind: "select", options: ["Yes", "No"], width: "7rem" },
            { key: "rule", label: "Rule", placeholder: "Between 1 and 120", width: "11rem" },
          ],
        },
        {
          key: "destination",
          label: "Where the result goes",
          kind: "select",
          required: true,
          options: [
            { value: "review", label: "Held for staff to review" },
            { value: "webhook", label: "Sent to an endpoint", note: "Needs API calling, not yet available in the product" },
          ],
        },
        {
          key: "endpointUrl",
          label: "Endpoint address",
          kind: "text",
          pattern: { regex: "^$|^https://[^\\s]+$", message: "Use an https address, or leave blank if results are held for review." },
          help: "Never put keys or passwords here. Credentials are set up separately by your IT team.",
        },
        {
          key: "readBack",
          label: "Read everything back before submitting",
          kind: "toggle",
        },
      ],
    },
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    greeting: "Hello, this is the {{department}} assistant. I can help you fill in a form by phone.",
    formName: "Registration form (sample)",
    fields: [
      { label: "Your full name", type: "Text", required: "Yes", rule: "" },
      { label: "Your age in years", type: "Number", required: "Yes", rule: "Between 1 and 120" },
    ],
    destination: "review",
    endpointUrl: "",
    readBack: true,
  },
};
