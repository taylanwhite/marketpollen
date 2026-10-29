import { useCallback, useEffect, useMemo, useState } from 'react';
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
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowDownward as DownIcon,
  ArrowUpward as UpIcon,
  CheckCircle as DoneIcon,
  Delete as DeleteIcon,
  Event as MoveIcon,
  MoreVert as MoreIcon,
  Route as RouteIcon,
  Search as SearchIcon,
  Sort as OptimizeIcon,
  Undo as UndoIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { Business, Opportunity } from '../types';
import { mapsLegs, overlapText, stopAddress, STOPS_PER_MAPS_LEG, type PlanStop } from '../utils/planStops';

interface PlanResponse {
  stops: PlanStop[];
  viewingUserId: string;
  editable: boolean;
  people: Array<{ id: string; name: string }>;
}

/**
 * One person's saved stops for one day. The owner can add stops from the
 * opportunity list or businesses, reorder them, mark them done, move them to
 * another day, or sort them by distance. Organization admins can open a
 * teammate's plan and assign or rearrange stops on it.
 */
export function DayRoute({
  storeId,
  date,
  storeName,
  storeAddress,
  canEdit,
  refreshKey,
  onCountChange,
}: {
  storeId: string;
  date: string;
  storeName: string;
  storeAddress: string;
  canEdit: boolean;
  refreshKey?: number;
  onCountChange?: (count: number) => void;
}) {
  const { userId } = useAuth();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewUserId, setViewUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; stop: PlanStop } | null>(null);
  const [moving, setMoving] = useState<PlanStop | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const who = viewUserId ? `&userId=${encodeURIComponent(viewUserId)}` : '';
      const data = await api.get<PlanResponse>(`/plan-stops?storeId=${storeId}&date=${date}${who}`);
      setPlan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this plan');
    } finally {
      setLoading(false);
    }
  }, [storeId, date, viewUserId]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { if (plan && !viewUserId) onCountChange?.(plan.stops.length); }, [plan, viewUserId, onCountChange]);

  const editable = canEdit && !!plan?.editable;
  const stops = plan?.stops || [];
  const plannedAddresses = stops.filter((stop) => stop.status === 'planned').map(stopAddress).filter(Boolean);
  const legs = mapsLegs(storeAddress, plannedAddresses);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const reorder = (stop: PlanStop, delta: number) => run(async () => {
    const ids = stops.map((s) => s.id);
    const from = ids.indexOf(stop.id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setPlan((prev) => prev && { ...prev, stops: ids.map((id) => prev.stops.find((s) => s.id === id)!) });
    const data = await api.put<{ stops: PlanStop[] }>('/plan-stops', { storeId, date, orderedIds: ids, userId: viewUserId || undefined });
    setPlan((prev) => prev && { ...prev, stops: data.stops });
  });

  const optimize = () => run(async () => {
    const data = await api.put<{ stops: PlanStop[] }>('/plan-stops', { storeId, date, optimize: true, userId: viewUserId || undefined });
    setPlan((prev) => prev && { ...prev, stops: data.stops });
    setNotice('Sorted by driving distance from the store.');
  });

  const setStatus = (stop: PlanStop, status: PlanStop['status']) => run(async () => {
    const updated = await api.patch<PlanStop>(`/plan-stops/${stop.id}`, { status });
    setPlan((prev) => prev && { ...prev, stops: prev.stops.map((s) => (s.id === stop.id ? updated : s)) });
  });

  const remove = (stop: PlanStop) => run(async () => {
    await api.delete(`/plan-stops/${stop.id}`);
    setPlan((prev) => prev && { ...prev, stops: prev.stops.filter((s) => s.id !== stop.id) });
  });

  const move = () => run(async () => {
    if (!moving || !moveDate) return;
    await api.patch<PlanStop>(`/plan-stops/${moving.id}`, { date: moveDate });
    setPlan((prev) => prev && { ...prev, stops: prev.stops.filter((s) => s.id !== moving.id) });
    setMoving(null);
    setNotice(`Moved ${moving.name}.`);
  });

  const viewingName = plan?.people.find((person) => person.id === plan.viewingUserId)?.name;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {plan && plan.people.length > 0 && (
        <TextField
          select
          size="small"
          label="Plan for"
          value={viewUserId}
          onChange={(event) => setViewUserId(event.target.value)}
        >
          <MenuItem value="">Me</MenuItem>
          {plan.people.filter((person) => person.id !== userId).map((person) => (
            <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
          ))}
        </TextField>
      )}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}

      {loading && !plan ? (
        <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
      ) : (
        <Paper sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.25, display: 'flex', alignItems: 'center', gap: 1 }}>
            <RouteIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {viewUserId && viewingName ? `${viewingName}'s plan · ` : ''}Start at {storeName}
            </Typography>
            {editable && stops.length > 1 && (
              <Button size="small" startIcon={<OptimizeIcon />} onClick={optimize} disabled={busy} sx={{ minHeight: 40, flexShrink: 0 }}>
                Sort by distance
              </Button>
            )}
          </Box>

          {stops.length === 0 ? (
            <Box sx={{ px: 2, py: 3, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
              <Typography color="text.secondary">
                {editable ? 'No stops planned for this day yet.' : 'Nothing planned for this day.'}
              </Typography>
            </Box>
          ) : stops.map((stop, index) => {
            const addr = stopAddress(stop);
            const finished = stop.status !== 'planned';
            return (
              <Box
                key={stop.id}
                sx={{ px: { xs: 1.5, sm: 2 }, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.25, opacity: finished ? 0.6 : 1 }}
              >
                <Box
                  sx={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8rem', fontWeight: 700,
                    bgcolor: finished ? 'success.main' : stop.businessId ? 'primary.main' : 'action.selected',
                    color: finished || stop.businessId ? 'primary.contrastText' : 'text.primary',
                  }}
                >
                  {finished ? <DoneIcon sx={{ fontSize: 18 }} /> : index + 1}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, textDecoration: stop.status === 'skipped' ? 'line-through' : 'none' }} noWrap>
                    {stop.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {stop.businessId ? 'Business' : 'Opportunity'}{addr ? ` · ${addr}` : ' · No address'}
                  </Typography>
                  {stop.assignedByName && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontStyle: 'italic' }}>
                      Assigned by {stop.assignedByName}
                    </Typography>
                  )}
                  {stop.overlaps.length > 0 && (
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      icon={<WarningIcon />}
                      label={overlapText(stop.overlaps)}
                      sx={{ mt: 0.5, maxWidth: '100%' }}
                    />
                  )}
                </Box>
                {addr && (
                  <Button
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ minHeight: 44, minWidth: 56, flexShrink: 0 }}
                  >
                    Maps
                  </Button>
                )}
                {editable && (
                  <IconButton
                    aria-label={`Change ${stop.name}`}
                    onClick={(event) => setMenu({ anchor: event.currentTarget, stop })}
                    disabled={busy}
                    sx={{ width: 44, height: 44, flexShrink: 0 }}
                  >
                    <MoreIcon />
                  </IconButton>
                )}
              </Box>
            );
          })}

          <Box sx={{ p: { xs: 1.5, sm: 2 }, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {editable && (
              <Button variant="outlined" fullWidth startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ minHeight: 48 }}>
                {viewUserId && viewingName ? `Assign stops to ${viewingName}` : 'Add stops'}
              </Button>
            )}
            {legs.map((href, index) => (
              <Button
                key={href}
                variant="contained"
                fullWidth
                startIcon={<RouteIcon />}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ minHeight: 48 }}
              >
                {legs.length === 1
                  ? 'Open route in Google Maps'
                  : `Open stops ${index * STOPS_PER_MAPS_LEG + 1}–${Math.min((index + 1) * STOPS_PER_MAPS_LEG, plannedAddresses.length)} in Google Maps`}
              </Button>
            ))}
          </Box>
        </Paper>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="up" disabled={stops[0]?.id === menu.stop.id} onClick={() => { reorder(menu.stop, -1); setMenu(null); }} sx={{ minHeight: 48 }}>
            <ListItemIcon><UpIcon fontSize="small" /></ListItemIcon>Move up
          </MenuItem>,
          <MenuItem key="down" disabled={stops[stops.length - 1]?.id === menu.stop.id} onClick={() => { reorder(menu.stop, 1); setMenu(null); }} sx={{ minHeight: 48 }}>
            <ListItemIcon><DownIcon fontSize="small" /></ListItemIcon>Move down
          </MenuItem>,
          menu.stop.status === 'planned' ? (
            <MenuItem key="done" onClick={() => { setStatus(menu.stop, 'done'); setMenu(null); }} sx={{ minHeight: 48 }}>
              <ListItemIcon><DoneIcon fontSize="small" /></ListItemIcon>Mark done
            </MenuItem>
          ) : (
            <MenuItem key="undo" onClick={() => { setStatus(menu.stop, 'planned'); setMenu(null); }} sx={{ minHeight: 48 }}>
              <ListItemIcon><UndoIcon fontSize="small" /></ListItemIcon>Not done yet
            </MenuItem>
          ),
          <MenuItem key="move" onClick={() => { setMoving(menu.stop); setMoveDate(date); setMenu(null); }} sx={{ minHeight: 48 }}>
            <ListItemIcon><MoveIcon fontSize="small" /></ListItemIcon>Move to another day
          </MenuItem>,
          <MenuItem key="remove" onClick={() => { remove(menu.stop); setMenu(null); }} sx={{ minHeight: 48, color: 'error.main' }}>
            <ListItemIcon sx={{ color: 'error.main' }}><DeleteIcon fontSize="small" /></ListItemIcon>Remove from plan
          </MenuItem>,
        ]}
      </Menu>

      <Dialog open={!!moving} onClose={() => setMoving(null)} fullWidth maxWidth="xs">
        <DialogTitle>Move {moving?.name}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            type="date"
            label="Day"
            value={moveDate}
            onChange={(event) => setMoveDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoving(null)} sx={{ minHeight: 44 }}>Cancel</Button>
          <Button variant="contained" onClick={move} disabled={busy || !moveDate || moveDate === date} sx={{ minHeight: 44 }}>Move</Button>
        </DialogActions>
      </Dialog>

      <AddStopsDialog
        open={adding}
        storeId={storeId}
        date={date}
        planned={stops}
        userId={viewUserId || undefined}
        onClose={() => setAdding(false)}
        onAdded={(stop) => setPlan((prev) => prev && { ...prev, stops: [...prev.stops, stop] })}
      />
    </Box>
  );
}

