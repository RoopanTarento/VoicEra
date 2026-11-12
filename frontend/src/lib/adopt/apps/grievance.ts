import type { ApplicationDef } from "../types";
import { COMMON_DEFAULTS, commonSections } from "./common";

export const grievance: ApplicationDef = {
  id: "grievance",
  name: "Citizen Grievance",
  oneLine:
    "Takes a complaint by phone, files it in your grievance system, and follows up until the citizen confirms it is resolved.",
  problem:
    "Citizens struggle to file complaints on portals, describe the problem in their own words, or find out what happened afterwards. Staff spend time on repeat status calls.",
  adopter:
    "Urban local bodies, highway authorities, utilities and other public services that already run a grievance or ticketing system.",
  owners: "Grievance cell head, operations lead, and the IT team that owns the ticketing system.",
  bestFit: "ULBs, NHAI, utilities, public services",
  icpFlow:
    "Citizen calls, explains the issue. VoicERA captures details, classifies, routes, creates the grievance, sends an acknowledgement, follows up and confirms resolution.",
  journey: [
    { step: "Call", detail: "The citizen calls your number and chooses a language." },
    { step: "Explain", detail: "They describe the problem in their own words. The agent asks follow-up questions." },
    { step: "Locate", detail: "The agent captures a location a field team can find." },
    { step: "Confirm", detail: "The agent reads the details back and the citizen confirms or corrects them." },
    { step: "Register", detail: "The complaint is classified, routed and filed. The citizen gets a reference." },
    { step: "Follow up", detail: "VoicERA checks status and calls with updates." },
    { step: "Close", detail: "The citizen confirms whether the issue is resolved, or it is reopened." },
  ],
  example: {
    title: "Pothole on a school road",
    context: "Inbound call to a municipal grievance line. Sample conversation, not a recording.",
    turns: [
      { who: "agent", text: "Hello, this is the municipal assistant. I can help you report a problem. This call may be recorded, and you can ask for a person at any time. What would you like to report?" },
      { who: "citizen", text: "There is a big pothole near the school on Station Road. Two scooters fell yesterday." },
      { who: "agent", text: "I'm sorry to hear that. Is it on the main road or the side lane, and which ward is it in?" },
      { who: "citizen", text: "Main road, ward twelve, opposite the school gate." },
      { who: "agent", text: "Let me check. Road damage, Station Road, ward 12, opposite the school gate. Is that right?" },
      { who: "citizen", text: "Yes." },
      { who: "agent", text: "I have registered it. Your reference is GRV-1042. The roads team aims to respond within 48 hours. I will call you when it is repaired to confirm." },
      { who: "note", text: "Reference and timing come from the adopter's system and SLA table. Here they are illustrative." },
    ],
  },
  canDo: [
    "Take a complaint in the citizen's own words and ask only the follow-up questions the category needs",
    "Classify and prioritise using your category list",
    "Route by your department and escalation matrix",
    "Create the case in your grievance system and read back a reference",
    "Retrieve status when a citizen asks where their complaint stands",
    "Call back with updates and ask the citizen to confirm resolution",
    "Pass the call to a person with the conversation attached",
  ],
  prebuilt:
    "Conversation flow, classification, information capture, routing, acknowledgement, follow-up, resolution confirmation.",
  configure: [
    "Grievance categories and the department each goes to",
    "Response times (SLAs) and escalation rules",
    "Approved wording for sensitive situations",
    "Handoff staff, hours and number",
  ],
  knowledge: [
    { name: "Grievance categories and descriptions", detail: "So the agent can tell a drainage complaint from a water supply one.", required: true },
    { name: "Department and routing matrix", detail: "Which team handles which category and area.", required: true },
    { name: "Service information and FAQs", detail: "Opening hours, how to pay a bill, what is and is not a grievance.", required: false },
    { name: "Escalation rules", detail: "Who is told, and when, if a case is overdue.", required: true },
  ],
  integrations: [
    {
      id: "grievance-system",
      name: "Grievance or ticketing system",
      purpose: "Create cases, read status, record closure.",
      need: "required",
      forPackage: ["orchestrate"],
      inputs: ["API documentation", "Test environment and credentials", "Field mapping for category, location, priority", "Named IT contact"],
      platform: "partial",
      platformNote:
        "Agents cannot yet be given your own API calls through the product. Each integration is project work with the implementation team.",
    },
    {
      id: "sms",
      name: "SMS or messaging for acknowledgements",
      purpose: "Send the reference by message as well as by voice.",
      need: "optional",
      forPackage: ["orchestrate"],
      inputs: ["Sender ID", "Approved message templates"],
      platform: "unavailable",
      platformNote: "Messaging is described in the ICP integration layer. It was not found in the repository check.",
    },
  ],
  integrationSummary: "Existing grievance or ticketing system.",
  handoff: [
    "The citizen asks for a person at any time",
    "The agent cannot classify after two attempts",
    "The complaint is about safety, harassment or another sensitive category you list",
    "The citizen is upset and repeating themselves",
  ],
  testing: [
    "Report a new complaint with a clear location",
    "Report with an unclear location and see the retry",
    "Check the status of an existing complaint",
    "Ask for a person",
    "Describe an emergency and confirm the agent redirects",
  ],
  measures: [
    { name: "Complaints captured with a usable location", detail: "Share of calls where the field team can find the place." },
    { name: "Correct first routing", detail: "Share of cases that were not re-routed by staff." },
    { name: "Confirmed resolution", detail: "Share of closed cases where the citizen agreed it was fixed." },
    { name: "Repeat status calls", detail: "Calls asking for an update on a case already filed." },
    { name: "Handoff rate", detail: "Share of calls passed to a person, and why." },
  ],
  recommendedPackage: "orchestrate",
  packageReason:
    "A grievance only has value once it exists in your system and is tracked to closure. That needs routing, case creation, escalation and human handoff, which Orchestrate adds.",
  launchReadiness: "Pre-built",
  needs: ["api-calling", "integrations", "workflow", "handoff", "sip", "evals", "rbac-audit", "retention"],
  segments: ["civic", "highways", "utilities", "revenue", "safety", "health-edu"],
  outbound: true,
  inbound: true,
  scenarios: [
    {
      id: "new-complaint",
      title: "Report a new complaint",
      situation: "A citizen calls to report a damaged road near a school.",
      expects: [
        "Agent says who it is and gives the consent notice",
        "Agent asks for the location",
        "Agent handles an unclear location",
        "Agent reads the details back before filing",
        "Agent gives a reference and a response time",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} {{consentNotice}}",
          observes: ["Agent says who it is and gives the consent notice"],
          requires: [{ key: "consentNotice", gap: "No consent notice is configured." }],
          choices: [
            { text: "Continue", to: "describe" },
            { text: "I want to speak to a person", to: "handoff" },
          ],
        },
        describe: {
          id: "describe",
          agent: "What would you like to report?",
          repromptTo: "describe",
          choices: [
            { text: "There is a big pothole near the school on Station Road.", to: "location", set: { category: "road damage" } },
            { text: "Garbage has not been collected on our street for a week.", to: "location", set: { category: "garbage collection" } },
            { text: "The streetlight outside my house has been off for days.", to: "location", set: { category: "streetlight" } },
          ],
        },
        location: {
          id: "location",
          agent: "I'm sorry to hear that. Where exactly is it? A landmark, street name or ward number helps the field team find it.",
          observes: ["Agent asks for the location"],
          repromptTo: "location",
          choices: [
            { text: "Station Road, ward 12, opposite the school gate.", to: "confirm", set: { location: "Station Road, ward 12, opposite the school gate" } },
            { text: "I am not sure of the exact place.", to: "locationRetry" },
          ],
        },
        locationRetry: {
          id: "locationRetry",
          agent: "That is fine. Is there a shop, school, temple or bus stop close by that I can note?",
          observes: ["Agent handles an unclear location"],
          choices: [
            { text: "Near the bus stop on Station Road.", to: "confirm", set: { location: "near the bus stop on Station Road" } },
          ],
        },
        confirm: {
          id: "confirm",
          agent: "Let me check what I have. Type of complaint: {{category}}. Place: {{location}}. Is that right?",
          observes: ["Agent reads the details back before filing"],
          choices: [
            { text: "Yes, that is right.", to: "register" },
            { text: "No, I want to change something.", to: "describe" },
          ],
        },
        register: {
          id: "register",
          agent: "I have registered your complaint. Your reference is {{ref}}. {{department}} aims to respond within {{sla}} hours. I will call you once it is resolved to confirm.",
          observes: ["Agent gives a reference and a response time"],
          action: { integrationId: "grievance-system", label: "Create a case in the grievance system" },
          requires: [{ key: "categories", gap: "No grievance categories are configured, so the response time shown is a placeholder." }],
          choices: [
            { text: "Please repeat the reference.", to: "repeatRef" },
            { text: "That is all, thank you.", to: "close" },
          ],
        },
        repeatRef: {
          id: "repeatRef",
          agent: "Your reference is {{ref}}. I will say it again slowly. {{ref}}.",
          observes: ["Agent repeats information when asked"],
          choices: [{ text: "Thank you.", to: "close" }],
        },
        close: {
          id: "close",
          agent: "Thank you for calling. Goodbye.",
          end: true,
        },
        handoff: {
          id: "handoff",
          agent: "{{handoffLine}}",
          observes: ["Agent offers a person when asked"],
          end: true,
        },
      },
    },
    {
      id: "status-check",
      title: "Check the status of a complaint",
      situation: "A citizen calls to ask what happened to a complaint filed last week.",
      expects: [
        "Agent asks for the reference rather than guessing",
        "Agent reads back status in plain words",
        "Agent offers a next step when the case is overdue",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "{{greeting}} Do you have a complaint reference number?",
          observes: ["Agent asks for the reference rather than guessing"],
          choices: [
            { text: "Yes, it is {{ref}}.", to: "status" },
            { text: "I lost the number.", to: "noRef" },
          ],
        },
        noRef: {
          id: "noRef",
          agent: "No problem. I can look it up with the phone number you are calling from. May I use it for that?",
          observes: ["Agent asks permission before using personal data"],
          choices: [
            { text: "Yes, go ahead.", to: "status" },
            { text: "No, I would rather speak to a person.", to: "handoff" },
          ],
        },
        status: {
          id: "status",
          agent: "I found your complaint. It was assigned to the field team and is in progress. It has been open longer than the usual response time, so I can ask a supervisor to look at it. Would you like that?",
          observes: ["Agent reads back status in plain words", "Agent offers a next step when the case is overdue"],
          action: { integrationId: "grievance-system", label: "Read case status from the grievance system" },
          choices: [
            { text: "Yes, please escalate it.", to: "escalated" },
            { text: "No, that is fine.", to: "close" },
          ],
        },
        escalated: {
          id: "escalated",
          agent: "I have asked for a supervisor to review {{ref}}. You will get a call when there is an update.",
          observes: ["Agent escalates under your rules"],
          action: { integrationId: "grievance-system", label: "Raise an escalation on the case" },
          choices: [{ text: "Thank you.", to: "close" }],
        },
        close: { id: "close", agent: "Thank you for calling. Goodbye.", end: true },
        handoff: { id: "handoff", agent: "{{handoffLine}}", observes: ["Agent offers a person when asked"], end: true },
      },
    },
    {
      id: "resolution-call",
      title: "Confirm a resolved complaint",
      situation: "VoicERA calls a citizen after the field team marks a case closed.",
      expects: [
        "Agent says why it is calling and checks it is the right person",
        "Agent asks whether the issue is actually fixed",
        "Agent reopens the case if the citizen says it is not fixed",
      ],
      start: "open",
      steps: {
        open: {
          id: "open",
          agent: "Hello, this is the {{department}} assistant calling about your complaint {{ref}}. Is this a good time to talk for a minute?",
          observes: ["Agent says why it is calling and checks it is the right person"],
          choices: [
            { text: "Yes, go ahead.", to: "ask" },
            { text: "Please do not call me again.", to: "optout" },
          ],
        },
        ask: {
          id: "ask",
          agent: "The field team has marked it as completed. Has the problem been fixed?",
          observes: ["Agent asks whether the issue is actually fixed"],
          repromptTo: "ask",
          choices: [
            { text: "Yes, it has been fixed.", to: "closed" },
            { text: "No, it is still there.", to: "reopen" },
          ],
        },
        closed: {
          id: "closed",
          agent: "Thank you. I have recorded that it is resolved. Goodbye.",
          action: { integrationId: "grievance-system", label: "Mark the case resolved with citizen confirmation" },
          end: true,
        },
        reopen: {
          id: "reopen",
          agent: "I'm sorry about that. I have reopened {{ref}} and marked it for review. You will get another call.",
          observes: ["Agent reopens the case if the citizen says it is not fixed"],
          action: { integrationId: "grievance-system", label: "Reopen the case and flag for review" },
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
  ],
  configSections: [
    ...commonSections({ outbound: true }),
    {
      id: "grievance-categories",
      title: "Grievance categories and routing",
      description: "What citizens can report, which team gets it, and how fast.",
      fields: [
        {
          key: "categories",
          label: "Categories",
          kind: "rows",
          required: true,
          minRows: 2,
          help: "Start with the categories you receive most. Sample rows are filled in. Replace them with your own.",
          columns: [
            { key: "name", label: "Category", placeholder: "Road damage" },
            { key: "team", label: "Team", placeholder: "Roads and drainage" },
            { key: "sla", label: "Respond within (hours)", kind: "number", width: "9rem" },
            { key: "priority", label: "Priority", kind: "select", options: ["Normal", "High", "Urgent"], width: "8rem" },
          ],
        },
        {
          key: "referencePrefix",
          label: "Reference prefix",
          kind: "text",
          required: true,
          pattern: { regex: "^[A-Z]{2,6}$", message: "Use 2 to 6 capital letters, for example GRV." },
          help: "The reference read to the citizen looks like GRV-1042.",
        },
        {
          key: "locationMode",
          label: "How location is captured",
          kind: "select",
          required: true,
          options: [
            { value: "landmark", label: "Landmark and area description" },
            { value: "ward", label: "Ward or zone number" },
            { value: "pin", label: "Postal PIN code" },
          ],
        },
      ],
    },
    {
      id: "grievance-escalation",
      title: "Escalation and follow-up",
      description: "What happens when a case is overdue, and when citizens hear back.",
      fields: [
        {
          key: "escalation",
          label: "Escalation rules",
          kind: "rows",
          minRows: 1,
          columns: [
            { key: "when", label: "When", placeholder: "No update after SLA" },
            { key: "who", label: "Notify", placeholder: "Zonal supervisor" },
            { key: "after", label: "After (hours)", kind: "number", width: "8rem" },
          ],
        },
        {
          key: "followUp",
          label: "Call the citizen to confirm resolution",
          kind: "toggle",
        },
        {
          key: "sensitiveNote",
          label: "Approved wording for sensitive complaints",
          kind: "textarea",
          maxLength: 400,
          help: "For example, how the agent responds to harassment or safety complaints before handing off.",
        },
      ],
    },
  ],
  defaults: {
    ...COMMON_DEFAULTS,
    greeting: "Hello, this is the {{department}} assistant. I can help you report a problem or check on a complaint.",
    categories: [
      { name: "Road damage", team: "Roads and drainage", sla: 48, priority: "High" },
      { name: "Garbage collection", team: "Solid waste", sla: 24, priority: "Normal" },
      { name: "Streetlight", team: "Electrical", sla: 72, priority: "Normal" },
    ],
    referencePrefix: "GRV",
    locationMode: "landmark",
    escalation: [{ when: "No update after the response time", who: "Zonal supervisor", after: 24 }],
    followUp: true,
    sensitiveNote: "",
  },
};
