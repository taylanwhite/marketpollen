import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Opportunity } from '../types';
import { AddressPicker } from '../components/AddressPicker';
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
} from '@mui/material';
import {
  Explore as ExploreIcon,
  Add as AddIcon,
  CheckCircle as ConvertIcon,
  Cancel as DismissIcon,
  Place as PlaceIcon,
} from '@mui/icons-material';

interface NearbyPlace {
  placeId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export function Opportunities() {
  const navigate = useNavigate();
  const { permissions, canEdit } = usePermissions();
  const [storeAddress, setStoreAddress] = useState('');
  const [searchAddress, setSearchAddress] = useState('');
  const [searchCity, setSearchCity] = useState('');
  const [searchState, setSearchState] = useState('');
  const [searchZipCode, setSearchZipCode] = useState('');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(new Set());
  const [loadingStore, setLoadingStore] = useState(true);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [loadingOpportunities, setLoadingOpportunities] = useState(true);
  const [adding, setAdding] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const storeId = permissions.currentStoreId;

  useEffect(() => {
    if (!storeId) {
      setOpportunities([]);
      setLoadingOpportunities(false);
      setLoadingStore(false);
      return;
    }
    loadStoreAddress();
    loadOpportunities();
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
      const res = await api.post<{ places: NearbyPlace[] }>('/places-nearby', { storeId, address: address.trim() });
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

  const handleDismiss = async (opp: Opportunity) => {
    if (!canEdit(opp.storeId)) return;
    setError('');
    setDismissingId(opp.id);
    try {
      await api.patch(`/opportunities/${opp.id}`, { status: 'dismissed' });
      setSuccess('Dismissed.');
      await loadOpportunities();
    } catch (err: any) {
      setError(err.message || 'Failed to dismiss');
    } finally {
      setDismissingId(null);
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
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Find businesses near your store (or any address), add them as opportunities, then convert them to businesses and contacts.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Find nearby */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
          Find businesses nearby
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
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start', mb: 2 }}>
              <AddressPicker
                value={{ address: searchAddress, city: searchCity, state: searchState, zipCode: searchZipCode }}
                onChange={handleAddressChange}
                label="Address to search from (default: store)"
              />
              <Button
                variant="contained"
                onClick={handleFindNearby}
                disabled={loadingNearby}
                startIcon={loadingNearby ? <CircularProgress size={18} color="inherit" /> : <ExploreIcon />}
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
                  {nearbyPlaces.map((place) => (
                    <ListItem
                      key={place.placeId}
                      secondaryAction={
                        <IconButton
                          edge="end"
                          onClick={() => togglePlaceSelection(place.placeId)}
                          color={selectedPlaceIds.has(place.placeId) ? 'primary' : 'default'}
                        >
                          <AddIcon />
                        </IconButton>
                      }
                    >
                      <ListItemText
                        primary={place.name}
                        secondary={place.address || [place.city, place.state, place.zipCode].filter(Boolean).join(', ') || undefined}
                      />
                    </ListItem>
                  ))}
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
      </Paper>

      {/* My opportunities */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
          My opportunities
        </Typography>
        {loadingOpportunities ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        ) : opportunities.length === 0 ? (
          <Typography color="text.secondary">
            No opportunities yet. Use “Find nearby” above to discover businesses and add them here.
          </Typography>
        ) : (
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
                        onClick={() => handleDismiss(opp)}
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
      </Paper>
    </Box>
  );
}
