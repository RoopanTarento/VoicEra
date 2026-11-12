"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getMyAccess, type RbacMe } from "@/lib/api/rbac";

interface PermissionsValue {
  me: RbacMe | null;
  loaded: boolean;
  /** True when the signed-in role has ``permission``. Until access has loaded,
   * tenant permissions read as granted (the API still enforces them) so the
   * sidebar doesn't flash empty; platform access is never assumed. */
  can: (permission: string) => boolean;
  refresh: () => void;
}

const PermissionsContext = createContext<PermissionsValue>({
  me: null,
  loaded: false,
  can: () => false,
  refresh: () => {},
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [me, setMe] = useState<RbacMe | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const key = session ? `${session.email}:${session.orgId}:${version}` : null;

  // Re-read access when the tab regains focus and every minute, so a role
  // change or suspension shows up without signing out (the API enforces it
  // immediately either way).
  useEffect(() => {
    if (!session) return;
    const bump = () => setVersion((v) => v + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(bump, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [session]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getMyAccess()
      .then((access) => {
        if (!cancelled) {
          setMe(access);
          setLoadedFor(key);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadedFor(key);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // After the first load, keep showing the last known access while a refresh runs.
  const loaded = key !== null && loadedFor !== null && loadedFor.startsWith(`${session?.email}:${session?.orgId}:`);
  const can = useCallback(
    (permission: string) => {
      if (permission.startsWith("platform:")) return Boolean(loaded && me?.platform_admin);
      if (!loaded || !me) return true;
      return me.permissions.includes(permission);
    },
    [loaded, me],
  );

  return (
    <PermissionsContext.Provider
      value={{ me: loaded ? me : null, loaded, can, refresh: () => setVersion((v) => v + 1) }}
    >
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionsContext);
}

/** Shown across the top when the platform has suspended this adopter. */
export function AdopterStatusBanner() {
  const { me } = usePermissions();
  if (!me || me.adopter_status !== "suspended") return null;
  return (
    <div className="border-b border-v-danger-line bg-v-danger-pale px-6 py-2.5 text-center text-sm text-v-danger">
      This organisation is suspended by the VoicEra platform team. Calls, campaigns and data access are paused.
    </div>
  );
}

/**
 * Page-level guard: renders ``children`` only when the role has ``permission``;
 * otherwise a plain "your role can't do this" panel. The API refuses the same
 * actions, so this is for clarity, not security.
 */
export function RequirePermission({
  permission,
  what,
  children,
}: {
  permission: string;
  /** What the page is for, e.g. "manage contact lists". */
  what: string;
  children: React.ReactNode;
}) {
  const { can, me, loaded } = usePermissions();
  if (!loaded || can(permission)) return <>{children}</>;
  return (
    <div className="mx-auto mt-16 max-w-md rounded-v-xl border border-v-line bg-v-panel p-6 text-center">
      <p className="text-base font-medium text-v-fg">Your role can&apos;t {what}</p>
      <p className="mt-2 text-sm font-light leading-relaxed text-v-muted">
        You&apos;re signed in as {me?.role_label ?? "a member"}. See Workspace → Roles &amp; Permissions for what each
        role can do, or ask your organisation&apos;s Super admin or an Admin to change your role.
      </p>
    </div>
  );
}
