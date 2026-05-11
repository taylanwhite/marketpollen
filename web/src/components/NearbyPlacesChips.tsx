import { useEffect, useState } from 'react';
import { Box, Chip, Typography, Skeleton, IconButton } from '@mui/material';
import { LocationOn as LocationIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { api } from '../api/client';

export interface NearbyPlace {
  placeId: string;
  name: string;
  address?: string;
  distanceM?: number;
}

interface NearbyPlacesChipsProps {
  storeId: string | null | undefined;
  onSelect: (place: NearbyPlace) => void;
  maxChips?: number;
}

// Cache nearby-place results in sessionStorage to avoid burning Google Places
// quota every time the marketer pops open the +sheet. Cache key is a coarse
// grid cell (~110m) so small position drift between opens still hits.
const CACHE_TTL_MS = 5 * 60 * 1000;
const GRID_DEGREES = 0.001;

interface CacheEntry {
  fetchedAt: number;
  places: NearbyPlace[];
}

function cacheKey(storeId: string, lat: number, lng: number): string {
  const gLat = Math.round(lat / GRID_DEGREES) * GRID_DEGREES;
  const gLng = Math.round(lng / GRID_DEGREES) * GRID_DEGREES;
  return `nearby:${storeId}:${gLat.toFixed(3)}:${gLng.toFixed(3)}`;
}

function readCache(key: string): NearbyPlace[] | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.places;
  } catch {
    return null;
  }
}

function writeCache(key: string, places: NearbyPlace[]): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), places }));
  } catch {
    // sessionStorage may be unavailable (private mode); ignore silently
  }
}

type GeoState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; lat: number; lng: number };

function metersLabel(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  const km = m / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)}km`;
}

/**
 * Asks for the device's location and shows the closest 3–5 nearby places
 * (Places API). Marketers tap a chip and the place name is filled in for them,
 * skipping a lot of typing in noisy field environments.
 */
export function NearbyPlacesChips({ storeId, onSelect, maxChips = 5 }: NearbyPlacesChipsProps) {
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Request browser geolocation on mount and whenever the user manually retries
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ kind: 'error', message: 'Location not supported' });
      return;
    }
    setGeo({ kind: 'loading', message: 'Finding nearby spots…' });
    const watcher = navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ kind: 'ready', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeo({ kind: 'denied', message: 'Location off — enable for nearby suggestions' });
        } else {
          setGeo({ kind: 'error', message: 'Could not get location' });
        }
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8000 }
    );
    return () => {
      // getCurrentPosition has no cleanup but cancel any in-flight call by ignoring it
      void watcher;
    };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (geo.kind !== 'ready' || !storeId) return;

    const key = cacheKey(storeId, geo.lat, geo.lng);
    const cached = readCache(key);
    if (cached) {
      setPlaces(cached);
      setLoadingPlaces(false);
      return;
    }

    setLoadingPlaces(true);
    (async () => {
      try {
        const data = await api.post<{ places: NearbyPlace[] }>('/places-nearby', {
          storeId,
          lat: geo.lat,
          lng: geo.lng,
        });
        if (cancelled) return;
        const list = data.places || [];
        setPlaces(list);
        writeCache(key, list);
      } catch (err) {
        if (!cancelled) {
          console.warn('Nearby places lookup failed:', err);
          setPlaces([]);
        }
      } finally {
        if (!cancelled) setLoadingPlaces(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geo, storeId]);

  if (geo.kind === 'idle' || geo.kind === 'error') return null;

  if (geo.kind === 'denied') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LocationIcon fontSize="small" color="action" />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {geo.message}
        </Typography>
        <IconButton size="small" onClick={() => setRefreshKey((k) => k + 1)} aria-label="Retry location">
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  }

  if (geo.kind === 'loading' || loadingPlaces) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LocationIcon fontSize="small" color="action" />
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          Looking around you…
        </Typography>
        <Skeleton variant="rounded" width={80} height={24} />
        <Skeleton variant="rounded" width={100} height={24} />
        <Skeleton variant="rounded" width={70} height={24} />
      </Box>
    );
  }

  if (places.length === 0) return null;

  const visible = places.slice(0, maxChips);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
        <LocationIcon fontSize="small" color="action" sx={{ fontSize: 16 }} />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Near you
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {visible.map((place) => (
          <Chip
            key={place.placeId}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span>{place.name}</span>
                {place.distanceM != null && (
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ color: 'rgba(0,0,0,0.5)', fontSize: '0.7rem' }}
                  >
                    {metersLabel(place.distanceM)}
                  </Typography>
                )}
              </Box>
            }
            clickable
            onClick={() => onSelect(place)}
            size="small"
            sx={{
              maxWidth: 240,
              bgcolor: 'rgba(245, 200, 66, 0.18)',
              borderColor: 'rgba(245, 200, 66, 0.4)',
              border: '1px solid',
              fontWeight: 500,
              '& .MuiChip-label': { px: 1 },
              '&:hover': { bgcolor: 'rgba(245, 200, 66, 0.3)' },
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
