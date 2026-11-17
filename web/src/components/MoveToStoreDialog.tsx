import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { api } from '../api/client';
import { useMoveTargets } from '../hooks/useMoveTargets';

/** contactCount: contacts whose main business it is (they move with it); leave out when not known. */
export type MovableBusiness = { id: string; name: string; contactCount?: number };

type MoveResult = { businessId: string; storeName: string; contacts: number; unlinked: number; planStops: number };

interface MoveToStoreDialogProps {
  open: boolean;
  onClose: () => void;
  /** The store the businesses are in now. */
  sourceStoreId: string;
  /** Businesses that can be picked (all in the source store). */
  businesses: MovableBusiness[];
  /** Ticked when the dialog opens. */
  initialSelected?: string[];
  /** Show only the ticked businesses, without the list to pick more (e.g. from one contact). */
  fixedSelection?: boolean;
  onMoved: (summary: string, movedIds: string[]) => void;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function MoveToStoreDialog({
  open,
  onClose,
  sourceStoreId,
  businesses,
  initialSelected = [],
  fixedSelection = false,
  onMoved,
}: MoveToStoreDialogProps) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const targets = useMoveTargets(sourceStoreId);
  const [storeId, setStoreId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialSelected));
    setStoreId(targets.length === 1 ? targets[0].id : '');
    setSearch('');
    setProgress(null);
    setError('');
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? businesses.filter((b) => b.name.toLowerCase().includes(q)) : businesses;
  }, [businesses, search]);

  const picked = businesses.filter((b) => selected.has(b.id));
  const countsKnown = picked.every((b) => b.contactCount !== undefined);
  const contactTotal = picked.reduce((sum, b) => sum + (b.contactCount ?? 0), 0);
  const allShownTicked = shown.length > 0 && shown.every((b) => selected.has(b.id));
  const busy = progress !== null;
  const targetName = targets.find((t) => t.id === storeId)?.name || '';

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllShown = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of shown) {
        if (allShownTicked) next.delete(b.id);
        else next.add(b.id);
      }
      return next;
    });
  };

  const move = async () => {
    if (!storeId || picked.length === 0) return;
    setError('');
    setProgress({ done: 0, total: picked.length });
    const moved: MoveResult[] = [];
    const failed: string[] = [];
    // One at a time, so a failure part way leaves the rest untouched and is easy to retry.
    for (const business of picked) {
      try {
        moved.push(await api.post<MoveResult>(`/businesses/${business.id}`, { action: 'move', storeId }));
      } catch (err) {
        failed.push(`${business.name}: ${err instanceof Error ? err.message : 'could not move'}`);
      }
      setProgress({ done: moved.length + failed.length, total: picked.length });
    }
    const movedIds = moved.map((m) => m.businessId);
    if (moved.length) {
      const contacts = moved.reduce((sum, m) => sum + m.contacts, 0);
      const unlinked = moved.reduce((sum, m) => sum + m.unlinked, 0);
      let summary = `Moved ${plural(moved.length, 'business', 'businesses')} and ${plural(contacts, 'contact')} to ${targetName}.`;
      if (unlinked) summary += ` ${plural(unlinked, 'extra business link')} between the two stores ${unlinked === 1 ? 'was' : 'were'} removed.`;
      onMoved(summary, movedIds);
    }
    if (failed.length) {
      setSelected(new Set(picked.filter((b) => !movedIds.includes(b.id)).map((b) => b.id)));
      setError(`Some couldn't be moved. ${failed.join('. ')}`);
      setProgress(null);
      return;
    }
    onClose();
  };

  const businessWord = picked.length === 1 ? 'business' : 'businesses';

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullScreen={phone} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Move to another store</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {targets.length === 0 ? (
          <Alert severity="info">
            You need edit access to another store in this organization to move businesses there.
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {fixedSelection && picked.length === 1
                ? 'The business moves with all its contacts, their visits, files and follow-ups, and upcoming plan stops.'
                : 'Each business moves with its contacts, their visits, files and follow-ups, and upcoming plan stops.'}
            </Typography>
            <TextField
              select
              label="Move to"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              disabled={busy}
              fullWidth
            >
              {targets.map((store) => (
                <MenuItem key={store.id} value={store.id} sx={{ minHeight: 44 }}>{store.name}</MenuItem>
              ))}
            </TextField>

            {fixedSelection ? (
              <Box>
                {picked.map((b) => (
                  <Typography key={b.id} sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {b.name}
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
                      {b.contactCount === undefined ? ' and all its contacts' : ` · ${plural(b.contactCount, 'contact')}`}
                    </Typography>
                  </Typography>
                ))}
              </Box>
            ) : (
              <Box>
                <TextField
                  placeholder="Search businesses"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  size="small"
                  fullWidth
                  disabled={busy}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                    ),
                  }}
                />
                <FormControlLabel
                  sx={{ mt: 1, ml: 0, minHeight: 44 }}
                  control={
                    <Checkbox
                      checked={allShownTicked}
                      indeterminate={!allShownTicked && shown.some((b) => selected.has(b.id))}
                      onChange={toggleAllShown}
                      disabled={busy || shown.length === 0}
                    />
                  }
                  label={search.trim() ? `Select all ${shown.length} shown` : `Select all ${shown.length}`}
                />
                <List
                  dense
                  disablePadding
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    maxHeight: { xs: 'none', sm: 320 },
                    overflowY: 'auto',
                  }}
                >
                  {shown.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No businesses match.</Typography>
                  )}
                  {shown.map((b) => (
                    <ListItemButton key={b.id} onClick={() => toggle(b.id)} disabled={busy} sx={{ minHeight: 48 }}>
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <Checkbox edge="start" checked={selected.has(b.id)} tabIndex={-1} disableRipple />
                      </ListItemIcon>
                      <ListItemText
                        primary={b.name}
                        secondary={b.contactCount === undefined ? undefined : plural(b.contactCount, 'contact')}
                        primaryTypographyProps={{ sx: { overflowWrap: 'anywhere' } }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}

            {busy && (
              <Box>
                <LinearProgress variant="determinate" value={(progress.done / progress.total) * 100} />
                <Typography variant="caption" color="text.secondary">
                  Moving {Math.min(progress.done + 1, progress.total)} of {progress.total}…
                </Typography>
              </Box>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>Cancel</Button>
        {targets.length > 0 && (
          <Button
            variant="contained"
            onClick={move}
            disabled={busy || !storeId || picked.length === 0}
            sx={{ minHeight: 44 }}
          >
            {picked.length === 0 || (fixedSelection && picked.length === 1)
              ? `Move${targetName ? ` to ${targetName}` : ''}`
              : `Move ${picked.length} ${businessWord}${countsKnown ? ` (${plural(contactTotal, 'contact')})` : ''}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
