/**
 * API client for Neon-backed endpoints. Sends Clerk session token with each
 * request, caches GETs so screens render after a reload while offline, and
 * exposes a `queueXxx` family for offline-safe writes that survive a network
 * drop (returns `null` when persisted to the local outbox instead of the
 * server response).
 *
 * Use `queuePost` / `queuePatch` / `queueDelete` for the field-critical
 * mutations that absolutely cannot be lost (logging a visit, adding a
 * reachout, scheduling a follow-up). Use `post` / `patch` / `delete` for
 * everything else (admin actions, RPC-style calls that need a response).
 */

import { enqueueOrSend, cachedGet, setOfflineTokenGetter, pingNow } from '../utils/offlineQueue';

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
  setOfflineTokenGetter(getter);
}

async function getToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  return tokenGetter();
}

function resolveUrl(path: string): string {
  return path.startsWith('http') ? path : `/api${path}`;
}

function isLikelyNetworkError(err: unknown): boolean {
  if (!err) return false;
  // fetch() throws TypeError on true network failures (DNS, CORS, refused).
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /network|fetch|failed to fetch|load failed|networkerror|aborted/i.test(msg);
}

async function request<T = unknown>(
  path: string,
  options: { method?: string; body?: object; headers?: HeadersInit } = {}
): Promise<T> {
  const token = await getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;

  const url = resolveUrl(path);
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
    });

    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || res.statusText || String(res.status));
    return data as T;
  } catch (err) {
    // AI calls (extract, generate-email), Places API calls, and other
    // non-queueable requests all flow through here. When they fail with a
    // network-shaped error, kick a reachability probe so the global offline
    // banner appears within seconds — instead of staying lit at "online"
    // until the marketer's next save attempt also fails.
    //
    // We fire-and-forget; the probe's own error handling and coalescing
    // make it safe to call repeatedly, and we never want a probe failure
    // to mask the real underlying error from the caller.
    if (isLikelyNetworkError(err)) {
      pingNow().catch(() => {});
    }
    throw err;
  }
}

export interface QueueOptions {
  /** Short human-readable label shown in the offline banner ("Log visit") */
  label?: string;
}

export const api = {
  /** GET with offline cache fallback. Cached value is returned when offline. */
  get: <T = unknown>(path: string) => cachedGet<T>(resolveUrl(path)),

  /** Standard write. Throws on network failure. Use when caller needs the server response. */
  post: <T = unknown>(path: string, body: object) => request<T>(path, { method: 'POST', body }),
  patch: <T = unknown>(path: string, body: object) => request<T>(path, { method: 'PATCH', body }),
  delete: (path: string) => request(path, { method: 'DELETE' }),

  /**
   * Offline-safe POST. If the network is unreachable, the mutation is persisted
   * to the local outbox and resolves to `null`. If the network is reachable,
   * it behaves exactly like `post()`. Callers must handle `null` gracefully
   * (typically by not relying on the response shape and trusting the
   * optimistic local state).
   *
   * Important: queued POSTs are retried on reconnect. Make POST handlers
   * idempotent (e.g. accept a client-provided `id`) before queuing creates
   * that produce duplicates on retry.
   */
  queuePost: <T = unknown>(path: string, body: object, options: QueueOptions = {}) =>
    enqueueOrSend<T>({ method: 'POST', url: resolveUrl(path), body, label: options.label }),

  /**
   * Offline-safe PATCH. PATCH calls in this codebase send the full updated
   * sub-resource (e.g. the entire reachouts array on a Contact), which makes
   * them naturally idempotent: replaying the request always converges to the
   * same server state.
   */
  queuePatch: <T = unknown>(path: string, body: object, options: QueueOptions = {}) =>
    enqueueOrSend<T>({ method: 'PATCH', url: resolveUrl(path), body, label: options.label }),

  /** Offline-safe DELETE. */
  queueDelete: (path: string, options: QueueOptions = {}) =>
    enqueueOrSend({ method: 'DELETE', url: resolveUrl(path), label: options.label }),
};
