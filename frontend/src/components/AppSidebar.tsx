"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Building2,
  BookOpen,
  Clock,
  FileText,
  Hash,
  KeySquare,
  Layers,
  ListChecks,
  PlayCircle,
  Plug,
  ScrollText,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { NavRail, type NavGroup } from "@/components/ui/NavRail";
import { ProfileMenu } from "@/components/ui/ProfileMenu";
import { useAuth } from "@/components/AuthProvider";
import { useWalkthrough } from "@/components/walkthrough";
import { usePermissions } from "@/components/PermissionsProvider";

const iconClass = "size-[17px] shrink-0";
const SIDEBAR_EXPANDED_KEY = "voicera_sidebar_expanded";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { restart: restartWalkthrough } = useWalkthrough();
  const { can, me } = usePermissions();

  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    return stored === null ? true : stored === "1";
  });

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, next ? "1" : "0");
      return next;
    });
  }

  const isRoute = (path: string) => pathname === path;

  const groups: NavGroup[] = [
    {
      label: "Build",
      items: [
        {
          key: "agent-builder",
          label: "Agent Builder",
          icon: <Sparkles className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/agent-builder"),
          onClick: () => router.push("/agent-builder"),
        },
        {
          key: "dash",
          label: "Agents",
          icon: <User className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/dashboard"),
          onClick: () => router.push("/dashboard"),
          tourId: "nav-agents",
        },
        {
          key: "numbers",
          label: "Numbers",
          icon: <Hash className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/numbers"),
          onClick: () => router.push("/numbers"),
          tourId: "nav-numbers",
        },
        {
          key: "kb",
          label: "Knowledge Base",
          icon: <BookOpen className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/knowledge-base"),
          onClick: () => router.push("/knowledge-base"),
          tourId: "nav-kb",
        },
        {
          key: "contact-lists",
          label: "Contact Lists",
          icon: <ListChecks className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/contact-lists"),
          onClick: () => router.push("/contact-lists"),
        },
        {
          key: "batches",
          label: "Campaigns",
          icon: <Layers className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/batches"),
          onClick: () => router.push("/batches"),
          tourId: "nav-campaigns",
        },
        {
          key: "history",
          label: "History",
          icon: <Clock className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/history"),
          onClick: () => router.push("/history"),
          tourId: "nav-history",
        },
        {
          key: "analytics",
          label: "Analytics",
          icon: <TrendingUp className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/analytics"),
          onClick: () => router.push("/analytics"),
          tourId: "nav-analytics",
        },
        {
          key: "telemetry",
          label: "Telemetry",
          icon: <Activity className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/telemetry"),
          onClick: () => router.push("/telemetry"),
          tourId: "nav-telemetry",
        },
      ],
    },
    ...(can("platform:manage")
      ? [
          {
            // VoicEra operators only: adopters and platform-wide audit.
            label: "Platform",
            items: [
              { key: "platform-adopters", label: "Adopters", path: "/platform/adopters", icon: Building2 },
              { key: "platform-audit", label: "Platform audit", path: "/platform/audit", icon: ScrollText },
            ].map(({ key, label, path, icon: Icon }) => ({
              key,
              label,
              icon: <Icon className={iconClass} strokeWidth={1.8} />,
              active: isRoute(path),
              onClick: () => router.push(path),
            })),
          },
        ]
      : []),
    {
      label: "Workspace",
      items: [
        {
          key: "members",
          label: "Members",
          icon: <Users className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/members"),
          onClick: () => router.push("/members"),
          tourId: "nav-members",
        },
        {
          key: "roles",
          label: "Roles & Permissions",
          icon: <KeySquare className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/roles"),
          onClick: () => router.push("/roles"),
        },
        {
          key: "integrations",
          label: "Integrations",
          icon: <Plug className={iconClass} strokeWidth={1.8} />,
          active: isRoute("/integrations"),
          onClick: () => router.push("/integrations"),
          tourId: "nav-integrations",
        },
      ],
    },
  ];

  // Hide what the signed-in role can't use (the API enforces it regardless).
  const ITEM_PERMISSION: Record<string, string> = {
    "agent-builder": "copilot:use",
    dash: "agents:read",
    "contact-lists": "lists:read",
    numbers: "numbers:read",
    kb: "knowledge:read",
    batches: "campaigns:read",
    history: "calls:read",
    analytics: "analytics:read",
    telemetry: "telemetry:read",
    members: "members:read",
    integrations: "integrations:read",
  };
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((item) => !ITEM_PERMISSION[item.key] || can(ITEM_PERMISSION[item.key]!)) }))
    .filter((g) => g.items.length > 0);

  return (
    <NavRail
      groups={visibleGroups}
      expanded={expanded}
      onToggleExpanded={toggleExpanded}
      onBrandClick={() => router.push("/dashboard")}
      footer={
        <>
          <button
            type="button"
            title="Walkthrough"
            onClick={() => {
              restartWalkthrough();
              router.push("/dashboard");
            }}
            className="flex w-full cursor-pointer items-center gap-[11px] rounded-v-md px-[11px] py-1.5 text-left text-[13.5px] font-medium text-v-accent transition-colors duration-[120ms] hover:bg-v-soft"
          >
            <PlayCircle className={iconClass} strokeWidth={1.8} />
            {expanded ? <span>Walkthrough</span> : null}
          </button>
          <button
            type="button"
            title="Docs"
            onClick={() => window.open("https://voicera.mintlify.app/docs/guides", "_blank")}
            className="flex w-full cursor-pointer items-center gap-[11px] rounded-v-md px-[11px] py-1.5 text-left text-[13.5px] font-medium text-v-body transition-colors duration-[120ms] hover:bg-v-soft hover:text-v-fg"
          >
            <FileText className={iconClass} strokeWidth={1.8} />
            {expanded ? <span>Docs</span> : null}
          </button>
          <ProfileMenu
            name={session?.name?.trim() || "User"}
            email={session?.email ?? ""}
            org={session?.orgName ?? ""}
            orgId={session?.orgId ?? ""}
            role={me?.role ?? session?.role ?? "member"}
            expanded={expanded}
            onAccount={() => router.push("/account")}
            onMembers={() => router.push("/members")}
            onSignOut={signOut}
          />
        </>
      }
    />
  );
}
