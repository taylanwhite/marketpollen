import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
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
  Checkbox,
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
} from '@mui/icons-material';

// Simplified permission type for UI state
type AccessLevel = 'none' | 'view' | 'full';

interface UserWithPermissions extends User {
  email: string;
}

export function AdminPanel() {
  const { currentUser } = useAuth();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<UserWithPermissions[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserWithPermissions[]>([]);
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

  useEffect(() => {
    if (!isAdmin()) {
      navigate('/dashboard');
      return;
    }
    loadData();
  }, [isAdmin, navigate]);

  useEffect(() => {
    if (userSearchTerm.trim()) {
      const term = userSearchTerm.toLowerCase();
      setFilteredUsers(
        users.filter(user => user.email.toLowerCase().includes(term))
      );
    } else {
      setFilteredUsers(users);
    }
  }, [userSearchTerm, users]);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadLocations(), loadUsers()]);
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

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!newUserEmail.trim()) {
      setError('Email is required');
      return;
    }

    try {
      const inviteId = `${newUserEmail.toLowerCase()}-${Date.now()}`;
      // New users get full access to all locations by default
      const defaultPermissions: LocationPermission[] = locations.map(loc => ({
        locationId: loc.id,
        canEdit: true // Full access
      }));

      const inviteData = {
        email: newUserEmail.toLowerCase(),
        isGlobalAdmin: inviteAsAdmin,
        locationPermissions: inviteAsAdmin ? [] : defaultPermissions,
        invitedBy: currentUser?.uid,
        invitedAt: new Date(),
        status: 'pending'
      };

      await setDoc(doc(db, 'invites', inviteId), inviteData);
      
      setSuccess(`Invitation sent to ${newUserEmail}. They will have full access to all locations by default.`);
      setNewUserEmail('');
      setInviteAsAdmin(false);
    } catch (err: any) {
      setError(err.message || 'Failed to send invitation');
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

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <AdminIcon /> User Management
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Invite New User */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Invite New User
        </Typography>
        <Box component="form" onSubmit={handleInviteUser} sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 500 }}>
          <TextField
            label="Email Address"
            type="email"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            placeholder="user@example.com"
            required
            fullWidth
            helperText="New users get full access to all locations by default"
          />
          
          <FormControlLabel
            control={
              <Checkbox
                checked={inviteAsAdmin}
                onChange={(e) => setInviteAsAdmin(e.target.checked)}
              />
            }
            label="Make Global Administrator"
          />
          
          <Button
            type="submit"
            variant="contained"
            startIcon={<SendIcon />}
            sx={{ alignSelf: 'flex-start' }}
          >
            Send Invitation
          </Button>
        </Box>
      </Paper>

      {/* User Management List */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Manage Users ({users.length})
          </Typography>
          <TextField
            placeholder="Search users..."
            value={userSearchTerm}
            onChange={(e) => setUserSearchTerm(e.target.value)}
            size="small"
            sx={{ width: 300 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />
        </Box>

        {filteredUsers.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            {userSearchTerm ? 'No users match your search' : 'No users yet'}
          </Typography>
        ) : (
          <List>
            {filteredUsers.map((user, index) => (
              <React.Fragment key={user.uid}>
                {index > 0 && <Divider />}
                <ListItem sx={{ py: 2 }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {user.email}
                        {user.uid === currentUser?.uid && (
                          <Chip label="You" size="small" color="primary" variant="outlined" />
                        )}
                        {user.isGlobalAdmin && (
                          <Chip label="Admin" size="small" color="secondary" icon={<AdminIcon />} />
                        )}
                      </Box>
                    }
                    secondary={getUserAccessSummary(user)}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => openEditModal(user)}
                      disabled={user.uid === currentUser?.uid}
                    >
                      <EditIcon />
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
