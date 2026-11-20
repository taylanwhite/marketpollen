import { createElement, lazy, type ComponentType } from 'react';

/**
 * Pages other than Contacts and sign-in load as their own files, so the app
 * starts with less code. prefetchPages() then fetches them all right after
 * startup: switching tabs doesn't wait, and the service worker has every page
 * cached for offline use as before.
 */

type Loader = () => Promise<unknown>;
const loaders: Loader[] = [];

/**
 * A page that loads its code on first use. Once the code is in (normally from
 * the prefetch), it renders the page directly: React.lazy on its own would
 * still show the loading spinner for a moment on each page's first visit.
 */
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const fetchPage = () => {
    pending ??= load().then((page) => { loaded = page; return page; }, (err) => { pending = null; throw err; });
    return pending;
  };
  loaders.push(fetchPage);
  const Lazy = lazy(() => fetchPage().then((page) => ({ default: page })));
  return function LazyPage(props: P) {
    return createElement((loaded ?? Lazy) as ComponentType<P>, props);
  };
}

export const Businesses = lazyPage(() => import('./Businesses').then((m) => m.Businesses));
export const Opportunities = lazyPage(() => import('./Opportunities').then((m) => m.Opportunities));
export const Donations = lazyPage(() => import('./Donations').then((m) => m.Donations));
export const Calendar = lazyPage(() => import('./Calendar').then((m) => m.Calendar));
export const Reports = lazyPage(() => import('./Reports').then((m) => m.Reports));
export const Stores = lazyPage(() => import('./Stores').then((m) => m.Stores));
export const AdminPanel = lazyPage(() => import('./AdminPanel').then((m) => m.AdminPanel));
export const OrgSettings = lazyPage(() => import('./OrgSettings').then((m) => m.OrgSettings));
export const Platform = lazyPage(() => import('./Platform').then((m) => m.Platform));
export const LegalPage = lazyPage(() => import('./Legal').then((m) => m.LegalPage));

let prefetched = false;

/** Fetch every page's code in the background, once, when the browser is idle. */
export function prefetchPages(): void {
  if (prefetched || typeof window === 'undefined') return;
  prefetched = true;
  const run = () => {
    for (const load of loaders) load().catch(() => { /* tried again when the page opens */ });
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}
