/**
 * Clears anything we cached on-device that could leak across users on a
 * shared phone: the in-app IndexedDB outbox/cache and the service-worker
 * API response cache. Called on sign-out so the next user that lands on
 * the device gets a clean slate.
 *
 * The service-worker SHELL cache (HTML/JS/CSS/icons) is intentionally
 * preserved so the app still cold-starts instantly.
 */
export async function clearLocalUserData(): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // 1) IndexedDB: drop the entire app database so the offline outbox and
  // cached GET responses are gone.
  if (typeof indexedDB !== 'undefined') {
    tasks.push(
      new Promise<void>((resolve) => {
        try {
          const req = indexedDB.deleteDatabase('marketpollen');
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        } catch {
          resolve();
        }
      })
    );
  }

  // 2) Service-worker caches: drop any that hold API responses (anything
  // matching mp-api-*). Leave mp-shell-* alone so the next user still gets
  // a fast cold start.
  if (typeof caches !== 'undefined') {
    tasks.push(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mp-api-')).map((k) => caches.delete(k))))
        .catch(() => undefined)
    );
  }

  await Promise.all(tasks);
}
