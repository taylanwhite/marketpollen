import { useEffect, useRef, useState } from 'react';
import { haptics } from '../utils/haptics';

interface PullToRefreshOptions {
  /** Callback fired when the user has pulled far enough and released */
  onRefresh: () => void | Promise<void>;
  /** Minimum pull distance in px to trigger refresh. Default: 70 */
  threshold?: number;
  /** Resistance factor — higher = harder to pull. Default: 2 */
  resistance?: number;
  /** Set to false to disable (e.g. on desktop). Default: enabled on touch devices */
  enabled?: boolean;
}

interface PullToRefreshState {
  /** Current pull distance in px (0 when idle) */
  pullDistance: number;
  /** True while the refresh callback is running */
  refreshing: boolean;
  /** True if pulled past the trigger threshold (visual cue) */
  willTrigger: boolean;
}

/**
 * Minimal swipe-down-to-refresh gesture. Designed for use at the top of a
 * page; intercepts touchstart/move when the page is already scrolled to top.
 *
 * Marketers in the field often want a quick "is this the freshest data?"
 * gesture, especially when toggling on/off LTE — this gives them that.
 */
export function usePullToRefresh(options: PullToRefreshOptions): PullToRefreshState {
  const { onRefresh, threshold = 70, resistance = 2, enabled = true } = options;
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const triggered = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    // Bail if the gesture started inside an overlay (drawer, dialog, popover,
    // bottom sheet, or any explicitly opted-out container). Otherwise a
    // swipe-to-close on a SwipeableDrawer would also trigger a page refresh.
    const insideOverlay = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return !!target.closest(
        '[role="dialog"], .MuiDrawer-root, .MuiModal-root, .MuiPopover-root, [data-no-pull-refresh]'
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (window.scrollY > 0) return; // Only engage at page top
      if (insideOverlay(e.target)) return;
      startY.current = e.touches[0].clientY;
      triggered.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshing) return;
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        if (pullDistance !== 0) setPullDistance(0);
        return;
      }
      const damped = dy / resistance;
      setPullDistance(damped);

      // Haptic ping when the user crosses the trigger threshold
      if (!triggered.current && damped >= threshold) {
        triggered.current = true;
        haptics.tap();
      }
    };

    const onTouchEnd = async () => {
      if (refreshing) return;
      const reached = pullDistance >= threshold;
      startY.current = null;
      if (reached) {
        setRefreshing(true);
        setPullDistance(threshold); // hold the spinner
        haptics.press();
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, refreshing, pullDistance, threshold, resistance, onRefresh]);

  return {
    pullDistance,
    refreshing,
    willTrigger: pullDistance >= threshold,
  };
}
