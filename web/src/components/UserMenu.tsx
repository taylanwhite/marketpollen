import { useState, MouseEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useClerk } from '@clerk/react';
import { clearLocalUserData } from '../utils/clearLocalData';
import { usePermissions } from '../contexts/PermissionContext';
import { useOffline } from '../contexts/OfflineContext';
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Avatar,
  Typography,
  Box,
  Chip,
} from '@mui/material';
import {
  SwapHoriz as SwapIcon,
  AdminPanelSettings as AdminIcon,
  Settings as SettingsIcon,
  LocationOn as LocationIcon,
  Logout as LogoutIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { Store } from '../types';

interface UserMenuProps {
  currentStore: Store | null;
  hasMultipleStores: boolean;
}

export function UserMenu({ currentStore, hasMultipleStores }: UserMenuProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useClerk();
  const { isAdmin, isOrgAdminFn } = usePermissions();
  const { pendingCount, sync } = useOffline();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const go = (path: string) => {
    handleClose();
    navigate(path);
  };

  const handleLogout = async () => {
    handleClose();

    // If the marketer has un-synced field work, give them a chance to wait
    // for sync before we wipe the IndexedDB. Without this check, logging out
    // on a flaky network would silently destroy queued contacts, reachouts,
    // and follow-up events — exactly the data this app is built to protect.
    if (pendingCount > 0) {
      const message = `You have ${pendingCount} change${pendingCount === 1 ? '' : 's'} that haven't synced yet. Signing out will lose them.\n\nSign out anyway?`;
      if (!window.confirm(message)) {
        // Best-effort: kick the queue while we still have a token.
        sync().catch(() => {});
        return;
      }
    }

    try {
      localStorage.removeItem('selectedStoreId');
      // Drop the offline outbox + API response cache so the next user on a
      // shared device doesn't see this user's data.
      await clearLocalUserData();
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const isActive = (path: string) => location.pathname === path;
  const showAdmin = isAdmin() || isOrgAdminFn();

  return (
    <>
      <IconButton
        onClick={handleOpen}
        size="small"
        aria-label="Account menu"
        sx={{
          p: 0.5,
          border: '2px solid rgba(245, 200, 66, 0.5)',
          '&:hover': { bgcolor: 'rgba(245, 200, 66, 0.15)' },
        }}
      >
        <Avatar sx={{ width: 32, height: 32, bgcolor: '#f5c842', color: '#2d2d2d' }}>
          <PersonIcon fontSize="small" />
        </Avatar>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              minWidth: 240,
              borderRadius: 2,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            },
          },
        }}
      >
        {currentStore && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Current store
            </Typography>
            <Chip
              icon={<LocationIcon sx={{ color: '#2d2d2d !important', fontSize: 16 }} />}
              label={currentStore.name}
              size="small"
              sx={{
                mt: 0.5,
                bgcolor: 'rgba(245, 200, 66, 0.15)',
                color: '#2d2d2d',
                border: '1px solid rgba(245, 200, 66, 0.5)',
                fontWeight: 500,
                maxWidth: '100%',
                '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
              }}
            />
          </Box>
        )}

        {hasMultipleStores && (
          <>
            <MenuItem onClick={() => go('/select-store')} selected={isActive('/select-store')}>
              <ListItemIcon>
                <SwapIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Change store</ListItemText>
            </MenuItem>
            <Divider />
          </>
        )}

        {showAdmin && (
          <Box sx={{ pt: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 2, py: 0.5, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1 }}
            >
              Admin
            </Typography>
            {(isOrgAdminFn() || isAdmin()) && (
              <MenuItem onClick={() => go('/org-settings')} selected={isActive('/org-settings')}>
                <ListItemIcon>
                  <SettingsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Org settings</ListItemText>
              </MenuItem>
            )}
            {isAdmin() && (
              <MenuItem onClick={() => go('/stores')} selected={isActive('/stores')}>
                <ListItemIcon>
                  <LocationIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Stores</ListItemText>
              </MenuItem>
            )}
            <MenuItem onClick={() => go('/admin')} selected={isActive('/admin')}>
              <ListItemIcon>
                <AdminIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>User management</ListItemText>
            </MenuItem>
            <Divider />
          </Box>
        )}

        <MenuItem onClick={handleLogout} sx={{ color: '#e74c3c' }}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" sx={{ color: '#e74c3c' }} />
          </ListItemIcon>
          <ListItemText>Logout</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
