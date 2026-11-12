"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Rocket,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Container, EmptyState, LinkButton, Spinner } from "@/components/adopt/ui";
import { useAdopt } from "@/lib/adopt/state";
import { APPLICATIONS, APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { recommend } from "@/lib/adopt/questionnaire";
import { PACKAGES, PACKAGE_BY_ID } from "@/lib/adopt/icp";
import { computeReadiness } from "@/lib/adopt/readiness";
import type { ApplicationId, PackageId } from "@/lib/adopt/types";

const ITEMS = [
  { href: "/adopt/workspace", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/adopt/workspace/configure", label: "Service configuration", icon: SlidersHorizontal },
  { href: "/adopt/workspace/knowledge", label: "Knowledge and systems", icon: BookOpen },
  { href: "/adopt/workspace/test", label: "Conversation testing", icon: FlaskConical },
  { href: "/adopt/workspace/readiness", label: "Readiness", icon: ClipboardCheck },
  { href: "/adopt/workspace/deploy", label: "Deployment centre", icon: Rocket },
  { href: "/adopt/workspace/operations", label: "Operations", icon: Gauge },
];

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, hydrated, actions } = useAdopt();
  const [pickApp, setPickApp] = useState<ApplicationId>("scheme-discovery");
  const [pickPkg, setPickPkg] = useState<PackageId | "">("");

  if (!hydrated) {
    return (
      <Container>
        <Spinner label="Opening your workspace" />
      </Container>
    );
  }

  const ws = state.workspace;
  const app = ws.applicationId ? APPLICATION_BY_ID[ws.applicationId] : null;

  if (!ws.started || !app) {
    const rec = recommend(state.answers);
    return (
      <Container>
        <div className="py-12 md:py-16">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight md:text-[38px]">Your workspace</h1>
          <p className="mt-3 max-w-[60ch] text-[15px] font-light leading-relaxed text-v-body">
            The workspace is where you configure an application, test the conversation, check readiness and rehearse
            the launch. It starts from a recommendation or from an application you choose.
          </p>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {rec ? (
              <EmptyState
                title="Start from your recommendation"
                action={
                  <Button
                    onClick={() => {
                      actions.startFromRecommendation();
                      router.refresh();
                    }}
                  >
                    Use {APPLICATION_BY_ID[rec.applicationId].name} with {PACKAGE_BY_ID[rec.packageId].name}
                  </Button>
                }
              >
                Your answers point to {APPLICATION_BY_ID[rec.applicationId].name}. The workspace opens with your
                department name and languages already filled in.
              </EmptyState>
            ) : (
              <EmptyState
                title="Find your fit first"
                action={<LinkButton href="/adopt/select" arrow>Answer the questions</LinkButton>}
              >
                A few questions give you a recommendation and a starting point.
              </EmptyState>
            )}
            <div className="flex flex-col gap-4 rounded-v-xl border border-v-line bg-v-panel p-6 shadow-[var(--v-shadow-card)]">
              <h2 className="text-base font-semibold">Or pick an application yourself</h2>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pick-app" className="text-[13px] font-semibold">Application</label>
                <Select id="pick-app" value={pickApp} onChange={(e) => { setPickApp(e.target.value as ApplicationId); setPickPkg(""); }}>
                  {APPLICATIONS.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pick-pkg" className="text-[13px] font-semibold">Package</label>
                <Select id="pick-pkg" value={pickPkg || APPLICATION_BY_ID[pickApp].recommendedPackage} onChange={(e) => setPickPkg(e.target.value as PackageId)}>
                  {PACKAGES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === APPLICATION_BY_ID[pickApp].recommendedPackage ? " (usual fit)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  actions.startWorkspace(pickApp, (pickPkg || APPLICATION_BY_ID[pickApp].recommendedPackage) as PackageId);
                }}
              >
                Open the workspace
              </Button>
            </div>
          </div>
        </div>
      </Container>
    );
  }

  const readiness = computeReadiness(app, ws, state.answers);
  const pct = Math.round((readiness.yourSideDone / Math.max(1, readiness.yourSideTotal)) * 100);
  const dept = String(ws.config.department || "").trim();

  return (
    <Container className="py-6 md:py-8">
      <div className="mb-6 flex flex-col gap-1 border-b border-v-line pb-5">
        <span className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">Workspace</span>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="text-[24px] font-semibold tracking-tight md:text-[28px]">{dept || "Your department"}</h1>
          <p className="text-[13px] text-v-body">
            {app.name} <span className="text-v-disabled">·</span> {PACKAGE_BY_ID[ws.packageId ?? app.recommendedPackage].name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Workspace" className="min-w-0 lg:sticky lg:top-[100px] lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {ITEMS.map((it) => {
              const active = it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`);
              const Icon = it.icon;
              return (
                <li key={it.href} className="shrink-0">
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 whitespace-nowrap rounded-v-md px-3 py-2.5 text-[13px] font-medium transition-colors ${
                      active ? "bg-v-pale text-v-accent-deep" : "text-v-body hover:bg-v-soft hover:text-v-fg"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.8} aria-hidden />
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 hidden rounded-v-lg border border-v-line bg-v-panel p-3.5 lg:block">
            <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Your side of readiness</p>
            <p className="mt-1.5 text-[13px] text-v-body">
              {readiness.yourSideDone} of {readiness.yourSideTotal} done
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-v-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Readiness">
              <div className="h-full rounded-full bg-v-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}
