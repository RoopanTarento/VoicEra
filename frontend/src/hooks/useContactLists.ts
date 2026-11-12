"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteContactList,
  listContactLists,
  renameContactList,
  uploadContactList,
  type ContactList,
  type ContactListUploadResult,
} from "@/lib/api/contact-lists";

export function useContactLists(onNotify: (title: string, note: string) => void) {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLists(await listContactLists());
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load contact lists.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listContactLists()
      .then((res) => {
        if (!cancelled) setLists(res);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load contact lists.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function upload(name: string, file: File): Promise<ContactListUploadResult | null> {
    setUploading(true);
    try {
      const result = await uploadContactList(name, file);
      await reload();
      return result;
    } catch (err) {
      onNotify("Couldn't upload list", err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function rename(listId: string, name: string): Promise<boolean> {
    setBusyId(listId);
    try {
      const updated = await renameContactList(listId, name);
      setLists((prev) => prev.map((l) => (l.list_id === listId ? { ...l, ...updated } : l)));
      onNotify("List renamed", `It's now called ${updated.name}.`);
      return true;
    } catch (err) {
      onNotify("Couldn't rename list", err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  /** Returns the server's reason on failure (e.g. a running campaign still uses
   * the list), so the confirm dialog can show it in place. */
  async function remove(listId: string): Promise<string | null> {
    setBusyId(listId);
    try {
      await deleteContactList(listId);
      setLists((prev) => prev.filter((l) => l.list_id !== listId));
      onNotify("List deleted", "Campaigns can no longer be created from it.");
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't delete this list.";
    } finally {
      setBusyId(null);
    }
  }

  return { lists, loading, loadError, uploading, busyId, upload, rename, remove, reload };
}
