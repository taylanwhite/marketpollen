/**
 * Warm the lazy-loaded chunks that the app might need while offline.
 *
 * Field marketers often install the PWA, open it once on a fast network at
 * the truck, and then walk into a dead-signal zone before they ever tap a
 * contact card or an "edit" button. If we wait for those interactions to
 * trigger the dynamic import, the chunk fetch will fail offline and the
 * <Suspense fallback /> stays empty — the UI looks broken.
 *
 * We instead fire the imports during browser idle time after first paint.
 * The service worker's stale-while-revalidate strategy stores the bytes in
 * the asset cache, so the next tap resolves instantly even without signal.
 *
 * Each import is fired exactly once per session.
 */

let warmed = false;

export function prefetchOfflineAssets(): void {
  if (warmed) return;
  warmed = true;

  const run = () => {
    // Errors are intentionally swallowed: a failed prefetch should never
    // surface to the user. The real interaction will either find the chunk
    // in cache or re-attempt the fetch.
    void import('../components/ContactActionsSheet').catch(() => {});
    void import('../components/EditContactModal').catch(() => {});
    void import('../components/GenerateEmailDialog').catch(() => {});
  };

  if (typeof window === 'undefined') return;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    ric(run, { timeout: 4000 });
  } else {
    setTimeout(run, 1500);
  }
}
