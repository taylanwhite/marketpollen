import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Opportunity } from '../types';
import { AddressPicker } from '../components/AddressPicker';
import { DismissOpportunityModal } from '../components/DismissOpportunityModal';
import { OnlineOnlyNotice } from '../components/OnlineOnlyNotice';
import { FilterTypeDialog } from '../components/FilterTypeDialog';
import { useOffline } from '../contexts/OfflineContext';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  List,
  ListItem,
  IconButton,
  Divider,
  TextField,
  Tabs,
  Tab,
  FormControlLabel,
  Switch,
  Tooltip,
  InputAdornment,
  Stack,
  Chip,
  Collapse,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import {
  Explore as ExploreIcon,
  Add as AddIcon,
  CheckCircle as ConvertIcon,
  Cancel as DismissIcon,
  Place as PlaceIcon,
  Restore as RestoreIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Tune as MoreFiltersIcon,
} from '@mui/icons-material';

interface NearbyPlace {
  placeId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  distanceM?: number;
}

/**
 * Common bakery prospect types, surfaced as quick-tap chips on the Generate
 * tab. These are the categories that historically convert best for our
 * marketers: anywhere with regular client-appreciation, employee-treat, or
 * event budgets. Order matters — most-tapped first. Keep the labels short
 * so chip rows stay clean on narrow screens.
 *
 * The string is sent verbatim as the Google Places `textQuery`, so phrasing
 * matters: "Real estate office" pulls realtor branches; "Real estate" alone
 * also pulls listings, which we don't want.
 */
const QUICK_TYPE_FILTERS = [
  'Real estate office',
  'Law firm',
  'Event venue',
  'Hospital',
  'School',
  'Bank',
  'Salon',
  'Dentist',
] as const;

function formatDistance(meters?: number): string {
  if (meters == null) return '';
  const miles = meters / 1609.34;
  if (miles < 0.1) {
    const feet = Math.round(meters * 3.28084);
    return `${feet} ft`;
  }
  return `${miles.toFixed(1)} mi`;
}

/**
 * Build the searchable haystack for an opportunity once and cache it on the
 * memoized derived list. Lower-cased so the predicate is a single substring
 * test per item.
 */
