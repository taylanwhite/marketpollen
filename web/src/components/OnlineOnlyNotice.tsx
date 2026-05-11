import { Alert, AlertProps, Box } from '@mui/material';
import { CloudOff as CloudOffIcon } from '@mui/icons-material';
import { useOffline } from '../contexts/OfflineContext';

interface OnlineOnlyNoticeProps {
  /**
   * Short verb describing what the gated feature does, used in the message:
   * "Voice dictation needs service" → feature="Voice dictation".
   * Keep it under ~20 chars so it reads cleanly on small screens.
   */
  feature: string;
  /**
   * Optional override copy. If provided, replaces the generated sentence.
   */
  message?: string;
  /** Visual density. "compact" is best for inline use inside dialogs. */
  size?: 'compact' | 'normal';
  severity?: AlertProps['severity'];
  /** Set to false to render even when online (for previewing). */
  onlyWhenOffline?: boolean;
  sx?: AlertProps['sx'];
}

/**
 * Inline notice that appears whenever the user is offline AND a piece of UI
 * depends on a live network call (AI extraction, email generation, places
 * search, dictation, etc.). Centralized so the wording and tone stay consistent
 * across the app — marketers should always read the same calm sentence in
 * every spot that's degraded by no-signal.
 */
export function OnlineOnlyNotice({
  feature,
  message,
  size = 'compact',
  severity = 'info',
  onlyWhenOffline = true,
  sx,
}: OnlineOnlyNoticeProps) {
  const { isOnline } = useOffline();
  if (onlyWhenOffline && isOnline) return null;

  const text = message || `${feature} needs service. You can still type and save — we'll sync when you're back.`;

  return (
    <Alert
      severity={severity}
      icon={<CloudOffIcon fontSize="small" />}
      sx={{
        py: size === 'compact' ? 0.25 : 0.75,
        '& .MuiAlert-icon': { py: size === 'compact' ? 0.5 : 1 },
        '& .MuiAlert-message': { py: size === 'compact' ? 0.5 : 1, fontSize: '0.85rem' },
        ...sx,
      }}
    >
      {text}
    </Alert>
  );
}

/**
 * App-wide slim banner shown directly below the AppBar whenever the user
 * loses signal. Differs from `OnlineOnlyNotice` in that it's persistent and
 * communicates the global state, not a feature gate.
 */
export function OfflineBanner() {
  const { isOnline, pendingCount } = useOffline();
  if (isOnline) return null;

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (t) => t.zIndex.appBar - 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        px: 2,
        py: 0.75,
        bgcolor: 'rgba(245, 200, 66, 0.95)',
        color: '#3a2a00',
        fontSize: '0.8rem',
        fontWeight: 600,
        textAlign: 'center',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
      }}
    >
      <CloudOffIcon sx={{ fontSize: 16 }} />
      <span>
        No service — your work is saving on this device
        {pendingCount > 0 ? ` (${pendingCount} waiting to sync).` : '.'}
        {' '}AI features are paused.
      </span>
    </Box>
  );
}
