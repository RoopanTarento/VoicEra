import type { Archetype, PackageDef, PackageId, PlatformLayer, ProductFamily, Segment } from "./types";

/**
 * Hierarchy taken from "ICP - Voicera [Use Case Based] 6-Oct-26".
 *
 *   Segment (department group)
 *     -> Archetype (how the segment interacts with citizens)
 *       -> Product family (Resolution / Engagement)
 *         -> Ready-to-deploy application (five)
 *           -> Package (Deploy / Connect / Orchestrate)
 *             -> Platform layers, deployment, operations, governance
 *
 * Wording is the ICP's wherever the ICP has it. Where we add a mapping the ICP
 * does not state, it is marked `fitSource: "inferred"`.
 */

export const POSITIONING = {
  headline: "Anyone can now talk to intelligence.",
  sub: "Describe it. Hear it. Deploy it.",
  proposition: "Configure, connect, launch.",
  body: "The conversation is pre-built. Your department brings its content and rules and, where needed, connects the system it already runs.",
  notReplace:
    "VoicERA does not replace the systems you already use. It turns them into something citizens can talk to.",
};

export const ARCHETYPES: Archetype[] = [
  {
    id: "always-on",
    name: "Always-on citizen service",
    tagline: "Build once, deploy repeatedly",
    interactionModel: "Inbound, outbound and resolution, in a loop",
    coreNeed:
      "Citizens continuously need to report issues, request services, get updates and confirm resolution.",
    opportunity:
      "Conversational grievance intake, service requests, status updates, proactive notifications and resolution verification.",
    strategicRole: "Core repeatable product",
    productFamily: "resolution",
  },
  {
    id: "programme",
    name: "Programme-driven engagement",
    tagline: "Deploy for a mission, scale massively",
    interactionModel: "Outbound, then citizen response, support and follow-up",
    coreNeed:
      "Government programmes need large-scale citizen awareness, participation and follow-through.",
    opportunity:
      "Proactive outreach, multilingual information, FAQs, reminders, participation support and follow-ups.",
    strategicRole: "Campaign and programme deployments",
    productFamily: "engagement",
  },
  {
    id: "complex",
    name: "Complex administrative services",
    tagline: "High value, integrate later",
    interactionModel: "Inbound, case handling and follow-up",
    coreNeed: "Citizens have high-value but more complex administrative needs.",
    opportunity:
      "Conversational intake, case triage, information gathering, status communication and escalation.",
    strategicRole: "Expansion market",
    productFamily: null,
  },
];

export const PRODUCT_FAMILIES: ProductFamily[] = [
  {
    id: "resolution",
    name: "Citizen Resolution Agent",
    need: "Citizens need to report issues, request action and track resolution.",
    workflow: ["Report", "Understand", "Route", "Follow up", "Resolve", "Confirm"],
    examples: "NHAI, ULBs, utilities",
    deploymentModel: "Always-on",
    variants: [
      {
        name: "Highway Resolution",
        interaction: "Incident or issue reporting",
        outbound: "Status, updates, resolution confirmation",
        inbound: "Report an issue, describe the location",
        example: "NHAI",
      },
      {
        name: "Civic Resolution",
        interaction: "Civic complaint",
        outbound: "Field visit, status, closure confirmation",
        inbound: "Pothole, garbage, streetlight, water issue",
        example: "Urban local body",
      },
      {
        name: "Utility Resolution",
        interaction: "Service disruption",
        outbound: "Restoration updates, appointment confirmation",
        inbound: "Outage, service request",
        example: "Power and water utilities",
      },
    ],
  },
  {
    id: "engagement",
    name: "Citizen Engagement Agent",
    need: "Government needs to reach citizens, answer questions and drive participation.",
    workflow: ["Reach", "Inform", "Answer", "Assist", "Remind", "Follow up"],
    examples: "Census, welfare, agriculture",
    deploymentModel: "Programme or campaign",
    variants: [
      {
        name: "Census Support",
        interaction: "Citizen participation",
        outbound: "Awareness, reminders, process updates",
        inbound: "Questions, assistance",
        example: "Census",
      },
      {
        name: "Scheme Engagement",
        interaction: "Scheme participation",
        outbound: "Eligibility, application, missing-information reminders",
        inbound: "Scheme questions, application support",
        example: "Welfare",
      },
      {
        name: "Farmer Engagement",
        interaction: "Programme or service participation",
        outbound: "Programme outreach, reminders, follow-up",
        inbound: "Farmer questions, service requests",
        example: "Agriculture",
      },
    ],
  },
];

