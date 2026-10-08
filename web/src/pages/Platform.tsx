import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { AdminPanel } from './AdminPanel';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';

interface OrgAccess {
  mode: 'open' | 'trial' | 'grace' | 'trial_ended' | 'payment_locked';
  daysLeft: number | null;
}

interface PlatformOrg {
  id: string;
  name: string;
  storeCount: number;
  monthlyPriceCents: number;
  billingEnabled: boolean;
  subscriptionStatus: string | null;
  paidQuantity: number;
  admins: string[];
  access?: OrgAccess;
}

interface OrgInvoice {
  id: string;
  number: string | null;
  status: string | null;
  totalCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  created: number;
  hostedUrl: string | null;
}

interface OrgDetail {
  id: string;
  name: string;
  stores: Array<{ id: string; name: string }>;
  members: Array<{ email: string; displayName: string | null; isAdmin: boolean }>;
  billing: {
    enabled: boolean;
    status: string | null;
    paidQuantity: number;
    monthlyLabel: string;
    nextMonthlyLabel: string;
    currentPeriodEnd: string | null;
    alert: string | null;
    unitLabel: string;
    invoices: OrgInvoice[];
    access?: OrgAccess;
  } | null;
  pendingOwners?: string[];
}

function money(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function billLabel(org: PlatformOrg) {
  const days = org.access?.daysLeft ?? 0;
  if (org.access?.mode === 'trial') return `Free trial · ${days} day${days === 1 ? '' : 's'} left`;
  if (org.access?.mode === 'trial_ended') return 'Trial ended';
  if (org.access?.mode === 'grace') return `Payment due · ${days} day${days === 1 ? '' : 's'} left`;
  if (org.access?.mode === 'payment_locked') return 'Insufficient payment';
  if (!org.billingEnabled) return 'Not billing';
  if (org.subscriptionStatus === 'active') return `Paying ${money(org.monthlyPriceCents)} × ${org.paidQuantity}`;
  return 'Waiting for first payment';
}

export function Platform() {
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'organizations' | 'people'>('organizations');
  const [orgs, setOrgs] = useState<PlatformOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('65');
  const [newTrial, setNewTrial] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { price: string; billing: boolean }>>({});
  const [selected, setSelected] = useState<PlatformOrg | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin()) {
      navigate('/dashboard');
      return;
    }
    loadOrgs();
  }, [isAdmin, navigate]);

  const loadOrgs = async () => {
    setLoading(true);
    try {
      const rows = await api.get<PlatformOrg[]>('/platform');
      setOrgs(rows);
      setDrafts(Object.fromEntries(rows.map((org) => [org.id, {
        price: (org.monthlyPriceCents / 100).toFixed(2).replace(/\.00$/, ''),
        billing: org.billingEnabled,
      }])));
    } catch (err: any) {
      setError(err.message || 'Could not load organizations');
    } finally {
      setLoading(false);
    }
  };

  const createOrg = async () => {
    if (!newName.trim()) return;
    setSavingId('new');
    setError('');
    try {
      const created = await api.post<{ id: string }>('/organizations', { name: newName.trim(), trial: newTrial });
      const price = Number(newPrice);
      if (price && price !== 65) {
        await api.post(`/organizations/${created.id}/billing`, { action: 'set_price', monthlyPrice: price });
      }
      setCreating(false);
      setNewName('');
      setNewPrice('65');
      setNewTrial(true);
      setSuccess(`${newName.trim()} was created.`);
      await loadOrgs();
    } catch (err: any) {
      setError(err.message || 'Could not create the organization');
    } finally {
      setSavingId(null);
    }
  };

  const openOrg = async (org: PlatformOrg) => {
    setSelected(org);
    setOwnerEmail('');
    setDetail(null);
    setDetailLoading(true);
    try {
      const row = await api.get<OrgDetail>(`/organizations/${org.id}`);
      setDetail(row);
    } catch (err: any) {
      setError(err.message || 'Could not open that organization');
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const chargeInStripe = async (org: PlatformOrg) => {
    setSavingId(org.id);
    setError('');
    try {
      const result = await api.post<{ url: string }>(`/organizations/${org.id}/billing`, {
        action: 'checkout',
        quantity: Math.max(org.storeCount, 1),
      });
      window.location.href = result.url;
    } catch (err: any) {
      setError(err.message || 'Could not open Stripe');
      setSavingId(null);
    }
  };

  const openBillingPortal = async (orgId: string) => {
    setSavingId(orgId);
    setError('');
    try {
      const result = await api.post<{ url: string }>(`/organizations/${orgId}/billing`, { action: 'portal' });
      window.location.href = result.url;
    } catch (err: any) {
      setError(err.message || 'Could not open the card on file');
      setSavingId(null);
    }
  };

  const addOwner = async () => {
    if (!selected || !ownerEmail.trim()) return;
    setSavingId('owner');
    setError('');
    try {
      const result = await api.post<{ pending: boolean; emailed: boolean; email: string }>(`/organizations/${selected.id}/members`, {
        email: ownerEmail.trim(),
      });
      setOwnerEmail('');
      setSuccess(result.pending
        ? `${result.email} will become an owner when they create an account${result.emailed ? '' : '. The email could not be sent'}.`
        : `${result.email} is now an owner.`);
      const row = await api.get<OrgDetail>(`/organizations/${selected.id}`);
      setDetail(row);
      await loadOrgs();
    } catch (err: any) {
      setError(err.message || 'Could not add that owner');
    } finally {
      setSavingId(null);
    }
  };

  const startTrial = async () => {
    if (!selected) return;
    setSavingId('trial');
    setError('');
    try {
      await api.post(`/organizations/${selected.id}/billing`, { action: 'start_trial' });
      setSuccess(`${selected.name} has a free month.`);
      const row = await api.get<OrgDetail>(`/organizations/${selected.id}`);
      setDetail(row);
      await loadOrgs();
    } catch (err: any) {
      setError(err.message || 'Could not start the free month');
    } finally {
      setSavingId(null);
    }
  };

  const saveOrg = async (org: PlatformOrg) => {
    const draft = drafts[org.id];
    if (!draft) return;
    setSavingId(org.id);
    setError('');
    try {
      const price = Number(draft.price);
      if (org.subscriptionStatus !== 'active' && price !== org.monthlyPriceCents / 100) {
        await api.post(`/organizations/${org.id}/billing`, { action: 'set_price', monthlyPrice: price });
      }
      if (draft.billing !== org.billingEnabled) {
        await api.post(`/organizations/${org.id}/billing`, { action: 'enable', enabled: draft.billing });
      }
      setSuccess(`${org.name} was updated.`);
      await loadOrgs();
    } catch (err: any) {
      setError(err.message || 'Could not update the organization');
    } finally {
      setSavingId(null);
    }
  };

  if (!isAdmin()) return null;

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>Platform</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        MarketPollen organizations and the people in them.
      </Typography>

      <Tabs value={tab} onChange={(_event, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="organizations" label="Organizations" />
        <Tab value="people" label="People" />
      </Tabs>

      {tab === 'people' ? <AdminPanel embedded /> : (
        <>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" onClick={() => setCreating(true)}>New organization</Button>
          </Box>

          {loading ? <CircularProgress /> : (
            <Paper sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Organization</TableCell>
                    <TableCell>Stores</TableCell>
                    <TableCell>Price per store</TableCell>
                    <TableCell>Require a bill</TableCell>
                    <TableCell>Bill</TableCell>
                    <TableCell>Admins</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {orgs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7}>No organizations yet.</TableCell>
                    </TableRow>
                  ) : orgs.map((org) => {
                    const draft = drafts[org.id] || { price: '65', billing: false };
                    const dirty = Number(draft.price) !== org.monthlyPriceCents / 100 || draft.billing !== org.billingEnabled;
                    return (
                      <TableRow key={org.id} hover>
                        <TableCell>
                          <Button size="small" sx={{ textTransform: 'none', fontWeight: 600, px: 0 }} onClick={() => openOrg(org)}>
                            {org.name}
                          </Button>
                        </TableCell>
                        <TableCell>{org.storeCount}</TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            value={draft.price}
                            disabled={org.subscriptionStatus === 'active' || savingId === org.id}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [org.id]: { ...draft, price: event.target.value },
                            }))}
                            sx={{ width: 100 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={draft.billing}
                            disabled={org.subscriptionStatus === 'active' || savingId === org.id}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [org.id]: { ...draft, billing: event.target.checked },
                            }))}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={billLabel(org)} />
                        </TableCell>
                        <TableCell>{org.admins.join(', ') || 'None'}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <Button size="small" disabled={!dirty || savingId === org.id} onClick={() => saveOrg(org)}>
                            Save
                          </Button>
                          <Button size="small" onClick={() => navigate(`/org-settings?org=${org.id}`)}>
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Paper>
          )}
        </>
      )}

      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        <DialogTitle>{selected?.name}</DialogTitle>
        <DialogContent>
          {detailLoading || !detail ? <CircularProgress sx={{ my: 3 }} /> : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {error && <Alert severity="error">{error}</Alert>}
              {detail.billing?.alert && <Alert severity="warning">{detail.billing.alert}</Alert>}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Bill</Typography>
                <Typography variant="body2" color="text.secondary">
                  {detail.billing?.enabled
                    ? detail.billing.status === 'active'
                      ? `${detail.billing.monthlyLabel} a month for ${detail.billing.paidQuantity} ${detail.billing.paidQuantity === 1 ? 'store' : 'stores'}, ${detail.billing.unitLabel} each.`
                      : `Billing is required at ${detail.billing.unitLabel} a store. They have not paid yet.`
                    : 'Billing is not required.'}
                  {detail.billing?.status === 'active' && detail.billing.currentPeriodEnd && detail.billing.nextMonthlyLabel !== detail.billing.monthlyLabel && (
                    <> Next bill on {new Date(detail.billing.currentPeriodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} is {detail.billing.nextMonthlyLabel}.</>
                  )}
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Owners</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {detail.members.filter((member) => member.isAdmin).map((member) => member.email).join(', ') || 'None yet'}
                </Typography>
                {(detail.pendingOwners?.length ?? 0) > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Waiting to sign up: {detail.pendingOwners?.join(', ')}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label="Owner email"
                    value={ownerEmail}
                    onChange={(event) => setOwnerEmail(event.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <Button variant="contained" disabled={!ownerEmail.trim() || savingId === 'owner'} onClick={addOwner}>
                    {savingId === 'owner' ? <CircularProgress size={16} color="inherit" /> : 'Add owner'}
                  </Button>
                </Box>
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Stores</Typography>
                <Typography variant="body2" color="text.secondary">
                  {detail.stores.map((store) => store.name).join(', ') || 'None yet'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Invoices</Typography>
                {(detail.billing?.invoices.length ?? 0) === 0 ? (
                  <Typography variant="body2" color="text.secondary">No invoices yet.</Typography>
                ) : detail.billing?.invoices.map((invoice) => (
                  <Box key={invoice.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography sx={{ flex: 1 }} variant="body2">
                      {new Date(invoice.created * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                      {invoice.number ? ` · ${invoice.number}` : ''}
                    </Typography>
                    <Chip
                      size="small"
                      label={invoice.status === 'paid' ? 'Paid' : invoice.status === 'open' ? 'Due' : invoice.status || 'Invoice'}
                      color={invoice.status === 'paid' ? 'success' : invoice.status === 'open' ? 'warning' : 'default'}
                    />
                    <Typography variant="body2">
                      ${(((invoice.status === 'paid' ? invoice.amountPaidCents : invoice.amountDueCents) || 0) / 100).toLocaleString()}
                    </Typography>
                    {invoice.hostedUrl && (
                      <Button size="small" href={invoice.hostedUrl} target="_blank" rel="noopener noreferrer">View</Button>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          {selected && detail?.billing?.status !== 'active' && detail?.billing?.access?.mode !== 'trial' && (
            <Button onClick={startTrial} disabled={savingId === 'trial'}>
              {savingId === 'trial' ? <CircularProgress size={16} /> : 'Give a free month'}
            </Button>
          )}
          {selected && selected.billingEnabled && selected.subscriptionStatus !== 'active' && detail?.billing?.access?.mode !== 'trial' && (
            <Button variant="contained" onClick={() => chargeInStripe(selected)} disabled={savingId === selected.id}>
              Charge in Stripe
            </Button>
          )}
          {selected && detail?.billing?.status === 'active' && (
            <Button onClick={() => openBillingPortal(selected.id)} disabled={savingId === selected.id}>Card on file</Button>
          )}
          {selected && (
            <Button onClick={() => navigate(`/org-settings?org=${selected.id}`)}>Their settings</Button>
          )}
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={creating} onClose={() => setCreating(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New organization</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            autoFocus
            fullWidth
          />
          <TextField
            label="Price per store"
            type="number"
            value={newPrice}
            onChange={(event) => setNewPrice(event.target.value)}
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={newTrial} onChange={(event) => setNewTrial(event.target.checked)} />}
            label="Start with a free month"
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCreating(false)}>Cancel</Button>
          <Button variant="contained" disabled={!newName.trim() || savingId === 'new'} onClick={createOrg}>
            {savingId === 'new' ? <CircularProgress size={18} color="inherit" /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
