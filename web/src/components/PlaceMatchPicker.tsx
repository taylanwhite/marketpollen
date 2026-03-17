import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Store } from '../types';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Card,
  CardActionArea,
  CardContent,
  Alert,
  TextField,
  Collapse,
} from '@mui/material';
import {
  Place as PlaceIcon,
  LinkOff as LinkOffIcon,
  CheckCircle as CheckCircleIcon,
  Search as SearchIcon,
} from '@mui/icons-material';

interface PlaceResult {
  placeId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

interface PlaceMatchPickerProps {
  open: boolean;
  businessName: string;
  businessAddress?: string;
  businessCity?: string;
  businessState?: string;
  businessZipCode?: string;
  onSelect: (place: PlaceResult) => void;
  onSkip: () => void;
  onClose: () => void;
}

export function PlaceMatchPicker({
  open,
  businessName,
  businessAddress,
  businessCity,
  businessState,
  businessZipCode,
  onSelect,
  onSkip,
  onClose,
}: PlaceMatchPickerProps) {
  const { permissions } = usePermissions();
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRefine, setShowRefine] = useState(false);
  const [refineQuery, setRefineQuery] = useState('');
  const storeRef = useRef<Store | null>(null);

  useEffect(() => {
    if (open && businessName) {
      loadStoreAndSearch();
    }
    if (!open) {
      setPlaces([]);
      setSelectedId(null);
      setError('');
      setShowRefine(false);
      setRefineQuery('');
    }
  }, [open, businessName]);

  const loadStoreAndSearch = async () => {
    if (!storeRef.current && permissions.currentStoreId) {
      try {
        const store = await api.get<Store>(`/stores/${permissions.currentStoreId}`);
        storeRef.current = store;
      } catch {
        // Proceed without store location
      }
    }
    searchPlaces();
  };

  const searchPlaces = async (customQuery?: string) => {
    setLoading(true);
    setError('');
    try {
      const searchName = customQuery || businessName;
      const hasBusinessLocation = businessAddress || businessCity || businessState || businessZipCode;
      const store = storeRef.current;
      const res = await api.post<{ places: PlaceResult[] }>('/places-lookup', {
        name: searchName,
        address: customQuery ? undefined : (businessAddress || undefined),
        city: customQuery ? undefined : (businessCity || undefined),
        state: customQuery ? undefined : (businessState || undefined),
        zipCode: customQuery ? undefined : (businessZipCode || undefined),
        ...((!customQuery && !hasBusinessLocation && store) && {
          storeAddress: store.address,
          storeCity: store.city,
          storeState: store.state,
          storeZipCode: store.zipCode,
        }),
      });
      setPlaces(res.places || []);
      setSelectedId(null);
    } catch (err: any) {
      console.error('Place lookup failed:', err);
      setError('Could not search Google Places. You can skip this step.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefineSearch = () => {
    if (refineQuery.trim()) {
      searchPlaces(refineQuery.trim());
      setShowRefine(false);
    }
  };

  const handleConfirmSelection = () => {
    const selected = places.find(p => p.placeId === selectedId);
    if (selected) {
      onSelect(selected);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <PlaceIcon color="primary" />
        Link to Google Place
      </DialogTitle>

      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          We found places on Google that might match <strong>{businessName}</strong>.
          Linking prevents this business from appearing as a future opportunity.
        </Typography>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>
        )}

        {!loading && !error && places.length === 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No matching places found on Google. The business will be created without a link.
          </Alert>
        )}

        {!loading && places.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {places.map((place) => (
              <Card
                key={place.placeId}
                variant="outlined"
                sx={{
                  borderColor: selectedId === place.placeId ? 'primary.main' : 'divider',
                  borderWidth: selectedId === place.placeId ? 2 : 1,
                  bgcolor: selectedId === place.placeId ? 'primary.50' : 'background.paper',
                }}
              >
                <CardActionArea onClick={() => setSelectedId(place.placeId)}>
                  <CardContent sx={{ py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {place.name}
                      </Typography>
                      {place.address && (
                        <Typography variant="body2" color="text.secondary">
                          {place.address}
                        </Typography>
                      )}
                    </Box>
                    {selectedId === place.placeId && (
                      <CheckCircleIcon color="primary" />
                    )}
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        )}

        {!loading && (
          <Box sx={{ mt: 2 }}>
            <Button
              size="small"
              startIcon={<SearchIcon />}
              onClick={() => setShowRefine(!showRefine)}
              color="inherit"
            >
              {showRefine ? 'Hide' : 'Try a different search'}
            </Button>
            <Collapse in={showRefine}>
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField
                  size="small"
                  fullWidth
                  value={refineQuery}
                  onChange={(e) => setRefineQuery(e.target.value)}
                  placeholder="e.g. Chase Bank 1372 N Canyon Creek Pkwy"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRefineSearch(); }}
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleRefineSearch}
                  disabled={!refineQuery.trim()}
                >
                  Search
                </Button>
              </Box>
            </Collapse>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, justifyContent: 'space-between' }}>
        <Button
          onClick={onSkip}
          startIcon={<LinkOffIcon />}
          color="inherit"
        >
          {places.length === 0 && !loading ? 'Continue' : 'Skip — None of these'}
        </Button>
        {places.length > 0 && (
          <Button
            variant="contained"
            onClick={handleConfirmSelection}
            disabled={!selectedId}
            startIcon={<CheckCircleIcon />}
          >
            Link & Create
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export type { PlaceResult };
