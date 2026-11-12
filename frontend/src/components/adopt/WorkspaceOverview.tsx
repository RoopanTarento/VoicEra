"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { HierarchyChain } from "@/components/adopt/content";
import { Notice, Panel, StatusIcon, StatusPill } from "@/components/adopt/ui";
import { useWorkspace } from "@/lib/adopt/use-workspace";
import { configProgress, validateConfig } from "@/lib/adopt/config-schema";
import { PACKAGES, PACKAGE_BY_ID, SEGMENTS } from "@/lib/adopt/icp";
import type { PackageId } from "@/lib/adopt/types";

export function WorkspaceOverview() {
  const { app, ws, readiness, actions, state } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  if (!app || !readiness) return null;

  const pkgId = (ws.packageId ?? app.recommendedPackage) as PackageId;
  const prog = configProgress(app, ws.config);
  const v = validateConfig(app, ws.config);
  const passed = app.scenarios.filter((s) => ws.results[s.id]?.verdict === "passed").length;
  const ran = app.scenarios.filter((s) => ws.results[s.id]?.ran).length;
  const approvedK = ws.knowledge.filter((k) => k.status === "approved").length;
  const confirmedA = ws.approvals.filter((a) => a.confirmed).length;
  const seg = SEGMENTS.find((s) => s.id === state.answers.segmentId) ?? null;
  const next = readiness.items.filter((i) => i.group === "yours" && i.status !== "done").slice(0, 4);

  const cards = [
    {
      href: "/adopt/workspace/configure",
      title: "Service configuration",
      value: `${prog.valid} of ${prog.total}`,
      note: ws.configSaved ? "required fields valid, saved" : v.complete ? "complete, not saved yet" : "required fields valid",
    },
    {
      href: "/adopt/workspace/knowledge",
      title: "Knowledge sources",
      value: `${approvedK} of ${ws.knowledge.length}`,
      note: "approved",
    },
    {
      href: "/adopt/workspace/test",
      title: "Conversation tests",
      value: `${passed} of ${app.scenarios.length}`,
      note: `reviewed as passed, ${ran} run`,
    },
    {
      href: "/adopt/workspace/readiness",
      title: "Approvals",
      value: `${confirmedA} of ${ws.approvals.length}`,
      note: "confirmed",
    },
    {
      href: "/adopt/workspace/deploy",
      title: "Deployment rehearsal",
      value: ws.deploy.stage === "done" ? "Done" : ws.deploy.stage === "running" ? "Running" : "Not run",
      note: "a check of your own setup",
    },
    {
      href: "/adopt/workspace/operations",
      title: "Operations",
      value: ws.deploy.stage === "done" ? "Demo data" : "Empty",
      note: ws.deploy.stage === "done" ? "after the rehearsal" : "appears after the rehearsal",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="ov-head" className="flex flex-col gap-4">
        <h2 id="ov-head" className="text-xl font-semibold tracking-tight">Overview</h2>
        <HierarchyChain segment={seg} application={app} packageId={pkgId} compact />
      </section>

      <Panel className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Where you are</p>
            <p className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums">
              {readiness.yourSideDone} of {readiness.yourSideTotal} readiness items done
            </p>
            <p className="mt-0.5 text-[13px] text-v-body">
              {readiness.readyToHandOver
                ? "Everything on your side is done. You can hand this to the implementation team."
                : "These are the things on your side. Platform items to confirm are listed separately in Readiness."}
            </p>
          </div>
          <div className="flex min-w-[240px] flex-col gap-1.5">
            <label htmlFor="pkg-change" className="text-[12px] font-semibold">Package</label>
            <Select id="pkg-change" value={pkgId} onChange={(e) => actions.changePackage(e.target.value as PackageId)}>
              {PACKAGES.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.id === app.recommendedPackage ? " (usual fit)" : ""}</option>
              ))}
            </Select>
            <p className="text-[11.5px] leading-snug text-v-muted">{PACKAGE_BY_ID[pkgId].positioning}</p>
          </div>
        </div>
        {pkgId !== app.recommendedPackage ? (
          <Notice tone="warning" title={`${PACKAGE_BY_ID[pkgId].name} is not the usual fit for ${app.name}`}>
            {pkgId === "deploy"
              ? "Deploy does not connect to your systems, so steps that create records or read status are described but not part of this package."
              : "A deeper package than usual means more integration and approval work. Check that you need it."}
          </Notice>
        ) : null}
      </Panel>

      {next.length > 0 ? (
        <section aria-labelledby="next-head" className="flex flex-col gap-3">
          <h2 id="next-head" className="text-base font-semibold">What to do next</h2>
          <ul className="flex flex-col divide-y divide-v-hairline rounded-v-xl border border-v-line bg-v-panel">
            {next.map((i) => (
              <li key={i.id}>
                <Link href={i.href ?? "/adopt/workspace/readiness"} className="flex items-center gap-3 px-4 py-3 hover:bg-v-soft">
                  <StatusIcon status={i.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-v-fg">{i.label}</span>
                    {i.reason ? <span className="block text-[12.5px] text-v-muted">{i.reason}</span> : null}
                  </span>
                  <StatusPill status={i.status} />
                  <ArrowRight className="size-4 shrink-0 text-v-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="areas-head" className="flex flex-col gap-3">
        <h2 id="areas-head" className="text-base font-semibold">Everything in this workspace</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="flex h-full flex-col gap-1.5 rounded-v-xl border border-v-line bg-v-panel p-4 shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent">
                <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">{c.title}</span>
                <span className="text-[24px] font-semibold tracking-tight tabular-nums">{c.value}</span>
                <span className="text-[12.5px] text-v-muted">{c.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="reset-head" className="flex flex-col gap-3 border-t border-v-line pt-6">
        <h2 id="reset-head" className="text-base font-semibold">Start the workspace over</h2>
        <p className="max-w-[60ch] text-[13.5px] text-v-body">
          This clears the configuration, test reviews, approvals and rehearsal for this workspace. Your selection answers are kept.
        </p>
        {confirm ? (
          <div className="flex flex-wrap items-center gap-3" role="alertdialog" aria-label="Confirm workspace reset">
            <span className="text-[13px] font-medium">Clear this workspace?</span>
            <Button variant="danger-outline" size="sm" onClick={() => { actions.resetWorkspace(); setConfirm(false); }}>Yes, clear it</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Keep it</Button>
          </div>
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>Clear this workspace</Button>
          </div>
        )}
      </section>
    </div>
  );
}
