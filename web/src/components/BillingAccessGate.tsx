import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { OrgAccessMode } from '../types';
import { money, processingFeeCents } from '../../handlers/lib/billing-copy';
import {
  Alert,
  Box,
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
  // The trial-ended popup can be put away; the org stays locked on the server, so a banner stays.
  const [dismissedOrgId, setDismissedOrgId] = useState<string | null>(null);
  const [unitCents, setUnitCents] = useState<number | null>(null);
  const trialEnded = access?.mode === 'trial_ended';

  // Admins see what it will cost before they go to Stripe.
  useEffect(() => {
    setUnitCents(null);
    if (!trialEnded || !canPay || isGlobalAdmin || !orgId) return;
    let cancelled = false;
    api.get<{ unitCents?: number }>(`/organizations/${orgId}/billing`)
      .then((billing) => { if (!cancelled && typeof billing.unitCents === 'number') setUnitCents(billing.unitCents); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [trialEnded, canPay, isGlobalAdmin, orgId]);

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

  if (access.mode === 'trial_ended') {
    const stores = Math.max(storeCount, 1);
    // Same total as checkout (price per store plus the processing fee per store), shown as one price.
    const priceLine = unitCents === null
      ? null
      : `${money((unitCents + processingFeeCents(unitCents)) * stores)} a month for ${stores} ${stores === 1 ? 'store' : 'stores'}.`;
    const bannerText = isGlobalAdmin
      ? `Free trial ended for ${name}.`
      : 'Your free trial has ended.';
    const addCardButton = (
      <Button
        variant="contained"
        onClick={pay}
        disabled={busy}
        sx={{ bgcolor: '#f5c842', color: '#2d2d2d', fontWeight: 700, minHeight: 44, '&:hover': { bgcolor: '#e8b923' } }}
      >
        {busy ? <CircularProgress size={18} color="inherit" /> : 'Add a card'}
      </Button>
    );

    if (isGlobalAdmin || variant === 'banner' || dismissedOrgId === (orgId ?? '')) {
      return (
        <Alert
          severity="info"
          sx={{ mb: 2, alignItems: 'center', '& .MuiAlert-action': { pt: 0 } }}
          action={canPay && !isGlobalAdmin ? (
            <Button color="inherit" size="small" onClick={pay} disabled={busy} sx={{ whiteSpace: 'nowrap' }}>
              {busy ? <CircularProgress size={16} color="inherit" /> : 'Add a card'}
            </Button>
          ) : undefined}
        >
          {bannerText}
          {error && <Box component="span" sx={{ display: 'block', color: 'error.main', mt: 0.5 }}>{error}</Box>}
        </Alert>
      );
    }

    return (
      <Dialog open onClose={() => setDismissedOrgId(orgId ?? '')} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Your free trial has ended</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Thanks for trying MarketPollen with {name}. Everything you added is saved: contacts, visits, bites and plans.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {canPay
              ? 'Add a card to keep saving and pick up right where you left off.'
              : `Saving is paused until an admin of ${name} adds a card.`}
          </Typography>
          {canPay && priceLine && (
            <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 600 }}>{priceLine}</Typography>
          )}
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexDirection: 'column', alignItems: 'stretch', gap: 1, '& > :not(style) ~ :not(style)': { ml: 0 } }}>
          {canPay && addCardButton}
          {canSwitch && (
            <Button onClick={() => navigate('/select-store')}>Switch organization</Button>
          )}
          <Button color="inherit" onClick={() => setDismissedOrgId(orgId ?? '')}>
            {canPay ? 'Not now' : 'OK'}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  const title = 'Insufficient payment';
  const body = `The card for ${name} didn’t go through, and the 7 days to fix it have passed.`;

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