/**
 * Nine segments from the ICP. The `applications` lists follow the ICP's
 * "Typical deployment" column for each ready-to-deploy solution; where a segment
 * is not named there the mapping is our inference and is labelled as such.
 */
export const SEGMENTS: Segment[] = [
  {
    id: "civic",
    name: "Civic & local government",
    archetype: "always-on",
    workflow: "Citizen issue, grievance registration, status, resolution confirmation",
    whyItWins: "High volume, recurring, location-based, multilingual, clear routing",
    role: "Conversational front door to the existing grievance system",
    adopters: "Urban local bodies",
    applications: ["grievance", "surveys", "form-filling"],
    fitNote:
      "Citizen Grievance lists ULBs as a typical deployment. Surveys and form filling are our suggestion for the same department.",
    fitSource: "icp",
  },
  {
    id: "highways",
    name: "Highways & transport",
    archetype: "always-on",
    workflow: "Incident or issue reporting, location capture, routing, resolution follow-up",
    whyItWins: "Urgent, highly conversational, location matters, strong outbound loop",
    role: "Voice-based reporting, routing and follow-up",
    adopters: "NHAI and similar highway authorities",
    applications: ["grievance", "surveys"],
    fitNote: "Citizen Grievance lists NHAI as a typical deployment.",
    fitSource: "icp",
  },
  {
    id: "utilities",
    name: "Public utilities",
    archetype: "always-on",
    workflow: "Service disruption, complaint, restoration update, confirmation",
    whyItWins: "High frequency, clear trigger, citizens need updates",
    role: "Conversational service desk with outbound follow-up",
    adopters: "Power and water utilities",
    applications: ["grievance", "surveys", "form-filling"],
    fitNote: "Citizen Grievance lists utilities as a typical deployment.",
    fitSource: "icp",
  },
  {
    id: "welfare",
    name: "Welfare & benefits",
    archetype: "programme",
    workflow: "Scheme or application support, missing information, follow-up",
    whyItWins: "Citizens often need explanation, clarification and repeated assistance",
    role: "Conversational scheme and application support",
    adopters: "Social welfare and benefit programmes",
    applications: ["scheme-discovery", "application-support", "form-filling", "surveys"],
    fitNote:
      "Scheme Discovery and Scheme Application Support list welfare as a typical deployment.",
    fitSource: "icp",
  },
  {
    id: "agriculture",
    name: "Agriculture & rural services",
    archetype: "programme",
    workflow: "Farmer service request, guidance, follow-up",
    whyItWins: "Voice, local language and repeat interactions are highly relevant",
    role: "Voice-based farmer support and follow-up",
    adopters: "Agriculture departments and rural programmes",
    applications: ["scheme-discovery", "application-support", "surveys", "form-filling"],
    fitNote:
      "Scheme Discovery and Scheme Application Support list agriculture as a typical deployment.",
    fitSource: "icp",
  },
  {
    id: "census",
    name: "Census & population services",
    archetype: "programme",
    workflow: "Census awareness, process guidance, reminder, support",
    whyItWins: "Large-scale outreach, citizen questions and follow-up",
    role: "Citizen engagement layer around official Census infrastructure",
    adopters: "Census and population programmes",
    applications: ["surveys", "scheme-discovery"],
    fitNote:
      "The ICP names Census Support as an engagement deployment but does not map it to one of the five applications. Surveys (outbound outreach) and Scheme Discovery (process questions) are our reading.",
    fitSource: "inferred",
  },
  {
    id: "revenue",
    name: "Revenue & district administration",
    archetype: "complex",
    workflow: "Case intake, information gathering, routing, follow-up",
    whyItWins: "Huge potential",
    role: "Conversational intake and case handling",
    adopters: "District administrations and revenue offices",
    applications: ["form-filling", "grievance"],
    fitNote:
      "The ICP treats this as an expansion market and says workflows are complex. Form Filling and Grievance are the closest ready-made fits and are our suggestion, not an ICP mapping.",
    fitSource: "inferred",
    challenge: "Complex workflows",
  },
  {
    id: "health-edu",
    name: "Health & education",
    archetype: "complex",
    workflow: "Service request, triage, follow-up",
    whyItWins: "High interaction value",
    role: "Conversational intake, triage and follow-up",
    adopters: "Health and education departments",
    applications: ["form-filling", "surveys", "grievance"],
    fitNote:
      "The ICP calls this more domain-specific. These mappings are our suggestion and need a domain review before any clinical or academic content is added.",
    fitSource: "inferred",
    challenge: "More domain-specific",
  },
  {
    id: "safety",
    name: "Public safety & regulatory",
    archetype: "complex",
    workflow: "Incident or report, triage, escalation",
    whyItWins: "Extremely valuable",
    role: "Conversational intake, triage and escalation",
    adopters: "Public safety and regulatory bodies",
    applications: ["grievance", "form-filling"],
    fitNote:
      "The ICP flags higher risk and integration complexity. Grievance and Form Filling are a starting point only. Emergency use is out of scope.",
    fitSource: "inferred",
    challenge: "Higher risk and integration complexity",
  },
];

