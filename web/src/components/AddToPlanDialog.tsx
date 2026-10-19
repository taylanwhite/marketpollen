import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client';
import { localDateKey, overlapText, shortDate, type PlanStop } from '../utils/planStops';

/** Pick a day and put one opportunity or business on your plan for it. */
export function AddToPlanDialog({
  open,
  storeId,
  target,
  onClose,
  onAdded,
}: {
  open: boolean;
  storeId: string;
  target: { name: string; opportunityId?: string; businessId?: string } | null;
  onClose: () => void;
  onAdded?: (stop: PlanStop) => void;
}) {
  const [date, setDate] = useState(() => localDateKey(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<PlanStop | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setAdded(null);
  }, [open]);

  const save = async () => {
    if (!target) return;
    setSaving(true);
    setError('');
    try {
      const stop = await api.post<PlanStop>('/plan-stops', {
        storeId,
        date,
        opportunityId: target.opportunityId,
        businessId: target.businessId,
      });
      onAdded?.(stop);
      // Stay open to show a teammate overlap; otherwise we're done.
      if (stop.overlaps.length > 0) setAdded(stop);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this to your plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add to plan</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography sx={{ fontWeight: 600 }}>{target?.name}</Typography>
        {added ? (
          <Alert severity="warning">
            Added to your plan for {shortDate(added.date)}. {overlapText(added.overlaps)}.
          </Alert>
        ) : (
          <TextField
            type="date"
            label="Day"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        {added ? (
          <Button variant="contained" onClick={onClose} sx={{ minHeight: 44 }}>OK</Button>
        ) : (
          <>
            <Button onClick={onClose} sx={{ minHeight: 44 }}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={saving || !date} sx={{ minHeight: 44 }}>
              {saving ? 'Adding…' : 'Add'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
