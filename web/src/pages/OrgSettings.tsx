import { useState, useEffect } from 'react';
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

interface OrgData {
  id: string;
  name: string;
  quarterlyGoal: number;
  stores: Array<{ id: string; name: string }>;
  products: CampaignProduct[];
  members: Array<{ userId: string; email: string; displayName: string | null; isAdmin: boolean }>;
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

  useEffect(() => { if (currentOrg) loadOrgData(); }, [currentOrg?.id]);

  const loadOrgData = async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const data = await api.get<OrgData>(`/organizations/${currentOrg.id}`);
      setOrgData(data);
      setGoalValue(data.quarterlyGoal);
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
