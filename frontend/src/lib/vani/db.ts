import { RATES_AS_OF_DEFAULT } from "./catalog";
import { storage } from "./storage";
import type { Db } from "./types";

export const DB_KEY = "vani.db.v1";
export const TOKEN_KEY = "vani.token";

export const emptyDb = (): Db => ({
  version: 1, orgs: [], users: [], sessions: [], tokens: [], packages: [], audit: [], notices: [], agents: [],
  counters: { quote: 0 }, attempts: {},
  simulation: { network: false, recommendationDown: false, pricingDown: false, pdfFails: false, stalePricing: false, unavailableProviders: [] },
  ratesAsOf: RATES_AS_OF_DEFAULT,
});

let cache: Db | null = null;
let seeder: (() => Promise<Db>) | null = null;
export const setSeeder = (fn: () => Promise<Db>) => { seeder = fn; };
export const dropCache = () => { cache = null; };

export async function loadDb(): Promise<Db> {
  if (cache) return cache;
  const raw = storage.persistent.get(DB_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.version === 1) { cache = parsed; return parsed; }
    } catch { /* fall through to a fresh database */ }
  }
  cache = seeder ? await seeder() : emptyDb();
  saveDb(cache);
  return cache;
}

export function saveDb(db: Db) {
  cache = db;
  storage.persistent.set(DB_KEY, JSON.stringify(db));
}

export async function resetDb(): Promise<Db> {
  storage.persistent.remove(DB_KEY);
  storage.persistent.remove(TOKEN_KEY);
  storage.tab.remove(TOKEN_KEY);
  cache = null;
  return loadDb();
}

/** Run a change and save it. */
export async function mutate<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const db = await loadDb();
  const out = await fn(db);
  saveDb(db);
  return out;
}
