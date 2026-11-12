"use client";

import { Bell, ChevronRight, HelpCircle, LayoutGrid, LogOut, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, PhoneCall, Plus, Search, Settings, ShieldCheck, BarChart3, Package, User, CornerDownLeft, Moon, Sun, WifiOff } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "@/lib/vani/api";
import { ago } from "@/lib/vani/format";
import { roleLabel } from "@/lib/vani/rbac";
import type { Notice, PackageRecord } from "@/lib/vani/types";
import { useVani } from "./provider";
import { Alert, Badge, Button, Dialog, Drawer, IconButton, Logo, Menu, MenuItem, Skeleton, Tooltip, cx, useMounted } from "./ui";

const NAV = [
  { href: "/vani/app", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/vani/app/packages", label: "Packages", icon: Package },
  { href: "/vani/app/agents", label: "Agents & Campaigns", icon: PhoneCall },
  { href: "/vani/app/insights", label: "Insights", icon: BarChart3 },
  { href: "/vani/app/governance", label: "Governance", icon: ShieldCheck },
];
const FOOT = [
  { href: "/vani/app/settings", label: "Settings", icon: Settings },
  { href: "/vani/app/help", label: "Help", icon: HelpCircle },
];

/* Breadcrumb override: the wizard tells the shell the package's name. */
const CrumbCtx = createContext<{ label: string | null; set: (l: string | null) => void }>({ label: null, set: () => {} });
export function useCrumb(label: string | null | undefined) {
  const { set } = useContext(CrumbCtx);
  useEffect(() => { set(label ?? null); return () => set(null); }, [label, set]);
}

const SEGMENT: Record<string, string> = { app: "Workspace", packages: "Packages", agents: "Agents & Campaigns", insights: "Insights", governance: "Governance", settings: "Settings", help: "Help", new: "New package", requirements: "Requirements", hosting: "Hosting & data", recommendation: "Recommendation", configure: "Configure & price", quote: "Quote", design: "Design system" };

function Breadcrumbs({ pathname, pkgName }: { pathname: string; pkgName: string | null }) {
  const parts = pathname.replace(/^\/vani\/?/, "").split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];
  let acc = "/vani";
  parts.forEach((p, i) => {
    acc += `/${p}`;
    const isId = parts[i - 1] === "packages" && p !== "new";
    crumbs.push({ label: isId ? pkgName ?? "Package" : SEGMENT[p] ?? p, href: isId ? `${acc}/requirements` : acc });
  });
  const shown = crumbs.slice(parts[0] === "app" ? 1 : 0);
  if (shown.length === 0) shown.push({ label: "Overview", href: "/vani/app" });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 m-0 p-0 list-none" style={{ fontSize: 13 }}>
        {shown.map((c, i) => (
          <li key={`${i}-${c.href}`} className={cx("flex items-center gap-1.5 min-w-0", i < shown.length - 2 && "hidden sm:flex")}>
            {i > 0 && <ChevronRight size={13} className="muted flex-none" aria-hidden />}
            {i === shown.length - 1 ? <span className="ink truncate" style={{ fontWeight: 500 }} aria-current="page">{c.label}</span> : <Link href={c.href} className="truncate" style={{ color: "var(--muted)", textDecoration: "none" }}>{c.label}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ command palette */

function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { can, toast } = useVani();
  const [q, setQ] = useState("");
  const [pkgs, setPkgs] = useState<PackageRecord[]>([]);
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { api.listPackages().then(setPkgs).catch(() => setPkgs([])); } }, [open]);
  const items = useMemo(() => {
    const all: { label: string; hint: string; run: () => void }[] = [
      ...(can("create") ? [{ label: "Create a package", hint: "Action", run: () => router.push("/vani/app/packages/new") }] : []),
      ...NAV.map((n) => ({ label: n.label, hint: "Go to", run: () => router.push(n.href) })),
      ...FOOT.map((n) => ({ label: n.label, hint: "Go to", run: () => router.push(n.href) })),
      { label: "Design system", hint: "Go to", run: () => router.push("/vani/app/design") },
      ...pkgs.map((p) => ({ label: p.name, hint: "Package", run: () => router.push(`/vani/app/packages/${p.id}/${p.step}`) })),
    ];
    const t = q.trim().toLowerCase();
    return t ? all.filter((x) => x.label.toLowerCase().includes(t)) : all.slice(0, 9);
  }, [q, pkgs, can, router]);
  const go = (i: number) => { const it = items[i]; if (!it) { toast("Nothing matches that search."); return; } onClose(); it.run(); };
  return (
    <Dialog open={open} onClose={() => { setQ(""); onClose(); }} title="Search" description="Jump to a package or page.">
      <div className="va-affix">
        <span className="pre"><Search size={15} aria-hidden /></span>
        <input data-autofocus className="va-input" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={`pal-${sel}`} aria-label="Search packages and pages" placeholder="Search packages and pages" value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } if (e.key === "Enter") { e.preventDefault(); go(sel); } }} />
      </div>
      <ul id="pal-list" role="listbox" aria-label="Results" className="m-0 mt-3 p-0 list-none grid gap-0.5" style={{ maxHeight: 320, overflowY: "auto" }}>
        {items.map((it, i) => (
          <li key={it.label + i} id={`pal-${i}`} role="option" aria-selected={i === sel}>
            <button type="button" className="va-menuitem justify-between" style={i === sel ? { background: "var(--sunken)" } : undefined} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
              <span>{it.label}</span><span className="muted" style={{ fontSize: 12 }}>{it.hint}</span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="muted p-3" style={{ fontSize: 13 }}>No results for &quot;{q}&quot;.</li>}
      </ul>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ notifications */

function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<Notice[]>([]);
  const load = useCallback(() => { api.listNotices().then(setItems).catch(() => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  const unread = items.filter((n) => !n.read).length;
  return (
    <Menu label="Notifications" trigger={({ props }) => (
      <button type="button" className="va-btn va-btn--ghost va-btn--icon relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} {...props} onClick={(e) => { load(); (props.onClick as () => void)(); e.currentTarget.blur(); }}>
        <Bell size={17} />{unread > 0 && <span style={{ position: "absolute", top: 7, right: 8, width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--bg)" }} />}
      </button>
    )}>
      {(close) => (
        <div style={{ width: 320 }}>
          <div className="flex items-center justify-between px-2.5 py-1.5"><span className="ink" style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>{unread > 0 && <button className="va-link" style={{ fontSize: 12.5 }} onClick={() => { void api.markNoticesRead().then(load); }}>Mark all read</button>}</div>
          <div className="va-menusep" style={{ marginTop: 2 }} />
          {items.length === 0 ? <p className="muted p-3" style={{ fontSize: 13 }}>Nothing yet. Approvals and returns show up here.</p> : items.slice(0, 6).map((n) => (
            <MenuItem key={n.id} onSelect={() => { close(); if (n.href) router.push(n.href); }}>
              <span className="min-w-0"><span className="block ink truncate" style={{ fontWeight: n.read ? 400 : 600 }}>{n.title}</span><span className="block muted" style={{ fontSize: 12, whiteSpace: "normal" }}>{n.body}</span><span className="block muted" style={{ fontSize: 11.5 }}>{ago(n.at)}</span></span>
            </MenuItem>
          ))}
        </div>
      )}
    </Menu>
  );
}

/* ------------------------------------------------------------------ shell */

function NavLink({ item, pathname, collapsed, onNavigate }: { item: (typeof NAV)[number]; pathname: string; collapsed: boolean; onNavigate?: () => void }) {
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const Icon = item.icon;
  const link = <Link href={item.href} className="va-nav" aria-label={item.label} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon size={17} className="flex-none" aria-hidden /><span className="lbl">{item.label}</span></Link>;
  return collapsed ? <Tooltip text={item.label} side="right">{link}</Tooltip> : link;
}

function Sidebar({ collapsed, onToggle, onNavigate, pathname, mobile }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; pathname: string; mobile?: boolean }) {
  const { user, org, signOut, confirm, theme, setTheme } = useVani();
  const dark = theme === "dark";
  return (
    <div className={cx("flex flex-col h-full", collapsed && "va-collapsed")} style={{ background: "var(--surface)" }}>
      <div className="flex items-center justify-between px-3" style={{ height: 56 }}>
        <Link href="/vani/app" style={{ textDecoration: "none" }} aria-label="Vani Anuvaad home" onClick={onNavigate}><Logo withName={!collapsed} /></Link>
      </div>
      {!collapsed && org && <div className="mx-3 mb-3 px-3 py-2 rounded-lg" style={{ background: "var(--sunken)", border: "1px solid var(--line)" }}><div className="eyebrow" style={{ fontSize: 10 }}>Organisation</div><div className="ink truncate" style={{ fontWeight: 500, fontSize: 13 }} title={org.name}>{org.name}</div></div>}
      <nav aria-label="Primary" className="px-3 grid gap-0.5">{NAV.map((n) => <NavLink key={n.href} item={n} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />)}</nav>
      <div className="flex-1" />
      <nav aria-label="Secondary" className="px-3 pb-2 grid gap-0.5">{FOOT.map((n) => <NavLink key={n.href} item={n} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />)}
        <button type="button" className="va-nav" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>{dark ? <Sun size={17} className="flex-none" aria-hidden /> : <Moon size={17} className="flex-none" aria-hidden />}<span className="lbl">{dark ? "Light theme" : "Dark theme"}</span></button>
      </nav>
      <div className="p-3" style={{ borderTop: "1px solid var(--line)" }}>
        <Menu label="Account" align="left" side="top" trigger={({ props }) => (
          <button type="button" className="va-nav" style={{ height: 44 }} aria-label={`Account menu for ${user?.name ?? "you"}`} {...props}>
            <span className="grid place-content-center flex-none" style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--solid)", color: "var(--on-solid)", fontSize: 11, fontWeight: 700 }} aria-hidden>{(user?.name ?? "?").split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
            <span className="lbl text-left min-w-0"><span className="block ink truncate" style={{ fontSize: 13, fontWeight: 500 }}>{user?.name}</span><span className="block muted truncate" style={{ fontSize: 11.5 }}>{user ? roleLabel(user.role) : ""}</span></span>
          </button>
        )}>
          {(close) => (
            <div style={{ minWidth: 230 }}>
              <div className="px-2.5 py-2"><div className="ink" style={{ fontWeight: 600 }}>{user?.name}</div><div className="muted" style={{ fontSize: 12.5 }}>{user?.email}</div></div>
              <div className="va-menusep" />
              <MenuItem icon={<User size={15} />} href="/vani/app/settings" onSelect={() => { close(); onNavigate?.(); }}>Profile and settings</MenuItem>
              <MenuItem icon={<LogOut size={15} />} danger onSelect={async () => { close(); if (await confirm({ title: "Sign out?", body: "Your work is saved. You can sign in again at any time.", confirmLabel: "Sign out" })) void signOut(); }}>Sign out</MenuItem>
            </div>
          )}
        </Menu>
        {!mobile && onToggle && <button type="button" onClick={onToggle} className="va-nav mt-1" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>{collapsed ? <PanelLeftOpen size={17} className="flex-none" aria-hidden /> : <PanelLeftClose size={17} className="flex-none" aria-hidden />}<span className="lbl">Collapse</span></button>}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status, loggedOut, user, org, refresh } = useVani();
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useMounted();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState(false);
  const [crumb, setCrumb] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => { try { const v = localStorage.getItem("vani.nav") === "1"; const id = requestAnimationFrame(() => setCollapsed(v)); return () => cancelAnimationFrame(id); } catch { /* ignore */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("vani.nav", c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  useEffect(() => { if (status === "anon" && !loggedOut) router.replace(`/vani/signin?denied=1&next=${encodeURIComponent(pathname)}`); }, [status, loggedOut, router, pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(true); }
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) { e.preventDefault(); setSearch(true); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { mainRef.current?.focus({ preventScroll: true }); }, [pathname]);

  const crumbCtx = useMemo(() => ({ label: crumb, set: setCrumb }), [crumb]);

  if (status === "error") {
    return (
      <div className="min-h-dvh grid place-items-center p-6">
        <div style={{ maxWidth: 420 }}>
          <Alert tone="bad" title="We can't reach the server" action={<Button size="sm" onClick={() => void refresh()}>Try again</Button>}>Check your connection. Your saved work is safe.</Alert>
          <p className="mt-4 muted flex items-center gap-2" style={{ fontSize: 12.5 }}><WifiOff size={14} /> If the prototype&apos;s network switch is on, turn it off in Settings once you can sign in.</p>
        </div>
      </div>
    );
  }
  if (status === "loading" || status === "anon" || !user || !mounted) {
    return (
      <div className="min-h-dvh flex" aria-busy="true">
        <div className="hidden lg:block" style={{ width: 240, borderRight: "1px solid var(--line)", padding: 16 }}><Skeleton w={130} h={22} /><div className="mt-8 grid gap-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={30} />)}</div></div>
        <div className="flex-1 p-8"><Skeleton w={220} h={28} /><div className="mt-8 grid gap-4 sm:grid-cols-3"><Skeleton h={110} r={12} /><Skeleton h={110} r={12} /><Skeleton h={110} r={12} /></div></div>
      </div>
    );
  }
  const sandbox = org?.environment !== "Production";
  return (
    <CrumbCtx.Provider value={crumbCtx}>
      <div className="min-h-dvh flex" style={{ background: "var(--bg)" }}>
        <aside className="hidden lg:block flex-none sticky top-0 h-dvh va-noprint" style={{ width: collapsed ? 64 : 244, borderRight: "1px solid var(--line)", transition: "width 0.2s cubic-bezier(0.22,1,0.36,1)" }} aria-label="Sidebar">
          <Sidebar collapsed={collapsed} onToggle={toggle} pathname={pathname} />
        </aside>
        <Drawer open={mobileNav} onClose={() => setMobileNav(false)} title="Menu">
          <div className="-m-5" style={{ height: "calc(100% + 40px)" }}><Sidebar collapsed={false} mobile pathname={pathname} onNavigate={() => setMobileNav(false)} /></div>
        </Drawer>
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-6 va-noprint" style={{ height: 56, background: "color-mix(in srgb, var(--bg) 90%, transparent)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--line)" }}>
            <IconButton label="Open menu" className="lg:hidden" onClick={() => setMobileNav(true)} tip={false}><MenuIcon size={18} /></IconButton>
            <Breadcrumbs pathname={pathname} pkgName={crumb} />
            <div className="flex-1" />
            <Tooltip side="bottom" align="end" text={sandbox ? "Sandbox: nothing here goes live" : "Production environment"}><span><Badge tone={sandbox ? "warn" : "pass"}><span className="va-dot" style={{ background: "currentColor" }} />{org?.environment}</Badge></span></Tooltip>
            <button type="button" onClick={() => setSearch(true)} className="va-btn va-btn--secondary va-btn--sm hidden sm:inline-flex" style={{ minWidth: 180, justifyContent: "space-between", color: "var(--muted)" }} aria-label="Search (press slash)"><span className="flex items-center gap-2"><Search size={14} aria-hidden />Search</span><span className="va-kbd">/</span></button>
            <IconButton label="Search" className="sm:hidden" onClick={() => setSearch(true)} tip={false}><Search size={17} /></IconButton>
            <Tooltip side="bottom" align="end" text="Help"><Link href="/vani/app/help" className="va-btn va-btn--ghost va-btn--icon" aria-label="Help"><HelpCircle size={17} /></Link></Tooltip>
            <Notifications />
          </header>
          <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 min-w-0" style={{ outline: "none" }}>{children}</main>
        </div>
      </div>
      <Palette open={search} onClose={() => setSearch(false)} />
    </CrumbCtx.Provider>
  );
}

export { Plus, CornerDownLeft };