function haystack(opp: Opportunity): string {
  return [
    opp.name,
    opp.address,
    opp.city,
    opp.state,
    opp.zipCode,
    opp.dismissedReason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function Opportunities() {
  const navigate = useNavigate();
  const { permissions, canEdit } = usePermissions();
  const { isOnline } = useOffline();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [storeAddress, setStoreAddress] = useState('');
  // Structured store address kept separately so we can offer a "Use my
  // store address" reset action without re-fetching.
  const [storeAddressParts, setStoreAddressParts] = useState<{ address: string; city: string; state: string; zipCode: string }>({
    address: '',
    city: '',
    state: '',
    zipCode: '',
  });
  const [searchAddress, setSearchAddress] = useState('');
  const [searchCity, setSearchCity] = useState('');
  const [searchState, setSearchState] = useState('');
  const [searchZipCode, setSearchZipCode] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  // Google Places paginates with an opaque token. Empty string means "no
  // more pages" (server omits it in the response). We track it so the
  // infinite-scroll sentinel can trigger the next fetch with the right token.
  const [nearbyPageToken, setNearbyPageToken] = useState<string>('');
  const [loadingNearbyMore, setLoadingNearbyMore] = useState(false);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(new Set());
  const [loadingStore, setLoadingStore] = useState(true);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [loadingOpportunities, setLoadingOpportunities] = useState(true);
  const [adding, setAdding] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissedOpportunities, setDismissedOpportunities] = useState<Opportunity[]>([]);
  const [dismissModalOpen, setDismissModalOpen] = useState(false);
  const [opportunityToDismiss, setOpportunityToDismiss] = useState<Opportunity | null>(null);

  // Mobile-first search: starts as a magnifying-glass icon and expands into
  // a full text field on tap. On desktop we open it the same way to keep
  // the UI consistent and uncluttered.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Generate tab: keep the address picker hidden by default and just show
  // the store address with a "Change" link. 95% of the time marketers want
  // "find places near my store" — there's no reason to make them stare at
  // an empty Google Places autocomplete first.
  const [addressEditOpen, setAddressEditOpen] = useState(false);
  // "More…" filter directory dialog. Houses the long-tail of business
  // types so the inline quick-tap chips stay short and focused.
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);

  const storeId = permissions.currentStoreId;

  useEffect(() => {
    if (!storeId) {
      setOpportunities([]);
      setDismissedOpportunities([]);
      setLoadingOpportunities(false);
      setLoadingStore(false);
      return;
    }
    loadStoreAddress();
    loadOpportunities();
    loadDismissedOpportunities();
  }, [storeId]);

  const loadStoreAddress = async () => {
    if (!storeId) return;
    try {
      setLoadingStore(true);
      const store = await api.get<{ address?: string; city?: string; state?: string; zipCode?: string }>(`/stores/${storeId}`);
      const partsArr = [store.address, store.city, store.state, store.zipCode].filter(Boolean);
      setStoreAddress(partsArr.join(', ') || '');
      const parts = {
        address: store.address || '',
        city: store.city || '',
        state: store.state || '',
        zipCode: store.zipCode || '',
      };
      setStoreAddressParts(parts);
      if (!searchAddress && !searchCity && !searchState && !searchZipCode) {
        setSearchAddress(parts.address);
        setSearchCity(parts.city);
        setSearchState(parts.state);
        setSearchZipCode(parts.zipCode);
      }
    } catch (e) {
      console.error('Load store:', e);
    } finally {
      setLoadingStore(false);
    }
  };

  const useStoreAddress = () => {
    setSearchAddress(storeAddressParts.address);
    setSearchCity(storeAddressParts.city);
    setSearchState(storeAddressParts.state);
    setSearchZipCode(storeAddressParts.zipCode);
    setAddressEditOpen(false);
  };

  // Compact, human-readable summary of "where we'll search" for the default
  // collapsed UI. Prefers city/state, falls back to street.
  const searchAroundLabel = (() => {
    const cityState = [searchCity, searchState].filter(Boolean).join(', ');
    if (cityState && searchZipCode) return `${cityState} ${searchZipCode}`;
    if (cityState) return cityState;
    return searchAddress || 'No address set';
  })();
  const isUsingStoreAddress =
    searchAddress === storeAddressParts.address &&
    searchCity === storeAddressParts.city &&
    searchState === storeAddressParts.state &&
    searchZipCode === storeAddressParts.zipCode;

  const loadOpportunities = async () => {
    if (!storeId) return;
    try {
      setLoadingOpportunities(true);
      const list = await api.get<Opportunity[]>(`/opportunities?storeId=${storeId}&status=new`);
      setOpportunities(list.map(o => ({
        ...o,
        createdAt: o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt),
      })));
    } catch (e) {
      console.error('Load opportunities:', e);
      setOpportunities([]);
    } finally {
      setLoadingOpportunities(false);
    }
  };

  const loadDismissedOpportunities = async () => {
    if (!storeId) return;
    try {
      const list = await api.get<Opportunity[]>(`/opportunities?storeId=${storeId}&status=dismissed`);
      setDismissedOpportunities(list.map(o => ({
        ...o,
        createdAt: o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt),
        dismissedAt: o.dismissedAt ? new Date(o.dismissedAt) : undefined,
      })));
    } catch (e) {
      console.error('Load dismissed opportunities:', e);
      setDismissedOpportunities([]);
    }
  };

  const buildAddressString = () => {
    const parts = [searchAddress, searchCity, searchState, searchZipCode].filter(Boolean);
    return parts.join(', ');
  };

  /**
   * Wipe the active discovery query and surface the filter UI again. Called
   * from the pinned "Reset Search" button that takes over the spot held by
   * the filter input + Find button while results are visible. Keeps the
   * search address (and "search around X" pill) intact — marketers almost
   * always want to keep searching near the same place, just with a
   * different category filter.
   */
  const handleResetSearch = () => {
    setTextQuery('');
    setNearbyPlaces([]);
    setNearbyPageToken('');
    setSelectedPlaceIds(new Set());
    setError('');
    setSuccess('');
  };

  /**
   * Fire a fresh nearby-business search.
   *
   * `overrideTextQuery` is critical for chip/dialog auto-fire flows: those
   * call `setTextQuery(preset)` immediately followed by `handleFindNearby()`,
   * but React hasn't re-rendered yet so the function still sees the OLD
   * `textQuery` from its closure. Passing the value in directly bypasses
   * the closure entirely. Pass `''` to explicitly mean "no filter".
   * Pass `undefined` (the default) when the user is using the textfield's
   * Find button, in which case the closure's `textQuery` is correct.
   */
  const handleFindNearby = async (overrideTextQuery?: string) => {
    if (!storeId) return;
    const address = buildAddressString();
    if (!address.trim()) {
      setError('Enter an address or use the store address above');
      return;
    }
    setError('');
    setSuccess('');
    setLoadingNearby(true);
    // Reset pagination state on a fresh search — any existing token belongs
    // to a different query and Google would reject it.
    setNearbyPlaces([]);
    setNearbyPageToken('');
    setSelectedPlaceIds(new Set());
    const effectiveQuery = (overrideTextQuery !== undefined ? overrideTextQuery : textQuery).trim();
    try {
      const payload: { storeId: string; address: string; textQuery?: string } = { storeId, address: address.trim() };
      if (effectiveQuery) payload.textQuery = effectiveQuery;
      const res = await api.post<{ places: NearbyPlace[]; nextPageToken?: string }>('/places-nearby', payload);
      setNearbyPlaces(res.places || []);
      setNearbyPageToken(res.nextPageToken || '');
      if (!res.places?.length) setSuccess('No new nearby places found (existing businesses and opportunities are excluded).');
    } catch (err: any) {
      setError(err.message || 'Failed to find nearby places');
    } finally {
      setLoadingNearby(false);
    }
  };

  /**
   * Fetch the next page of Google Places results using the opaque token
   * from the previous response. Appends to the existing list rather than
   * replacing it (infinite scroll behavior). De-duplicates by placeId
   * so the rare server-side duplicate (existed-set race between pages)
   * doesn't double-render.
   */
  const handleLoadMoreNearby = useCallback(async () => {
    if (!storeId || !nearbyPageToken || loadingNearbyMore || loadingNearby) return;
    // Inline so useCallback's deps stay stable — buildAddressString is a
    // fresh closure every render and would defeat the memoization.
    const address = [searchAddress, searchCity, searchState, searchZipCode]
      .filter(Boolean)
      .join(', ')
      .trim();
    if (!address) return;
    setLoadingNearbyMore(true);
    try {
      const payload: { storeId: string; address: string; textQuery?: string; pageToken: string } = {
        storeId,
        address,
        pageToken: nearbyPageToken,
      };
      if (textQuery.trim()) payload.textQuery = textQuery.trim();
      const res = await api.post<{ places: NearbyPlace[]; nextPageToken?: string }>('/places-nearby', payload);
      const incoming = res.places || [];
      setNearbyPlaces((prev) => {
        const seen = new Set(prev.map((p) => p.placeId));
        return [...prev, ...incoming.filter((p) => !seen.has(p.placeId))];
      });
      setNearbyPageToken(res.nextPageToken || '');
    } catch (err: any) {
      // Stop trying — clear the token so the sentinel disconnects and the
      // marketer doesn't see repeated failures from the same dead token.
      setNearbyPageToken('');
      setError(err.message || 'Failed to load more places');
    } finally {
      setLoadingNearbyMore(false);
    }
  }, [storeId, nearbyPageToken, loadingNearbyMore, loadingNearby, textQuery, searchAddress, searchCity, searchState, searchZipCode]);

  // Sentinel for the Generate-tab nearby places list. When it scrolls into
  // view we fetch the next page from Google.
  const { sentinelRef: nearbySentinelRef } = useInfiniteScroll({
    onLoadMore: handleLoadMoreNearby,
    hasMore: !!nearbyPageToken,
    loading: loadingNearbyMore,
  });

  const togglePlaceSelection = (placeId: string) => {
    setSelectedPlaceIds(prev => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  };

  const handleAddAsOpportunities = async () => {
    if (!storeId || selectedPlaceIds.size === 0) return;
    setError('');
    setAdding(true);
    try {
      const toAdd = nearbyPlaces.filter(p => selectedPlaceIds.has(p.placeId));
      await api.post('/opportunities', {
        storeId,
        opportunities: toAdd.map(p => ({
          placeId: p.placeId,
          name: p.name,
          address: p.address,
          city: p.city,
          state: p.state,
          zipCode: p.zipCode,
        })),
      });
      setSuccess(`Added ${toAdd.length} opportunity(ies).`);
      setNearbyPlaces(prev => prev.filter(p => !selectedPlaceIds.has(p.placeId)));
      setSelectedPlaceIds(new Set());
      await loadOpportunities();
    } catch (err: any) {
      setError(err.message || 'Failed to add opportunities');
    } finally {
      setAdding(false);
    }
  };

  const handleConvert = async (opp: Opportunity) => {
    if (!canEdit(opp.storeId)) return;
    setError('');
    setConvertingId(opp.id);
    try {
      const res = await api.post<{ business: { id: string } }>(`/opportunities/${opp.id}/convert`, {});
      setSuccess('Converted to business!');
      await loadOpportunities();
      if (res?.business?.id) navigate(`/businesses?highlight=${res.business.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to convert');
    } finally {
      setConvertingId(null);
    }
  };

  const openDismissModal = (opp: Opportunity) => {
    if (!canEdit(opp.storeId)) return;
    setOpportunityToDismiss(opp);
    setDismissModalOpen(true);
  };

  const handleDismissWithReason = async (reason: string) => {
    if (!opportunityToDismiss) return;
    setError('');
    setDismissingId(opportunityToDismiss.id);
    try {
      await api.patch(`/opportunities/${opportunityToDismiss.id}`, {
        status: 'dismissed',
        dismissedReason: reason || undefined,
      });
      setSuccess('Dismissed.');
      await loadOpportunities();
      await loadDismissedOpportunities();
    } catch (err: any) {
      setError(err.message || 'Failed to dismiss');
    } finally {
      setDismissingId(null);
    }
  };

  const handleRestore = async (opp: Opportunity) => {
    if (!canEdit(opp.storeId)) return;
    setError('');
    setRestoringId(opp.id);
    try {
      await api.patch(`/opportunities/${opp.id}`, { status: 'new' });
      setSuccess('Restored to opportunities.');
      await loadOpportunities();
      await loadDismissedOpportunities();
    } catch (err: any) {
      setError(err.message || 'Failed to restore');
    } finally {
      setRestoringId(null);
    }
  };

  const handleAddressChange = (value: { address?: string; city?: string; state?: string; zipCode?: string }) => {
    setSearchAddress(value.address || '');
    setSearchCity(value.city || '');
    setSearchState(value.state || '');
    setSearchZipCode(value.zipCode || '');
  };

  // Memoized search predicate. Empty term short-circuits to the original list
  // so we don't allocate on every render when nobody is searching.
  const term = searchTerm.trim().toLowerCase();
  const filteredOpportunities = useMemo(
    () => (term ? opportunities.filter((o) => haystack(o).includes(term)) : opportunities),
    [opportunities, term],
  );
  const filteredDismissed = useMemo(
    () => (term ? dismissedOpportunities.filter((o) => haystack(o).includes(term)) : dismissedOpportunities),
    [dismissedOpportunities, term],
  );

  // Local infinite scroll for the saved Opportunities tab. We render a
  // window of the filtered list and grow it as the marketer scrolls. Doing
  // this client-side (rather than paginating from the server) means search
  // still scans the *entire* dataset and the offline cache continues to
  // hold one snapshot per status — no API churn.
  const PAGE_SIZE = 30;
  const [visibleActiveCount, setVisibleActiveCount] = useState(PAGE_SIZE);
  const [visibleDismissedCount, setVisibleDismissedCount] = useState(PAGE_SIZE);

  // Reset the visible window whenever the underlying filtered list changes
  // (search term changed, items added/removed, etc). Without this the
  // window can stay smaller than the current list's first page or, worse,
  // paginate past data that no longer exists.
  useEffect(() => {
    setVisibleActiveCount(PAGE_SIZE);
  }, [term, opportunities.length]);
  useEffect(() => {
    setVisibleDismissedCount(PAGE_SIZE);
  }, [term, dismissedOpportunities.length]);

  const visibleOpportunities = useMemo(
    () => filteredOpportunities.slice(0, visibleActiveCount),
    [filteredOpportunities, visibleActiveCount],
  );
  const visibleDismissedList = useMemo(
    () => filteredDismissed.slice(0, visibleDismissedCount),
    [filteredDismissed, visibleDismissedCount],
  );

  const hasMoreActive = visibleActiveCount < filteredOpportunities.length;
  const hasMoreDismissed = visibleDismissedCount < filteredDismissed.length;

  const { sentinelRef: activeSentinelRef } = useInfiniteScroll({
    onLoadMore: () => setVisibleActiveCount((c) => c + PAGE_SIZE),
    hasMore: hasMoreActive,
  });
  const { sentinelRef: dismissedSentinelRef } = useInfiniteScroll({
    onLoadMore: () => setVisibleDismissedCount((c) => c + PAGE_SIZE),
    hasMore: hasMoreDismissed,
  });

  // While searching, automatically reveal dismissed matches so a marketer
  // doesn't think a remembered place is "missing" — it might just be parked.
  const effectiveShowDismissed = showDismissed || (!!term && filteredDismissed.length > 0);

  if (!storeId) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <Typography color="text.secondary">Select a store to view opportunities.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ExploreIcon /> Discover
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Opportunities" />
          <Tab label={isMobile ? 'Generate' : 'Generate Opportunities'} />
        </Tabs>

        <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
          {/* Tab 0: Opportunities List */}
          {activeTab === 0 && (
            <>
              {/* Search header — magnifying glass on the right collapses to
                  a full-width text field on tap. Searches both active and
                  dismissed opportunities at once. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  {term
                    ? `${filteredOpportunities.length + (effectiveShowDismissed ? filteredDismissed.length : 0)} match${
                        filteredOpportunities.length + (effectiveShowDismissed ? filteredDismissed.length : 0) === 1 ? '' : 'es'
                      }`
                    : `${opportunities.length} active${dismissedOpportunities.length ? ` · ${dismissedOpportunities.length} dismissed` : ''}`}
                </Typography>
                {!searchOpen ? (
                  <IconButton
                    aria-label="Search opportunities"
                    onClick={() => setSearchOpen(true)}
                    size="small"
                  >
                    <SearchIcon />
                  </IconButton>
                ) : null}
              </Box>

              <Collapse in={searchOpen} unmountOnExit>
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name, address, city…"
                  sx={{ mb: 1.5 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label="Close search"
                          onClick={() => {
                            setSearchTerm('');
                            setSearchOpen(false);
                          }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Collapse>

              {loadingOpportunities ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress />
                </Box>
              ) : opportunities.length === 0 && dismissedOpportunities.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  No opportunities yet. Switch to "Generate" to discover businesses near your store.
                </Typography>
              ) : term && filteredOpportunities.length === 0 && filteredDismissed.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  No opportunities match “{searchTerm.trim()}”.
                </Typography>
              ) : (
                <>
                  {filteredOpportunities.length > 0 && (
                    <>
                      <List disablePadding sx={{ mb: 1 }}>
                        {visibleOpportunities.map((opp) => (
                          <OpportunityRow
                            key={opp.id}
                            opp={opp}
                            canEdit={canEdit(opp.storeId)}
                            converting={convertingId === opp.id}
                            dismissing={dismissingId === opp.id}
                            onConvert={() => handleConvert(opp)}
                            onDismiss={() => openDismissModal(opp)}
                          />
                        ))}
                      </List>
                      {/* Infinite-scroll sentinel for the active list. When
                          this scrolls into view we reveal the next PAGE_SIZE
                          items. Disconnects when there's nothing left. */}
                      {hasMoreActive && (
                        <Box
                          ref={activeSentinelRef}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            py: 1.5,
                            gap: 1,
                            color: 'text.secondary',
                            fontSize: '0.8rem',
                          }}
                        >
                          <CircularProgress size={14} />
                          {`Loading… (${visibleOpportunities.length} of ${filteredOpportunities.length})`}
                        </Box>
                      )}
                    </>
                  )}

                  {term && filteredOpportunities.length === 0 && filteredDismissed.length > 0 && (
                    <Typography color="text.secondary" sx={{ mb: 1, fontStyle: 'italic' }}>
                      No active matches — see dismissed below.
                    </Typography>
                  )}
                </>
              )}

              <Divider sx={{ my: 2 }} />

              {/* Dismissed toggle — auto-on while searching with hits */}
              <FormControlLabel
                control={
                  <Switch
                    checked={effectiveShowDismissed}
                    onChange={(e) => setShowDismissed(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Typography variant="body2">
                    Show dismissed{' '}
                    <Typography component="span" variant="body2" color="text.secondary">
                      ({term ? `${filteredDismissed.length} of ${dismissedOpportunities.length}` : dismissedOpportunities.length})
                    </Typography>
                  </Typography>
                }
              />

              {effectiveShowDismissed && filteredDismissed.length > 0 && (
                <>
                  <List disablePadding sx={{ mt: 1, bgcolor: 'action.hover', borderRadius: 1, py: 0.5 }}>
                    {visibleDismissedList.map((opp) => (
                      <DismissedOpportunityRow
                        key={opp.id}
                        opp={opp}
                        canEdit={canEdit(opp.storeId)}
                        restoring={restoringId === opp.id}
                        onRestore={() => handleRestore(opp)}
                      />
                    ))}
                  </List>
                  {/* Sentinel for the dismissed list — same pattern as
                      active. Lives outside the List bg-tint so the loader
                      sits flush with the page background. */}
                  {hasMoreDismissed && (
                    <Box
                      ref={dismissedSentinelRef}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        py: 1.5,
                        gap: 1,
                        color: 'text.secondary',
                        fontSize: '0.8rem',
                      }}
                    >
                      <CircularProgress size={14} />
                      {`Loading… (${visibleDismissedList.length} of ${filteredDismissed.length})`}
                    </Box>
                  )}
                </>
              )}
              {effectiveShowDismissed && term && filteredDismissed.length === 0 && dismissedOpportunities.length > 0 && (
                <Typography color="text.secondary" variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                  No dismissed matches.
                </Typography>
              )}
            </>
          )}

          {/* Tab 1: Generate Opportunities */}
          {activeTab === 1 && (
            <>
              {loadingStore ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <Box
                  component="form"
                  onSubmit={(e) => { e.preventDefault(); handleFindNearby(); }}
                  sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  {/* Discovery hits Google Places live — when offline we
                      can't search at all. Be explicit instead of letting the
                      button spin into a network error. */}
                  <OnlineOnlyNotice
                    feature="Nearby search"
                    message="No service — nearby business search needs internet. Try again when you're back online."
                  />

                  {/* Compact "where we're searching" — always visible. The
                      full address picker stays collapsed by default since
                      the store address is the right answer 95% of the time. */}
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem' }}>
                      Search around
                    </Typography>
                    {!addressEditOpen ? (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          p: 1.25,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1.5,
                          bgcolor: 'action.hover',
                        }}
                      >
                        <PlaceIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3, wordBreak: 'break-word' }}>
                            {searchAroundLabel}
                          </Typography>
                          {isUsingStoreAddress && (
                            <Typography variant="caption" color="text.secondary">
                              Your store
                            </Typography>
                          )}
                        </Box>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setAddressEditOpen(true)}
                          sx={{ flexShrink: 0, textTransform: 'none' }}
                        >
                          Change
                        </Button>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <AddressPicker
                          value={{ address: searchAddress, city: searchCity, state: searchState, zipCode: searchZipCode }}
                          onChange={handleAddressChange}
                          label="Street address"
                          sx={{ width: '100%' }}
                        />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                          {!isUsingStoreAddress && storeAddress && (
                            <Button
                              size="small"
                              variant="text"
                              onClick={useStoreAddress}
                              startIcon={<PlaceIcon fontSize="small" />}
                              sx={{ textTransform: 'none' }}
                            >
                              Use my store address
                            </Button>
                          )}
                          <Box sx={{ flex: 1 }} />
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => setAddressEditOpen(false)}
                            sx={{ textTransform: 'none' }}
                          >
                            Done
                          </Button>
                        </Box>
                      </Box>
                    )}
                  </Box>

                  {/* Filter UI (textfield + chips + Find button) lives ONLY
                      while there are no results to show. Once a search lands,
                      the entire block swaps for a single pinned "Reset Search"
                      button that wipes the query and brings the filters back
                      with one tap — keeps thumb-space focused on results. */}
                  {nearbyPlaces.length > 0 ? (
                    <Box
                      sx={{
                        // Position-sticky so the button stays glued to the
                        // top of the form area as the marketer scrolls
                        // through nearby results below — they can always
                        // back out of a search in one tap, no scroll up.
                        position: 'sticky',
                        top: { xs: 0, sm: 8 },
                        zIndex: 2,
                        bgcolor: 'background.paper',
                        py: 1,
                        // Stretch the bg slightly past the form padding so
                        // there's no visible seam when content scrolls underneath.
                        mx: { xs: -1.5, sm: -2 },
                        px: { xs: 1.5, sm: 2 },
                        borderBottom: 1,
                        borderColor: 'divider',
                      }}
                    >
                      <Button
                        variant="contained"
                        color="secondary"
                        onClick={handleResetSearch}
                        startIcon={<RestoreIcon />}
                        fullWidth
                        sx={{
                          py: { xs: 1.25, sm: 0.75 },
                          fontSize: { xs: '1rem', sm: '0.875rem' },
                          textTransform: 'none',
                          fontWeight: 600,
                        }}
                      >
                        Reset search
                        {textQuery.trim() && (
                          <Typography component="span" sx={{ ml: 0.75, opacity: 0.85, fontSize: '0.85rem', fontWeight: 400 }}>
                            ({textQuery.trim()})
                          </Typography>
                        )}
                      </Button>
                    </Box>
                  ) : (
                    <>
                  <Box>
                    <TextField
                      label="Filter by type (optional)"
                      placeholder="e.g. Event venue, law firm, real estate"
                      value={textQuery}
                      onChange={(e) => setTextQuery(e.target.value)}
                      size="small"
                      fullWidth
                    />
                    {/* Quick-tap chips for the most common bakery prospect
                        categories. Tapping a chip both fills the field AND
                        kicks off the search immediately — one-tap discovery
                        for the field marketer. We hide the entire row once
                        results load so the chips don't compete with them
                        for thumb-space (the "minimal/no screen space when
                        loaded" requirement). */}
                    {nearbyPlaces.length === 0 && !loadingNearby && (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                        {QUICK_TYPE_FILTERS.map((preset) => {
                          const isActive = textQuery.trim().toLowerCase() === preset.toLowerCase();
                          return (
                            <Chip
                              key={preset}
                              label={preset}
                              size="small"
                              variant={isActive ? 'filled' : 'outlined'}
                              color={isActive ? 'primary' : 'default'}
                              onClick={() => {
                                if (isActive) {
                                  // Tap the active chip again to clear the
                                  // filter and go back to "any nearby business".
                                  setTextQuery('');
                                  return;
                                }
                                setTextQuery(preset);
                                // Auto-fire the search so the marketer's
                                // intent ("show me real estate near me") is
                                // a single tap away. Pass the preset to
                                // `handleFindNearby` explicitly — relying on
                                // the just-set state would race React's
                                // render and the request would go out
                                // without `textQuery`, which Google rejects
                                // with "Request contains an invalid argument".
                                if (isOnline && !loadingNearby) {
                                  handleFindNearby(preset);
                                }
                              }}
                              sx={{
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                height: 'auto',
                                py: 0.4,
                                '& .MuiChip-label': {
                                  whiteSpace: 'normal',
                                  lineHeight: 1.3,
                                  px: 1,
                                },
                              }}
                            />
                          );
                        })}
                        {/* Escape hatch: tap "More…" to open the full
                            filter directory dialog. Visually distinct from
                            the quick chips (icon + dashed-style outline)
                            so marketers don't mistake it for another
                            preset that auto-fires a search. */}
                        <Chip
                          icon={<MoreFiltersIcon sx={{ fontSize: 14, ml: 0.5 }} />}
                          label="More…"
                          size="small"
                          variant="outlined"
                          onClick={() => setFilterDialogOpen(true)}
                          sx={{
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            height: 'auto',
                            py: 0.4,
                            borderStyle: 'dashed',
                            color: 'text.secondary',
                            '& .MuiChip-label': {
                              whiteSpace: 'normal',
                              lineHeight: 1.3,
                              px: 1,
                            },
                          }}
                        />
                      </Box>
                    )}
                  </Box>

                  <Tooltip
                    title={!isOnline ? 'Nearby search needs service' : ''}
                    enterTouchDelay={0}
                    disableHoverListener={isOnline}
                    disableFocusListener={isOnline}
                    disableTouchListener={isOnline}
                  >
                    <span style={{ alignSelf: isMobile ? 'stretch' : 'flex-start' }}>
                      <Button
                        type="submit"
                        variant="contained"
                        disabled={loadingNearby || !isOnline}
                        startIcon={loadingNearby ? <CircularProgress size={18} color="inherit" /> : <ExploreIcon />}
                        sx={{
                          width: { xs: '100%', sm: 'auto' },
                          py: { xs: 1.25, sm: 0.75 },
                          fontSize: { xs: '1rem', sm: '0.875rem' },
                        }}
                      >
                        {loadingNearby ? 'Searching…' : 'Find nearby businesses'}
                      </Button>
                    </span>
                  </Tooltip>
                    </>
                  )}
                  {nearbyPlaces.length > 0 && (
                    <>
                      <Divider sx={{ my: 2 }} />
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Tap places to select, then add them as opportunities.
                      </Typography>
                      <List
                        disablePadding
                        sx={{
                          bgcolor: 'background.default',
                          borderRadius: 1,
                          maxHeight: { xs: 380, sm: 320 },
                          overflow: 'auto',
                          mb: 1.5,
                        }}
                      >
                        {nearbyPlaces.map((place) => {
                          const isSelected = selectedPlaceIds.has(place.placeId);
                          return (
                            <ListItem
                              key={place.placeId}
                              onClick={() => togglePlaceSelection(place.placeId)}
                              sx={{
                                cursor: 'pointer',
                                bgcolor: isSelected ? 'primary.main' : 'transparent',
                                color: isSelected ? 'primary.contrastText' : 'inherit',
                                '&:hover': { bgcolor: isSelected ? 'primary.dark' : 'action.hover' },
                                borderRadius: 1,
                                mb: 0.5,
                                py: 1.25,
                                gap: 1.5,
                                alignItems: 'flex-start',
                              }}
                            >
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
                                  <Typography
                                    variant="body2"
                                    sx={{ fontWeight: 600, color: 'inherit' }}
                                  >
                                    {place.name}
                                  </Typography>
                                  {place.distanceM != null && (
                                    <Chip
                                      label={formatDistance(place.distanceM)}
                                      size="small"
                                      sx={{
                                        height: 18,
                                        fontSize: '0.65rem',
                                        bgcolor: isSelected ? 'rgba(255,255,255,0.25)' : 'action.selected',
                                        color: 'inherit',
                                      }}
                                    />
                                  )}
                                </Stack>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: isSelected ? 'primary.contrastText' : 'text.secondary',
                                    opacity: isSelected ? 0.85 : 1,
                                    display: 'block',
                                    lineHeight: 1.4,
                                  }}
                                >
                                  {place.address || [place.city, place.state, place.zipCode].filter(Boolean).join(', ')}
                                </Typography>
                              </Box>
                              <IconButton
                                edge="end"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePlaceSelection(place.placeId);
                                }}
                                sx={{ color: isSelected ? 'primary.contrastText' : 'action.active', mt: 0.25 }}
                              >
                                {isSelected ? <ConvertIcon /> : <AddIcon />}
                              </IconButton>
                            </ListItem>
                          );
                        })}
                        {/* Sentinel: when this scrolls into view (200px before
                            actually visible), the next page of Google results
                            loads automatically. Disconnects when nearbyPageToken
                            is empty (Google has no more pages — capped at ~60). */}
                        {nearbyPageToken && (
                          <Box
                            ref={nearbySentinelRef}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              py: 1.5,
                              gap: 1,
                              color: 'text.secondary',
                              fontSize: '0.8rem',
                            }}
                          >
                            {loadingNearbyMore && <CircularProgress size={14} />}
                            {loadingNearbyMore ? 'Loading more…' : 'Scroll for more'}
                          </Box>
                        )}
                        {/* Done-state line so the marketer knows they've hit
                            Google's cap (~60 places per query, per the Places
                            API), not that the scroll is broken. */}
                        {!nearbyPageToken && nearbyPlaces.length >= 20 && (
                          <Box sx={{ textAlign: 'center', py: 1.5, color: 'text.secondary', fontSize: '0.75rem' }}>
                            That's everything Google found. Try a different filter or address.
                          </Box>
                        )}
                      </List>
                      <Button
                        variant="contained"
                        onClick={handleAddAsOpportunities}
                        disabled={adding || selectedPlaceIds.size === 0}
                        startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
                        fullWidth={isMobile}
                        sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                      >
                        {adding ? 'Adding…' : `Add ${selectedPlaceIds.size} as opportunit${selectedPlaceIds.size === 1 ? 'y' : 'ies'}`}
                      </Button>
                    </>
                  )}
                </Box>
              )}
            </>
          )}
        </Box>
      </Paper>

      <DismissOpportunityModal
        open={dismissModalOpen}
        opportunityName={opportunityToDismiss?.name || ''}
        onClose={() => {
          setDismissModalOpen(false);
          setOpportunityToDismiss(null);
        }}
        onDismiss={handleDismissWithReason}
      />

      {/* Full filter directory. Opens from the "More…" chip on the
          Generate tab. Picking a category fills `textQuery` and immediately
          fires the search — same one-tap flow as the inline quick chips. */}
      <FilterTypeDialog
        open={filterDialogOpen}
        currentValue={textQuery}
        onClose={() => setFilterDialogOpen(false)}
        onPick={(type) => {
          setTextQuery(type);
          // Pass the picked type directly so the search uses it on the
          // first attempt. The `setTextQuery` call above schedules a
          // re-render, but `handleFindNearby` would otherwise capture the
          // pre-update closure and send a payload with no `textQuery`.
          if (isOnline && !loadingNearby) {
            handleFindNearby(type);
          }
        }}
      />
    </Box>
  );
}

/**
 * One row in the active opportunities list. We deliberately don't use the
 * MUI `secondaryAction` prop because it positions actions absolutely on the
 * right and overlaps wrapped text on narrow viewports — the exact bug the
 * field marketers reported. Instead we lay out as a flex row with the text
 * column allowed to shrink and the actions kept at the end.
 */
function OpportunityRow({
  opp,
  canEdit,
  converting,
  dismissing,
  onConvert,
  onDismiss,
}: {
  opp: Opportunity;
  canEdit: boolean;
  converting: boolean;
  dismissing: boolean;
  onConvert: () => void;
  onDismiss: () => void;
}) {
  const subtitle =
    opp.address || [opp.city, opp.state, opp.zipCode].filter(Boolean).join(', ');
  return (
    <ListItem
      sx={{
        alignItems: 'flex-start',
        gap: 1,
        py: 1.25,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <PlaceIcon fontSize="small" color="action" sx={{ mt: 0.5 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
          {opp.name}
        </Typography>
        {subtitle && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', lineHeight: 1.4, mt: 0.25 }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {canEdit && (
        <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0, mt: 0.25 }}>
          <Tooltip title="Convert to business">
            <span>
              <IconButton
                size="small"
                onClick={onConvert}
                disabled={converting}
                aria-label="Convert to business"
              >
                {converting ? <CircularProgress size={20} /> : <ConvertIcon color="primary" />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Dismiss">
            <span>
              <IconButton
                size="small"
                onClick={onDismiss}
                disabled={dismissing}
                aria-label="Dismiss opportunity"
              >
                {dismissing ? <CircularProgress size={20} /> : <DismissIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </ListItem>
  );
}

function DismissedOpportunityRow({
  opp,
  canEdit,
  restoring,
  onRestore,
}: {
  opp: Opportunity;
  canEdit: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const subtitle =
    opp.address || [opp.city, opp.state, opp.zipCode].filter(Boolean).join(', ');
  return (
    <ListItem
      sx={{
        alignItems: 'flex-start',
        gap: 1,
        py: 1,
        opacity: 0.85,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <PlaceIcon fontSize="small" color="disabled" sx={{ mt: 0.5 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, textDecoration: 'line-through', color: 'text.secondary', lineHeight: 1.3 }}
        >
          {opp.name}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4, mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
        {opp.dismissedReason && (
          <Typography variant="caption" color="error.main" sx={{ display: 'block', fontStyle: 'italic', mt: 0.25 }}>
            Reason: {opp.dismissedReason}
          </Typography>
        )}
      </Box>
      {canEdit && (
        <Tooltip title="Restore to opportunities">
          <span>
            <IconButton
              size="small"
              onClick={onRestore}
              disabled={restoring}
              aria-label="Restore opportunity"
              sx={{ flexShrink: 0, mt: 0.25 }}
            >
              {restoring ? <CircularProgress size={20} /> : <RestoreIcon color="primary" />}
            </IconButton>
          </span>
        </Tooltip>
      )}
    </ListItem>
  );
}
