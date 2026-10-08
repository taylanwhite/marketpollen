const archivedIds = new Set<string>();

export function markStoreArchived(id: string) {
  archivedIds.add(id);
}

export function isStoreArchived(store?: { id?: string; archivedAt?: string | Date | null } | null): boolean {
  if (!store) return false;
  if (store.archivedAt) return true;
  return !!store.id && archivedIds.has(store.id);
}

export function isStoreLocked(store?: { billingStatus?: string | null; pauseOn?: string | Date | null } | null): boolean {
  if (!store) return false;
  if (store.billingStatus === 'paused') return true;
  if (store.billingStatus === 'pause_scheduled' && store.pauseOn) {
    return new Date(store.pauseOn).getTime() <= Date.now();
  }
  return false;
}