export const PLATFORM_LAYERS: PlatformLayer[] = [
  {
    id: "experience",
    name: "Experience",
    question: "How citizens interact",
    items: [
      "Inbound voice",
      "Outbound voice",
      "Conversational agents",
      "One-way voice alerts",
      "Multilingual interaction",
      "Phone-based access",
      "Browser-based testing",
    ],
  },
  {
    id: "orchestration",
    name: "Orchestration",
    question: "How the application thinks and executes",
    items: [
      "Conversation orchestration",
      "Context management",
      "Workflow orchestration",
      "Classification and routing",
      "Tool and API calls",
      "Error and retry handling",
      "Escalation and human handoff",
      "Call management",
    ],
  },
  {
    id: "intelligence",
    name: "Intelligence",
    question: "What the application knows and uses",
    items: [
      "Knowledge base (documents, schemes, FAQs, policies, SOPs)",
      "LLMs from several providers, custom and self-hosted models",
      "Speech recognition and speech synthesis",
      "Indian languages and voice selection",
    ],
  },
  {
    id: "integration",
    name: "Government integration",
    question: "What the application can access and act on",
    items: [
      "Grievance systems",
      "Scheme portals and application systems",
      "Databases, APIs and webhooks",
      "Existing government applications",
      "Telephony providers",
      "AI providers",
    ],
  },
  {
    id: "action",
    name: "Action and engagement",
    question: "What the application actually does",
    items: [
      "Capture information, create cases, retrieve status",
      "Route, trigger workflows, escalate",
      "Campaigns, surveys, alerts, reminders",
      "Follow up and confirm resolution",
    ],
  },
  {
    id: "operations",
    name: "Operations and infrastructure",
    question: "How the application is run in production",
    items: [
      "Government cloud, private cloud, on-premise",
      "Numbers, campaigns, call history, recordings, transcripts",
      "Analytics, telemetry, performance monitoring",
      "Organisations, members, credentials, access, configuration",
    ],
  },
];

