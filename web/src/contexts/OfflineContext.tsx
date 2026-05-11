import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  subscribe,
  getPendingCount,
  getIsOnline,
  getLastError,
  getSyncedCount,
  drain,
  retryAll,
} from '../utils/offlineQueue';
import { outboxAll, OutboxEntry } from '../utils/idb';

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  lastError: string | null;
  /**
   * Monotonically increases each time a queued mutation lands on the server.
   * Subscribe to this in data-loading effects so offline writes become
   * visible the moment the queue catches up.
   */
  syncedCount: number;
  /** Force an immediate sync attempt (resets backoff). */
  retry: () => Promise<void>;
  /** Trigger a drain at next available opportunity. */
  sync: () => Promise<void>;
  /** Full snapshot of the pending mutations (for a detailed view). */
  pending: OutboxEntry[];
  refreshPending: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | undefined>(undefined);

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}

interface OfflineProviderProps {
  children: ReactNode;
}

export function OfflineProvider({ children }: OfflineProviderProps) {
  const [isOnline, setIsOnline] = useState<boolean>(getIsOnline());
  const [pendingCount, setPendingCount] = useState<number>(getPendingCount());
  const [lastError, setLastError] = useState<string | null>(getLastError());
  const [syncedCount, setSyncedCount] = useState<number>(getSyncedCount());
  const [pending, setPending] = useState<OutboxEntry[]>([]);

  const refreshPending = useCallback(async () => {
    try {
      const all = await outboxAll();
      setPending(all);
    } catch (err) {
      console.warn('Failed to load outbox snapshot', err);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribe(() => {
      setIsOnline(getIsOnline());
      setPendingCount(getPendingCount());
      setLastError(getLastError());
      setSyncedCount(getSyncedCount());
      refreshPending().catch(() => {});
    });
    refreshPending().catch(() => {});
    return unsub;
  }, [refreshPending]);

  const value: OfflineContextValue = {
    isOnline,
    pendingCount,
    lastError,
    syncedCount,
    retry: retryAll,
    sync: drain,
    pending,
    refreshPending,
  };

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
