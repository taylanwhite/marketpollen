import { useState, MouseEvent } from 'react';
import { useOffline } from '../contexts/OfflineContext';
import {
  Box,
  Chip,
  Tooltip,
  IconButton,
  Popover,
  Typography,
  List,
  ListItem,
  ListItemText,
  Button,
  Divider,
  Alert,
} from '@mui/material';
import {
  CloudOff as CloudOffIcon,
  CloudSync as CloudSyncIcon,
  CloudDone as CloudDoneIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';

function describeEntry(method: string, url: string, label?: string): string {
  if (label) return label;
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
  return `${method} ${path}`;
}

/**
 * Always-visible online/offline status pill plus a "pending sync" badge.
 * Tap to see a list of queued operations and a manual retry.
 */
export function OfflineIndicator() {
  const { isOnline, pendingCount, lastError, retry, pending } = useOffline();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const open = Boolean(anchor);

  const handleOpen = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget);
  const handleClose = () => setAnchor(null);

  const handleRetry = async () => {
    await retry();
  };

  // Three states:
  //  - Online + 0 pending → tiny green dot, optional (return null to hide)
  //  - Online + N pending → blue "Syncing N"
  //  - Offline → amber "Offline" (with N pending if any)
  let pill: React.ReactNode = null;
  if (!isOnline) {
    pill = (
      <Chip
        icon={<CloudOffIcon sx={{ fontSize: 16 }} />}
        label={pendingCount > 0 ? `Offline · ${pendingCount} waiting` : 'Offline'}
        size="small"
        onClick={handleOpen}
        sx={{
          bgcolor: 'rgba(245, 200, 66, 0.25)',
          color: '#7a5a00',
          fontWeight: 600,
          border: '1px solid rgba(245, 200, 66, 0.6)',
          '& .MuiChip-icon': { color: '#7a5a00' },
          cursor: 'pointer',
        }}
      />
    );
  } else if (pendingCount > 0) {
    pill = (
      <Chip
        icon={<CloudSyncIcon sx={{ fontSize: 16 }} />}
        label={`Syncing ${pendingCount}`}
        size="small"
        onClick={handleOpen}
        sx={{
          bgcolor: 'rgba(33, 150, 243, 0.15)',
          color: '#0d47a1',
          fontWeight: 600,
          border: '1px solid rgba(33, 150, 243, 0.4)',
          '& .MuiChip-icon': { color: '#0d47a1' },
          cursor: 'pointer',
        }}
      />
    );
  }

  if (!pill) {
    // Everything's fine; render a tiny tooltip-only icon so the user can still
    // peek at status if they want
    return (
      <Tooltip title="All changes saved">
        <IconButton size="small" onClick={handleOpen} sx={{ color: '#4caf50' }} aria-label="Sync status">
          <CloudDoneIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <>
      {pill}
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: { mt: 1, minWidth: 280, maxWidth: 360, borderRadius: 2 },
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {isOnline ? 'Syncing changes' : "You're offline"}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {isOnline
              ? "We're sending your saved work to the server. Nothing has been lost."
              : "Your work is being saved on this device. It will sync automatically when you're back online."}
          </Typography>

          {lastError && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Last attempt: {lastError}
            </Alert>
          )}

          {pending.length > 0 ? (
            <>
              <Divider sx={{ my: 1 }} />
              <List dense disablePadding>
                {pending.slice(0, 8).map((entry) => (
                  <ListItem key={entry.id} disableGutters>
                    <ListItemText
                      primary={describeEntry(entry.method, entry.url, entry.label)}
                      secondary={
                        entry.attempts > 0
                          ? `Retried ${entry.attempts}× · queued ${new Date(entry.createdAt).toLocaleTimeString()}`
                          : `Queued ${new Date(entry.createdAt).toLocaleTimeString()}`
                      }
                      primaryTypographyProps={{ variant: 'body2', sx: { fontWeight: 500 } }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItem>
                ))}
                {pending.length > 8 && (
                  <Typography variant="caption" color="text.secondary" sx={{ pl: 0 }}>
                    + {pending.length - 8} more
                  </Typography>
                )}
              </List>
              <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  startIcon={<RefreshIcon fontSize="small" />}
                  onClick={handleRetry}
                  disabled={!isOnline}
                >
                  Retry now
                </Button>
              </Box>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Nothing pending.
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}
