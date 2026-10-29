import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { localDateKey, overlapText, shortDate, type PlanStop } from '../utils/planStops';

type Person = { id: string; name: string };

/**
 * Pick a day and put one opportunity or business on a plan for it. Organization
 * admins can also pick whose plan, to assign the visit to a marketer.
 */
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
  const { userId } = useAuth();
  const [date, setDate] = useState(() => localDateKey(new Date()));
  const [people, setPeople] = useState<Person[]>([]);
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<PlanStop | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setAdded(null);
  }, [open]);

  // Only admins get a list back; everyone else plans for themselves.
  useEffect(() => {
    if (!open || !storeId) return;
    let cancelled = false;
    api.get<{ canAssign: boolean; people: Person[] }>(`/plan-stops?storeId=${storeId}&people=1`)
      .then((data) => { if (!cancelled) setPeople(data.canAssign ? data.people : []); })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, [open, storeId]);

  const others = people.filter((person) => person.id !== userId);
  const assigneeName = others.find((person) => person.id === assignee)?.name;

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
        userId: assignee || undefined,
      });
      onAdded?.(stop);
      // Stay open to confirm an assignment or show a teammate overlap.
      if (stop.overlaps.length > 0 || assignee) setAdded(stop);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this to the plan');
    } finally {
      setSaving(false);
    }
  };

  const whosePlan = assigneeName ? `${assigneeName}'s plan` : 'your plan';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{others.length > 0 ? 'Add to plan or assign' : 'Add to plan'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography sx={{ fontWeight: 600 }}>{target?.name}</Typography>
        {added ? (
          <Alert severity={added.overlaps.length > 0 ? 'warning' : 'success'}>
            Added to {whosePlan} for {shortDate(added.date)}.
            {added.overlaps.length > 0 ? ` ${overlapText(added.overlaps)}.` : ''}
          </Alert>
        ) : (
          <>
            {others.length > 0 && (
              <TextField
                select
                label="For"
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                fullWidth
                helperText={assignee ? 'It will show on their plan for that day.' : undefined}
              >
                <MenuItem value="">Me</MenuItem>
                {others.map((person) => (
                  <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              type="date"
              label="Day"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </>
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
              {saving ? 'Saving…' : assignee ? 'Assign' : 'Add'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