/** Pick stops for the day from the long-term opportunity list or existing businesses. */
function AddStopsDialog({
  open,
  storeId,
  date,
  planned,
  userId,
  onClose,
  onAdded,
}: {
  open: boolean;
  storeId: string;
  date: string;
  planned: PlanStop[];
  /** A teammate's plan, when an admin is assigning stops. */
  userId?: string;
  onClose: () => void;
  onAdded: (stop: PlanStop) => void;
}) {
  const [tab, setTab] = useState<'opportunities' | 'businesses'>('opportunities');
  const [search, setSearch] = useState('');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setError('');
    setWarning('');
    setLoading(true);
    Promise.all([
      api.get<Opportunity[]>(`/opportunities?storeId=${storeId}&status=new`),
      api.get<Business[]>(`/businesses?storeId=${storeId}`),
    ])
      .then(([opps, biz]) => {
        setOpportunities(opps);
        setBusinesses(biz.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load places'))
      .finally(() => setLoading(false));
  }, [open, storeId]);

  const plannedOpp = new Set(planned.map((stop) => stop.opportunityId).filter(Boolean));
  const plannedBiz = new Set(planned.map((stop) => stop.businessId).filter(Boolean));
  const term = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = tab === 'opportunities'
      ? opportunities.map((o) => ({ id: o.id, name: o.name, address: stopAddress(o), opportunityId: o.id, businessId: undefined as string | undefined }))
      : businesses.map((b) => ({ id: b.id, name: b.name, address: stopAddress(b), opportunityId: undefined as string | undefined, businessId: b.id }));
    return term ? list.filter((row) => `${row.name} ${row.address}`.toLowerCase().includes(term)) : list;
  }, [tab, opportunities, businesses, term]);

  const add = async (row: { id: string; name: string; opportunityId?: string; businessId?: string }) => {
    setSavingId(row.id);
    setError('');
    setWarning('');
    try {
      const stop = await api.post<PlanStop>('/plan-stops', { storeId, date, opportunityId: row.opportunityId, businessId: row.businessId, userId });
      onAdded(stop);
      if (stop.overlaps.length > 0) setWarning(`${row.name}: ${overlapText(stop.overlaps)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this stop');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 0 }}>Add stops</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
        <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="fullWidth">
          <Tab value="opportunities" label={`Opportunities (${opportunities.length})`} />
          <Tab value="businesses" label={`Businesses (${businesses.length})`} />
        </Tabs>
        <TextField
          size="small"
          placeholder="Search name or address"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        {warning && <Alert severity="warning" onClose={() => setWarning('')}>{warning}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        {loading ? (
          <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            {term ? 'Nothing matches that search.' : tab === 'opportunities' ? 'No opportunities saved yet. Find some on the Discover page.' : 'No businesses yet.'}
          </Typography>
        ) : (
          <Box sx={{ maxHeight: 420, overflowY: 'auto', mx: -1 }}>
            {rows.map((row) => {
              const onPlan = row.opportunityId ? plannedOpp.has(row.opportunityId) : plannedBiz.has(row.businessId!);
              return (
                <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{row.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {row.address || 'No address'}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant={onPlan ? 'text' : 'outlined'}
                    disabled={onPlan || savingId === row.id}
                    onClick={() => add(row)}
                    sx={{ minHeight: 40, flexShrink: 0 }}
                  >
                    {onPlan ? 'Added' : savingId === row.id ? 'Adding…' : 'Add'}
                  </Button>
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose} sx={{ minHeight: 44 }}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
