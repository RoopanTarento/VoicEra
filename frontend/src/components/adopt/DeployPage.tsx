"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Minus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { AvailabilityPill, LinkButton, Notice, Panel } from "@/components/adopt/ui";
import { useWorkspace } from "@/lib/adopt/use-workspace";
import { validateConfig, isBlank } from "@/lib/adopt/config-schema";
import { CAPABILITY_BY_ID } from "@/lib/adopt/capabilities";
import type { PackageId } from "@/lib/adopt/types";

const PKG_RANK: Record<PackageId, number> = { deploy: 0, connect: 1, orchestrate: 2 };

const ENVS = [
  { value: "gov-cloud", label: "Government cloud", note: "Hosted on a government cloud environment. Environment setup is project work." },
  { value: "private-cloud", label: "Private cloud", note: "Runs in your own cloud account. Needs infrastructure setup with the implementation team." },
  { value: "on-prem", label: "On your own premises", note: "Runs in your data centre. Needs hardware, network access and the most setup time." },
];

type Check = { id: string; label: string; blocking: boolean; ok: boolean; detail: string };

export function DeployPage() {
  const { app, ws, actions } = useWorkspace();
  const timers = useRef<number[]>([]);
  const [active, setActive] = useState(false);
  if (!app) return null;
  const pkg = (ws.packageId ?? app.recommendedPackage) as PackageId;
  const running = ws.deploy.stage === "running";

  function buildChecks(): Check[] {
    const v = validateConfig(app!, ws.config);
    const required = app!.knowledge.map((k, i) => (k.required ? i : -1)).filter((i) => i >= 0);
    const approvedK = required.filter((i) => ws.knowledge[i]?.status === "approved").length;
    const reviewed = app!.scenarios.filter((s) => ws.results[s.id]?.verdict === "passed").length;
    const needed = PKG_RANK[pkg] >= 1 ? app!.integrations.filter((i) => i.need === "required") : [];
    const integOk = needed.filter((i) => ws.integrations[i.id] && ws.integrations[i.id].status !== "not-started").length;
    const confirmed = ws.approvals.filter((a) => a.confirmed).length;
    const list: Check[] = [
      { id: "config", label: "Configuration is complete and saved", blocking: true, ok: v.complete && ws.configSaved, detail: v.complete ? (ws.configSaved ? "Saved." : "Complete but not saved.") : `${Object.keys(v.errors).length} fields need attention.` },
      { id: "handoff", label: "A handoff number is set", blocking: true, ok: !isBlank(ws.config.handoffNumber), detail: !isBlank(ws.config.handoffNumber) ? "Set." : "No number. Callers who ask for a person would not reach one." },
      { id: "env", label: "A deployment environment is chosen", blocking: true, ok: !!ws.environment, detail: ws.environment ? ENVS.find((e) => e.value === ws.environment)?.label ?? ws.environment : "Not chosen." },
      { id: "knowledge", label: "Required knowledge is approved", blocking: false, ok: approvedK === required.length, detail: `${approvedK} of ${required.length} approved.` },
      { id: "tests", label: "Conversation scenarios reviewed as passed", blocking: false, ok: reviewed === app!.scenarios.length, detail: `${reviewed} of ${app!.scenarios.length}.` },
      { id: "approvals", label: "Approvals confirmed", blocking: false, ok: confirmed === ws.approvals.length, detail: `${confirmed} of ${ws.approvals.length}.` },
    ];
    if (needed.length) {
      list.push({ id: "integ", label: "System details agreed with IT", blocking: false, ok: integOk === needed.length, detail: `${integOk} of ${needed.length} systems have details.` });
    }
    return list;
  }

  function run() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const checks = buildChecks();
    setActive(true);
    actions.patchWorkspace({ deploy: { stage: "running", log: [] } });
    const log: string[] = [];
    checks.forEach((c, i) => {
      timers.current.push(
        window.setTimeout(() => {
          log.push(`${c.ok ? "PASS" : c.blocking ? "FAIL" : "WARN"}|${c.label}|${c.detail}`);
          actions.patchWorkspace({ deploy: { stage: "running", log: [...log] } });
        }, 350 * (i + 1)),
      );
    });
    timers.current.push(
      window.setTimeout(() => {
        const failed = checks.some((c) => c.blocking && !c.ok);
        actions.patchWorkspace({
          deploy: { stage: failed ? "idle" : "done", log: [...log], finishedAt: new Date().toISOString() },
        });
        setActive(false);
      }, 350 * (checks.length + 1)),
    );
  }

  const parsed = ws.deploy.log.map((l) => {
    const [kind, label, detail] = l.split("|");
    return { kind, label, detail };
  });
  const failed = parsed.filter((p) => p.kind === "FAIL").length;
  const warned = parsed.filter((p) => p.kind === "WARN").length;
  const interrupted = running && !active;
  const env = ENVS.find((e) => e.value === ws.environment);
  const gaps = ["sip", "versioning", "rbac-audit", "call-quality"].map((id) => CAPABILITY_BY_ID[id]).filter(Boolean);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="d-head" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="d-head" className="text-xl font-semibold tracking-tight">Deployment centre</h2>
          <p className="max-w-[64ch] text-[14px] leading-relaxed text-v-body">
            Choose where this will run and rehearse the launch. The rehearsal checks your own setup in this browser.
            It is a local demonstration and does not deploy anything.
          </p>
        </div>
        <Notice tone="demo" title="Nothing goes live from here">
          Putting an agent on a phone number is done by the implementation team, on your agreed environment, after
          approvals. This page prepares you for that and produces the brief they start from.
        </Notice>
      </section>

      <section aria-labelledby="e-head" className="flex flex-col gap-3">
        <h3 id="e-head" className="text-base font-semibold">Environment</h3>
        <div className="max-w-[460px]">
          <label htmlFor="env" className="mb-1.5 block text-[13px] font-semibold">Where should it run?</label>
          <Select id="env" value={ws.environment} onChange={(e) => actions.patchWorkspace({ environment: e.target.value })}>
            <option value="">Choose one</option>
            {ENVS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </Select>
        </div>
        {env ? <p className="max-w-[62ch] text-[13px] text-v-body">{env.note}</p> : null}
        <p className="max-w-[62ch] text-[12.5px] text-v-muted">
          The ICP lists government cloud, private cloud and on-premise as supported environments. Which ones can be
          offered for your case is confirmed during scoping.
        </p>
      </section>

      <section aria-labelledby="rh-head" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="rh-head" className="text-base font-semibold">Rehearsal</h3>
          <Button onClick={run} disabled={running && !interrupted}>
            {ws.deploy.stage === "done" || ws.deploy.log.length ? "Run the rehearsal again" : "Run the rehearsal"}
          </Button>
        </div>
        <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-v-body">
          It goes through your configuration, knowledge, handoff, tests and approvals, and tells you what would stop a
          launch. Three checks block it: saved configuration, a handoff number and a chosen environment. The rest are
          warnings.
        </p>

        {interrupted ? (
          <Notice tone="warning" title="The last rehearsal was interrupted">
            Run it again to get a complete result.
          </Notice>
        ) : null}

        {parsed.length === 0 && !running ? (
          <Panel className="!p-5 text-[13.5px] text-v-muted">Not run yet.</Panel>
        ) : (
          <ol className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel" aria-live="polite" aria-label="Rehearsal results">
            {parsed.map((p) => (
              <li key={p.label} className="flex items-start gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white ${p.kind === "PASS" ? "bg-v-ok" : p.kind === "FAIL" ? "bg-v-danger" : "bg-v-warning"}`}
                >
                  {p.kind === "PASS" ? <Check className="size-3" strokeWidth={3} /> : p.kind === "FAIL" ? <Minus className="size-3" strokeWidth={3} /> : <TriangleAlert className="size-3" strokeWidth={2.5} />}
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">
                    {p.label} <span className="sr-only">{p.kind === "PASS" ? "passed" : p.kind === "FAIL" ? "failed" : "warning"}</span>
                  </p>
                  <p className="text-[12.5px] text-v-muted">{p.detail}</p>
                </div>
              </li>
            ))}
            {running && !interrupted ? (
              <li className="flex items-center gap-3 px-4 py-3 text-[13px] text-v-muted" role="status">
                <span className="size-4 animate-spin rounded-full border-2 border-v-line-strong border-t-v-accent" aria-hidden /> Checking
              </li>
            ) : null}
          </ol>
        )}

        {ws.deploy.stage === "done" ? (
          <Notice tone="info" title="Rehearsal complete">
            {warned > 0 ? `${warned} ${warned === 1 ? "warning" : "warnings"} to look at. ` : "Everything on your side passed. "}
            Operations now shows demonstration data.{" "}
            <Link href="/adopt/workspace/operations" className="font-semibold underline">Open Operations</Link>
          </Notice>
        ) : failed > 0 && !running ? (
          <Notice tone="danger" title={`${failed} blocking ${failed === 1 ? "check" : "checks"} failed`}>
            Fix {failed === 1 ? "it" : "them"} and run the rehearsal again.
          </Notice>
        ) : null}
      </section>

      <section aria-labelledby="g-head" className="flex flex-col gap-3 border-t border-v-line pt-8">
        <h3 id="g-head" className="text-base font-semibold">Before real launch, with the platform team</h3>
        <p className="max-w-[62ch] text-[13.5px] text-v-body">
          These are things a rehearsal here cannot prove. Ask the VoicERA team where each stands for your deployment.
        </p>
        <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
          {gaps.map((g) => (
            <li key={g.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{g.label}</p>
                <p className="text-[12.5px] leading-relaxed text-v-muted">{g.repoNote ?? g.icpSays}</p>
              </div>
              <AvailabilityPill value={g.availability} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/adopt/workspace/readiness" variant="outline">Download the hand-over brief</LinkButton>
          <LinkButton href="/adopt/help" variant="ghost">Contact the team</LinkButton>
        </div>
      </section>
    </div>
  );
}
