import { Box, CircularProgress } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  refreshing: boolean;
  willTrigger: boolean;
  threshold?: number;
}

/**
 * Small visual cue that follows the user's finger as they pull down on a page.
 * Rendered absolutely at the top of the viewport; receives state from
 * `usePullToRefresh`.
 */
export function PullToRefreshIndicator({
  pullDistance,
  refreshing,
  willTrigger,
  threshold = 70,
}: PullToRefreshIndicatorProps) {
  if (pullDistance <= 4 && !refreshing) return null;

  const progress = Math.min(1, pullDistance / threshold);

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 'calc(56px + env(safe-area-inset-top))',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 1300,
        transform: `translateY(${Math.min(pullDistance, threshold) - 30}px)`,
        opacity: progress,
        transition: refreshing ? 'transform 0.2s, opacity 0.2s' : 'none',
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          bgcolor: '#f5c842',
          color: '#2d2d2d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {refreshing ? (
          <CircularProgress size={20} sx={{ color: '#2d2d2d' }} />
        ) : (
          <RefreshIcon
            sx={{
              fontSize: 20,
              transition: 'transform 0.2s',
              transform: `rotate(${progress * 270}deg)`,
              opacity: willTrigger ? 1 : 0.6,
            }}
          />
        )}
      </Box>
    </Box>
  );
}
