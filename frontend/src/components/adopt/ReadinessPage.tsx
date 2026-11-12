"use client";

import Link from "next/link";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import {
  AvailabilityPill,
  Notice,
  Panel,
  StatusIcon,
  StatusPill,
} from "@/components/adopt/ui";
import { useWorkspace } from "@/lib/adopt/use-workspace";
import { PACKAGE_BY_ID } from "@/lib/adopt/icp";
import { validateConfig } from "@/lib/adopt/config-schema";
import type { ApprovalEntry, PackageId } from "@/lib/adopt/types";
import type { ReadinessItem } from "@/lib/adopt/readiness";

function ApprovalRow({ a, onChange }: { a: ApprovalEntry; onChange: (next: ApprovalEntry) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  function toggle(on: boolean) {
    if (on) {
      if (a.approver.trim().length < 3) return setErr("Enter who approved it first.");
      if (!a.date) return setErr("Enter the date it was approved.");
      if (a.date > today) return setErr("The approval date cannot be in the future.");
    }
    setErr(null);
    onChange({ ...a, confirmed: on });
  }

  return (
    <li>
      <Panel className="flex flex-col gap-3 !p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold">{a.label}</p>
            <p className="text-[12.5px] text-v-muted">{a.why}</p>
          </div>
          <label className="flex shrink-0 items-center gap-2.5 text-[13px] font-medium">
            <span id={`ap-${a.id}-l`}>Approved</span>
            <Switch checked={a.confirmed} label={`${a.label}: approved`} onChange={toggle} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`ap-${a.id}-who`} className="text-[12.5px] font-semibold">Approved by (name and role)</label>
            <Input id={`ap-${a.id}-who`} value={a.approver} maxLength={80} onChange={(e) => onChange({ ...a, approver: e.target.value, confirmed: e.target.value.trim().length < 3 ? false : a.confirmed })} aria-invalid={err ? true : undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`ap-${a.id}-date`} className="text-[12.5px] font-semibold">Date</label>
            <Input id={`ap-${a.id}-date`} type="date" max={today} value={a.date} onChange={(e) => onChange({ ...a, date: e.target.value, confirmed: e.target.value ? a.confirmed : false })} aria-invalid={err ? true : undefined} />
          </div>
        </div>
        {err ? <p role="alert" className="text-[12.5px] font-medium text-v-danger">{err}</p> : null}
      </Panel>
    </li>
  );
}

