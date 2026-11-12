import type { Availability, Capability } from "./types";

/**
 * Platform capability status.
 *
 * `icpSays` mirrors the "VoicEra today" column of the ICP (check = available,
 * yellow = partial, cross = unavailable). `repoNote` records what the
 * repository check of 5 Oct 2026 found, where it adds something. Where the two
 * differ, both are shown and the item is flagged for confirmation.
 *
 * This is what powers the honest "can this go live?" answers in the readiness
 * checklist. Nothing here is marketing copy.
 */
export const CAPABILITIES: Capability[] = [
  {
    id: "multilingual",
    label: "Multilingual conversation",
    layer: "AI and voice",
    availability: "available",
    icpSays: "Available. Mandatory in the market. Maintain.",
    priority: "Maintain",
  },
  {
    id: "indian-languages",
    label: "Indian language coverage",
    layer: "AI and voice",
    availability: "available",
    icpSays: "Available. Mandatory in the market. Deepen.",
    repoNote:
      "Coverage depends on the speech provider chosen per language. Which languages are voice-ready for a given department has to be confirmed per deployment.",
    priority: "Deepen",
  },
  {
    id: "model-agnostic",
    label: "Choice of models and providers",
    layer: "AI and voice",
    availability: "available",
    icpSays: "Available. Competitive. Maintain.",
    repoNote:
      "The repository registers multiple speech and language providers. The ICP also mentions custom OpenAI-compatible endpoints; that was not confirmed in the repository check and is listed as to confirm.",
    priority: "Maintain",
  },
  {
    id: "telephony",
    label: "Telephony (numbers, inbound, outbound)",
    layer: "Telephony",
    availability: "available",
    icpSays: "Available. Mandatory. Production harden.",
    repoNote: "Two carriers are integrated in the repository today.",
    priority: "Maintain",
  },
  {
    id: "sip",
    label: "Production SIP",
    layer: "Telephony",
    availability: "partial",
    icpSays: "Partial. Mandatory. P0.",
    repoNote:
      "No SIP trunk integration was found in the repository. Government telephony usually needs this.",
    priority: "P0",
  },
  {
    id: "knowledge-base",
    label: "Knowledge base",
    layer: "Knowledge",
    availability: "available",
    icpSays: "Available. Mandatory. Maintain.",
    repoNote:
      "Ingestion today is PDF documents. Other formats (spreadsheets, web pages, structured scheme catalogues) need confirmation.",
    priority: "Maintain",
  },
  {
    id: "campaigns",
    label: "Outbound campaigns",
    layer: "Engagement",
    availability: "available",
    icpSays: "Available. Mandatory. Maintain.",
    repoNote: "Contact upload, scheduling and controlled concurrency exist for campaigns.",
    priority: "Maintain",
  },
  {
    id: "outbound-compliance",
    label: "Outbound compliance controls",
    layer: "Engagement",
    availability: "planned",
    icpSays: "Listed as P0 (campaign governance).",
    repoNote:
      "Consent records, calling windows and do-not-call handling are not confirmed. Treat as your responsibility until confirmed.",
    priority: "P0",
  },
  {
    id: "analytics",
    label: "Call analytics",
    layer: "Operations",
    availability: "available",
    icpSays: "Available. Mandatory. Deepen.",
    priority: "Deepen",
  },
  {
    id: "transcripts",
    label: "Transcripts and audit trail",
    layer: "Operations",
    availability: "available",
    icpSays: "Available. Mandatory. Deepen.",
    priority: "Deepen",
  },
  {
    id: "api-calling",
    label: "API and function calling",
    layer: "Government actions",
    availability: "partial",
    icpSays: "Partial or unclear. Mandatory. P0.",
    repoNote:
      "Agents cannot yet be given your own API calls or webhooks through the product. This blocks any application that must write to or read from your systems.",
    priority: "P0",
  },
  {
    id: "integrations",
    label: "Government system integrations",
    layer: "Government actions",
    availability: "partial",
    icpSays: "Partial. Critical. P0 or P1.",
    repoNote: "Each integration is project work today. There is no connector library.",
    priority: "P0",
  },
  {
    id: "workflow",
    label: "Workflow orchestration",
    layer: "Government actions",
    availability: "partial",
    icpSays: "Partial. Mandatory. P0.",
    priority: "P0",
  },
  {
    id: "handoff",
    label: "Human handoff with context",
    layer: "Government actions",
    availability: "partial",
    icpSays: "Partial or unclear. Mandatory. P0.",
    repoNote: "Live transfer to a staffed queue with the conversation attached is not confirmed.",
    priority: "P0",
  },
  {
    id: "full-duplex",
    label: "Interruptions and natural turn-taking",
    layer: "AI and voice",
    availability: "partial",
    icpSays: "Partial. Mandatory. P0.",
    priority: "P0",
  },
  {
    id: "evals",
    label: "Automated agent testing",
    layer: "Evaluation",
    availability: "partial",
    icpSays: "Partial or unclear. Mandatory. P0.",
    repoNote:
      "The workspace test screen in this experience is a local simulation. It is not the platform's evaluation engine.",
    priority: "P0",
  },
  {
    id: "fallback",
    label: "Model fallback",
    layer: "Reliability",
    availability: "partial",
    icpSays: "Partial or unclear. Expected. P0.",
    priority: "P0",
  },
  {
    id: "rbac-audit",
    label: "Role-based access and audit logs",
    layer: "Governance",
    availability: "partial",
    icpSays: "Listed as P0 for government operations.",
    repoNote:
      "Organisation-level access exists. Fine-grained roles and a full audit log should be confirmed for your deployment.",
    priority: "P0",
  },
  {
    id: "retention",
    label: "Data retention controls",
    layer: "Governance",
    availability: "planned",
    icpSays: "Listed as P0 for sensitive citizen conversations.",
    repoNote: "No retention or deletion controls were found. Recordings and transcripts persist.",
    priority: "P0",
  },
  {
    id: "versioning",
    label: "Versioning and rollback",
    layer: "Governance",
    availability: "planned",
    icpSays: "Listed as P0 for safe government deployment.",
    priority: "P0",
  },
  {
    id: "call-quality",
    label: "Call quality and cost monitoring",
    layer: "Operations",
    availability: "partial",
    icpSays: "Listed as P0 for population-scale deployment.",
    repoNote: "No usage metering or billing was found.",
    priority: "P0",
  },
  {
    id: "dtmf",
    label: "DTMF and IVR interoperability",
    layer: "Telephony",
    availability: "planned",
    icpSays: "Listed as P0 for existing government infrastructure.",
    priority: "P0",
  },
  {
    id: "templates",
    label: "Government workflow templates",
    layer: "Agent building",
    availability: "partial",
    icpSays: "Partial. Rare in the market. Potential moat.",
    repoNote:
      "The five applications in this experience are those templates. Their content here is a starting point to be configured, not a finished deployment.",
  },
  {
    id: "deployment-options",
    label: "Cloud, private cloud and on-premise deployment",
    layer: "Deployment",
    availability: "available",
    icpSays: "Available. Differentiator. Double down.",
    repoNote:
      "Containerised components are documented. Environment setup for a given government cloud is project work.",
    priority: "Double down",
  },
];

export const CAPABILITY_BY_ID: Record<string, Capability> = Object.fromEntries(
  CAPABILITIES.map((c) => [c.id, c]),
);

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Available",
  partial: "Partly available",
  planned: "Not yet available",
  unavailable: "Not available",
};

/** Capabilities that are P0 gaps, in a stable order. Used in "what this depends on". */
export function gapsFor(ids: string[]): Capability[] {
  return ids
    .map((id) => CAPABILITY_BY_ID[id])
    .filter((c): c is Capability => !!c && c.availability !== "available");
}
