/** A tiny key-value store so the mock backend runs in the browser and under node tests. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  get(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  set(k: string, v: string) { this.m.set(k, v); }
  remove(k: string) { this.m.delete(k); }
}

function browserKV(kind: "local" | "session"): KV {
  const area = () => (typeof window === "undefined" ? null : kind === "local" ? window.localStorage : window.sessionStorage);
  return {
    get(k) { try { return area()?.getItem(k) ?? null; } catch { return null; } },
    set(k, v) { try { area()?.setItem(k, v); } catch { /* storage full or blocked */ } },
    remove(k) { try { area()?.removeItem(k); } catch { /* ignore */ } },
  };
}

let persistent: KV = browserKV("local");
let tab: KV = browserKV("session");
export const storage = { get persistent() { return persistent; }, get tab() { return tab; } };

/** Tests swap both stores for memory. */
export function useMemoryStorage() { persistent = new MemoryKV(); tab = new MemoryKV(); }
