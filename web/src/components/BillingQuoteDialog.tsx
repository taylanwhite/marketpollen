import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  Typography,
} from '@mui/material';

export interface BillingQuote {
  intent: 'add_store' | 'resume_store' | 'pause_store' | 'keep_open' | 'delete_store' | 'archive_store';
  needsCharge: boolean;
  needsCheckout: boolean;
  message: string;
  dueTodayCents: number;
  currentMonthlyCents?: number;
  newMonthlyCents?: number;
  periodEnd?: string | null;
  storeName?: string;
  unitCents?: number;
  orgName?: string;
  card?: { brand: string; last4: string; expMonth: number; expYear: number } | null;
}

const TITLES: Record<BillingQuote['intent'], string> = {
  add_store: 'Add a store',
  resume_store: 'Turn this store back on?',
  pause_store: 'Pause this store?',
  keep_open: 'Keep this store open?',
  delete_store: 'Remove this store?',
  archive_store: 'Archive this store?',
};

function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function brandName(brand: string): string {
  const names: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
    diners: 'Diners Club',
    jcb: 'JCB',
    unionpay: 'UnionPay',
  };
  return names[brand] || brand.replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function confirmLabel(quote: BillingQuote): string {
  if (quote.intent === 'delete_store') return 'Remove store';
  if (quote.intent === 'archive_store') return 'Archive store';
  if (quote.intent === 'pause_store') return 'Pause store';
  if (quote.intent === 'keep_open') return 'Keep it open';
  if (quote.needsCharge && quote.dueTodayCents > 0) return `Charge ${money(quote.dueTodayCents)}`;
  if (quote.intent === 'resume_store') return 'Turn it back on';
  if (quote.intent === 'add_store') return 'Add store';
  return 'Continue';
}

function InvoiceRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75 }}>
      <Typography variant="body2" color={strong ? 'text.primary' : 'text.secondary'} sx={{ fontWeight: strong ? 600 : 400 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 700 : 500, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
        {value}
      </Typography>
    </Box>
  );
}

function AddStoreInvoice({ quote }: { quote: BillingQuote }) {
  const unit = quote.unitCents ?? 0;
  const due = quote.dueTodayCents;
  const current = quote.currentMonthlyCents ?? 0;
  const next = quote.newMonthlyCents ?? unit;
  const renews = formatDate(quote.periodEnd);
  const hasSubscription = current > 0;
  const prorated = hasSubscription && due > 0 && due !== unit;
  const trial = !hasSubscription && due === 0 && !!renews && next > 0 && !quote.needsCharge;
  const included = hasSubscription && due === 0 && next === current;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.4, lineHeight: 1.2 }}>
            Invoice
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {quote.orgName || 'Organization'}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </Typography>
      </Box>

      <Box sx={{ border: '1px solid', borderColor: 'grey.300', borderRadius: 1, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.25, bgcolor: 'grey.50', display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Description
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Amount
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ px: 2, py: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{quote.storeName || 'Store'}</Typography>
              <Typography variant="body2" color="text.secondary">
                Store subscription
              </Typography>
            </Box>
            <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {money(unit)} / month
            </Typography>
          </Box>
          {hasSubscription && next !== current && (
            <Box sx={{ mt: 1.5 }}>
              <InvoiceRow label="Current subscription" value={`${money(current)} / month`} />
              <InvoiceRow label="Subscription after today" value={`${money(next)} / month`} strong />
            </Box>
          )}
          {prorated && renews && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Today’s charge covers the rest of the current period, through {renews}.
            </Typography>
          )}
          {included && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              This store is already covered by the subscription. Nothing is charged today.
            </Typography>
          )}
          {trial && renews && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              No charge today. {money(unit)} a month begins {renews}.
            </Typography>
          )}
        </Box>
        <Divider />
        <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', bgcolor: 'grey.50' }}>
          <Typography sx={{ fontWeight: 700 }}>Due today</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {money(due)}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ mt: 2, px: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
          Charged to
        </Typography>
        {quote.card ? (
          <Typography sx={{ mt: 0.5, fontWeight: 600 }}>
            {brandName(quote.card.brand)} ending in {quote.card.last4}
            <Typography component="span" variant="body2" color="text.secondary">
              {` · expires ${quote.card.expMonth}/${quote.card.expYear}`}
            </Typography>
          </Typography>
        ) : (
          <Typography sx={{ mt: 0.5 }} color="text.secondary">
            No card on file.
          </Typography>
        )}
      </Box>
    </Box>
  );
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
  const invoice = quote?.intent === 'add_store' && quote.unitCents != null;
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      {!invoice && (
        <Box sx={{ px: 3, pt: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{quote ? TITLES[quote.intent] : ''}</Typography>
        </Box>
      )}
      <DialogContent sx={{ pt: invoice ? 3 : 1.5 }}>
        {invoice && quote ? <AddStoreInvoice quote={quote} /> : (
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{quote?.message}</Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading} sx={{ color: 'text.secondary' }}>Cancel</Button>
        {quote?.needsCheckout && onSetupBilling && (
          <Button variant="contained" onClick={onSetupBilling} disabled={loading}>
            Add a card
          </Button>
        )}
        {quote && !quote.needsCheckout && (
          <Button
            variant="contained"
            onClick={onConfirm}
            disabled={loading}
            color={quote.intent === 'delete_store' ? 'error' : 'primary'}
            sx={{ minWidth: 140 }}
          >
            {loading ? <CircularProgress size={18} color="inherit" /> : confirmLabel(quote)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
