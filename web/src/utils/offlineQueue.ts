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

// ─── Active reachability probing ───────────────────────────────────────────
//
// `navigator.onLine` and the OS-level online/offline events only know about
// hardware-level connectivity. They lie in three real-world scenarios that
// hit field marketers constantly:
//
//   1. Marginal cellular — the radio still has a "bar" but nothing routes,
//      so every fetch hangs/times out.
//   2. Captive-portal Wi-Fi — fetches "succeed" against the portal but
//      return HTML/401 instead of API JSON.
//   3. The API itself is down/being deployed — internet is fine but no
//      writes will ever land.
//
// We compensate by actively probing GET /api/health (no auth, no DB, no
// caching) on a few smart triggers and updating `isOnline` based on what
// actually round-trips. Listeners (the OfflineContext, all UI banners and
// gated buttons) react automatically because they already subscribe to this
// module's `notify()` channel.

const HEALTH_URL = '/api/health';
const PROBE_TIMEOUT_MS = 5_000;
// Heartbeat cadence while online and foregrounded. 25s is a balance between
// "marketer notices a dead zone within 30s of walking into it" and "doesn't
// burn battery / mobile data".
const PROBE_INTERVAL_ONLINE_MS = 25_000;
// Backoff while offline — we still poll occasionally so the app can flip
// itself back to online when service returns even if the OS misses the
// `online` event (a real failure mode on iOS Safari over flaky cellular).
const PROBE_BACKOFF_OFFLINE_MS = [10_000, 20_000, 60_000, 120_000];

let inFlightProbe: Promise<boolean> | null = null;
let probeIntervalId: ReturnType<typeof setInterval> | null = null;
let consecutiveOfflineProbes = 0;
let probeNextScheduledAt = 0;

/**
 * Round-trip the /api/health endpoint with a hard timeout. Returns whether
 * we were able to reach our own backend (the only definition of "online"
 * that matters for marketers in the field).
 *
 * Never throws. Bails out cleanly on AbortError, network error, non-2xx,
 * malformed JSON, etc — all of which we treat as "offline" because none of
 * them allow real work to happen.
 */
async function probeReachability(): Promise<boolean> {
  // Coalesce concurrent probes so a burst of failures (e.g. 3 AI calls
  // failing in the same second) doesn't fan out into 3 health fetches.
  if (inFlightProbe) return inFlightProbe;

  inFlightProbe = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(HEALTH_URL, {
        method: 'GET',
        // Belt-and-suspenders: the SW also bypasses cache for /api/health,
        // but tell the HTTP cache directly too in case the SW isn't active.
        cache: 'no-store',
        signal: controller.signal,
        // Don't send the auth header — keep this as cheap as possible and
        // independent of token state (handy during sign-in races).
        headers: { Accept: 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
      inFlightProbe = null;
    }
  })();

  return inFlightProbe;
}

/**
 * Run a probe and update `isOnline` based on the result. Notifies all
 * subscribers. Manages backoff scheduling so we poll less aggressively
 * while we're confirmed offline. If the state flips from offline → online
 * and we have queued mutations, kick a drain immediately.
 */
async function runProbeAndUpdate(): Promise<void> {
  const reachable = await probeReachability();
  const wasOnline = isOnline;
  if (reachable) {
    consecutiveOfflineProbes = 0;
    if (!isOnline) {
      isOnline = true;
      notify();
      // Reconnected — drain any pending writes immediately.
      drain().catch(() => {});
    }
  } else {
    consecutiveOfflineProbes += 1;
    if (isOnline) {
      isOnline = false;
      notify();
    }
  }
  // Touch wasOnline so the linter doesn't complain; useful for future
  // telemetry hooks (e.g. log "session went offline" once per transition).
  void wasOnline;
}

/**
 * Public API: trigger an immediate reachability probe. Components call this
 * after a failed AI call (or any unexplained network error) so the global
 * offline state catches up to reality within ~2s instead of waiting for
 * the next periodic heartbeat.
 *
 * Safe to call frequently — concurrent calls are coalesced.
 */
export function pingNow(): Promise<void> {
  return runProbeAndUpdate();
}

/**
 * Schedule the next interval-driven probe. Cadence depends on current state:
 *   - Online: steady heartbeat every PROBE_INTERVAL_ONLINE_MS
 *   - Offline: exponential-ish backoff so we don't hammer a dead network
 *     while still recovering quickly when service returns.
 */
function scheduleNextProbe(): void {
  if (probeIntervalId) {
    clearTimeout(probeIntervalId);
    probeIntervalId = null;
  }
  if (typeof document !== 'undefined' && document.hidden) {
    // Don't poll while the tab is in the background — battery killer with
    // no UI to update. We'll catch up on visibilitychange.
    return;
  }
  let delay: number;
  if (isOnline) {
    delay = PROBE_INTERVAL_ONLINE_MS;
  } else {
    const idx = Math.min(consecutiveOfflineProbes, PROBE_BACKOFF_OFFLINE_MS.length - 1);
    delay = PROBE_BACKOFF_OFFLINE_MS[idx];
  }
  probeNextScheduledAt = Date.now() + delay;
  probeIntervalId = setTimeout(async () => {
    await runProbeAndUpdate();
    scheduleNextProbe();
  }, delay);
}

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
  // OS-level events are still useful as fast-paths: airplane-mode toggles
  // and Wi-Fi disconnects fire these reliably and immediately. We treat
  // them as hints — the real source of truth is `runProbeAndUpdate`.
  window.addEventListener('online', () => {
    // Don't trust the OS blindly — verify with a probe before flipping
    // the UI to "online" and triggering a drain. Captive portal Wi-Fi
    // fires this event long before any actual API can reach us.
    runProbeAndUpdate().catch(() => {});
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    consecutiveOfflineProbes += 1;
    notify();
    // Reset the periodic schedule so we move to the offline backoff.
    scheduleNextProbe();
  });

  // Probe whenever the marketer brings the app back to foreground — they
  // constantly switch between Market Pollen and Maps/Messages, and this
  // catches the case where they drove out of a dead zone with the tab
  // hidden. Also resumes the heartbeat (which pauses while hidden).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      runProbeAndUpdate().catch(() => {});
      scheduleNextProbe();
    } else if (probeIntervalId) {
      clearTimeout(probeIntervalId);
      probeIntervalId = null;
    }
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
          // Still offline; stop draining for now. Bump the offline-probe
          // counter and reschedule so the next health probe uses the
          // offline backoff cadence (we just got first-hand evidence).
          isOnline = false;
          consecutiveOfflineProbes += 1;
          notify();
          scheduleNextProbe();
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
 * Boot the reachability monitor. We do this in a microtask rather than
 * synchronously at module load so importers (the React tree) finish
 * mounting before we fire the first probe — the OfflineContext can then
 * receive the very first `notify()` instead of having to read a snapshot.
 */
if (typeof window !== 'undefined') {
  Promise.resolve().then(() => {
    // Prime the state once, then start the recurring schedule.
    runProbeAndUpdate().catch(() => {});
    scheduleNextProbe();
  });
}

/**
 * Diagnostic helper for any future "is the probe loop healthy?" UI. Not
 * used by the app today, but cheap to expose and useful in support cases.
 */
export function getProbeDiagnostics() {
  return {
    isOnline,
    consecutiveOfflineProbes,
    nextProbeInMs: probeNextScheduledAt > 0 ? Math.max(0, probeNextScheduledAt - Date.now()) : null,
  };
}
