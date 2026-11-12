"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Menu, RotateCcw, X } from "lucide-react";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { Container } from "@/components/adopt/ui";
import { useAdopt } from "@/lib/adopt/state";
import { APPLICATION_BY_ID } from "@/lib/adopt/applications";
import { recommend } from "@/lib/adopt/questionnaire";
import { PACKAGE_BY_ID } from "@/lib/adopt/icp";

type NavItem = { href: string; label: string; exact?: boolean };

const PRIMARY: NavItem[] = [
  { href: "/adopt", label: "Home", exact: true },
  { href: "/canvas", label: "Build a package" },
  { href: "/adopt/advisor", label: "Advisor" },
  { href: "/adopt/citizen", label: "Citizen view" },
  { href: "/adopt/workspace", label: "Workspace" },
];

const MORE: NavItem[] = [
  { href: "/adopt/sectors", label: "Sectors" },
  { href: "/adopt/applications", label: "Applications" },
  { href: "/adopt/packages", label: "Packages" },
  { href: "/adopt/select", label: "Find your fit" },
  { href: "/compose", label: "Composer" },
  { href: "/adopt/help", label: "Help" },
  { href: "/adopt/all", label: "All screens" },
];

const NAV: NavItem[] = [...PRIMARY, ...MORE];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdoptShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, hydrated, actions } = useAdopt();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Close the mobile menu when the route changes.
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), 0);
    return () => clearTimeout(t);
  }, [pathname]);

  const ws = state.workspace;
  const rec = hydrated ? recommend(state.answers) : null;
  const wsApp = ws.applicationId ? APPLICATION_BY_ID[ws.applicationId] : null;
  const planApp = wsApp ?? (rec ? APPLICATION_BY_ID[rec.applicationId] : null);
  const planPkg = ws.packageId ?? rec?.packageId ?? null;
  const dept = (ws.started ? String(ws.config.department ?? "") : "") || state.answers.department || "";

  return (
    <div className="flex min-h-screen flex-col bg-v-bg text-v-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-v-md focus:bg-v-fg focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-v-line bg-v-panel/95 backdrop-blur">
        <Container className="flex h-14 items-center justify-between gap-4">
          <Link href="/adopt" className="flex items-center gap-2.5" aria-label="VoicERA, adopter home">
            <VoicEraMark size={24} className="text-v-fg" />
            <span className="text-[15px] font-semibold tracking-tight">VoicERA</span>
            <span className="hidden rounded-v-sm border border-v-line px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted sm:inline">
              Adopt
            </span>
          </Link>
          <nav aria-label="Adopter navigation" className="hidden items-center gap-1 lg:flex">
            {PRIMARY.map((n) => {
              const active = isActive(pathname, n.href, n.exact);
              const dot = n.href === "/adopt/workspace" && hydrated && ws.started;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded-v-md px-3 py-2 text-[13.5px] font-medium transition-colors ${
                    active ? "bg-v-pale text-v-accent-deep" : "text-v-body hover:bg-v-soft hover:text-v-fg"
                  }`}
                >
                  {n.label}
                  {dot ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-v-accent" aria-label="Workspace started" /> : null}
                </Link>
              );
            })}
            <details key={pathname} className="group relative">
              <summary
                className={`flex cursor-pointer list-none items-center gap-1 rounded-v-md px-3 py-2 text-[13.5px] font-medium [&::-webkit-details-marker]:hidden ${
                  MORE.some((m) => isActive(pathname, m.href)) ? "bg-v-pale text-v-accent-deep" : "text-v-body hover:bg-v-soft hover:text-v-fg"
                }`}
              >
                More <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="absolute right-0 top-full z-50 mt-1 flex w-52 flex-col rounded-v-xl border border-v-line bg-v-panel p-1.5 shadow-[var(--v-shadow-card)]">
                {MORE.map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    aria-current={isActive(pathname, m.href) ? "page" : undefined}
                    className={`rounded-v-md px-3 py-2 text-[13.5px] ${isActive(pathname, m.href) ? "bg-v-pale font-medium text-v-accent-deep" : "text-v-body hover:bg-v-soft hover:text-v-fg"}`}
                  >
                    {m.label}
                  </Link>
                ))}
              </div>
            </details>
          </nav>
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-v-md border border-v-line text-v-fg lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="adopt-mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </Container>
        {open ? (
          <nav id="adopt-mobile-nav" aria-label="Adopter navigation" className="border-t border-v-line bg-v-panel lg:hidden">
            <Container className="flex flex-col py-2">
              {NAV.map((n) => {
                const active = isActive(pathname, n.href, n.exact);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-v-md px-3 py-3 text-[14px] font-medium ${
                      active ? "bg-v-pale text-v-accent-deep" : "text-v-body"
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </Container>
          </nav>
        ) : null}
        {hydrated && (planApp || dept) ? (
          <div className="border-t border-v-hairline bg-v-surface-sunk">
            <Container className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[12px] text-v-body">
              <span className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Your plan</span>
              <span className="min-w-0 truncate">
                {[dept, planApp?.name, planPkg ? PACKAGE_BY_ID[planPkg].name : null].filter(Boolean).join("  ·  ")}
              </span>
              <span className="ml-auto flex items-center gap-3">
                {rec && !ws.started ? (
                  <Link href="/adopt/select/result" className="font-semibold text-v-accent hover:underline">
                    Review recommendation
                  </Link>
                ) : null}
                {ws.started ? (
                  <Link href="/adopt/workspace" className="font-semibold text-v-accent hover:underline">
                    Open workspace
                  </Link>
                ) : null}
              </span>
            </Container>
          </div>
        ) : null}
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-v-line bg-v-panel">
        <Container className="flex flex-col gap-6 py-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[62ch] text-[12.5px] leading-relaxed text-v-muted">
            <p>
              Everything you enter stays in this browser. Conversation tests are a local simulation, and the operations
              figures are demonstration data. Nothing here calls a citizen or goes live.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 text-[13px]">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Link href="/adopt/help" className="text-v-body hover:text-v-accent">Help and support</Link>
              <Link href="/adopt/platform" className="text-v-body hover:text-v-accent">What the platform includes</Link>
            </div>
            {confirmReset ? (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]" role="alertdialog" aria-label="Confirm reset">
                <span className="text-v-body">Clear everything saved on this device?</span>
                <button
                  type="button"
                  className="rounded-v-md bg-v-danger px-3 py-1.5 font-semibold text-white"
                  onClick={() => {
                    actions.resetAll();
                    setConfirmReset(false);
                  }}
                >
                  Clear it
                </button>
                <button type="button" className="rounded-v-md border border-v-line px-3 py-1.5" onClick={() => setConfirmReset(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-v-muted hover:text-v-fg"
              >
                <RotateCcw className="size-3.5" aria-hidden /> Start over and clear saved answers
              </button>
            )}
          </div>
        </Container>
      </footer>
    </div>
  );
}