export const PLATINUM_INCLUDES: { area: string; items: string }[] = [
  { area: "AI and voice", items: "Multilingual voice AI, STT, TTS, LLM orchestration, code-mixed conversations, interruption handling" },
  { area: "Agent building", items: "Agent builder, conversation flows, knowledge base, prompts, workflows, tool and API calling" },
  { area: "Telephony", items: "Inbound and outbound calling, SIP, routing, transfers, recordings, transcription" },
  { area: "Citizen engagement", items: "Campaigns, reminders, retries, callbacks, response capture and follow-ups" },
  { area: "Government actions", items: "Data capture, classification, routing, case creation, status retrieval, escalation and human handoff" },
  { area: "Integrations", items: "APIs, webhooks, government applications, databases, grievance systems, messaging and BHASHINI" },
  { area: "Analytics and operations", items: "Call analytics, transcripts, campaign analytics, monitoring, alerts, usage and performance" },
  { area: "Evaluation", items: "Conversation testing, task evaluation, language testing, regression testing and agent readiness" },
  { area: "Governance", items: "RBAC, audit trails, data controls, retention and deployment controls" },
  { area: "Deployment", items: "Government cloud, private cloud, on-premise and sovereign or open model environments" },
  { area: "Managed operations", items: "Setup, configuration, monitoring, optimisation, campaign operations and support" },
];

/** The ICP's four commercial components. The ICP gives no prices; neither do we. */
export const COMMERCIAL_COMPONENTS = [
  { name: "Platform", model: "Annual platform licence" },
  { name: "Voice usage", model: "Usage-based" },
  { name: "Implementation", model: "One-time configuration and integration" },
  { name: "Managed operations", model: "Annual or managed service" },
  { name: "Custom development", model: "Project-based, where required" },
];

