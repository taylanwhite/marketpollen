import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useNavigate } from 'react-router-dom';
import { Store } from '../types';
import { AddressPicker } from '../components/AddressPicker';
import { BillingQuote, BillingQuoteDialog } from '../components/BillingQuoteDialog';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  CardActions,
  Paper,
  InputAdornment,
  CircularProgress,
  Alert,
  Collapse,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Chip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Close as CloseIcon,
  LocationOn as LocationIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Pause as PauseIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
} from '@mui/icons-material';

export function Stores() {
  const { isAdmin, isOrgAdminFn, currentOrg, permissions } = usePermissions();
  const navigate = useNavigate();
  
  const [stores, setStores] = useState<Store[]>([]);
  const [filteredStores, setFilteredStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Create form
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: ''
  });

  // Edit modal
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: ''
  });
  const [organizationId, setOrganizationId] = useState(currentOrg?.id ?? '');
  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | { type: 'create' }
    | { type: 'pause' | 'keep_open' | 'resume' | 'delete'; store: Store }
    | null
  >(null);

  const canManage = isAdmin() || isOrgAdminFn();

  useEffect(() => {
    if (!canManage) {
      navigate('/dashboard');
      return;
    }
    loadStores();
  }, [canManage, navigate]);

  useEffect(() => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      setFilteredStores(
        stores.filter(store =>
          store.name.toLowerCase().includes(term) ||
          (store.address?.toLowerCase() || '').includes(term) ||
          (store.city?.toLowerCase() || '').includes(term) ||
          (store.state?.toLowerCase() || '').includes(term) ||
          (store.zipCode?.toLowerCase() || '').includes(term)
        )
      );
    } else {
      setFilteredStores(stores);
    }
  }, [searchTerm, stores]);

  const loadStores = async () => {
    try {
      const list = await api.get<Store[]>(`/stores`);
      const storeList = list.map((s) => ({
        ...s,
        createdAt: s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt),
      }));
      storeList.sort((a, b) => a.name.localeCompare(b.name));
      setStores(storeList);
    } catch (err: any) {
      setError(err.message || 'Failed to load stores');
    } finally {
      setLoading(false);
    }
  };

  const targetOrgId = organizationId || currentOrg?.id || '';

  const createStore = async (confirmCharge: boolean, dueTodayCents?: number) => {
    await api.post<Store>(`/stores`, {
      name: formData.name.trim(),
      address: formData.address.trim() || undefined,
      city: formData.city.trim() || undefined,
      state: formData.state.trim().toUpperCase() || undefined,
      zipCode: formData.zipCode.trim() || undefined,
      organizationId: targetOrgId || undefined,
      confirmCharge,
      expectedDueCents: dueTodayCents,
      idempotencyKey: crypto.randomUUID(),
    });
    setSuccess('Store created.');
    setFormData({ name: '', address: '', city: '', state: '', zipCode: '' });
    setShowForm(false);
    await loadStores();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.name.trim()) {
      setError('Store name is required');
      return;
    }

    try {
      if (!targetOrgId) {
        await createStore(false);
        return;
      }
      const preview = await api.post<{ quote: BillingQuote | null }>(`/organizations/${targetOrgId}/billing`, {
        action: 'preview',
        intent: 'add_store',
        storeName: formData.name.trim(),
      });
      if (!preview.quote) {
        await createStore(false);
        return;
      }
      setPendingAction({ type: 'create' });
      setQuote(preview.quote);
    } catch (err: any) {
      setError(err.message || 'Failed to create store');
    }
  };

  const openStoreQuote = async (store: Store, intent: 'pause_store' | 'keep_open' | 'resume_store' | 'delete_store') => {
    if (!store.organizationId) {
      if (intent === 'delete_store') {
        setPendingAction({ type: 'delete', store });
        setQuote({
          intent: 'delete_store',
          needsCharge: false,
          needsCheckout: false,
          message: `Remove ${store.name}? The store and everything in it are deleted now. This cannot be undone.`,
          dueTodayCents: 0,
        });
      }
      return;
    }
    setError('');
    try {
      const preview = await api.post<{ quote: BillingQuote }>(`/organizations/${store.organizationId}/billing`, {
        action: 'preview',
        intent,
        storeId: store.id,
        storeName: store.name,
      });
      const type = intent === 'pause_store' ? 'pause' : intent === 'keep_open' ? 'keep_open' : intent === 'resume_store' ? 'resume' : 'delete';
      setPendingAction({ type, store });
      setQuote(preview.quote);
    } catch (err: any) {
      setError(err.message || 'Could not prepare that change');
    }
  };

  const confirmQuote = async () => {
    if (!quote || !pendingAction) return;
    setQuoteLoading(true);
    setError('');
    try {
      if (pendingAction.type === 'create') {
        await createStore(quote.needsCharge, quote.dueTodayCents);
      } else if (pendingAction.type === 'delete') {
        await api.delete(`/stores/${pendingAction.store.id}?confirm=1`);
        setSuccess(`${pendingAction.store.name} was removed.`);
        await loadStores();
      } else {
        await api.post(`/stores/${pendingAction.store.id}/billing`, {
          action: pendingAction.type,
          confirmCharge: quote.needsCharge,
          expectedDueCents: quote.dueTodayCents,
          idempotencyKey: crypto.randomUUID(),
        });
        setSuccess(
          pendingAction.type === 'pause'
            ? `${pendingAction.store.name} will pause at the end of this month.`
            : pendingAction.type === 'keep_open'
              ? `${pendingAction.store.name} stays open.`
              : `${pendingAction.store.name} is open again.`
        );
        await loadStores();
      }
      setQuote(null);
      setPendingAction(null);
    } catch (err: any) {
      setError(err.message || 'That change did not go through');
    } finally {
      setQuoteLoading(false);
    }
  };

  const openEditModal = (store: Store) => {
    setEditingStore(store);
    setEditFormData({
      name: store.name || '',
      address: store.address || '',
      city: store.city || '',
      state: store.state || '',
      zipCode: store.zipCode || ''
    });
  };

  const closeEditModal = () => {
    setEditingStore(null);
    setEditFormData({ name: '', address: '', city: '', state: '', zipCode: '' });
  };

  const handleEditSubmit = async () => {
    if (!editingStore) return;
    
    setError('');
    setSuccess('');

    if (!editFormData.name.trim()) {
      setError('Store name is required');
      return;
    }

    try {
      await api.patch(`/stores/${editingStore.id}`, {
        name: editFormData.name.trim(),
        address: editFormData.address.trim() || undefined,
        city: editFormData.city.trim() || undefined,
        state: editFormData.state.trim().toUpperCase() || undefined,
        zipCode: editFormData.zipCode.trim() || undefined
      });

      setSuccess('Store updated successfully!');
      closeEditModal();
      await loadStores();
    } catch (err: any) {
      setError(err.message || 'Failed to update store');
    }
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
        <LocationIcon /> Manage Stores
      </Typography>

      {/* Search and Actions */}
      <Paper sx={{ p: 2, mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          placeholder="Search stores..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          size="small"
          sx={{ flexGrow: 1, maxWidth: 400 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          }}
        />
        <Button
          variant="contained"
          startIcon={showForm ? <CloseIcon /> : <AddIcon />}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'New Store'}
        </Button>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Create Form */}
      <Collapse in={showForm}>
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            Create New Store
          </Typography>
          {permissions.organizations.find((org) => org.id === targetOrgId) && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This store will be added to {permissions.organizations.find((org) => org.id === targetOrgId)?.name}.
            </Typography>
          )}
          <Box component="form" onSubmit={handleSubmit}>
            <Grid container spacing={2}>
              {permissions.organizations.length > 1 && (
                <Grid size={{ xs: 12 }}>
                  <TextField
                    select
                    label="Organization"
                    value={targetOrgId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    fullWidth
                    required
                  >
                    {permissions.organizations.map((org) => (
                      <MenuItem key={org.id} value={org.id}>{org.name}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
              )}
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Store Name"
                  name="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Downtown Store"
                  required
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <AddressPicker
                  value={{
                    address: formData.address,
                    city: formData.city,
                    state: formData.state,
                    zipCode: formData.zipCode,
                  }}
                  onChange={(address) => {
                    setFormData({
                      ...formData,
                      address: address.address,
                      city: address.city,
                      state: address.state,
                      zipCode: address.zipCode,
                    });
                  }}
                  label="Address"
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  label="City"
                  name="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  label="State"
                  name="state"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                  placeholder="CA"
                  inputProps={{ maxLength: 2 }}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Zip Code"
                  name="zipCode"
                  value={formData.zipCode}
                  onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                  placeholder="12345"
                  inputProps={{ maxLength: 5 }}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Button type="submit" variant="contained" startIcon={<AddIcon />}>
                  Create Store
                </Button>
              </Grid>
            </Grid>
          </Box>
        </Paper>
      </Collapse>

      {/* Stores Grid */}
      {filteredStores.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {searchTerm ? 'No stores match your search' : 'No stores yet. Create your first store!'}
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {filteredStores.map((store) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={store.id} sx={{ display: 'flex' }}>
              <Card sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                    {store.name}
                  </Typography>
                  {store.billingStatus === 'pause_scheduled' && (
                    <Chip size="small" label="Pauses at the end of this month" sx={{ mb: 1 }} />
                  )}
                  {store.billingStatus === 'paused' && (
                    <Chip size="small" color="warning" label="Paused" sx={{ mb: 1 }} />
                  )}
                  {store.statusMessage && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {store.statusMessage}
                    </Typography>
                  )}
                  {(store.address || store.city) && (
                    <Box sx={{ color: 'text.secondary', mb: 2 }}>
                      {store.address && (
                        <Typography variant="body2">{store.address}</Typography>
                      )}
                      <Typography variant="body2">
                        {[store.city, store.state, store.zipCode].filter(Boolean).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Created: {store.createdAt.toLocaleDateString()}
                  </Typography>
                </CardContent>
                <CardActions sx={{ justifyContent: 'flex-end', pt: 0, flexWrap: 'wrap' }}>
                  {store.billingActive && store.billingStatus !== 'paused' && store.billingStatus !== 'pause_scheduled' && (
                    <Button size="small" startIcon={<PauseIcon />} onClick={() => openStoreQuote(store, 'pause_store')}>
                      Pause
                    </Button>
                  )}
                  {store.billingStatus === 'pause_scheduled' && (
                    <Button size="small" startIcon={<PlayIcon />} onClick={() => openStoreQuote(store, 'keep_open')}>
                      Keep open
                    </Button>
                  )}
                  {store.billingStatus === 'paused' && (
                    <Button size="small" startIcon={<PlayIcon />} onClick={() => openStoreQuote(store, 'resume_store')}>
                      Turn back on
                    </Button>
                  )}
                  <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => openStoreQuote(store, 'delete_store')}>
                    Remove
                  </Button>
                  <Button
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={() => openEditModal(store)}
                  >
                    Edit
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Edit Store Dialog */}
      <Dialog open={!!editingStore} onClose={closeEditModal} maxWidth="sm" fullWidth>
        <DialogTitle>
          Edit Store
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Store Name"
              value={editFormData.name}
              onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
              placeholder="e.g., Downtown Store"
              required
              fullWidth
            />
            <AddressPicker
              value={{
                address: editFormData.address,
                city: editFormData.city,
                state: editFormData.state,
                zipCode: editFormData.zipCode,
              }}
              onChange={(address) => {
                setEditFormData({
                  ...editFormData,
                  address: address.address,
                  city: address.city,
                  state: address.state,
                  zipCode: address.zipCode,
                });
              }}
              label="Address"
              fullWidth
            />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="City"
                value={editFormData.city}
                onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })}
                fullWidth
              />
              <TextField
                label="State"
                value={editFormData.state}
                onChange={(e) => setEditFormData({ ...editFormData, state: e.target.value.toUpperCase() })}
                placeholder="CA"
                inputProps={{ maxLength: 2 }}
                sx={{ width: 100 }}
              />
              <TextField
                label="Zip Code"
                value={editFormData.zipCode}
                onChange={(e) => setEditFormData({ ...editFormData, zipCode: e.target.value })}
                placeholder="12345"
                inputProps={{ maxLength: 5 }}
                sx={{ width: 120 }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeEditModal}>Cancel</Button>
          <Button 
            variant="contained" 
            startIcon={<SaveIcon />}
            onClick={handleEditSubmit}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      <BillingQuoteDialog
        quote={quote}
        open={!!quote}
        loading={quoteLoading}
        onClose={() => { if (!quoteLoading) { setQuote(null); setPendingAction(null); } }}
        onConfirm={confirmQuote}
        onSetupBilling={() => navigate('/org-settings')}
      />
    </Box>
  );
}
