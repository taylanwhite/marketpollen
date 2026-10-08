import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { OrgAccessMode } from '../types';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

interface AccessState {
  mode: OrgAccessMode;
  daysLeft: number | null;
}

interface BillingAccessGateProps {
  access?: AccessState | null;
  orgId?: string;
  orgName?: string;
  canPay: boolean;
  isGlobalAdmin: boolean;
  storeCount: number;
  canSwitch: boolean;
  variant?: 'modal' | 'banner';
}

export function BillingAccessGate({
  access,
  orgId,
  orgName,
  canPay,
  isGlobalAdmin,
  storeCount,
  canSwitch,
  variant = 'modal',
}: BillingAccessGateProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!access || access.mode === 'open') return null;

  const name = orgName || 'this organization';
  const days = access.daysLeft ?? 0;
  const dayLabel = `${days} day${days === 1 ? '' : 's'}`;

  const pay = async () => {
    if (!orgId) return;
    setBusy(true);
    setError('');
    try {
      const quantity = Math.max(storeCount, 1);
      const first = access.mode === 'payment_locked' ? 'portal' : 'checkout';
      try {
        const result = await api.post<{ url: string }>(`/organizations/${orgId}/billing`, { action: first, quantity });
        window.location.href = result.url;
      } catch (err) {
        if (first !== 'portal') throw err;
        const result = await api.post<{ url: string }>(`/organizations/${orgId}/billing`, { action: 'checkout', quantity });
        window.location.href = result.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open payment');
      setBusy(false);
    }
  };

  if (access.mode === 'trial') {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Free trial · {dayLabel} left
      </Alert>
    );
  }

  if (access.mode === 'grace') {
    return (
      <Alert
        severity="warning"
        sx={{ mb: 2 }}
        action={canPay ? (
          <Button color="inherit" size="small" onClick={pay} disabled={busy}>
            {busy ? <CircularProgress size={16} color="inherit" /> : 'Update card'}
          </Button>
        ) : undefined}
      >
        A payment didn’t go through. {canPay ? `You have ${dayLabel} to update the card.` : `The owner has ${dayLabel} to update the card.`}
      </Alert>
    );
  }

  const title = access.mode === 'trial_ended' ? 'Trial is done, please pay' : 'Insufficient payment';
  const body = access.mode === 'trial_ended'
    ? `The free month for ${name} is over.`
    : `The card for ${name} didn’t go through, and the 7 days to fix it have passed.`;

  if (isGlobalAdmin || variant === 'banner') {
    return (
      <Alert severity="warning" sx={{ mb: 2 }} action={canPay && !isGlobalAdmin ? (
        <Button color="inherit" size="small" onClick={pay} disabled={busy}>Pay</Button>
      ) : undefined}>
        {title}. {body}
      </Alert>
    );
  }

  return (
    <Dialog open disableEscapeKeyDown maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {body} {canPay ? 'Pay to keep using Market Pollen.' : `Ask the owner of ${name} to take care of this.`}
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
        {canPay && (
          <Button
            variant="contained"
            onClick={pay}
            disabled={busy}
            sx={{ bgcolor: '#f5c842', color: '#2d2d2d', fontWeight: 700, '&:hover': { bgcolor: '#e8b923' } }}
          >
            {busy ? <CircularProgress size={18} color="inherit" /> : 'Pay'}
          </Button>
        )}
        {canSwitch && (
          <Button onClick={() => navigate('/select-store')}>Switch organization</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
