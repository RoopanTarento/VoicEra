"use client";

import { useCallback, useEffect, useState } from "react";
import { listMembers, removeMember } from "@/lib/api/members";
import { changeMemberRole } from "@/lib/api/rbac";
import type { MemberListItem, UserRole } from "@/lib/api-types";

export function useMembers(orgId: string | undefined, onNotify: (title: string, note: string) => void) {
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoadError("");
    try {
      const res = await listMembers(orgId);
      setMembers(res.members);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load members.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    // Fetch on mount; the list is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /** Optimistic: the table shows the new role at once and goes back to the
   * old one if the API refuses (the API enforces the same rules as the UI). */
  async function changeRole(m: MemberListItem, role: string, label: string) {
    const previous = m.role;
    const setRole = (from: string, to: string) =>
      setMembers((list) =>
        list.map((x) => (x.email === m.email && x.role === from ? { ...x, role: to as UserRole } : x)),
      );
    setBusyEmail(m.email);
    setRole(previous, role);
    try {
      await changeMemberRole(m.email, role);
      onNotify("Role updated", `${m.email} is now ${label}.`);
    } catch (err) {
      setRole(role, previous);
      onNotify("Couldn't change role", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyEmail(null);
    }
  }

  async function remove(m: MemberListItem) {
    setBusyEmail(m.email);
    try {
      await removeMember(m.email);
      onNotify("Removed", `${m.email} was removed.`);
      await load();
    } catch (err) {
      onNotify("Couldn't remove", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyEmail(null);
    }
  }

  return { members, loading, loadError, busyEmail, changeRole, remove, reload: load };
}
