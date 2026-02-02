import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Opportunity } from '../types';
import { AddressPicker } from '../components/AddressPicker';
import { DismissOpportunityModal } from '../components/DismissOpportunityModal';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Divider,
  TextField,
  Tabs,
  Tab,
  FormControlLabel,
  Switch,
  Tooltip,
} from '@mui/material';
import {
  Explore as ExploreIcon,
  Add as AddIcon,
  CheckCircle as ConvertIcon,
  Cancel as DismissIcon,
  Place as PlaceIcon,
  Restore as RestoreIcon,
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

export function Opportunities() {
  const navigate = useNavigate();
  const { permissions, canEdit } = usePermissions();
  const [storeAddress, setStoreAddress] = useState('');
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
    loadDismissedOpportunities(); // load count for "Show dismissed (N)" label
  }, [storeId]);

  const loadStoreAddress = async () => {
    if (!storeId) return;
    try {
      setLoadingStore(true);
      const store = await api.get<{ address?: string; city?: string; state?: string; zipCode?: string }>(`/stores/${storeId}`);
      const parts = [store.address, store.city, store.state, store.zipCode].filter(Boolean);
      setStoreAddress(parts.join(', ') || '');
      if (!searchAddress && !searchCity && !searchState && !searchZipCode) {
        setSearchAddress(store.address || '');
        setSearchCity(store.city || '');
        setSearchState(store.state || '');
        setSearchZipCode(store.zipCode || '');
      }
    } catch (e) {
      console.error('Load store:', e);
    } finally {
      setLoadingStore(false);
    }
  };

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
      if (showDismissed) await loadDismissedOpportunities();
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

  if (!storeId) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <Typography color="text.secondary">Select a store to view opportunities.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ExploreIcon /> Opportunities
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Opportunities" />
          <Tab label="Generate Opportunities" />
        </Tabs>

        <Box sx={{ p: 2 }}>
          {/* Tab 0: Opportunities List */}
          {activeTab === 0 && (
            <>
              {loadingOpportunities ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress />
                </Box>
              ) : opportunities.length === 0 && !showDismissed ? (
                <Typography color="text.secondary">
                  No opportunities yet. Go to "Generate Opportunities" to discover businesses and add them here.
                </Typography>
              ) : (
                <>
                  {opportunities.length > 0 && (
                    <List dense>
                      {opportunities.map((opp) => (
                        <ListItem
                          key={opp.id}
                          sx={{ alignItems: 'flex-start' }}
                          secondaryAction={
                            canEdit(opp.storeId) && (
                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                <IconButton
                                  size="small"
                                  title="Convert to business"
                                  onClick={() => handleConvert(opp)}
                                  disabled={convertingId === opp.id}
                                >
                                  {convertingId === opp.id ? (
                                    <CircularProgress size={20} />
                                  ) : (
                                    <ConvertIcon color="primary" />
                                  )}
                                </IconButton>
                                <IconButton
                                  size="small"
                                  title="Dismiss"
                                  onClick={() => openDismissModal(opp)}
                                  disabled={dismissingId === opp.id}
                                >
                                  {dismissingId === opp.id ? (
                                    <CircularProgress size={20} />
                                  ) : (
                                    <DismissIcon />
                                  )}
                                </IconButton>
                              </Box>
                            )
                          }
                        >
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <PlaceIcon fontSize="small" color="action" />
                                {opp.name}
                              </Box>
                            }
                            secondary={opp.address || [opp.city, opp.state, opp.zipCode].filter(Boolean).join(', ') || undefined}
                          />
                        </ListItem>
                      ))}
                    </List>
                  )}
                  {opportunities.length === 0 && showDismissed && (
                    <Typography color="text.secondary" sx={{ mb: 2 }}>
                      No active opportunities. Go to "Generate Opportunities" to discover businesses.
                    </Typography>
                  )}
                </>
              )}

              <Divider sx={{ my: 2 }} />

              <FormControlLabel
                control={
                  <Switch
                    checked={showDismissed}
                    onChange={(e) => setShowDismissed(e.target.checked)}
                    size="small"
                  />
                }
                label={`Show dismissed (${dismissedOpportunities.length})`}
              />

              {showDismissed && dismissedOpportunities.length > 0 && (
                <List dense sx={{ mt: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                  {dismissedOpportunities.map((opp) => (
                    <ListItem
                      key={opp.id}
                      sx={{ alignItems: 'flex-start', opacity: 0.8 }}
                      secondaryAction={
                        canEdit(opp.storeId) && (
                          <Tooltip title="Restore to opportunities">
                            <IconButton
                              size="small"
                              onClick={() => handleRestore(opp)}
                              disabled={restoringId === opp.id}
                            >
                              {restoringId === opp.id ? (
                                <CircularProgress size={20} />
                              ) : (
                                <RestoreIcon color="primary" />
                              )}
                            </IconButton>
                          </Tooltip>
                        )
                      }
                    >
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <PlaceIcon fontSize="small" color="disabled" />
                            <Typography sx={{ textDecoration: 'line-through', color: 'text.secondary' }}>
                              {opp.name}
                            </Typography>
                          </Box>
                        }
                        secondary={
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              {opp.address || [opp.city, opp.state, opp.zipCode].filter(Boolean).join(', ') || ''}
                            </Typography>
                            {opp.dismissedReason && (
                              <Typography variant="caption" color="error.main" sx={{ fontStyle: 'italic' }}>
                                Reason: {opp.dismissedReason}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </>
          )}

          {/* Tab 1: Generate Opportunities */}
          {activeTab === 1 && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Find businesses near your store (or any address), then add them as opportunities.
              </Typography>
              {loadingStore ? (
                <CircularProgress size={24} />
              ) : (
                <>
                  {storeAddress && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Store address: {storeAddress}
                    </Typography>
                  )}
                  <Box
                    component="form"
                    onSubmit={(e) => { e.preventDefault(); handleFindNearby(); }}
                    sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start', mb: 2 }}
                  >
                    <AddressPicker
                      value={{ address: searchAddress, city: searchCity, state: searchState, zipCode: searchZipCode }}
                      onChange={handleAddressChange}
                      label="Address to search from (default: store)"
                      sx={{ minWidth: 400 }}
                    />
                    <TextField
                      label="Search terms (optional)"
                      placeholder="e.g. Event Venue, Law firm, Real estate"
                      value={textQuery}
                      onChange={(e) => setTextQuery(e.target.value)}
                      size="small"
                      sx={{ minWidth: 300 }}
                      helperText="Leave blank for general nearby search"
                    />
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={loadingNearby}
                      startIcon={loadingNearby ? <CircularProgress size={18} color="inherit" /> : <ExploreIcon />}
                      sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                    >
                      {loadingNearby ? 'Searching…' : 'Find nearby'}
                    </Button>
                  </Box>
                  {nearbyPlaces.length > 0 && (
                    <>
                      <Divider sx={{ my: 2 }} />
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Select places to add as opportunities (already added or converted are excluded).
                      </Typography>
                      <List dense sx={{ bgcolor: 'background.default', borderRadius: 1, maxHeight: 320, overflow: 'auto' }}>
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
                                '&:hover': {
                                  bgcolor: isSelected ? 'primary.dark' : 'action.hover',
                                },
                                borderRadius: 1,
                                mb: 0.5,
                                transition: 'background-color 0.15s ease',
                              }}
                              secondaryAction={
                                <IconButton
                                  edge="end"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlaceSelection(place.placeId);
                                  }}
                                  sx={{ color: isSelected ? 'primary.contrastText' : 'inherit' }}
                                >
                                  {isSelected ? <ConvertIcon /> : <AddIcon />}
                                </IconButton>
                              }
                            >
                              <ListItemText
                                primary={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    {place.name}
                                    {place.distanceM != null && (
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          ml: 1,
                                          color: isSelected ? 'primary.contrastText' : 'text.secondary',
                                          opacity: isSelected ? 0.8 : 1,
                                        }}
                                      >
                                        {formatDistance(place.distanceM)}
                                      </Typography>
                                    )}
                                  </Box>
                                }
                                secondary={place.address || [place.city, place.state, place.zipCode].filter(Boolean).join(', ') || undefined}
                                secondaryTypographyProps={{
                                  sx: { color: isSelected ? 'primary.contrastText' : 'text.secondary', opacity: isSelected ? 0.8 : 1 }
                                }}
                              />
                            </ListItem>
                          );
                        })}
                      </List>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={handleAddAsOpportunities}
                        disabled={adding || selectedPlaceIds.size === 0}
                        startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
                        sx={{ mt: 1 }}
                      >
                        {adding ? 'Adding…' : `Add ${selectedPlaceIds.size} as opportunities`}
                      </Button>
                    </>
                  )}
                </>
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
