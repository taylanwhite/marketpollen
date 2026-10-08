export function isStoreLocked(store?: { billingStatus?: string | null; pauseOn?: string | Date | null } | null): boolean {
  if (!store) return false;
  if (store.billingStatus === 'paused') return true;
  if (store.billingStatus === 'pause_scheduled' && store.pauseOn) {
    return new Date(store.pauseOn).getTime() <= Date.now();
  }
  return false;
}
