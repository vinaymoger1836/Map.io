'use client';

/**
 * Where War Games keeps things.
 *
 * One interface, two implementations. On a machine running the app the
 * documents are JSON files under `data/` — durable, diffable, and untouched by
 * clearing a browser. Where that API is unavailable (a static export, or the
 * route failing) the same documents fall back to localStorage, so the app never
 * loses the ability to save; it only loses the ability to save *well*, and says
 * so.
 *
 * Nothing else in the app talks to storage directly. When these documents want
 * to live in Postgres on a server instead, this file is the only one that
 * changes.
 */

export interface Store {
  read<T>(doc: string): Promise<T | null>;
  write<T>(doc: string, value: T): Promise<void>;
  /** How the interface should describe where things are being kept. */
  readonly kind: 'files' | 'browser';
}

const LOCAL_PREFIX = 'mapio.wargames.';

const browserStore: Store = {
  kind: 'browser',
  async read<T>(doc: string): Promise<T | null> {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(LOCAL_PREFIX + doc);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      console.error(`[store] local read of ${doc} failed`, err);
      return null;
    }
  },
  async write<T>(doc: string, value: T): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LOCAL_PREFIX + doc, JSON.stringify(value));
    } catch (err) {
      console.error(`[store] local write of ${doc} failed`, err);
    }
  },
};

const fileStore: Store = {
  kind: 'files',
  async read<T>(doc: string): Promise<T | null> {
    const res = await fetch(`/api/store/${doc}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T | null;
  },
  async write<T>(doc: string, value: T): Promise<void> {
    const res = await fetch(`/api/store/${doc}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  },
};

let resolved: Store | null = null;
let probe: Promise<Store> | null = null;

/**
 * Picks the best store available, once per session. The probe is a real read of
 * a document that is allowed to be empty, because a route that 404s and a route
 * that returns `null` are very different answers and only one of them means the
 * files are usable.
 */
export function getStore(): Promise<Store> {
  if (resolved) return Promise.resolve(resolved);
  if (probe) return probe;

  probe = (async () => {
    try {
      await fileStore.read('probe');
      resolved = fileStore;
    } catch {
      console.warn('[store] file storage unavailable — falling back to browser storage.');
      resolved = browserStore;
    }
    return resolved;
  })();

  return probe;
}

export async function readDoc<T>(doc: string): Promise<T | null> {
  const store = await getStore();
  let val: T | null = null;
  if (store.kind === 'files') {
    try {
      val = await store.read<T>(doc);
    } catch (err) {
      console.warn(`[store] server read of ${doc} failed, checking local browser storage`, err);
    }
  }

  // If server had data, return it
  if (val !== null && val !== undefined) {
    if (!Array.isArray(val) || val.length > 0) {
      return val;
    }
  }

  // Fall back to local browser storage (essential for Vercel/serverless deployments)
  const localVal = await browserStore.read<T>(doc);
  return localVal !== null ? localVal : val;
}

export async function writeDoc<T>(doc: string, value: T): Promise<void> {
  // Always persist to browser localStorage so it survives page refreshes on Vercel / any device
  await browserStore.write(doc, value);

  // Also write to server/file store when available
  const store = await getStore();
  if (store.kind === 'files') {
    try {
      await store.write(doc, value);
    } catch (err) {
      console.warn(`[store] server file write of ${doc} failed; kept in browser storage`, err);
    }
  }
}

/**
 * Reads a document, and if it is empty adopts whatever the old localStorage key
 * held. Boards written before there was a store on disk are carried over once,
 * silently, on the first load that finds files available.
 */
export async function readWithLegacyFallback<T>(doc: string, legacyKey: string): Promise<T | null> {
  const current = await readDoc<T>(doc);
  if (current) return current;

  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) return null;
    const migrated = JSON.parse(raw) as T;
    await writeDoc(doc, migrated);
    console.info(`[store] migrated ${legacyKey} into ${doc}.`);
    return migrated;
  } catch (err) {
    console.error(`[store] could not migrate ${legacyKey}`, err);
    return null;
  }
}
