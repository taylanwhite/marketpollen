import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useNavigate } from 'react-router-dom';
import { Store, User, StorePermission } from '../types';
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  Paper,
  InputAdornment,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Switch,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  Search as SearchIcon,
  Send as SendIcon,
  Edit as EditIcon,
  AdminPanelSettings as AdminIcon,
  Block as BlockIcon,
  Visibility as ViewIcon,
  EditNote as EditNoteIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';

// Simplified permission type for UI state
type AccessLevel = 'none' | 'view' | 'full';

interface UserWithPermissions extends User {
  email: string;
}

interface PendingInvite {
  id: string;
  inviteIds: string[];
  email: string;
  isGlobalAdmin: boolean;
  storePermissions: StorePermission[];
  invitedBy: string;
  invitedAt: Date;
  status: 'pending' | 'accepted' | 'rejected';
}

export function AdminPanel() {
  const { userId, userEmail } = useAuth();
  const { isAdmin, isOrgAdminFn, currentOrg } = usePermissions();
  const navigate = useNavigate();
  
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<UserWithPermissions[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserWithPermissions[]>([]);
  const [filteredInvites, setFilteredInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  
  // Edit user modal
  const [editingUser, setEditingUser] = useState<UserWithPermissions | null>(null);
  const [editAccessLevels, setEditAccessLevels] = useState<Map<string, AccessLevel>>(new Map());
  const [editIsOrgAdmin, setEditIsOrgAdmin] = useState(false);
  
  // New user invitation
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [inviteAccessLevels, setInviteAccessLevels] = useState<Map<string, AccessLevel>>(new Map());
  const [inviteLoading, setInviteLoading] = useState(false);


  useEffect(() => {
    if (!isAdmin() && !isOrgAdminFn()) {
      navigate('/dashboard');
      return;
    }
    loadData();
  }, [isAdmin, navigate]);

  const openInviteDialog = () => {
    setNewUserEmail('');
    const defaultMap = new Map<string, AccessLevel>();
    stores.forEach(store => defaultMap.set(store.id, 'full'));
    setInviteAccessLevels(defaultMap);
    setInviteDialogOpen(true);
  };

  const closeInviteDialog = () => {
    setInviteDialogOpen(false);
    setNewUserEmail('');
    setInviteAccessLevels(new Map());
  };

  useEffect(() => {
    const term = userSearchTerm.toLowerCase().trim();
    if (term) {
      setFilteredUsers(
        users.filter(user => user.email.toLowerCase().includes(term))
      );
      setFilteredInvites(
        pendingInvites.filter(invite => invite.email.toLowerCase().includes(term))
      );
    } else {
      setFilteredUsers(users);
      setFilteredInvites(pendingInvites);
    }
  }, [userSearchTerm, users, pendingInvites]);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadStores(), loadUsers(), loadPendingInvites()]);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadStores = async () => {
    const list = await api.get<Store[]>('/stores');
    const storeList = list.map((s) => ({ ...s, createdAt: s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt) }));
    storeList.sort((a, b) => a.name.localeCompare(b.name));
    setStores(storeList);
  };

  const loadUsers = async () => {
    const list = await api.get<UserWithPermissions[]>('/users');
    const userList = list.map((u) => ({
      ...u,
      createdAt: u.createdAt instanceof Date ? u.createdAt : new Date(u.createdAt),
    }));
    userList.sort((a, b) => a.email.localeCompare(b.email));
    setUsers(userList);
  };

  const loadPendingInvites = async () => {
    const rows = await api.get<Array<{ id: string; email: string; storeId: string; canEdit: boolean; invitedBy: string; invitedAt: string | Date; status: string; isGlobalAdmin: boolean }>>('/invites');
    const pending = rows.filter((r) => r.status === 'pending');
    const byEmail = new Map<string, { inviteIds: string[]; email: string; isGlobalAdmin: boolean; storePermissions: StorePermission[]; invitedBy: string; invitedAt: Date }>();
    for (const r of pending) {
      const existing = byEmail.get(r.email);
      const invitedAt = r.invitedAt instanceof Date ? r.invitedAt : new Date(r.invitedAt);
      if (!existing) {
        byEmail.set(r.email, {
          inviteIds: [r.id],
          email: r.email,
          isGlobalAdmin: r.isGlobalAdmin,
          storePermissions: [{ storeId: r.storeId, canEdit: r.canEdit }],
          invitedBy: r.invitedBy,
          invitedAt,
        });
      } else {
        existing.inviteIds.push(r.id);
        existing.storePermissions.push({ storeId: r.storeId, canEdit: r.canEdit });
      }
    }
    const inviteList: PendingInvite[] = Array.from(byEmail.entries()).map(([email, data]) => ({
      id: data.inviteIds[0],
      inviteIds: data.inviteIds,
      email,
      isGlobalAdmin: data.isGlobalAdmin,
      storePermissions: data.storePermissions,
      invitedBy: data.invitedBy,
      invitedAt: data.invitedAt,
      status: 'pending' as const,
    }));
    inviteList.sort((a, b) => a.email.localeCompare(b.email));
    setPendingInvites(inviteList);
  };

  const checkExistingPendingInvite = async (email: string): Promise<boolean> => {
    const rows = await api.get<Array<{ email: string; status: string }>>('/invites');
    const normalizedEmail = email.toLowerCase().trim();
    return rows.some((r) => r.email === normalizedEmail && r.status === 'pending');
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setInviteLoading(true);

    if (!newUserEmail.trim()) {
      setError('Email is required');
      setInviteLoading(false);
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newUserEmail.trim())) {
      setError('Please enter a valid email address');
      setInviteLoading(false);
      return;
    }

    // Check for existing pending invite
    try {
      const hasExistingInvite = await checkExistingPendingInvite(newUserEmail);
      if (hasExistingInvite) {
        setError(`A pending invitation already exists for ${newUserEmail}. Please cancel the existing invite first or wait for it to be accepted.`);
        setInviteLoading(false);
        return;
      }
    } catch (checkError: any) {
      console.error('Error checking for existing invite:', checkError);
      setError('Failed to check for existing invitations. Please try again.');
      setInviteLoading(false);
      return;
    }

    try {
      const email = newUserEmail.toLowerCase().trim();
      const permissions: StorePermission[] = [];
      inviteAccessLevels.forEach((level, storeId) => {
        if (level !== 'none') {
          permissions.push({ storeId, canEdit: level === 'full' });
        }
      });

      if (permissions.length === 0) {
        setError('Select at least one store with access.');
        setInviteLoading(false);
        return;
      }

      for (const p of permissions) {
        await api.post('/invites', {
          email,
          storeId: p.storeId,
          canEdit: p.canEdit,
        });
      }
      
      // Reload invites to show the new one
      await loadPendingInvites();
      
      // Send invitation email
      try {
        if (!userId) {
          throw new Error('User not authenticated');
        }
        await api.post('/send-invite-email', {
          email: newUserEmail.toLowerCase().trim(),
          invitedByEmail: userEmail || '',
        });
        setSuccess(`Invitation email sent to ${newUserEmail}.`);
      } catch (emailError: any) {
        console.error('Error sending email:', emailError);
        setSuccess(`Invitation created for ${newUserEmail}, but email sending failed. They can still sign up manually.`);
      }
      
      closeInviteDialog();
    } catch (err: any) {
      console.error('Error sending invitation:', err);
      setError(err.message || 'Failed to send invitation. Check console for details.');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCancelInvite = async (invite: PendingInvite) => {
    if (!window.confirm(`Are you sure you want to cancel the invitation for ${invite.email}?`)) {
      return;
    }

    try {
      for (const id of invite.inviteIds) {
        await api.delete(`/invites/${id}`);
      }
      await loadPendingInvites();
      setSuccess(`Invitation for ${invite.email} has been cancelled.`);
    } catch (err: any) {
      console.error('Error cancelling invitation:', err);
      setError(err.message || 'Failed to cancel invitation');
    }
  };

  const getAccessLevel = (perm: StorePermission | undefined): AccessLevel => {
    if (!perm) return 'none';
    return perm.canEdit ? 'full' : 'view';
  };

  const openEditModal = (user: UserWithPermissions) => {
    setEditingUser(user);
    
    const accessMap = new Map<string, AccessLevel>();
    stores.forEach(store => {
      const perm = user.storePermissions.find(p => p.storeId === store.id);
      accessMap.set(store.id, getAccessLevel(perm));
    });
    setEditAccessLevels(accessMap);
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setEditAccessLevels(new Map());
    setEditIsOrgAdmin(false);
  };

  const handleAccessLevelChange = (storeId: string, level: AccessLevel) => {
    setEditAccessLevels(prev => {
      const next = new Map(prev);
      next.set(storeId, level);
      return next;
    });
  };

  const handleGrantAllAccess = () => {
    const newMap = new Map<string, AccessLevel>();
    stores.forEach(store => newMap.set(store.id, 'full'));
    setEditAccessLevels(newMap);
  };

  const handleViewOnlyAll = () => {
    const newMap = new Map<string, AccessLevel>();
    stores.forEach(store => newMap.set(store.id, 'view'));
    setEditAccessLevels(newMap);
  };

  const handleRevokeAllAccess = () => {
    const newMap = new Map<string, AccessLevel>();
    stores.forEach(store => newMap.set(store.id, 'none'));
    setEditAccessLevels(newMap);
  };

  const handleSaveUserPermissions = async () => {
    if (!editingUser) return;
    
    try {
      // Convert access levels to StorePermission array
      // Only include stores with access (not 'none')
      const permissions: StorePermission[] = [];
      editAccessLevels.forEach((level, storeId) => {
        if (level !== 'none') {
          permissions.push({
            storeId,
            canEdit: level === 'full'
          });
        }
      });

      const orgId = currentOrg?.id;
      await api.patch(`/users/${editingUser.uid}`, {
        storePermissions: permissions,
        isOrgAdmin: editIsOrgAdmin,
        orgId,
      });

      await loadUsers();
      setSuccess(`Updated permissions for ${editingUser.email}`);
      closeEditModal();
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    }
  };

  const getUserAccessSummary = (user: UserWithPermissions): string => {
    if (user.isGlobalAdmin) return 'Global Admin';
    
    const accessCount = user.storePermissions.length;
    const fullAccessCount = user.storePermissions.filter(p => p.canEdit).length;
    
    if (accessCount === 0) return 'No access';
    if (accessCount === stores.length && fullAccessCount === stores.length) {
      return 'All stores (edit)';
    }
    if (accessCount === stores.length && fullAccessCount === 0) {
      return 'All stores (view)';
    }
    if (accessCount === stores.length) {
      return `All stores (${fullAccessCount} edit, ${accessCount - fullAccessCount} view)`;
    }
    
    return `${accessCount} store${accessCount !== 1 ? 's' : ''} (${fullAccessCount} edit)`;
  };


  const getInviteAccessSummary = (invite: PendingInvite): string => {
    if (invite.isGlobalAdmin) return 'Global Admin (Pending)';
    
    const accessCount = invite.storePermissions.length;
    const fullAccessCount = invite.storePermissions.filter(p => p.canEdit).length;
    
    if (accessCount === 0) return 'No access (Pending)';
    if (accessCount === stores.length && fullAccessCount === stores.length) {
      return 'All stores - full access (Pending)';
    }
    if (accessCount === stores.length && fullAccessCount === 0) {
      return 'All stores - view only (Pending)';
    }
    if (accessCount === stores.length) {
      return `All stores (${fullAccessCount} with edit) (Pending)`;
    }
    
    return `${accessCount} store${accessCount !== 1 ? 's' : ''} (${fullAccessCount} with edit) (Pending)`;
  };


  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: { xs: 2, sm: 3 } }}>
        <Typography variant="h4" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, fontSize: { xs: '1.5rem', sm: '2rem' } }}>
          <AdminIcon sx={{ fontSize: { xs: '1.5rem', sm: '2rem' } }} /> User Management
        </Typography>
        <Button variant="contained" startIcon={<SendIcon />} onClick={openInviteDialog}>
          Invite User
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* User Management List */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, width: '100%', maxWidth: '100%' }}>
        <Box sx={{ 
          display: 'flex', 
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between', 
          alignItems: { xs: 'stretch', sm: 'center' }, 
          mb: { xs: 2, sm: 3 },
          gap: { xs: 2, sm: 0 }
        }}>
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
            Manage Users ({users.length} active, {pendingInvites.length} pending)
          </Typography>
          <TextField
            placeholder="Search users..."
            value={userSearchTerm}
            onChange={(e) => setUserSearchTerm(e.target.value)}
            size="small"
            sx={{ width: { xs: '100%', sm: 300 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />
        </Box>

        {(filteredUsers.length === 0 && filteredInvites.length === 0) ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            {userSearchTerm ? 'No users or invites match your search' : 'No users yet'}
          </Typography>
        ) : (
          <List>
            {/* Active Users */}
            {filteredUsers.map((user, index) => (
              <React.Fragment key={user.uid}>
                {(index > 0 || filteredInvites.length > 0) && <Divider />}
                <ListItem sx={{ py: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, pr: { xs: 2, sm: 7 } }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: { xs: 0.5, sm: 0 } }}>
                        <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>{user.email}</Typography>
                        {user.uid === userId && (
                          <Chip label="You" size="small" color="primary" variant="outlined" />
                        )}
                        {user.isGlobalAdmin && (
                          <Chip label="Admin" size="small" color="secondary" icon={<AdminIcon />} />
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                        {getUserAccessSummary(user)}
                      </Typography>
                    }
                  />
                  <ListItemSecondaryAction sx={{ position: { xs: 'relative', sm: 'absolute' }, right: { xs: 0, sm: 0 }, top: { xs: 'auto', sm: '50%' }, transform: { xs: 'none', sm: 'translateY(-50%)' }, mt: { xs: 1, sm: 0 } }}>
                    <IconButton
                      edge="end"
                      onClick={() => openEditModal(user)}
                      disabled={user.uid === userId}
                      size="small"
                    >
                      <EditIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              </React.Fragment>
            ))}
            
            {/* Pending Invites */}
            {filteredInvites.map((invite, index) => (
              <React.Fragment key={invite.id}>
                {(filteredUsers.length > 0 || index > 0) && <Divider />}
                <ListItem sx={{ py: 2, bgcolor: 'grey.50', opacity: 0.8, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, pr: { xs: 2, sm: 7 } }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: { xs: 0.5, sm: 0 } }}>
                        <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>{invite.email}</Typography>
                        <Chip 
                          label="Pending" 
                          size="small" 
                          color="warning" 
                          variant="outlined"
                        />
                        {invite.isGlobalAdmin && (
                          <Chip label="Admin" size="small" color="secondary" icon={<AdminIcon />} />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" component="span" sx={{ wordBreak: 'break-word' }}>
                          {getInviteAccessSummary(invite)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          Invited {invite.invitedAt.toLocaleDateString()}
                        </Typography>
                      </Box>
                    }
                  />
                  <ListItemSecondaryAction sx={{ position: { xs: 'relative', sm: 'absolute' }, right: { xs: 0, sm: 0 }, top: { xs: 'auto', sm: '50%' }, transform: { xs: 'none', sm: 'translateY(-50%)' }, mt: { xs: 1, sm: 0 } }}>
                    <IconButton
                      edge="end"
                      onClick={() => handleCancelInvite(invite)}
                      color="error"
                      size="small"
                      title="Cancel invitation"
                    >
                      <CancelIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        )}
      </Paper>

      {/* Invite User Dialog */}
      <Dialog open={inviteDialogOpen} onClose={closeInviteDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Invite New User</DialogTitle>
        <DialogContent>
          <Box component="form" id="invite-form" onSubmit={handleInviteUser} sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Email Address"
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="user@example.com"
              required
              fullWidth
              autoFocus
            />

            {stores.length > 0 && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Store Permissions</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Button size="small" onClick={() => {
                      const m = new Map<string, AccessLevel>();
                      stores.forEach(s => m.set(s.id, 'full'));
                      setInviteAccessLevels(m);
                    }}>All Edit</Button>
                    <Button size="small" onClick={() => {
                      const m = new Map<string, AccessLevel>();
                      stores.forEach(s => m.set(s.id, 'view'));
                      setInviteAccessLevels(m);
                    }}>All View</Button>
                    <Button size="small" color="error" onClick={() => {
                      const m = new Map<string, AccessLevel>();
                      stores.forEach(s => m.set(s.id, 'none'));
                      setInviteAccessLevels(m);
                    }}>None</Button>
                  </Box>
                </Box>

                {stores.map((store) => {
                  const level = inviteAccessLevels.get(store.id) || 'full';
                  return (
                    <Box key={store.id}>
                      <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                        {store.name}
                      </Typography>
                      <ToggleButtonGroup
                        value={level}
                        exclusive
                        onChange={(_, v) => {
                          if (v !== null) {
                            setInviteAccessLevels(prev => {
                              const next = new Map(prev);
                              next.set(store.id, v);
                              return next;
                            });
                          }
                        }}
                        size="small"
                        fullWidth
                      >
                        <ToggleButton value="none" sx={{ flex: 1, py: 0.5, fontSize: '0.75rem' }}>
                          <BlockIcon sx={{ fontSize: 14, mr: 0.5 }} /> None
                        </ToggleButton>
                        <ToggleButton value="view" sx={{ flex: 1, py: 0.5, fontSize: '0.75rem' }}>
                          <ViewIcon sx={{ fontSize: 14, mr: 0.5 }} /> View
                        </ToggleButton>
                        <ToggleButton value="full" sx={{ flex: 1, py: 0.5, fontSize: '0.75rem' }}>
                          <EditNoteIcon sx={{ fontSize: 14, mr: 0.5 }} /> Edit
                        </ToggleButton>
                      </ToggleButtonGroup>
                    </Box>
                  );
                })}
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeInviteDialog}>Cancel</Button>
          <Button
            type="submit"
            form="invite-form"
            variant="contained"
            startIcon={inviteLoading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            disabled={inviteLoading || !newUserEmail.trim()}
          >
            {inviteLoading ? 'Sending...' : 'Send Invitation'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onClose={closeEditModal} maxWidth="sm" fullWidth>
        <DialogTitle>
          Edit Permissions
        </DialogTitle>
        <DialogContent>
          {editingUser && (
            <Box sx={{ pt: 1 }}>
              <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.100' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {editingUser.email}
                </Typography>
              </Paper>

              <Box sx={{ mb: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editIsOrgAdmin}
                      onChange={(e) => setEditIsOrgAdmin(e.target.checked)}
                      color="primary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>Organization Admin</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Manage campaign settings, products, and store allocations
                      </Typography>
                    </Box>
                  }
                />
              </Box>

                  <Divider sx={{ my: 2 }} />
                  
                  <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={handleGrantAllAccess}>
                      All Edit
                    </Button>
                    <Button size="small" variant="outlined" onClick={handleViewOnlyAll}>
                      All View
                    </Button>
                    <Button size="small" variant="outlined" color="error" onClick={handleRevokeAllAccess}>
                      None
                    </Button>
                  </Box>

                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                    Store Permissions
                  </Typography>

                  <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                    {stores.map((store, index) => {
                      const level = editAccessLevels.get(store.id) || 'none';
                      return (
                        <React.Fragment key={store.id}>
                          {index > 0 && <Divider />}
                          <ListItem sx={{ py: 1.5, flexDirection: 'column', alignItems: 'stretch' }}>
                            <Typography variant="body1" sx={{ fontWeight: 500, mb: 1 }}>
                              {store.name}
                            </Typography>
                            <ToggleButtonGroup
                              value={level}
                              exclusive
                              onChange={(_, newLevel) => {
                                if (newLevel !== null) {
                                  handleAccessLevelChange(store.id, newLevel);
                                }
                              }}
                              size="small"
                              fullWidth
                            >
                              <ToggleButton value="none" sx={{ flex: 1 }}>
                                <BlockIcon sx={{ mr: 0.5, fontSize: 18 }} />
                                None
                              </ToggleButton>
                              <ToggleButton value="view" sx={{ flex: 1 }}>
                                <ViewIcon sx={{ mr: 0.5, fontSize: 18 }} />
                                View
                              </ToggleButton>
                              <ToggleButton value="full" sx={{ flex: 1 }}>
                                <EditNoteIcon sx={{ mr: 0.5, fontSize: 18 }} />
                                Edit
                              </ToggleButton>
                            </ToggleButtonGroup>
                          </ListItem>
                        </React.Fragment>
                      );
                    })}
                  </List>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeEditModal}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveUserPermissions}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
