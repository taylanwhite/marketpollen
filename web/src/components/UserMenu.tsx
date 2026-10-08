import { useMemo, useState, MouseEvent } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  List,
  ListItemButton,
} from '@mui/material';
import {
  SwapHoriz as SwapIcon,
  AdminPanelSettings as AdminIcon,
  Settings as SettingsIcon,
  LocationOn as LocationIcon,
  Logout as LogoutIcon,
  Person as PersonIcon,
  Insights as ReportsIcon,
  Business as OrgIcon,
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
  const { permissions, currentOrg, setCurrentStore, isAdmin, isOrgAdminFn } = usePermissions();
  const { pendingCount, sync } = useOffline();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgSearch, setOrgSearch] = useState('');
  const open = Boolean(anchorEl);
  const organizations = useMemo(
    () => [...permissions.organizations].sort((a, b) => a.name.localeCompare(b.name)),
    [permissions.organizations],
  );
  const visibleOrgs = orgSearch.trim()
    ? organizations.filter((org) => org.name.toLowerCase().includes(orgSearch.trim().toLowerCase()))
    : organizations;

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
      localStorage.removeItem('selectedOrgId');
      // Drop the offline outbox + API response cache so the next user on a
      // shared device doesn't see this user's data.
      await clearLocalUserData();
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const switchOrganization = (orgId: string) => {
    const org = organizations.find((item) => item.id === orgId);
    if (!org) return;
    localStorage.setItem('selectedOrgId', org.id);
    setOrgDialogOpen(false);
    setOrgSearch('');
    handleClose();
    if (org.stores.length === 1) {
      setCurrentStore(org.stores[0].id);
      if (location.pathname === '/select-store') navigate('/dashboard');
      else if (location.pathname === '/org-settings') navigate(`/org-settings?org=${org.id}`);
      return;
    }
    setCurrentStore(null);
    navigate('/select-store');
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
        {(currentOrg || currentStore) && (
          <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 }}>
            {currentOrg && (
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}
                >
                  Current organization
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
                  {currentOrg.name}
                </Typography>
              </Box>
            )}
            {currentStore && (
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}
                >
                  Current store
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
                  {currentStore.name}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        <MenuItem onClick={() => go('/reports')} selected={isActive('/reports')}>
          <ListItemIcon>
            <ReportsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Reports</ListItemText>
        </MenuItem>
        <Divider />

        {organizations.length > 1 && (
          <MenuItem onClick={() => { handleClose(); setOrgDialogOpen(true); }}>
            <ListItemIcon>
              <OrgIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Change organization</ListItemText>
          </MenuItem>
        )}
        {(hasMultipleStores || (currentOrg?.stores.length ?? 0) > 1) && (
          <MenuItem onClick={() => {
            if (currentOrg) localStorage.setItem('selectedOrgId', currentOrg.id);
            go('/select-store');
          }} selected={isActive('/select-store')}>
            <ListItemIcon>
              <SwapIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Change store</ListItemText>
          </MenuItem>
        )}
        {(organizations.length > 1 || hasMultipleStores || (currentOrg?.stores.length ?? 0) > 1) && <Divider />}

        {showAdmin && (
          <Box sx={{ pt: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 2, py: 0.5, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1 }}
            >
              Admin
            </Typography>
            {isAdmin() && (
              <MenuItem onClick={() => go('/platform')} selected={isActive('/platform')}>
                <ListItemIcon>
                  <AdminIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Platform</ListItemText>
              </MenuItem>
            )}
            {(isOrgAdminFn() || isAdmin()) && (
              <MenuItem onClick={() => go('/org-settings')} selected={isActive('/org-settings')}>
                <ListItemIcon>
                  <SettingsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Org settings</ListItemText>
              </MenuItem>
            )}
            {(isAdmin() || isOrgAdminFn()) && (
              <MenuItem onClick={() => go('/stores')} selected={isActive('/stores')}>
                <ListItemIcon>
                  <LocationIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Stores</ListItemText>
              </MenuItem>
            )}
            {!isAdmin() && (
              <MenuItem onClick={() => go('/admin')} selected={isActive('/admin')}>
                <ListItemIcon>
                  <AdminIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>User management</ListItemText>
              </MenuItem>
            )}
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

      <Dialog open={orgDialogOpen} onClose={() => setOrgDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Change organization</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Stores, contacts, and reports follow the organization you pick.
          </Typography>
          {organizations.length > 6 && (
            <TextField
              size="small"
              fullWidth
              autoFocus
              placeholder="Search organizations"
              value={orgSearch}
              onChange={(event) => setOrgSearch(event.target.value)}
              sx={{ mb: 1 }}
            />
          )}
          <List disablePadding>
            {visibleOrgs.map((org) => (
              <ListItemButton
                key={org.id}
                selected={org.id === currentOrg?.id}
                onClick={() => switchOrganization(org.id)}
              >
                <ListItemText
                  primary={org.name}
                  secondary={org.stores.length === 0 ? 'No stores yet' : `${org.stores.length} store${org.stores.length === 1 ? '' : 's'}`}
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
      </Dialog>
    </>
  );
}
