/**
 * Thin IndexedDB wrapper. No external dependencies.
 *
 * Two stores:
 *  - "outbox": pending writes (POST/PATCH/DELETE) waiting to sync
 *  - "cache":  cached GET responses for offline reads
 */

const DB_NAME = 'marketpollen';
const DB_VERSION = 1;
const OUTBOX_STORE = 'outbox';
const CACHE_STORE = 'cache';

export interface OutboxEntry {
  id: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
  // Optional grouping key so the UI can describe what's pending
  label?: string;
}

export interface CacheEntry {
  url: string;
  data: unknown;
  fetchedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------- Outbox ----------------

export async function outboxAdd(entry: OutboxEntry): Promise<void> {
  const store = await tx(OUTBOX_STORE, 'readwrite');
  await reqAsync(store.put(entry));
}

export async function outboxAll(): Promise<OutboxEntry[]> {
  const store = await tx(OUTBOX_STORE, 'readonly');
  const all = await reqAsync(store.getAll());
  return (all as OutboxEntry[]).sort((a, b) => a.createdAt - b.createdAt);
}

export async function outboxDelete(id: string): Promise<void> {
  const store = await tx(OUTBOX_STORE, 'readwrite');
  await reqAsync(store.delete(id));
}

export async function outboxUpdate(entry: OutboxEntry): Promise<void> {
  const store = await tx(OUTBOX_STORE, 'readwrite');
  await reqAsync(store.put(entry));
}

export async function outboxCount(): Promise<number> {
  const store = await tx(OUTBOX_STORE, 'readonly');
  return reqAsync(store.count());
}

// ---------------- Cache ----------------

export async function cachePut(url: string, data: unknown): Promise<void> {
  const store = await tx(CACHE_STORE, 'readwrite');
  await reqAsync(
    store.put({ url, data, fetchedAt: Date.now() } as CacheEntry)
  );
}

export async function cacheGet<T>(url: string): Promise<T | null> {
  const store = await tx(CACHE_STORE, 'readonly');
  const entry = (await reqAsync(store.get(url))) as CacheEntry | undefined;
  return entry ? (entry.data as T) : null;
}

export async function cacheDelete(url: string): Promise<void> {
  const store = await tx(CACHE_STORE, 'readwrite');
  await reqAsync(store.delete(url));
}

export async function cacheClear(): Promise<void> {
  const store = await tx(CACHE_STORE, 'readwrite');
  await reqAsync(store.clear());
}

/**
 * Generate a sortable UUID. Falls back to crypto.randomUUID() when available.
 */
export function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
