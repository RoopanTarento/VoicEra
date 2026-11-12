"use client";

import { useCallback, useEffect, useState } from "react";
import { getUseCaseCatalogue, type Scheme, type UseCaseCatalogue } from "@/lib/api/use-cases";

// Shared by the Start step, the Agent step's use-case row and the call detail
// sheet, so moving between them doesn't flash an empty list. Custom schemes
// added or removed here go through `addScheme` / `removeScheme` below, which
// update the cache too.
let cached: UseCaseCatalogue | null = null;
let inflight: Promise<UseCaseCatalogue> | null = null;

function fetchCatalogue(): Promise<UseCaseCatalogue> {
  if (!inflight) {
    inflight = getUseCaseCatalogue()
      .then((res) => {
        cached = res;
        return res;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** The scheme / survey catalogue (fetched once, then shared). */
export function useUseCaseCatalogue() {
  const [catalogue, setCatalogue] = useState<UseCaseCatalogue | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");

  // Shows the cached copy straight away but still refreshes it on mount, so a
  // scheme another teammate added (or a different signed-in org) shows up.
  useEffect(() => {
    let cancelled = false;
    fetchCatalogue()
      .then((res) => {
        if (!cancelled) setCatalogue(res);
      })
      .catch((err) => {
        if (!cancelled && !cached) setError(err instanceof Error ? err.message : "Couldn't load schemes and surveys.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setCatalogue(await fetchCatalogue());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load schemes and surveys.");
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback((fn: (c: UseCaseCatalogue) => UseCaseCatalogue) => {
    setCatalogue((c) => {
      if (!c) return c;
      cached = fn(c);
      return cached;
    });
  }, []);

  const addScheme = useCallback(
    (scheme: Scheme) => update((c) => ({ ...c, schemes: [...c.schemes.filter((s) => s.id !== scheme.id), scheme] })),
    [update],
  );

  const removeScheme = useCallback(
    (schemeId: string) => update((c) => ({ ...c, schemes: c.schemes.filter((s) => s.id !== schemeId) })),
    [update],
  );

  return { catalogue, loading, error, reload, addScheme, removeScheme };
}