export const PACKAGES: PackageDef[] = [
  {
    id: "deploy",
    name: "Deploy",
    positioning: "Configure the content. Launch the conversation.",
    bestFor: "Information, FAQs, surveys, basic citizen interactions",
    included: [
      "Pre-built conversational workflow",
      "Knowledge base",
      "Multilingual voice",
      "Telephony",
      "Analytics",
    ],
    integration: "None or minimal",
    typicalLaunch: "Days",
    who: "A department that wants citizens to get reliable answers, or wants to hear from citizens, without connecting a back-end system first.",
    problem:
      "Staff repeat the same answers on the phone, citizens do not know which scheme or process applies to them, or a programme needs feedback from many people quickly.",
    accomplish: [
      "Answer questions from your approved content, in the languages you choose",
      "Walk a citizen through need and eligibility questions",
      "Run outbound survey calls and capture structured answers",
      "See call volumes, outcomes and campaign results on dashboards",
    ],
    youProvide: [
      "Approved content: scheme details, FAQs, survey questionnaire",
      "Languages and tone you want",
      "A target audience list for outbound campaigns, with consent",
      "A named person who can approve what the agent may say",
    ],
    weConfigure: [
      "The pre-built flow for your application",
      "Knowledge base from your approved documents",
      "Telephony number and routing",
      "Dashboards and the reports you ask for",
    ],
    dependencies: [
      "Content approval from your department",
      "A telephony number or route",
      "Consent and outbound calling rules for campaigns",
    ],
    outOfScope: [
      "Creating or updating records in your systems",
      "Checking a citizen's case or application status",
      "Routing a request into a back-end workflow",
    ],
    nextSteps: [
      "Choose the application",
      "Share approved content",
      "Test the conversation in the workspace",
      "Review readiness and approvals",
    ],
    applications: ["scheme-discovery", "surveys"],
    provenanceNote:
      "Tagline, best-for, inclusions, integration and typical launch are from the ICP. The adopter-side wording on this page is ours.",
  },
  {
    id: "connect",
    name: "Connect",
    positioning: "Connect your systems. Let VoicERA take action.",
    bestFor: "Form filling, application support, structured data capture",
    included: [
      "Everything in Deploy",
      "API integration",
      "Data capture",
      "Workflow triggers",
      "Status checks",
    ],
    integration: "Light API or webhook integration",
    typicalLaunch: "Weeks",
    who: "A department whose citizens need to give structured information or check the progress of an application, and which has a form, API or portal that can receive or return that data.",
    problem:
      "Citizens abandon long forms, send incomplete applications, or keep calling to ask where an application stands.",
    accomplish: [
      "Collect form fields in conversation and validate them before submission",
      "Tell the citizen which documents or details are missing",
      "Send structured data to a form or API endpoint",
      "Look up application status and read it back",
    ],
    youProvide: [
      "Form fields, validation rules and the destination endpoint",
      "API documentation, a test environment and credentials, handled by your IT team",
      "The application workflow and the documents required",
      "Escalation rules for cases the agent cannot finish",
    ],
    weConfigure: [
      "Everything in Deploy",
      "Field capture and validation for your form",
      "Webhook or API calls to your endpoint",
      "Status-check conversation",
    ],
    dependencies: [
      "An endpoint that can accept and return data",
      "IT security review of the integration",
      "A test environment before anything touches live records",
      "A decision on what personal data the agent may collect and keep",
    ],
    outOfScope: [
      "Full case creation and routing across several systems",
      "Resolution tracking through a ticketing system",
      "Staffed human handoff with case context",
    ],
    nextSteps: [
      "Choose the application",
      "Share the form or application process",
      "Request API access from your IT team",
      "Test with sample data, never real personal records",
    ],
    applications: ["form-filling", "application-support"],
    provenanceNote:
      "Tagline, best-for, inclusions, integration and typical launch are from the ICP. The adopter-side wording on this page is ours.",
  },
  {
    id: "orchestrate",
    name: "Orchestrate",
    positioning:
      "Connect the full workflow. Let VoicERA manage the conversation from intake to resolution.",
    bestFor: "Grievances, service requests, end-to-end citizen workflows",
    included: [
      "Everything in Connect",
      "System integration",
      "Routing",
      "Case creation",
      "Escalation",
      "Human handoff",
      "Resolution tracking",
    ],
    integration: "Full integration with government systems",
    typicalLaunch: "Weeks to months",
    who: "A department that runs a grievance or service-request system and wants citizens to reach it by voice, with follow-up until the issue is closed.",
    problem:
      "Complaints are lost, mis-routed or never confirmed closed, and citizens call repeatedly because they cannot find out what happened.",
    accomplish: [
      "Take a complaint in the citizen's own words and ask follow-up questions",
      "Classify and prioritise it, then route it by your matrix",
      "Create the case in your system and give the citizen a reference",
      "Follow up and ask the citizen to confirm resolution",
      "Hand off to a person with the conversation attached",
    ],
    youProvide: [
      "Grievance categories, departments, SLAs and escalation rules",
      "Access to the grievance or ticketing system through an API",
      "Named staff who take handoffs, and when they are available",
      "Approved response wording for sensitive situations",
    ],
    weConfigure: [
      "Everything in Connect",
      "Classification and routing matrix",
      "Case creation and status retrieval against your system",
      "Follow-up calls and resolution confirmation",
      "Handoff paths with context",
    ],
    dependencies: [
      "System integration and the approvals that come with it",
      "Agreed SLAs, escalation owners and handoff staffing",
      "Security and data-protection review",
      "A staged rollout plan agreed with your operations team",
    ],
    outOfScope: [
      "Replacing your grievance system",
      "Emergency or life-safety calls",
      "Changing your internal grievance process",
    ],
    nextSteps: [
      "Choose Citizen Grievance",
      "Share categories, routing and SLAs",
      "Start the integration and approval work early",
      "Test every scenario before any citizen call",
    ],
    applications: ["grievance"],
    provenanceNote:
      "Tagline, best-for, inclusions, integration and typical launch are from the ICP. The adopter-side wording on this page is ours.",
  },
];

export const PACKAGE_BY_ID: Record<PackageId, PackageDef> = Object.fromEntries(
  PACKAGES.map((p) => [p.id, p]),
) as Record<PackageId, PackageDef>;

export const PACKAGE_ORDER: PackageId[] = ["deploy", "connect", "orchestrate"];

/** Timing in the ICP is a typical range, never a commitment. */
export const TIMING_CAVEAT =
  "Timings are the typical ranges in the ICP. They are not commitments. Your own approvals, integration access and content review set the real timeline.";
