import type {
  ApplicationDef,
  ApprovalEntry,
  Capability,
  KnowledgeSourceEntry,
  PackageId,
  QuestionnaireAnswers,
  ReadinessStatus,
  WorkspaceState,
} from "./types";
import { validateConfig, isBlank } from "./config-schema";
import { CAPABILITY_BY_ID } from "./capabilities";

export interface ReadinessItem {
  id: string;
  group: "yours" | "platform";
  label: string;
  status: ReadinessStatus;
  /** Why it is not done, in plain words. */
  reason?: string;
  /** Where in the workspace to fix it. */
  href?: string;
  /** For platform items: what the ICP and the repository check say. */
  platformCapability?: Capability;
}

const PKG_RANK: Record<PackageId, number> = { deploy: 0, connect: 1, orchestrate: 2 };

export function seedKnowledge(app: ApplicationDef): KnowledgeSourceEntry[] {
  return app.knowledge.map((k, i) => ({
    id: `k${i}`,
    name: k.name,
    kind: k.required ? "Required" : "Optional",
    status: "draft",
    notes: "",
  }));
}

export function seedApprovals(app: ApplicationDef, packageId: PackageId): ApprovalEntry[] {
  const list: ApprovalEntry[] = [
    { id: "content", label: "Content the agent may say", why: "Someone in the department has to own the words the agent uses.", approver: "", date: "", confirmed: false },
  ];
  if (PKG_RANK[packageId] >= 1) {
    list.push({ id: "security", label: "System connection and data sharing", why: "Your IT or security team has to agree before the agent can reach a system.", approver: "", date: "", confirmed: false });
  }
  if (app.outbound) {
    list.push({ id: "calling", label: "Outbound calling basis and hours", why: "Outbound calls need a consent basis and a calling-hours policy.", approver: "", date: "", confirmed: false });
  }
  list.push({ id: "handoff", label: "Handoff staffing", why: "Someone has to answer when a citizen asks for a person.", approver: "", date: "", confirmed: false });
  return list;
}

export function emptyWorkspace(): WorkspaceState {
  return {
    started: false,
    applicationId: null,
    packageId: null,
    config: {},
    configSaved: false,
    knowledge: [],
    integrations: {},
    results: {},
    approvals: [],
    accessChecked: false,
    handoffReviewed: false,
    environment: "",
    deploy: { stage: "idle", log: [] },
  };
}

function platformItem(id: string, label: string): ReadinessItem {
  const cap = CAPABILITY_BY_ID[id];
  const status: ReadinessStatus = cap && cap.availability === "available" ? "done" : "blocked";
  return {
    id: `platform-${id}`,
    group: "platform",
    label,
    status,
    reason: cap ? (cap.repoNote ?? cap.icpSays) : undefined,
    platformCapability: cap,
  };
}

