import { useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  /**
   * Called when the sentinel scrolls into view. Should fetch / reveal the
   * next page of items. Receives no args; capture state via closure.
   * Whatever it returns is awaited so we can avoid double-firing while
   * a load is already in flight.
   */
  onLoadMore: () => void | Promise<void>;
  /**
   * `true` when there's more data to load. When `false` the observer
   * disconnects to save memory and avoid spurious calls.
   */
  hasMore: boolean;
  /**
   * `true` while a load is in progress. Prevents the observer from firing
   * `onLoadMore` again while the previous batch is still being fetched.
   */
  loading?: boolean;
  /**
   * Distance from the bottom of the scroll container at which to trigger.
   * Defaults to "200px" so the next batch starts loading just before the
   * user reaches the end — feels seamless on mobile.
   */
  rootMargin?: string;
}

/**
 * Lightweight wrapper around IntersectionObserver for "infinite scroll"
 * patterns. Returns a ref to attach to a sentinel element (an empty div
 * placed at the very end of the list); when that sentinel becomes visible
 * we fire `onLoadMore`.
 *
 * Why a sentinel and not a scroll listener? Scroll listeners run on every
 * pixel of movement, fight with React re-renders, and require knowing the
 * scroll container. IntersectionObserver is fire-and-forget, native, and
 * works regardless of which ancestor is actually scrolling.
 */
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  loading = false,
  rootMargin = '200px',
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Hold the latest callback in a ref so the observer doesn't have to
  // tear down + re-create whenever the parent re-renders with a fresh
  // closure (which would happen on every state change).
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const setSentinel = useCallback((node: HTMLDivElement | null) => {
    sentinelRef.current = node;
  }, []);

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (loadingRef.current) return;
        // Fire the latest callback. Errors are the caller's responsibility
        // to surface — we don't catch silently to avoid masking bugs.
        Promise.resolve(onLoadMoreRef.current()).catch((err) => {
          console.warn('useInfiniteScroll onLoadMore failed:', err);
        });
      },
      { rootMargin, threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // We intentionally re-observe whenever hasMore flips so the observer
    // gets cleaned up cleanly when the list is exhausted.
  }, [hasMore, rootMargin]);

  return { sentinelRef: setSentinel };
}
