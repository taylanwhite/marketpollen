import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { CampaignProduct } from '../types';
import {
  Box, Typography, TextField, Button, Card, CardContent, Paper,
  IconButton, Switch, FormControlLabel, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip,
} from '@mui/material';
import {
  Settings as SettingsIcon, Add as AddIcon, Edit as EditIcon,
  Delete as DeleteIcon, Save as SaveIcon,
} from '@mui/icons-material';

interface BillingInfo {
  enabled: boolean;
  status: string | null;
  paidQuantity: number;
  monthlyLabel: string;
  nextMonthlyLabel: string;
  currentPeriodEnd: string | null;
  alert: string | null;
  needsCheckout: boolean;
  minimumQuantity: number;
  configured: boolean;
  unitLabel: string;
}

interface OrgData {
  id: string;
  name: string;
  quarterlyGoal: number;
  stores: Array<{ id: string; name: string }>;
  products: CampaignProduct[];
  members: Array<{ userId: string; email: string; displayName: string | null; isAdmin: boolean }>;
  billing: BillingInfo | null;
}

export function OrgSettings() {
  const { currentOrg, isOrgAdminFn, isAdmin } = usePermissions();
  const [orgData, setOrgData] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [goalValue, setGoalValue] = useState(10000);

  const [productDialog, setProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CampaignProduct | null>(null);
  const [productForm, setProductForm] = useState({ name: '', slug: '', mouthValue: 1 });
  const [productSaving, setProductSaving] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [storeQuantity, setStoreQuantity] = useState(1);
  const [billingBusy, setBillingBusy] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    const sessionId = searchParams.get('session_id');
    const finish = () => {
      if (searchParams.get('billing') || sessionId) {
        const next = new URLSearchParams(searchParams);
        next.delete('billing');
        next.delete('session_id');
        setSearchParams(next, { replace: true });
      }
    };
    if (searchParams.get('billing') === 'success' && sessionId) {
      setSuccess('Payment received. The monthly bill will show here once it is confirmed.');
      api.post<{ status: string | null }>(`/organizations/${currentOrg.id}/billing`, { action: 'sync_checkout', sessionId })
        .then((billing) => setSuccess(billing.status === 'active'
          ? 'Your monthly bill is active. You can add stores now.'
          : 'Payment received. If the bill is not shown yet, refresh this page in a moment.'))
        .catch((err: Error) => setError(err.message || 'The payment is still processing. Refresh this page in a moment.'))
        .finally(() => {
          finish();
          loadOrgData();
        });
      return;
    }
    if (searchParams.get('billing') === 'cancel') {
      setError('The monthly bill was not started.');
      finish();
    }
    loadOrgData();
  }, [currentOrg?.id]);

  const loadOrgData = async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const data = await api.get<OrgData>(`/organizations/${currentOrg.id}`);
      setOrgData(data);
      setGoalValue(data.quarterlyGoal);
      if (data.billing?.minimumQuantity) {
        setStoreQuantity((current) => Math.max(current, data.billing!.minimumQuantity));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load organization');
    } finally {
      setLoading(false);
    }
  };

  const saveGoal = async () => {
    if (!orgData) return;
    setSaving(true);
    setError(''); setSuccess('');
    try {
      await api.patch(`/organizations/${orgData.id}`, { quarterlyGoal: goalValue });
      setSuccess('Goal updated!');
      await loadOrgData();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    setProductForm({ name: '', slug: '', mouthValue: 1 });
    setProductDialog(true);
  };

  const openEditProduct = (p: CampaignProduct) => {
    setEditingProduct(p);
    setProductForm({ name: p.name, slug: p.slug, mouthValue: p.mouthValue });
    setProductDialog(true);
  };

  const saveProduct = async () => {
    if (!orgData) return;
    setProductSaving(true);
    setError(''); setSuccess('');
    try {
      if (editingProduct) {
        await api.patch(`/organizations/${orgData.id}/products/${editingProduct.id}`, {
          name: productForm.name.trim(),
          mouthValue: productForm.mouthValue,
        });
        setSuccess('Product updated!');
      } else {
        await api.post(`/organizations/${orgData.id}/products`, {
          name: productForm.name.trim(),
          slug: productForm.slug.trim().replace(/\s+/g, '_'),
          mouthValue: productForm.mouthValue,
        });
        setSuccess('Product added!');
      }
      setProductDialog(false);
      await loadOrgData();
    } catch (err: any) { setError(err.message); }
    finally { setProductSaving(false); }
  };

  const toggleProduct = async (p: CampaignProduct) => {
    if (!orgData) return;
    try {
      await api.patch(`/organizations/${orgData.id}/products/${p.id}`, { isActive: !p.isActive });
      await loadOrgData();
    } catch (err: any) { setError(err.message); }
  };

  const deleteProduct = async (p: CampaignProduct) => {
    if (!orgData || p.reachoutColumn) return;
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/organizations/${orgData.id}/products/${p.id}`);
      setSuccess('Product deleted');
      await loadOrgData();
    } catch (err: any) { setError(err.message); }
  };

  if (!isOrgAdminFn() && !isAdmin()) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">You need organization admin access to view this page.</Typography>
      </Box>
    );
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;

  if (!orgData) return <Alert severity="error">No organization found.</Alert>;

  const storeCount = orgData.stores.length;

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsIcon /> {orgData.name} Settings
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Quarterly Goal */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Quarterly Goal</Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              label="Total Mouths per Quarter"
              type="number"
              value={goalValue}
              onChange={e => setGoalValue(parseInt(e.target.value) || 0)}
              size="small"
              slotProps={{ htmlInput: { min: 0 } }}
              sx={{ width: 240 }}
            />
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
              onClick={saveGoal}
              disabled={saving || goalValue === orgData.quarterlyGoal}
            >
              Save
            </Button>
          </Box>
          {storeCount > 1 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {(goalValue * storeCount).toLocaleString()} mouths total across {storeCount} stores
            </Typography>
          )}
        </CardContent>
      </Card>

      {(isAdmin() || orgData.billing?.enabled) && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>Monthly bill</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Each store is {orgData.billing?.unitLabel || '$65.00'} a month.
            </Typography>
            {orgData.billing?.alert && <Alert severity="warning" sx={{ mb: 2 }}>{orgData.billing.alert}</Alert>}
            {isAdmin() && orgData.billing?.status !== 'active' && (
              <FormControlLabel
                sx={{ mb: 1, display: 'block' }}
                control={
                  <Switch
                    checked={!!orgData.billing?.enabled}
                    disabled={billingBusy}
                    onChange={async (event) => {
                      setBillingBusy(true);
                      setError('');
                      try {
                        await api.post(`/organizations/${orgData.id}/billing`, { action: 'enable', enabled: event.target.checked });
                        await loadOrgData();
                      } catch (err: any) {
                        setError(err.message || 'Could not update billing');
                      } finally {
                        setBillingBusy(false);
                      }
                    }}
                  />
                }
                label="Require a monthly bill before new stores can be added"
              />
            )}
            {orgData.billing?.needsCheckout && (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  label="How many stores are you starting with?"
                  type="number"
                  size="small"
                  value={storeQuantity}
                  onChange={(event) => setStoreQuantity(Math.max(orgData.billing?.minimumQuantity || 1, parseInt(event.target.value, 10) || 1))}
                  slotProps={{ htmlInput: { min: orgData.billing.minimumQuantity || 1 } }}
                  sx={{ width: 280 }}
                />
                <Button
                  variant="contained"
                  disabled={billingBusy || orgData.billing.configured === false}
                  onClick={async () => {
                    setBillingBusy(true);
                    setError('');
                    try {
                      const result = await api.post<{ url: string }>(`/organizations/${orgData.id}/billing`, {
                        action: 'checkout',
                        quantity: storeQuantity,
                      });
                      window.location.href = result.url;
                    } catch (err: any) {
                      setError(err.message || 'Could not start the bill');
                      setBillingBusy(false);
                    }
                  }}
                >
                  {billingBusy ? <CircularProgress size={16} color="inherit" /> : `Start at $${storeQuantity * 65} a month`}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  You'll pay for the full month today. Adding another store later charges only the days left in that month.
                </Typography>
              </Box>
            )}
            {orgData.billing?.status === 'active' && (
              <Box>
                <Typography sx={{ mb: 1 }}>
                  You're paying {orgData.billing.monthlyLabel} a month
                  {orgData.billing.paidQuantity ? ` for ${orgData.billing.paidQuantity} ${orgData.billing.paidQuantity === 1 ? 'store' : 'stores'}` : ''}.
                  {orgData.billing.currentPeriodEnd && orgData.billing.nextMonthlyLabel !== orgData.billing.monthlyLabel && (
                    <> On {new Date(orgData.billing.currentPeriodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} the bill goes to {orgData.billing.nextMonthlyLabel}.</>
                  )}
                </Typography>
                <Button
                  variant="outlined"
                  disabled={billingBusy}
                  onClick={async () => {
                    setBillingBusy(true);
                    setError('');
                    try {
                      const result = await api.post<{ url: string }>(`/organizations/${orgData.id}/billing`, { action: 'portal' });
                      window.location.href = result.url;
                    } catch (err: any) {
                      setError(err.message || 'Could not open billing');
                      setBillingBusy(false);
                    }
                  }}
                >
                  Update card
                </Button>
              </Box>
            )}
            {orgData.billing?.enabled && orgData.billing.configured === false && (
              <Alert severity="info" sx={{ mt: 2 }}>Monthly billing isn't configured yet.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Products */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>Campaign Products</Typography>
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openAddProduct}>
              Add Product
            </Button>
          </Box>
          {orgData.products.map(p => (
            <Paper key={p.id} variant="outlined" sx={{ p: 2, mb: 1, display: 'flex', alignItems: 'center', gap: 2, opacity: p.isActive ? 1 : 0.5 }}>
              <Box sx={{ flex: 1 }}>
                <Typography fontWeight={600}>{p.name}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" component="span">
                    {p.mouthValue} mouth{p.mouthValue !== 1 ? 's' : ''} each
                  </Typography>
                  {p.reachoutColumn && <Chip label="Default" size="small" />}
                </Box>
              </Box>
              <FormControlLabel
                control={<Switch checked={p.isActive} onChange={() => toggleProduct(p)} size="small" />}
                label={p.isActive ? 'Active' : 'Inactive'}
              />
              <IconButton size="small" onClick={() => openEditProduct(p)}><EditIcon fontSize="small" /></IconButton>
              {!p.reachoutColumn && (
                <IconButton size="small" color="error" onClick={() => deleteProduct(p)}><DeleteIcon fontSize="small" /></IconButton>
              )}
            </Paper>
          ))}
        </CardContent>
      </Card>

      {/* Product Add/Edit Dialog */}
      <Dialog open={productDialog} onClose={() => setProductDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editingProduct ? 'Edit Product' : 'Add Product'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Product Name"
              value={productForm.name}
              onChange={e => setProductForm({ ...productForm, name: e.target.value })}
              fullWidth
              required
            />
            {!editingProduct && (
              <TextField
                label="Slug (unique identifier)"
                value={productForm.slug}
                onChange={e => setProductForm({ ...productForm, slug: e.target.value })}
                fullWidth
                required
                helperText="e.g. miniCupcakes (no spaces)"
              />
            )}
            <TextField
              label="Mouth Value"
              type="number"
              value={productForm.mouthValue}
              onChange={e => setProductForm({ ...productForm, mouthValue: parseInt(e.target.value) || 0 })}
              fullWidth
              required
              slotProps={{ htmlInput: { min: 0 } }}
              helperText="How many mouths this product counts as"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setProductDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveProduct}
            disabled={productSaving || !productForm.name.trim() || (!editingProduct && !productForm.slug.trim())}
          >
            {productSaving ? <CircularProgress size={20} /> : editingProduct ? 'Save' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
