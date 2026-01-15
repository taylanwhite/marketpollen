import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useNavigate } from 'react-router-dom';
import { Location, User, LocationPermission } from '../types';
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
  email: string;
  isGlobalAdmin: boolean;
  locationPermissions: LocationPermission[];
  invitedBy: string;
  invitedAt: Date;
  status: 'pending' | 'accepted' | 'rejected';
}

export function AdminPanel() {
  const { currentUser } = useAuth();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  
  const [locations, setLocations] = useState<Location[]>([]);
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
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  
  // New user invitation form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [inviteAsAdmin, setInviteAsAdmin] = useState(false);
  const [inviteAccessLevels, setInviteAccessLevels] = useState<Map<string, AccessLevel>>(new Map());
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin()) {
      navigate('/dashboard');
      return;
    }
    loadData();
  }, [isAdmin, navigate]);

  // Initialize invite access levels when locations load
  useEffect(() => {
    if (locations.length > 0 && inviteAccessLevels.size === 0) {
      const defaultMap = new Map<string, AccessLevel>();
      locations.forEach(loc => defaultMap.set(loc.id, 'full'));
      setInviteAccessLevels(defaultMap);
    }
  }, [locations]);

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
      await Promise.all([loadLocations(), loadUsers(), loadPendingInvites()]);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async () => {
    const querySnapshot = await getDocs(collection(db, 'locations'));
    const locationList: Location[] = [];
    querySnapshot.forEach((doc) => {
      locationList.push({ id: doc.id, ...doc.data() } as Location);
    });
    locationList.sort((a, b) => a.name.localeCompare(b.name));
    setLocations(locationList);
  };

  const loadUsers = async () => {
    const querySnapshot = await getDocs(collection(db, 'users'));
    const userList: UserWithPermissions[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      userList.push({
        uid: doc.id,
        email: data.email || '',
        displayName: data.displayName,
        createdAt: data.createdAt?.toDate() || new Date(),
        isGlobalAdmin: data.isGlobalAdmin || false,
        locationPermissions: data.locationPermissions || []
      });
    });
    userList.sort((a, b) => a.email.localeCompare(b.email));
    setUsers(userList);
  };

  const loadPendingInvites = async () => {
    const querySnapshot = await getDocs(collection(db, 'invites'));
    const inviteList: PendingInvite[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.status === 'pending') {
        inviteList.push({
          id: doc.id,
          email: data.email || '',
          isGlobalAdmin: data.isGlobalAdmin || false,
          locationPermissions: data.locationPermissions || [],
          invitedBy: data.invitedBy || '',
          invitedAt: data.invitedAt?.toDate() || new Date(),
          status: data.status || 'pending'
        });
      }
    });
    inviteList.sort((a, b) => a.email.localeCompare(b.email));
    setPendingInvites(inviteList);
  };

  const checkExistingPendingInvite = async (email: string): Promise<boolean> => {
    const normalizedEmail = email.toLowerCase().trim();
    const invitesRef = collection(db, 'invites');
    const q = query(
      invitesRef,
      where('email', '==', normalizedEmail),
      where('status', '==', 'pending')
    );
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
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
      const inviteId = `${newUserEmail.toLowerCase().trim()}-${Date.now()}`;
      
      // Convert access levels to LocationPermission array
      const permissions: LocationPermission[] = [];
      inviteAccessLevels.forEach((level, locationId) => {
        if (level !== 'none') {
          permissions.push({
            locationId,
            canEdit: level === 'full'
          });
        }
      });

      const inviteData = {
        email: newUserEmail.toLowerCase().trim(),
        isGlobalAdmin: inviteAsAdmin,
        locationPermissions: inviteAsAdmin ? [] : permissions,
        invitedBy: currentUser?.uid || '',
        invitedAt: new Date(),
        status: 'pending'
      };

      console.log('Creating invitation:', inviteData);
      await setDoc(doc(db, 'invites', inviteId), inviteData);
      
      // Reload invites to show the new one
      await loadPendingInvites();
      
      // Send invitation email
      try {
        if (!currentUser) {
          throw new Error('User not authenticated');
        }
        const idToken = await currentUser.getIdToken();
        const emailResponse = await fetch('/api/send-invite-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            email: newUserEmail.toLowerCase().trim(),
            isGlobalAdmin: inviteAsAdmin,
            invitedByEmail: currentUser?.email || '',
          }),
        });

        if (!emailResponse.ok) {
          const errorData = await emailResponse.json();
          console.warn('Email sending failed:', errorData);
          // Still show success since invite was created, but note email issue
          setSuccess(`Invitation created for ${newUserEmail}, but email sending failed. They can still sign up manually.`);
        } else {
          setSuccess(`Invitation email sent to ${newUserEmail}.`);
        }
      } catch (emailError: any) {
        console.error('Error sending email:', emailError);
        // Still show success since invite was created
        setSuccess(`Invitation created for ${newUserEmail}, but email sending failed. They can still sign up manually.`);
      }
      
      setNewUserEmail('');
      setInviteAsAdmin(false);
      setInviteAccessLevels(new Map());
    } catch (err: any) {
      console.error('Error sending invitation:', err);
      setError(err.message || 'Failed to send invitation. Check console for details.');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCancelInvite = async (inviteId: string, email: string) => {
    if (!window.confirm(`Are you sure you want to cancel the invitation for ${email}?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'invites', inviteId));
      await loadPendingInvites();
      setSuccess(`Invitation for ${email} has been cancelled.`);
    } catch (err: any) {
      console.error('Error cancelling invitation:', err);
      setError(err.message || 'Failed to cancel invitation');
    }
  };

  const getAccessLevel = (perm: LocationPermission | undefined): AccessLevel => {
    if (!perm) return 'none';
    return perm.canEdit ? 'full' : 'view';
  };

  const openEditModal = (user: UserWithPermissions) => {
    setEditingUser(user);
    setEditIsAdmin(user.isGlobalAdmin);
    
    // Build access levels map from permissions
    const accessMap = new Map<string, AccessLevel>();
    locations.forEach(loc => {
      const perm = user.locationPermissions.find(p => p.locationId === loc.id);
      accessMap.set(loc.id, getAccessLevel(perm));
    });
    setEditAccessLevels(accessMap);
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setEditAccessLevels(new Map());
    setEditIsAdmin(false);
  };

  const handleAccessLevelChange = (locationId: string, level: AccessLevel) => {
    setEditAccessLevels(prev => {
      const next = new Map(prev);
      next.set(locationId, level);
      return next;
    });
  };

  const handleGrantAllAccess = () => {
    const newMap = new Map<string, AccessLevel>();
    locations.forEach(loc => newMap.set(loc.id, 'full'));
    setEditAccessLevels(newMap);
  };

  const handleViewOnlyAll = () => {
    const newMap = new Map<string, AccessLevel>();
    locations.forEach(loc => newMap.set(loc.id, 'view'));
    setEditAccessLevels(newMap);
  };

  const handleRevokeAllAccess = () => {
    const newMap = new Map<string, AccessLevel>();
    locations.forEach(loc => newMap.set(loc.id, 'none'));
    setEditAccessLevels(newMap);
  };

  const handleSaveUserPermissions = async () => {
    if (!editingUser) return;
    
    try {
      // Convert access levels to LocationPermission array
      // Only include locations with access (not 'none')
      const permissions: LocationPermission[] = [];
      editAccessLevels.forEach((level, locationId) => {
        if (level !== 'none') {
          permissions.push({
            locationId,
            canEdit: level === 'full'
          });
        }
      });

      await updateDoc(doc(db, 'users', editingUser.uid), {
        isGlobalAdmin: editIsAdmin,
        locationPermissions: editIsAdmin ? [] : permissions
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
    
    const accessCount = user.locationPermissions.length;
    const fullAccessCount = user.locationPermissions.filter(p => p.canEdit).length;
    
    if (accessCount === 0) return 'No access';
    if (accessCount === locations.length && fullAccessCount === locations.length) {
      return 'All locations (full access)';
    }
    if (accessCount === locations.length && fullAccessCount === 0) {
      return 'All locations (view only)';
    }
    if (accessCount === locations.length) {
      return `All locations (${fullAccessCount} with edit)`;
    }
    
    return `${accessCount} location${accessCount !== 1 ? 's' : ''} (${fullAccessCount} with edit)`;
  };

  const getInviteAccessSummary = (invite: PendingInvite): string => {
    if (invite.isGlobalAdmin) return 'Global Admin (Pending)';
    
    const accessCount = invite.locationPermissions.length;
    const fullAccessCount = invite.locationPermissions.filter(p => p.canEdit).length;
    
    if (accessCount === 0) return 'No access (Pending)';
    if (accessCount === locations.length && fullAccessCount === locations.length) {
      return 'All locations - full access (Pending)';
    }
    if (accessCount === locations.length && fullAccessCount === 0) {
      return 'All locations - view only (Pending)';
    }
    if (accessCount === locations.length) {
      return `All locations (${fullAccessCount} with edit) (Pending)`;
    }
    
    return `${accessCount} location${accessCount !== 1 ? 's' : ''} (${fullAccessCount} with edit) (Pending)`;
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
      <Typography variant="h4" sx={{ mb: { xs: 2, sm: 3 }, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, fontSize: { xs: '1.5rem', sm: '2rem' } }}>
        <AdminIcon sx={{ fontSize: { xs: '1.5rem', sm: '2rem' } }} /> User Management
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Invite New User */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: { xs: 2, sm: 3 }, width: '100%', maxWidth: '100%' }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
          Invite New User
        </Typography>
        <Box component="form" onSubmit={handleInviteUser} sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          <TextField
            label="Email Address"
            type="email"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            placeholder="user@example.com"
            required
            fullWidth
          />
          
          <Box sx={{ mb: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={inviteAsAdmin}
                  onChange={(e) => setInviteAsAdmin(e.target.checked)}
                  color="secondary"
                />
              }
              label={
                <Box>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>Global Administrator</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Full access to all locations and user management
                  </Typography>
                </Box>
              }
            />
          </Box>

          {!inviteAsAdmin && locations.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" onClick={() => {
                  const newMap = new Map<string, AccessLevel>();
                  locations.forEach(loc => newMap.set(loc.id, 'full'));
                  setInviteAccessLevels(newMap);
                }}>
                  Full Access All
                </Button>
                <Button size="small" variant="outlined" onClick={() => {
                  const newMap = new Map<string, AccessLevel>();
                  locations.forEach(loc => newMap.set(loc.id, 'view'));
                  setInviteAccessLevels(newMap);
                }}>
                  View Only All
                </Button>
                <Button size="small" variant="outlined" color="error" onClick={() => {
                  const newMap = new Map<string, AccessLevel>();
                  locations.forEach(loc => newMap.set(loc.id, 'none'));
                  setInviteAccessLevels(newMap);
                }}>
                  Revoke All
                </Button>
              </Box>

              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                Location Permissions
              </Typography>

              <List sx={{ bgcolor: 'grey.50', borderRadius: 1, mb: 2, width: '100%', maxWidth: '100%' }}>
                {locations.map((location, index) => {
                  const level = inviteAccessLevels.get(location.id) || 'full';
                  return (
                    <React.Fragment key={location.id}>
                      {index > 0 && <Divider />}
                      <ListItem sx={{ py: 1.5, flexDirection: 'column', alignItems: 'stretch' }}>
                        <Typography variant="body1" sx={{ fontWeight: 500, mb: 1 }}>
                          {location.name}
                        </Typography>
                        <ToggleButtonGroup
                          value={level}
                          exclusive
                          onChange={(_, newLevel) => {
                            if (newLevel !== null) {
                              setInviteAccessLevels(prev => {
                                const next = new Map(prev);
                                next.set(location.id, newLevel);
                                return next;
                              });
                            }
                          }}
                          size="small"
                          fullWidth
                          sx={{ width: '100%' }}
                        >
                          <ToggleButton value="none" sx={{ flex: 1, fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: { xs: 0.5, sm: 1 } }}>
                            <BlockIcon sx={{ mr: { xs: 0.25, sm: 0.5 }, fontSize: { xs: 16, sm: 18 } }} />
                            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>No Access</Box>
                            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>None</Box>
                          </ToggleButton>
                          <ToggleButton value="view" sx={{ flex: 1, fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: { xs: 0.5, sm: 1 } }}>
                            <ViewIcon sx={{ mr: { xs: 0.25, sm: 0.5 }, fontSize: { xs: 16, sm: 18 } }} />
                            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>View Only</Box>
                            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>View</Box>
                          </ToggleButton>
                          <ToggleButton value="full" sx={{ flex: 1, fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: { xs: 0.5, sm: 1 } }}>
                            <EditNoteIcon sx={{ mr: { xs: 0.25, sm: 0.5 }, fontSize: { xs: 16, sm: 18 } }} />
                            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Full Access</Box>
                            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Full</Box>
                          </ToggleButton>
                        </ToggleButtonGroup>
                      </ListItem>
                    </React.Fragment>
                  );
                })}
              </List>
            </>
          )}
          
          <Button
            type="submit"
            variant="contained"
            startIcon={inviteLoading ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
            sx={{ alignSelf: 'flex-start' }}
            disabled={inviteLoading || !newUserEmail.trim()}
          >
            {inviteLoading ? 'Sending...' : 'Send Invitation'}
          </Button>
        </Box>
      </Paper>

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
                        {user.uid === currentUser?.uid && (
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
                      disabled={user.uid === currentUser?.uid}
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
                      onClick={() => handleCancelInvite(invite.id, invite.email)}
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

              <Box sx={{ mb: 3 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editIsAdmin}
                      onChange={(e) => setEditIsAdmin(e.target.checked)}
                      color="secondary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>Global Administrator</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Full access to all locations and user management
                      </Typography>
                    </Box>
                  }
                />
              </Box>

              {!editIsAdmin && (
                <>
                  <Divider sx={{ my: 2 }} />
                  
                  <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={handleGrantAllAccess}>
                      Full Access All
                    </Button>
                    <Button size="small" variant="outlined" onClick={handleViewOnlyAll}>
                      View Only All
                    </Button>
                    <Button size="small" variant="outlined" color="error" onClick={handleRevokeAllAccess}>
                      Revoke All
                    </Button>
                  </Box>

                  <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                    Location Permissions
                  </Typography>

                  <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                    {locations.map((location, index) => {
                      const level = editAccessLevels.get(location.id) || 'none';
                      return (
                        <React.Fragment key={location.id}>
                          {index > 0 && <Divider />}
                          <ListItem sx={{ py: 1.5, flexDirection: 'column', alignItems: 'stretch' }}>
                            <Typography variant="body1" sx={{ fontWeight: 500, mb: 1 }}>
                              {location.name}
                            </Typography>
                            <ToggleButtonGroup
                              value={level}
                              exclusive
                              onChange={(_, newLevel) => {
                                if (newLevel !== null) {
                                  handleAccessLevelChange(location.id, newLevel);
                                }
                              }}
                              size="small"
                              fullWidth
                            >
                              <ToggleButton value="none" sx={{ flex: 1 }}>
                                <BlockIcon sx={{ mr: 0.5, fontSize: 18 }} />
                                No Access
                              </ToggleButton>
                              <ToggleButton value="view" sx={{ flex: 1 }}>
                                <ViewIcon sx={{ mr: 0.5, fontSize: 18 }} />
                                View Only
                              </ToggleButton>
                              <ToggleButton value="full" sx={{ flex: 1 }}>
                                <EditNoteIcon sx={{ mr: 0.5, fontSize: 18 }} />
                                Full Access
                              </ToggleButton>
                            </ToggleButtonGroup>
                          </ListItem>
                        </React.Fragment>
                      );
                    })}
                  </List>
                </>
              )}
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
