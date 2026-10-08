import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

export interface BillingQuote {
  intent: 'add_store' | 'resume_store' | 'pause_store' | 'keep_open' | 'delete_store';
  needsCharge: boolean;
  needsCheckout: boolean;
  message: string;
  dueTodayCents: number;
}

const TITLES: Record<BillingQuote['intent'], string> = {
  add_store: 'Add this store?',
  resume_store: 'Turn this store back on?',
  pause_store: 'Pause this store?',
  keep_open: 'Keep this store open?',
  delete_store: 'Remove this store?',
};

function confirmLabel(quote: BillingQuote): string {
  if (quote.intent === 'delete_store') return 'Remove store';
  if (quote.intent === 'pause_store') return 'Pause store';
  if (quote.intent === 'keep_open') return 'Keep it open';
  if (quote.needsCharge && quote.intent === 'resume_store') return 'Turn it back on';
  if (quote.needsCharge) return 'Add store';
  if (quote.intent === 'resume_store') return 'Turn it back on';
  return 'Continue';
}

export function BillingQuoteDialog({
  quote,
  open,
  loading,
  onClose,
  onConfirm,
  onSetupBilling,
}: {
  quote: BillingQuote | null;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSetupBilling?: () => void;
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{quote ? TITLES[quote.intent] : ''}</DialogTitle>
      <DialogContent>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{quote?.message}</Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        {quote?.needsCheckout && onSetupBilling && (
          <Button variant="contained" onClick={onSetupBilling} disabled={loading}>
            Set up the monthly bill
          </Button>
        )}
        {quote && !quote.needsCheckout && (
          <Button variant="contained" onClick={onConfirm} disabled={loading} color={quote.intent === 'delete_store' ? 'error' : 'primary'}>
            {loading ? <CircularProgress size={18} color="inherit" /> : confirmLabel(quote)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
