/**
 * Offline write queue and drain loop.
 *
 * Design:
 *  - All mutating API calls (POST/PATCH/DELETE) optionally pass through this queue
 *    via `enqueueOrSend`. If the network call succeeds, we return the response
 *    immediately. If it fails because we appear to be offline, we persist the
 *    mutation to the IndexedDB outbox and resolve with `null` so the caller can
 *    apply an optimistic update.
 *  - The drain loop runs whenever we transition online or a new entry is
 *    enqueued, and uses exponential backoff per-entry on persistent failures.
 *  - GET responses are cached so screens still render when offline.
 *
 * Idempotency note: PATCH operations that send the full updated object (the
 * pattern used throughout the app, e.g. PATCH /contacts/:id with the entire
 * reachouts array) are naturally idempotent. POST operations that create new
 * resources should pass a client-generated id in the body so the server can
 * dedupe; the schema's existing `id`/`contactId`/`businessId` columns support
 * this.
 */

import {
  outboxAdd,
  outboxAll,
  outboxDelete,
  outboxUpdate,
  outboxCount,
  cachePut,
  cacheGet,
  genId,
  OutboxEntry,
} from './idb';

type Listener = () => void;

const listeners: Set<Listener> = new Set();
let pendingCount = 0;
let lastError: string | null = null;
let isDraining = false;
let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
// Monotonically increases each time an entry is successfully drained from
// the outbox to the server. UI layers subscribe to this so saves made
// offline immediately become visible once the queue catches up.
let syncedCount = 0;

// Per-entry retry backoff (ms): 0, 2s, 5s, 15s, 30s, then cap at 60s
const BACKOFF_MS = [0, 2_000, 5_000, 15_000, 30_000, 60_000];

// Token getter is injected from the API client to avoid an import cycle
let tokenGetter: (() => Promise<string | null>) | null = null;
export function setOfflineTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
}

function notify() {
  listeners.forEach((l) => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingCount(): number {
  return pendingCount;
}

export function getIsOnline(): boolean {
  return isOnline;
}

export function getLastError(): string | null {
  return lastError;
}

export function getSyncedCount(): number {
  return syncedCount;
}

async function refreshCount() {
  pendingCount = await outboxCount();
  notify();
}

// Initialize pendingCount on load
refreshCount().catch((err) => console.warn('Failed to read outbox count', err));

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true;
    notify();
    drain().catch((err) => console.warn('Drain on reconnect failed', err));
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    notify();
  });
}

function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  // fetch() throws TypeError on network failure
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /network|fetch|failed to fetch|load failed|networkerror/i.test(msg);
}

interface SendOptions {
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string; // full URL relative to origin (already prefixed /api/...)
  body?: unknown;
  /** Caller-visible description shown in the offline banner */
  label?: string;
}

/**
 * Send a mutation now. If the network is unreachable, persist it to the
 * outbox and return null (caller should treat this as a successful queue).
 */
export async function enqueueOrSend<T = unknown>(opts: SendOptions): Promise<T | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  // Try the network first. We treat ANY thrown error (which fetch only throws
  // for true network failures) as "queue it". HTTP errors (4xx/5xx) still
  // propagate so the caller sees validation errors normally when online.
  try {
    const res = await fetch(opts.url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || res.statusText);
    }
    return data as T;
  } catch (err) {
    if (!isNetworkError(err)) {
      // Real server error — bubble up, don't queue
      throw err;
    }

    // Persist and resolve with null (caller treats as queued)
    const entry: OutboxEntry = {
      id: genId(),
      method: opts.method,
      url: opts.url,
      body: opts.body,
      createdAt: Date.now(),
      attempts: 0,
      label: opts.label,
    };
    await outboxAdd(entry);
    await refreshCount();
    // Schedule a drain attempt soon in case connectivity returns
    setTimeout(() => {
      drain().catch(() => {});
    }, BACKOFF_MS[1]);
    return null;
  }
}

/**
 * Try to send every queued mutation. Stops on the first one that still fails
 * (so we preserve order). Uses per-entry exponential backoff.
 */
export async function drain(): Promise<void> {
  if (isDraining) return;
  isDraining = true;
  lastError = null;
  notify();

  try {
    const entries = await outboxAll();
    for (const entry of entries) {
      const wait = BACKOFF_MS[Math.min(entry.attempts, BACKOFF_MS.length - 1)];
      const elapsed = Date.now() - (entry.createdAt + wait * entry.attempts);
      if (entry.attempts > 0 && elapsed < wait) {
        // Not ready to retry yet
        continue;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (tokenGetter) {
        const token = await tokenGetter();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        const res = await fetch(entry.url, {
          method: entry.method,
          headers,
          body: entry.body !== undefined ? JSON.stringify(entry.body) : undefined,
        });
        if (!res.ok && res.status !== 204) {
          // HTTP error — treat as fatal for this entry (likely auth or validation)
          const txt = await res.text().catch(() => '');
          throw new Error(`${res.status} ${txt || res.statusText}`);
        }
        await outboxDelete(entry.id);
        syncedCount += 1;
        await refreshCount();
      } catch (err) {
        if (isNetworkError(err)) {
          // Still offline; stop draining for now
          isOnline = false;
          notify();
          break;
        }
        // Server-side error — bump attempts; after several failures we leave
        // the entry parked so the user can manually retry from the banner
        const next: OutboxEntry = {
          ...entry,
          attempts: entry.attempts + 1,
          lastError: err instanceof Error ? err.message : String(err),
        };
        await outboxUpdate(next);
        lastError = next.lastError ?? null;
        notify();
        // Try the next entry — don't let one bad write block the rest
        continue;
      }
    }
  } finally {
    isDraining = false;
    notify();
  }
}

/**
 * Force an immediate retry of every queued item (resets backoff).
 */
export async function retryAll(): Promise<void> {
  const entries = await outboxAll();
  for (const entry of entries) {
    if (entry.attempts > 0) {
      await outboxUpdate({ ...entry, attempts: 0, lastError: undefined });
    }
  }
  await drain();
}

/**
 * Wrap a GET so the response is cached for offline use. If the network fails
 * and we have a cached value, return it; otherwise re-throw.
 */
export async function cachedGet<T>(url: string): Promise<T> {
  if (tokenGetter) {
    // touch to keep variable used; auth header attached below
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || res.statusText);
    // Best-effort cache; ignore IDB failures (e.g. private-mode Safari)
    cachePut(url, data).catch(() => {});
    return data as T;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await cacheGet<T>(url);
    if (cached !== null) return cached;
    throw err;
  }
}

/**
 * Periodic background ping while pending items exist, in case the browser
 * never fires "online" (some mobile networks are unreliable about events).
 */
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (pendingCount > 0 && navigator.onLine) {
      drain().catch(() => {});
    }
  }, 30_000);
}