export function computeReadiness(
  app: ApplicationDef,
  ws: WorkspaceState,
  answers: QuestionnaireAnswers,
): { items: ReadinessItem[]; yourSideDone: number; yourSideTotal: number; readyToHandOver: boolean } {
  const items: ReadinessItem[] = [];
  const pkg = ws.packageId ?? app.recommendedPackage;
  const base = "/adopt/workspace";

  // 1. Configuration
  const v = validateConfig(app, ws.config);
  const errCount = Object.keys(v.errors).length;
  items.push({
    id: "config",
    group: "yours",
    label: "Service configuration is complete and saved",
    status: v.complete && ws.configSaved ? "done" : errCount > 0 ? "in-progress" : "in-progress",
    reason: !v.complete
      ? `${errCount} ${errCount === 1 ? "field needs" : "fields need"} attention.`
      : !ws.configSaved
        ? "Complete, but not saved yet."
        : undefined,
    href: `${base}/configure`,
  });

  items.push({
    id: "sample",
    group: "yours",
    label: "Sample content replaced with your own",
    status: v.warnings.some((w) => /Sample entries/.test(w.message)) ? "in-progress" : "done",
    reason: v.warnings.some((w) => /Sample entries/.test(w.message))
      ? "Sample rows are still in place."
      : undefined,
    href: `${base}/configure`,
  });

  // 2. Knowledge
  const requiredIdx = app.knowledge.map((k, i) => (k.required ? i : -1)).filter((i) => i >= 0);
  const approved = requiredIdx.filter((i) => ws.knowledge[i]?.status === "approved").length;
  items.push({
    id: "knowledge",
    group: "yours",
    label: "Required knowledge sources approved",
    status: approved === requiredIdx.length ? "done" : approved > 0 ? "in-progress" : "blocked",
    reason: approved === requiredIdx.length ? undefined : `${approved} of ${requiredIdx.length} required sources approved.`,
    href: `${base}/knowledge`,
  });

  // 3. Testing
  const ran = app.scenarios.filter((s) => ws.results[s.id]?.ran).length;
  const passed = app.scenarios.filter((s) => ws.results[s.id]?.verdict === "passed").length;
  const needsWork = app.scenarios.filter((s) => ws.results[s.id]?.verdict === "needs-work").length;
  items.push({
    id: "tests",
    group: "yours",
    label: "Every test scenario run and reviewed",
    status: passed === app.scenarios.length ? "done" : needsWork > 0 ? "blocked" : ran > 0 ? "in-progress" : "blocked",
    reason:
      passed === app.scenarios.length
        ? undefined
        : needsWork > 0
          ? `${needsWork} ${needsWork === 1 ? "scenario was" : "scenarios were"} marked as needing work.`
          : `${passed} of ${app.scenarios.length} scenarios reviewed as passed. ${ran} run.`,
    href: `${base}/test`,
  });

  // 4. Handoff
  const handoffNumber = !isBlank(ws.config.handoffNumber);
  items.push({
    id: "handoff",
    group: "yours",
    label: "Human handoff is set up and reviewed",
    status: handoffNumber && ws.handoffReviewed ? "done" : handoffNumber ? "in-progress" : "blocked",
    reason: !handoffNumber ? "No handoff number or queue is set." : !ws.handoffReviewed ? "Set, but you have not confirmed the staffing." : undefined,
    href: `${base}/configure`,
  });

  // 5. Integrations
  if (PKG_RANK[pkg] >= 1) {
    const required = app.integrations.filter((i) => i.need === "required");
    required.forEach((i) => {
      const entry = ws.integrations[i.id];
      const status: ReadinessStatus =
        entry?.status === "reviewed" ? "done" : entry?.status === "details-entered" ? "in-progress" : "blocked";
      items.push({
        id: `integration-${i.id}`,
        group: "yours",
        label: `${i.name}: details agreed with your IT team`,
        status,
        reason:
          status === "done"
            ? undefined
            : status === "in-progress"
              ? "Details entered. Waiting for your IT owner to review them."
              : "No details entered yet.",
        href: `${base}/deploy`,
      });
    });
  }

  // 6. Approvals
  ws.approvals.forEach((a) => {
    items.push({
      id: `approval-${a.id}`,
      group: "yours",
      label: `Approved: ${a.label}`,
      status: a.confirmed && a.approver.trim() && a.date ? "done" : "blocked",
      reason: a.confirmed ? (!a.approver.trim() || !a.date ? "Add who approved it and when." : undefined) : "Not yet approved.",
      href: `${base}/readiness`,
    });
  });

  // 7. Outbound
  if (app.id === "surveys") {
    const basisOk = !!ws.config.consentBasis && ws.config.consentBasis !== "unsure";
    items.push({
      id: "calling-basis",
      group: "yours",
      label: "Basis for outbound calling is settled",
      status: basisOk ? "done" : "blocked",
      reason: basisOk ? undefined : "The consent basis is still 'not sure yet'.",
      href: `${base}/configure`,
    });
  }

  // 8. Access and environment
  items.push({
    id: "access",
    group: "yours",
    label: "People who need access to this workspace identified",
    status: ws.accessChecked ? "done" : "in-progress",
    reason: ws.accessChecked ? undefined : "Confirm who will manage the agent and see transcripts.",
    href: `${base}/readiness`,
  });
  items.push({
    id: "environment",
    group: "yours",
    label: "Deployment environment chosen",
    status: ws.environment ? "done" : "blocked",
    reason: ws.environment ? undefined : "Choose where this will run.",
    href: `${base}/deploy`,
  });
  items.push({
    id: "rehearsal",
    group: "yours",
    label: "Deployment rehearsal completed",
    status: ws.deploy.stage === "done" ? "done" : ws.deploy.stage === "running" ? "in-progress" : "blocked",
    reason: ws.deploy.stage === "done" ? undefined : "The rehearsal checks your own setup. It does not put anything live.",
    href: `${base}/deploy`,
  });

  // Retention is the adopter's question, but the platform gap decides the answer.
  if (answers.retention === "yes") {
    items.push({
      id: "retention-rules",
      group: "yours",
      label: "Your retention rules can be met",
      status: "blocked",
      reason: "You have retention rules. Retention and deletion controls are not yet confirmed in the platform. Agree a manual process or wait for the control.",
    });
  }

  // Platform items: shown honestly, never counted as the adopter's task.
  const wanted = Array.from(new Set(["telephony", "sip", ...app.needs]));
  wanted.forEach((id) => {
    const cap = CAPABILITY_BY_ID[id];
    if (!cap) return;
    if (PKG_RANK[pkg] === 0 && (id === "api-calling" || id === "integrations" || id === "workflow")) return;
    items.push(platformItem(id, cap.label));
  });

  const mine = items.filter((i) => i.group === "yours");
  const done = mine.filter((i) => i.status === "done").length;
  return {
    items,
    yourSideDone: done,
    yourSideTotal: mine.length,
    readyToHandOver: done === mine.length,
  };
}
