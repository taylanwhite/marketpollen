import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, Tooltip, useMap } from 'react-leaflet';
import { latLng, latLngBounds, type Map as LeafletMap, type CircleMarker as LeafletCircleMarker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Map as MapIcon, Search as SearchIcon, ExpandMore as ExpandMoreIcon, Storefront as StoreIcon } from '@mui/icons-material';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { AddToPlanDialog } from '../components/AddToPlanDialog';
import { getDateRange, type DateRangeKey } from '../utils/reportAggregations';

type VisitTuple = [number, number, number]; // [time ms, type index, person index]

type MapBusiness = {
  id: string;
  storeId: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  contacts: number;
  visits: VisitTuple[];
};

type MapOpportunity = {
  id: string;
  storeId: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  status: string;
};

/** A place "Search this area" found that isn't a business or opportunity yet. */
type FoundPlace = {
  placeId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  lat?: number;
  lng?: number;
};

type SearchedArea = { lat: number; lng: number; radiusM: number; storeId: string };

// Google's nearby search can't cover more than about 50 km around a point.
const MAX_AREA_RADIUS_M = 50_000;

type MapResponse = {
  types: string[];
  people: { id: string; name: string }[];
  stores: { id: string; name: string; address?: string; lat: number; lng: number }[];
  businesses: MapBusiness[];
  opportunities: MapOpportunity[];
  unplaced: { businesses: number; opportunities: number };
  pending: number;
};

