import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Opportunity } from '../types';
import { AddressPicker } from '../components/AddressPicker';
import { DismissOpportunityModal } from '../components/DismissOpportunityModal';
import { OnlineOnlyNotice } from '../components/OnlineOnlyNotice';
import { useOffline } from '../contexts/OfflineContext';
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

  const handleFindNearby = async () => {
    if (!storeId) return;
    const address = buildAddressString();
    if (!address.trim()) {
      setError('Enter an address or use the store address above');
      return;
    }
    setError('');
    setSuccess('');
    setLoadingNearby(true);
    setNearbyPlaces([]);
    setSelectedPlaceIds(new Set());
    try {
      const payload: { storeId: string; address: string; textQuery?: string } = { storeId, address: address.trim() };
      if (textQuery.trim()) payload.textQuery = textQuery.trim();
      const res = await api.post<{ places: NearbyPlace[] }>('/places-nearby', payload);
      setNearbyPlaces(res.places || []);
      if (!res.places?.length) setSuccess('No new nearby places found (existing businesses and opportunities are excluded).');
    } catch (err: any) {
      setError(err.message || 'Failed to find nearby places');
    } finally {
      setLoadingNearby(false);
    }
  };

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
                    <List disablePadding sx={{ mb: 1 }}>
                      {filteredOpportunities.map((opp) => (
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
                <List disablePadding sx={{ mt: 1, bgcolor: 'action.hover', borderRadius: 1, py: 0.5 }}>
                  {filteredDismissed.map((opp) => (
                    <DismissedOpportunityRow
                      key={opp.id}
                      opp={opp}
                      canEdit={canEdit(opp.storeId)}
                      restoring={restoringId === opp.id}
                      onRestore={() => handleRestore(opp)}
                    />
                  ))}
                </List>
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

                  <TextField
                    label="Filter by type (optional)"
                    placeholder="e.g. Event venue, law firm, real estate"
                    value={textQuery}
                    onChange={(e) => setTextQuery(e.target.value)}
                    size="small"
                    fullWidth
                  />

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