function Row({ i }: { i: ReadinessItem }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="mt-0.5"><StatusIcon status={i.status} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-v-fg">{i.label}</p>
        {i.reason ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-v-muted">{i.reason}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <StatusPill status={i.status} />
        {i.href && i.status !== "done" ? (
          <Link href={i.href} className="text-[12px] font-semibold text-v-accent hover:underline">
            Fix this
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function ReadinessPage() {
  const { app, ws, readiness, actions } = useWorkspace();
  if (!app || !readiness) return null;
  const pkgId = (ws.packageId ?? app.recommendedPackage) as PackageId;
  const mine = readiness.items.filter((i) => i.group === "yours");
  const platform = readiness.items.filter((i) => i.group === "platform");
  const blockers = mine.filter((i) => i.status === "blocked");
  const v = validateConfig(app, ws.config);

  function brief() {
    const lines = [
      `# Hand-over brief: ${String(ws.config.department || "Department")}`,
      "",
      `Application: ${app!.name}`,
      `Package: ${PACKAGE_BY_ID[pkgId].name}`,
      `Your side: ${readiness!.yourSideDone} of ${readiness!.yourSideTotal} done`,
      "",
      "## Your side",
      ...mine.map((i) => `- [${i.status}] ${i.label}${i.reason ? ` (${i.reason})` : ""}`),
      "",
      "## Platform items to confirm with VoicERA",
      ...platform.map((i) => `- [${i.platformCapability?.availability ?? i.status}] ${i.label}${i.reason ? ` (${i.reason})` : ""}`),
      "",
      "## Configuration",
      "```json",
      JSON.stringify(ws.config, null, 2),
      "```",
      "",
      `Configuration warnings: ${v.warnings.length ? v.warnings.map((w) => w.message).join(" ") : "none"}`,
      "",
      "Generated locally in the adopter experience. Test results come from a local simulation and the deployment rehearsal does not put anything live.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = "voicera-handover-brief.md";
    el.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="r-head" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 id="r-head" className="text-xl font-semibold tracking-tight">Readiness</h2>
            <p className="max-w-[62ch] text-[14px] leading-relaxed text-v-body">
              Two lists. The first is what your department controls. The second is what the platform has to provide,
              which you can only confirm with the VoicERA team.
            </p>
          </div>
          <Button variant="outline" onClick={brief}>
            <Download className="size-3.5" aria-hidden /> Download hand-over brief
          </Button>
        </div>

        {readiness.readyToHandOver ? (
          <Notice tone="info" title="Your side is ready to hand over">
            Everything in your list is done. Launch still depends on the platform items below being confirmed.
          </Notice>
        ) : (
          <Notice tone={blockers.length ? "warning" : "info"} title={`${readiness.yourSideDone} of ${readiness.yourSideTotal} done on your side${blockers.length ? `, ${blockers.length} blocked` : ""}`}>
            {blockers.length
              ? "Blocked items cannot move until someone makes a decision or supplies something. Start with those."
              : "Keep going. Each item links to where you can fix it."}
          </Notice>
        )}
      </section>

      <section aria-labelledby="mine-head" className="flex flex-col gap-3">
        <h3 id="mine-head" className="text-base font-semibold">Your side</h3>
        <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
          {mine.map((i) => (
            <Row key={i.id} i={i} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="appr-head" className="flex flex-col gap-3">
        <h3 id="appr-head" className="text-base font-semibold">Approvals</h3>
        <p className="max-w-[62ch] text-[13.5px] text-v-body">
          Record who approved each item and when. Switching one on needs a name and a date. These are your records,
          not a workflow that notifies anyone.
        </p>
        <ul className="flex flex-col gap-3">
          {ws.approvals.map((a, idx) => (
            <ApprovalRow
              key={a.id}
              a={a}
              onChange={(next) => actions.setApprovals(ws.approvals.map((x, j) => (j === idx ? next : x)))}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="own-head" className="flex flex-col gap-3">
        <h3 id="own-head" className="text-base font-semibold">Confirmations</h3>
        <Panel className="flex flex-col divide-y divide-v-hairline !p-0">
          <label className="flex items-start justify-between gap-4 px-5 py-4">
            <span>
              <span className="block text-[14px] font-medium">Handoff staffing reviewed</span>
              <span className="block text-[12.5px] text-v-muted">
                The number, hours and the people who answer. The agent sends callers there when they ask for a person.
              </span>
            </span>
            <Switch checked={ws.handoffReviewed} label="Handoff staffing reviewed" onChange={(c) => actions.patchWorkspace({ handoffReviewed: c })} />
          </label>
          <label className="flex items-start justify-between gap-4 px-5 py-4">
            <span>
              <span className="block text-[14px] font-medium">People who need access identified</span>
              <span className="block text-[12.5px] text-v-muted">
                Who manages the agent and who may read transcripts. Fine-grained roles are not yet confirmed in the platform, so keep this list short.
              </span>
            </span>
            <Switch checked={ws.accessChecked} label="People who need access identified" onChange={(c) => actions.patchWorkspace({ accessChecked: c })} />
          </label>
        </Panel>
      </section>

      <section aria-labelledby="plat-head" className="flex flex-col gap-3">
        <div>
          <h3 id="plat-head" className="text-base font-semibold">Platform items to confirm with VoicERA</h3>
          <p className="mt-1 max-w-[62ch] text-[13.5px] text-v-body">
            These are not on you. They are listed because this application relies on them. Where the platform is not
            complete today, it says so.
          </p>
        </div>
        <ul className="divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
          {platform.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-v-fg">{i.label}</p>
                {i.reason ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-v-muted">{i.reason}</p> : null}
              </div>
              {i.platformCapability ? <AvailabilityPill value={i.platformCapability.availability} /> : null}
            </li>
          ))}
        </ul>
        <Link href="/adopt/platform" className="self-start text-[13px] font-semibold text-v-accent hover:underline">
          See the full platform status
        </Link>
      </section>
    </div>
  );
}