const RANGE_OPTIONS: { key: DateRangeKey; label: string }[] = [
  { key: '30d', label: 'Last 30 days' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

const TYPE_LABELS: Record<string, string> = {
  meeting: 'Visit',
  call: 'Call',
  text: 'Text',
  email: 'Email',
  other: 'Other',
};
const TYPE_ORDER = ['meeting', 'call', 'text', 'email', 'other'];

const COLORS = {
  recent: '#d97706', // visited in the last 30 days
  month3: '#f5c842', // 31–90 days ago
  older: '#e9dcae', // more than 90 days ago
  notVisited: '#9e9e9e',
  opportunity: '#3498db',
  store: '#2d2d2d',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Background map styles. Both use the free OpenStreetMap map (no account or key);
 * "Muted" just shows it in soft grays so the colored pins stand out.
 */
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const MAP_STYLES: Record<'muted' | 'standard', { label: string; className?: string }> = {
  muted: { label: 'Muted', className: 'map-tiles-muted' },
  standard: { label: 'Standard' },
};
type MapStyle = keyof typeof MAP_STYLES;
const MAP_STYLE_KEY = 'marketMapStyle';

function savedMapStyle(): MapStyle {
  try {
    const saved = localStorage.getItem(MAP_STYLE_KEY);
    if (saved && saved in MAP_STYLES) return saved as MapStyle;
  } catch {
    // Storage can be blocked (private mode); fall back to the default.
  }
  return 'muted';
}

function recencyColor(lastVisitMs: number, now: number): string {
  const days = (now - lastVisitMs) / DAY_MS;
  if (days <= 30) return COLORS.recent;
  if (days <= 90) return COLORS.month3;
  return COLORS.older;
}

function pinRadius(visitCount: number): number {
  return 6 + Math.min(8, Math.sqrt(visitCount) * 2);
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function directionsUrl(name: string, address?: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(', '))}`;
}

/** Leaflet measures its box once; measure again whenever the box changes size. */
function KeepSized() {
  const map = useMap();
  useEffect(() => {
    // Drop Leaflet's own "Leaflet 🇺🇦" credit; keep the OpenStreetMap credit
    // its license requires.
    map.attributionControl.setPrefix(false);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Zoom the map to fit the pins whenever a new set of places loads. */
function FitToPins({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  const lastKey = useRef('');
  useEffect(() => {
    if (!points.length || lastKey.current === fitKey) return;
    lastKey.current = fitKey;
    map.invalidateSize();
    if (points.length === 1) map.setView(points[0], 13);
    else map.fitBounds(latLngBounds(points), { padding: [32, 32], maxZoom: 14 });
  }, [map, points, fitKey]);
  return null;
}

/**
 * Where visits have happened and the open opportunities around them.
 * `embedded` drops the page heading when it sits in the Discover page's Map tab.
 */
export function MarketMap({ embedded = false, onOpenOpportunities }: { embedded?: boolean; onOpenOpportunities?: () => void } = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { permissions, currentOrg, isAdmin, isOrgAdminFn, canEdit } = usePermissions();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [data, setData] = useState<MapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [rangeKey, setRangeKey] = useState<DateRangeKey>('quarter');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(TYPE_ORDER));
  const [personFilter, setPersonFilter] = useState('all');
  const [showVisited, setShowVisited] = useState(true);
  const [showNotVisited, setShowNotVisited] = useState(false);
  const [showOpportunities, setShowOpportunities] = useState(true);
  const [leafletMap, setLeafletMap] = useState<LeafletMap | null>(null);
  const [mapStyle, setMapStyleState] = useState<MapStyle>(savedMapStyle);
  const setMapStyle = (style: MapStyle) => {
    setMapStyleState(style);
    try {
      localStorage.setItem(MAP_STYLE_KEY, style);
    } catch {
      // Not saved; the style still changes for this visit.
    }
  };
  const [areaQuery, setAreaQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<FoundPlace[]>([]);
  const [searchedArea, setSearchedArea] = useState<SearchedArea | null>(null);
  const [searchNote, setSearchNote] = useState('');
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [foundListOpen, setFoundListOpen] = useState(false);
  const foundMarkers = useRef(new Map<string, LeafletCircleMarker>());
  const [planTarget, setPlanTarget] = useState<{ storeId: string; name: string; opportunityId?: string; businessId?: string } | null>(null);

  const mapStores = useMemo(() => {
    const list = currentOrg?.stores?.length ? currentOrg.stores : permissions.accessibleStores;
    return list.filter((store) => !('archivedAt' in store && store.archivedAt));
  }, [currentOrg, permissions.accessibleStores]);
  const canRollup = mapStores.length > 1 && !!currentOrg?.id && (isAdmin() || isOrgAdminFn());
  const storesParam = searchParams.get('stores');
  const storeScope = canRollup && storesParam === 'all'
    ? 'all'
    : canRollup && storesParam && mapStores.some((s) => s.id === storesParam)
      ? storesParam
      : permissions.currentStoreId || '';
  const storeNames = useMemo(() => new Map(mapStores.map((s) => [s.id, s.name])), [mapStores]);

  const setStoreScope = (scope: string) => {
    const next = new URLSearchParams(searchParams);
    if (scope === 'all') next.set('stores', 'all');
    else if (scope === permissions.currentStoreId) next.delete('stores');
    else next.set('stores', scope);
    setSearchParams(next, { replace: true });
  };

  const scopeQuery = storeScope === 'all'
    ? `orgId=${encodeURIComponent(currentOrg?.id || '')}`
    : `storeId=${encodeURIComponent(storeScope)}`;

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    if (!storeScope) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      let res = await api.get<MapResponse>(`/map?${scopeQuery}`);
      if (signal.cancelled) return;
      setData(res);
      setLoading(false);
      // The first load for a store places pins a batch at a time.
      let lastPending = Infinity;
      while (res.pending > 0 && res.pending < lastPending && !signal.cancelled) {
        lastPending = res.pending;
        setPlacing(true);
        res = await api.get<MapResponse>(`/map?${scopeQuery}`);
        if (!signal.cancelled) setData(res);
      }
    } catch (err) {
      if (!signal.cancelled) setError((err as Error).message || 'Could not load the map');
    } finally {
      if (!signal.cancelled) {
        setLoading(false);
        setPlacing(false);
      }
    }
  }, [scopeQuery, storeScope]);

  useEffect(() => {
    setFound([]);
    setSearchedArea(null);
    setSearchNote('');
  }, [storeScope]);

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  const range = useMemo(() => getDateRange(rangeKey), [rangeKey]);
  const now = useMemo(() => Date.now(), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const personIndex = useMemo(() => {
    if (personFilter === 'all' || !data) return -1;
    return data.people.findIndex((p) => p.id === personFilter);
  }, [personFilter, data]);

  // Each business with only the visits that match the filters.
  const filtered = useMemo(() => {
    if (!data) return { visited: [], notVisited: [] };
    const startMs = range.start ? range.start.getTime() : -Infinity;
    const endMs = range.end.getTime();
    const allowedTypes = new Set(data.types.map((t, i) => (typeFilter.has(t) ? i : -1)).filter((i) => i >= 0));
    const visited: Array<MapBusiness & { matching: VisitTuple[] }> = [];
    const notVisited: MapBusiness[] = [];
    for (const b of data.businesses) {
      const matching = b.visits.filter(([t, type, person]) =>
        t >= startMs && t <= endMs && allowedTypes.has(type) && (personIndex < 0 || person === personIndex),
      );
      if (matching.length) {
        visited.push({ ...b, matching });
      } else {
        notVisited.push(b);
      }
    }
    // Draw busy places last so they sit on top.
    visited.sort((a, b) => a.matching.length - b.matching.length);
    return { visited, notVisited };
  }, [data, range, typeFilter, personIndex]);

  const points = useMemo<[number, number][]>(() => {
    if (!data) return [];
    const pts: [number, number][] = data.stores.map((s) => [s.lat, s.lng]);
    for (const b of data.businesses) pts.push([b.lat, b.lng]);
    for (const o of data.opportunities) pts.push([o.lat, o.lng]);
    return pts;
  }, [data]);

  /** The store new opportunities go to: the store picked, or the closest one on "All stores". */
  const storeFor = (lat: number, lng: number): string => {
    if (storeScope !== 'all') return storeScope;
    let best = permissions.currentStoreId || '';
    let bestDistance = Infinity;
    for (const s of data?.stores ?? []) {
      const d = latLng(lat, lng).distanceTo([s.lat, s.lng]);
      if (d < bestDistance) {
        bestDistance = d;
        best = s.id;
      }
    }
    return best;
  };

  const searchArea = async () => {
    if (!leafletMap || searching) return;
    const center = leafletMap.getCenter();
    const bounds = leafletMap.getBounds();
    // The biggest circle that fits on screen.
    const radiusM = Math.min(
      center.distanceTo([bounds.getNorth(), center.lng]),
      center.distanceTo([center.lat, bounds.getEast()]),
    );
    if (radiusM > MAX_AREA_RADIUS_M) {
      setSearchNote('Zoom in closer to search. The area on screen is too big.');
      return;
    }
    const storeId = storeFor(center.lat, center.lng);
    if (!storeId) return;
    setSearching(true);
    setSearchNote('');
    try {
      const payload: Record<string, unknown> = {
        storeId,
        lat: center.lat,
        lng: center.lng,
        radiusM: Math.round(radiusM),
        exactRadius: true,
      };
      if (areaQuery.trim()) payload.textQuery = areaQuery.trim();
      const res = await api.post<{ places: FoundPlace[] }>('/places-nearby', payload);
      const places = (res.places || []).filter((p) => p.lat != null && p.lng != null);
      setFound(places);
      setFoundListOpen(false);
      setSearchedArea({ lat: center.lat, lng: center.lng, radiusM, storeId });
      setShowOpportunities(true);
      if (!places.length) {
        setSearchNote(`No new places here${areaQuery.trim() ? ` for "${areaQuery.trim()}"` : ''}. Places that are already businesses or opportunities are left out.`);
      }
    } catch (err) {
      setSearchNote((err as Error).message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setFound([]);
    setSearchedArea(null);
    setSearchNote('');
  };

  const addAsOpportunities = async (places: FoundPlace[]) => {
    if (!searchedArea || !places.length) return;
    const storeId = searchedArea.storeId;
    const ids = new Set(places.map((p) => p.placeId));
    setAddingIds((prev) => new Set([...prev, ...ids]));
    setSearchNote('');
    try {
      const inserted = await api.post<Array<{ id: string; placeId: string; storeId: string; name: string; status: string }>>(
        '/opportunities',
        {
          storeId,
          opportunities: places.map((p) => ({
            placeId: p.placeId,
            name: p.name,
            address: p.address,
            city: p.city,
            state: p.state,
            zipCode: p.zipCode,
            lat: p.lat,
            lng: p.lng,
          })),
        },
      );
      const byPlace = new Map(places.map((p) => [p.placeId, p]));
      const added: MapOpportunity[] = (inserted || []).flatMap((row) => {
        const place = byPlace.get(row.placeId);
        if (!place || place.lat == null || place.lng == null) return [];
        return [{
          id: row.id,
          storeId: row.storeId,
          name: row.name,
          address: [place.address, place.city, place.state, place.zipCode].filter(Boolean).join(', ') || undefined,
          lat: place.lat,
          lng: place.lng,
          status: row.status,
        }];
      });
      setData((prev) => (prev ? { ...prev, opportunities: [...prev.opportunities, ...added] } : prev));
      setFound((prev) => prev.filter((p) => !ids.has(p.placeId)));
      if (places.length > 1) {
        setSearchNote(`Added ${added.length} ${added.length === 1 ? 'opportunity' : 'opportunities'}${storeScope === 'all' ? ` to ${storeNames.get(storeId) ?? 'the closest store'}` : ''}.`);
      }
    } catch (err) {
      setSearchNote((err as Error).message || 'Could not add those places');
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const canAddFound = !!searchedArea && canEdit(searchedArea.storeId);

  /** Bring the store (or every store on "All stores") back into view. */
  const backToStore = () => {
    const stores = data?.stores ?? [];
    if (!leafletMap || !stores.length) return;
    leafletMap.closePopup();
    if (stores.length === 1) leafletMap.setView([stores[0].lat, stores[0].lng], 12);
    else leafletMap.fitBounds(latLngBounds(stores.map((st) => [st.lat, st.lng] as [number, number])), { padding: [48, 48], maxZoom: 12 });
  };

  /** "2.3 mi from West Jordan" for a found place, measured from the store it would go to. */
  const distanceFromStore = (p: FoundPlace): string | undefined => {
    const store = data?.stores.find((st) => st.id === searchedArea?.storeId);
    if (!store || p.lat == null || p.lng == null) return undefined;
    const miles = latLng(store.lat, store.lng).distanceTo([p.lat, p.lng]) / 1609.34;
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi from ${store.name}`;
  };

  /** Jump to a found place's pin and open it. */
  const showFound = (p: FoundPlace) => {
    if (!leafletMap || p.lat == null || p.lng == null) return;
    leafletMap.setView([p.lat, p.lng], Math.max(leafletMap.getZoom(), 14));
    foundMarkers.current.get(p.placeId)?.openPopup();
    leafletMap.getContainer().scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const toggleType = (type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const typeName = (index: number) => TYPE_LABELS[data?.types[index] ?? 'other'] ?? 'Other';
  const personName = (index: number) => data?.people[index]?.name ?? 'Someone';
  const storeLabel = (storeId: string) => (storeScope === 'all' ? storeNames.get(storeId) : undefined);

  const filters = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
      {canRollup && (
        <ChipRow>
          <FilterChip label="All stores" selected={storeScope === 'all'} onClick={() => setStoreScope('all')} />
          {mapStores.map((store) => (
            <FilterChip
              key={store.id}
              label={store.name}
              selected={storeScope === store.id}
              onClick={() => setStoreScope(store.id)}
            />
          ))}
        </ChipRow>
      )}
      <ChipRow>
        {RANGE_OPTIONS.map((option) => (
          <FilterChip
            key={option.key}
            label={option.label}
            selected={rangeKey === option.key}
            onClick={() => setRangeKey(option.key)}
          />
        ))}
      </ChipRow>
      <ChipRow>
        {TYPE_ORDER.map((type) => (
          <FilterChip
            key={type}
            label={TYPE_LABELS[type]}
            selected={typeFilter.has(type)}
            onClick={() => toggleType(type)}
          />
        ))}
        {data && data.people.length > 1 && (
          <TextField
            select
            size="small"
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            sx={{ minWidth: 160, '& .MuiInputBase-root': { borderRadius: 4, height: 32 } }}
            aria-label="Who made the visit"
          >
            <MenuItem value="all">Everyone</MenuItem>
            {[...data.people]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
          </TextField>
        )}
      </ChipRow>
    </Box>
  );

  return (
    <Box>
      {embedded ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Where visits have happened, and the open opportunities nearby.
          {storeScope === 'all' && currentOrg?.name ? ` All stores in ${currentOrg.name}.` : ''}
        </Typography>
      ) : (
      <Box sx={{ mb: { xs: 1.5, sm: 2 } }}>
        <Typography
          variant="h4"
          sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, fontSize: { xs: '1.5rem', sm: '2.125rem' } }}
        >
          <MapIcon sx={{ color: '#d4a017' }} />
          Map
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Where visits have happened, and the open opportunities nearby.
          {storeScope === 'all' && currentOrg?.name ? ` All stores in ${currentOrg.name}.` : ''}
        </Typography>
      </Box>
      )}

      {filters}

      {storeScope && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Look for… e.g. Dentist"
            value={areaQuery}
            onChange={(e) => setAreaQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchArea();
            }}
            sx={{ flex: 1, maxWidth: { sm: 360 } }}
            inputProps={{ 'aria-label': 'What to look for' }}
          />
          <Button
            variant="contained"
            onClick={searchArea}
            disabled={!leafletMap || searching}
            startIcon={searching ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
            sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Search this area
          </Button>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!storeScope && !loading && <Alert severity="info">Pick a store to see its map.</Alert>}

      {storeScope && (
        <Box
          sx={{
            position: 'relative',
            height: { xs: '62vh', sm: 'calc(100vh - 380px)' },
            minHeight: 360,
            borderRadius: 3,
            overflow: 'hidden',
            border: '1px solid rgba(0,0,0,0.12)',
            // Keep Leaflet's panes under the app bar and dialogs.
            zIndex: 0,
            '& .leaflet-popup-content': { m: 1.5 },
            // Leaflet spaces out paragraphs; the popup text is MUI Typography.
            '& .leaflet-popup-content p': { m: 0 },
            '& .map-tiles-muted': { filter: 'grayscale(100%) brightness(1.06) contrast(0.88)' },
          }}
        >
          <MapContainer
            ref={setLeafletMap}
            center={[39.5, -98.35]}
            zoom={4}
            preferCanvas
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              key={mapStyle}
              attribution={OSM_ATTRIBUTION}
              url={OSM_URL}
              className={MAP_STYLES[mapStyle].className}
              maxZoom={19}
            />
            <KeepSized />
            <FitToPins points={points} fitKey={`${storeScope}:${points.length > 0}`} />

            {showNotVisited && filtered.notVisited.map((b) => (
              <CircleMarker
                key={`nv-${b.id}`}
                center={[b.lat, b.lng]}
                radius={5}
                pathOptions={{ color: '#ffffff', weight: 1, fillColor: COLORS.notVisited, fillOpacity: 0.7 }}
              >
                <Popup minWidth={240} maxWidth={300}>
                  <PinPopup
                    title={b.name}
                    address={b.address}
                    store={storeLabel(b.storeId)}
                    lines={[b.visits.length ? `Last visit ${shortDate(b.visits[0][0])}` : 'No visits logged yet']}
                    onContacts={b.storeId === permissions.currentStoreId ? () => navigate(`/dashboard?business=${b.id}`) : undefined}
                    onPlan={canEdit(b.storeId) ? () => setPlanTarget({ storeId: b.storeId, name: b.name, businessId: b.id }) : undefined}
                  />
                </Popup>
              </CircleMarker>
            ))}

            {showOpportunities && data?.opportunities.map((o) => (
              <CircleMarker
                key={`o-${o.id}`}
                center={[o.lat, o.lng]}
                radius={6}
                pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: COLORS.opportunity, fillOpacity: 0.85 }}
              >
                <Popup minWidth={240} maxWidth={300}>
                  <PinPopup
                    title={o.name}
                    address={o.address}
                    store={storeLabel(o.storeId)}
                    lines={[o.status === 'hold' ? 'Opportunity · on hold' : 'Opportunity · not visited yet']}
                    onDiscover={o.storeId === permissions.currentStoreId ? (onOpenOpportunities ?? (() => navigate('/opportunities'))) : undefined}
                    onPlan={canEdit(o.storeId) ? () => setPlanTarget({ storeId: o.storeId, name: o.name, opportunityId: o.id }) : undefined}
                  />
                </Popup>
              </CircleMarker>
            ))}

            {showVisited && filtered.visited.map((b) => {
              const last = b.matching[0];
              return (
                <CircleMarker
                  key={`v-${b.id}`}
                  center={[b.lat, b.lng]}
                  radius={pinRadius(b.matching.length)}
                  pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: recencyColor(last[0], now), fillOpacity: 0.9 }}
                >
                  <Popup minWidth={240} maxWidth={300}>
                    <PinPopup
                      title={b.name}
                      address={b.address}
                      store={storeLabel(b.storeId)}
                      lines={[
                        `${b.matching.length} ${b.matching.length === 1 ? 'visit' : 'visits'} in this period`,
                        `Last: ${shortDate(last[0])} · ${typeName(last[1])} · ${personName(last[2])}`,
                      ]}
                      onContacts={b.storeId === permissions.currentStoreId ? () => navigate(`/dashboard?business=${b.id}`) : undefined}
                      onPlan={canEdit(b.storeId) ? () => setPlanTarget({ storeId: b.storeId, name: b.name, businessId: b.id }) : undefined}
                    />
                  </Popup>
                </CircleMarker>
              );
            })}

            {searchedArea && (
              <Circle
                center={[searchedArea.lat, searchedArea.lng]}
                radius={searchedArea.radiusM}
                pathOptions={{ color: COLORS.opportunity, weight: 1.5, dashArray: '6 6', fill: false }}
                interactive={false}
              />
            )}

            {found.map((p) => (
              <CircleMarker
                key={`f-${p.placeId}`}
                ref={(marker) => {
                  if (marker) foundMarkers.current.set(p.placeId, marker);
                  else foundMarkers.current.delete(p.placeId);
                }}
                center={[p.lat!, p.lng!]}
                radius={7}
                pathOptions={{ color: COLORS.opportunity, weight: 2.5, fillColor: '#ffffff', fillOpacity: 1 }}
              >
                <Popup minWidth={240} maxWidth={300}>
                  <PinPopup
                    title={p.name}
                    address={[p.address, p.city].filter(Boolean).join(', ') || undefined}
                    store={searchedArea && storeScope === 'all' ? `Would go to ${storeNames.get(searchedArea.storeId) ?? 'the closest store'}` : undefined}
                    lines={['Not an opportunity yet', distanceFromStore(p) ?? ''].filter(Boolean)}
                    onAdd={canAddFound ? () => addAsOpportunities([p]) : undefined}
                    adding={addingIds.has(p.placeId)}
                  />
                </Popup>
              </CircleMarker>
            ))}

            {data?.stores.map((s) => (
              <CircleMarker
                key={`s-${s.id}`}
                center={[s.lat, s.lng]}
                radius={10}
                pathOptions={{ color: '#f5c842', weight: 3, fillColor: COLORS.store, fillOpacity: 1 }}
              >
                <Tooltip direction="top" offset={[0, -10]} permanent={!isMobile}>
                  {s.name}
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>

          {data && data.stores.length > 0 && (
            <Button
              size="small"
              onClick={backToStore}
              startIcon={<StoreIcon fontSize="small" />}
              sx={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 1000,
                bgcolor: '#ffffff',
                color: '#2d2d2d',
                border: '2px solid rgba(0,0,0,0.2)',
                boxShadow: 'none',
                '&:hover': { bgcolor: '#f4f4f4' },
              }}
            >
              {data.stores.length > 1 ? 'Back to stores' : 'Back to store'}
            </Button>
          )}

          <ToggleButtonGroup
            exclusive
            size="small"
            value={mapStyle}
            onChange={(_, style: MapStyle | null) => style && setMapStyle(style)}
            aria-label="Map style"
            sx={{
              position: 'absolute',
              bottom: 24,
              left: 10,
              zIndex: 1000,
              bgcolor: '#ffffff',
              border: '2px solid rgba(0,0,0,0.2)',
              borderRadius: 1,
              '& .MuiToggleButton-root': { border: 0, px: 1.25, py: 0.4, fontSize: '0.75rem', textTransform: 'none', color: '#2d2d2d' },
              '& .Mui-selected': { bgcolor: 'rgba(245, 200, 66, 0.35) !important', fontWeight: 700 },
            }}
          >
            {(Object.keys(MAP_STYLES) as MapStyle[]).map((style) => (
              <ToggleButton key={style} value={style}>{MAP_STYLES[style].label}</ToggleButton>
            ))}
          </ToggleButtonGroup>

          {(loading || placing) && (
            <Box
              sx={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                bgcolor: 'rgba(255,255,255,0.95)',
                borderRadius: 4,
                px: 1.5,
                py: 0.75,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                boxShadow: 1,
              }}
            >
              <CircularProgress size={16} />
              <Typography variant="caption">
                {placing && data ? `Placing ${data.pending} more pins…` : 'Loading map…'}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {storeScope && (found.length > 0 || searchNote) && (
        <Alert
          severity="info"
          icon={false}
          sx={{ mt: 1.5, alignItems: 'center', '& .MuiAlert-message': { width: '100%' } }}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            {found.length > 0 ? (
              <Box
                role="button"
                tabIndex={0}
                aria-expanded={foundListOpen}
                onClick={() => setFoundListOpen((open) => !open)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setFoundListOpen((open) => !open);
                }}
                sx={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {`${found.length} new ${found.length === 1 ? 'opportunity' : 'opportunities'} found`}
                </Typography>
                <ExpandMoreIcon
                  fontSize="small"
                  sx={{ transition: 'transform 0.2s', transform: foundListOpen ? 'rotate(180deg)' : 'none' }}
                />
                {searchNote && <Typography variant="body2">{searchNote}</Typography>}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>{searchNote}</Typography>
            )}
            {found.length > 0 && canAddFound && (
              <Button
                size="small"
                variant="contained"
                disabled={addingIds.size > 0}
                onClick={() => addAsOpportunities(found)}
              >
                Add all {found.length}
              </Button>
            )}
            {(found.length > 0 || searchedArea) && (
              <Button size="small" color="inherit" onClick={clearSearch}>Clear</Button>
            )}
          </Box>
          <Collapse in={found.length > 0 && foundListOpen} unmountOnExit>
            <Box
              sx={{
                mt: 1,
                maxHeight: 260,
                overflowY: 'auto',
                bgcolor: 'background.paper',
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,0.08)',
              }}
            >
              {found.map((p, i) => (
                <Box
                  key={p.placeId}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    borderTop: i ? '1px solid rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={() => showFound(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') showFound(p);
                    }}
                    sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{p.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {[distanceFromStore(p), [p.address, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  {canAddFound && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={addingIds.has(p.placeId)}
                      onClick={() => addAsOpportunities([p])}
                      sx={{ flexShrink: 0 }}
                    >
                      {addingIds.has(p.placeId) ? 'Adding…' : 'Add'}
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          </Collapse>
        </Alert>
      )}

      {storeScope && data && (
        <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: { xs: 1, sm: 2 }, alignItems: 'center' }}>
          <LegendToggle
            on={showVisited}
            onClick={() => setShowVisited((v) => !v)}
            swatch={<Dot color={COLORS.recent} />}
            label={`Visited (${filtered.visited.length})`}
          />
          <LegendToggle
            on={showOpportunities}
            onClick={() => setShowOpportunities((v) => !v)}
            swatch={<Dot color={COLORS.opportunity} />}
            label={`Opportunities (${data.opportunities.length})`}
          />
          <LegendToggle
            on={showNotVisited}
            onClick={() => setShowNotVisited((v) => !v)}
            swatch={<Dot color={COLORS.notVisited} />}
            label={`Not visited (${filtered.notVisited.length})`}
          />
        </Box>
      )}

      {storeScope && data && (
        <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, alignItems: 'center' }}>
          <KeyItem swatch={<Dot color={COLORS.recent} />} label="Last 30 days" />
          <KeyItem swatch={<Dot color={COLORS.month3} />} label="31–90 days" />
          <KeyItem swatch={<Dot color={COLORS.older} />} label="Older" />
          {found.length > 0 && (
            <KeyItem
              swatch={<Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#fff', border: `2px solid ${COLORS.opportunity}` }} />}
              label="New find"
            />
          )}
        </Box>
      )}

      <AddToPlanDialog
        open={!!planTarget}
        storeId={planTarget?.storeId || ''}
        target={planTarget ? { name: planTarget.name, opportunityId: planTarget.opportunityId, businessId: planTarget.businessId } : null}
        onClose={() => setPlanTarget(null)}
      />
    </Box>
  );
}

function PinPopup({
  title,
  address,
  store,
  lines,
  onContacts,
  onDiscover,
  onPlan,
  onAdd,
  adding = false,
}: {
  title: string;
  address?: string;
  store?: string;
  lines: string[];
  onContacts?: () => void;
  onDiscover?: () => void;
  onPlan?: () => void;
  onAdd?: () => void;
  adding?: boolean;
}) {
  return (
    <Box sx={{ fontFamily: 'inherit' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{title}</Typography>
      {address && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{address}</Typography>}
      {store && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{store}</Typography>}
      <Box sx={{ mt: 0.75 }}>
        {lines.map((line) => (
          <Typography key={line} variant="body2" sx={{ fontSize: '0.8rem' }}>{line}</Typography>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1, '& .MuiButton-root': { minWidth: 0, px: 1, py: 0.25, fontSize: '0.75rem' } }}>
        {onAdd && (
          <Button size="small" variant="contained" onClick={onAdd} disabled={adding}>
            {adding ? 'Adding…' : 'Add as opportunity'}
          </Button>
        )}
        {onContacts && <Button size="small" variant="outlined" onClick={onContacts}>Contacts</Button>}
        {onDiscover && <Button size="small" variant="outlined" onClick={onDiscover}>Open list</Button>}
        {onPlan && <Button size="small" variant="outlined" onClick={onPlan}>Add to plan</Button>}
        <Button size="small" href={directionsUrl(title, address)} target="_blank" rel="noopener noreferrer">
          Directions
        </Button>
      </Box>
    </Box>
  );
}

function KeyItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      {swatch}
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

function Dot({ color }: { color: string }) {
  return <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, border: '1px solid rgba(0,0,0,0.15)' }} />;
}

function LegendToggle({ on, onClick, swatch, label }: { on: boolean; onClick: () => void; swatch: ReactNode; label: string }) {
  return (
    <Chip
      onClick={onClick}
      icon={<Box sx={{ display: 'flex', alignItems: 'center', pl: 0.75, opacity: on ? 1 : 0.35 }}>{swatch}</Box>}
      label={label}
      variant="outlined"
      sx={{
        opacity: on ? 1 : 0.6,
        textDecoration: on ? 'none' : 'line-through',
        borderColor: on ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.12)',
      }}
    />
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.75,
        alignItems: 'center',
        flexWrap: { xs: 'nowrap', sm: 'wrap' },
        overflowX: { xs: 'auto', sm: 'visible' },
        mx: { xs: -1.5, sm: 0 },
        px: { xs: 1.5, sm: 0 },
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        '& > *': { flexShrink: 0 },
      }}
    >
      {children}
    </Box>
  );
}

function FilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <Chip
      label={label}
      onClick={onClick}
      sx={{
        fontWeight: selected ? 700 : 500,
        bgcolor: selected ? 'rgba(245, 200, 66, 0.28)' : 'transparent',
        border: '1px solid',
        borderColor: selected ? 'rgba(245, 200, 66, 0.7)' : 'rgba(0,0,0,0.12)',
      }}
    />
  );
}
