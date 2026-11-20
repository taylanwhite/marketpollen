import { lazy } from 'react';

/**
 * Pages other than Contacts and sign-in load as their own files, so the app
 * starts with less code. prefetchPages() then fetches them all right after
 * startup: switching tabs doesn't wait, and the service worker has every page
 * cached for offline use as before.
 */
const loaders = {
  businesses: () => import('./Businesses'),
  opportunities: () => import('./Opportunities'),
  donations: () => import('./Donations'),
  calendar: () => import('./Calendar'),
  reports: () => import('./Reports'),
  stores: () => import('./Stores'),
  admin: () => import('./AdminPanel'),
  orgSettings: () => import('./OrgSettings'),
  platform: () => import('./Platform'),
  legal: () => import('./Legal'),
};

export const Businesses = lazy(() => loaders.businesses().then((m) => ({ default: m.Businesses })));
export const Opportunities = lazy(() => loaders.opportunities().then((m) => ({ default: m.Opportunities })));
export const Donations = lazy(() => loaders.donations().then((m) => ({ default: m.Donations })));
export const Calendar = lazy(() => loaders.calendar().then((m) => ({ default: m.Calendar })));
export const Reports = lazy(() => loaders.reports().then((m) => ({ default: m.Reports })));
export const Stores = lazy(() => loaders.stores().then((m) => ({ default: m.Stores })));
export const AdminPanel = lazy(() => loaders.admin().then((m) => ({ default: m.AdminPanel })));
export const OrgSettings = lazy(() => loaders.orgSettings().then((m) => ({ default: m.OrgSettings })));
export const Platform = lazy(() => loaders.platform().then((m) => ({ default: m.Platform })));
export const LegalPage = lazy(() => loaders.legal().then((m) => ({ default: m.LegalPage })));

let prefetched = false;

/** Fetch every page's code in the background, once, when the browser is idle. */
export function prefetchPages(): void {
  if (prefetched || typeof window === 'undefined') return;
  prefetched = true;
  const run = () => {
    for (const load of Object.values(loaders)) load().catch(() => { /* retried when the page opens */ });
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}
