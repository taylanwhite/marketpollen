import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

const METERS_PER_MILE = 1609.34;
const NEARBY_RADIUS_M = Math.round(10 * METERS_PER_MILE);
const EXPANDED_RADIUS_M = Math.round(25 * METERS_PER_MILE);
const MAX_RADIUS_M = Math.round(50 * METERS_PER_MILE);
const SEARCH_RADII_M = [NEARBY_RADIUS_M, EXPANDED_RADIUS_M, MAX_RADIUS_M] as const;
const MAX_RESULTS = 20;
const SAME_LOCATION_THRESHOLD_M = 50; // Filter out places within 50m of search center

// Used when the marketer leaves the search box blank. Keep this as plain
// search text so blank, manual, and button searches all follow one path.
const DEFAULT_TEXT_QUERY = 'business';

function buildBoundingBox(lat: number, lng: number, radiusM: number) {
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));

  return {
    low: {
      latitude: lat - latDelta,
      longitude: lng - lngDelta,
    },
    high: {
      latitude: lat + latDelta,
      longitude: lng + lngDelta,
    },
  };
}

/** Calculate distance between two lat/lng points in meters using Haversine formula */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseAddressComponents(components: Array<{ longText?: string; shortText?: string; types?: string[] }> | undefined): { city?: string; state?: string; zipCode?: string } {
  const out: { city?: string; state?: string; zipCode?: string } = {};
  if (!Array.isArray(components)) return out;
  for (const c of components) {
    const types = c.types || [];
    const name = (c.longText ?? c.shortText ?? '') || '';
    if (types.includes('locality')) out.city = name;
    else if (types.includes('administrative_area_level_1')) out.state = name;
    else if (types.includes('postal_code')) out.zipCode = name;
  }
  return out;
}

/** Extract place ID from Places API v1 resource name "places/ChIJ..." */
function placeIdFromName(name: string | undefined): string | null {
  if (!name || typeof name !== 'string') return null;
  const prefix = 'places/';
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Google Places API key is not configured' });
  }

  const body = req.body as { storeId: string; address?: string; lat?: number; lng?: number; textQuery?: string; pageToken?: string; radiusM?: number };
  const storeId = body?.storeId?.trim();
  const textQuery = body?.textQuery?.trim();
  // Google Places v1 returns up to 20 results per call and a nextPageToken
  // we can echo back to grab the next batch (up to 60 total). The token is
  // opaque and short-lived (~2min), so the client treats it as ephemeral.
  const pageToken = typeof body?.pageToken === 'string' ? body.pageToken.trim() : '';
  const requestedRadiusM = typeof body.radiusM === 'number' && SEARCH_RADII_M.includes(body.radiusM as typeof SEARCH_RADII_M[number])
    ? body.radiusM
    : NEARBY_RADIUS_M;
  console.log('places-nearby request:', { storeId, textQuery, address: body.address, lat: body.lat, lng: body.lng, hasPageToken: !!pageToken, requestedRadiusM });
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  const can = await canAccessStore(uid, storeId);
  if (!can) return res.status(404).json({ error: 'Store not found' });

  let lat = body.lat;
  let lng = body.lng;
  if (lat == null || lng == null) {
    const address = body.address?.trim();
    if (!address) return res.status(400).json({ error: 'address or lat/lng required' });
    try {
      const geoRes = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address, key: apiKey },
      });
      // Check for API-level errors (e.g., REQUEST_DENIED, OVER_QUERY_LIMIT)
      if (geoRes.data?.status && geoRes.data.status !== 'OK' && geoRes.data.status !== 'ZERO_RESULTS') {
        console.error('Geocode API error:', geoRes.data.status, geoRes.data.error_message);
        return res.status(400).json({ error: `Geocoding error: ${geoRes.data.status} - ${geoRes.data.error_message || 'Unknown'}` });
      }
      const loc = geoRes.data?.results?.[0]?.geometry?.location;
      if (!loc) {
        console.error('Geocode returned no results for address:', address, 'Status:', geoRes.data?.status);
        return res.status(400).json({ error: 'Could not geocode address - no results found' });
      }
      lat = loc.lat;
      lng = loc.lng;
    } catch (e: any) {
      console.error('Geocode error:', e?.response?.data || e);
      return res.status(500).json({ error: 'Geocoding failed' });
    }
  }

  const [businessRows, oppRows] = await Promise.all([
    prisma.business.findMany({ where: { store_id: storeId, place_id: { not: null } }, select: { place_id: true } }),
    prisma.opportunity.findMany({ where: { store_id: storeId }, select: { place_id: true } }),
  ]);
  const existingSet = new Set<string>([
    ...businessRows.map((r) => r.place_id!).filter(Boolean),
    ...oppRows.map((r) => r.place_id),
  ]);

  try {
    let places: any[] = [];
    let nextPageToken: string | undefined;

    // Field mask: keep it tight so we only pay for fields we render.
    const placeFields = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location';
    const textSearchFieldMask = `${placeFields},nextPageToken`;
    const out: Array<{ placeId: string; name: string; address?: string; city?: string; state?: string; zipCode?: string; distanceM?: number }> = [];
    const addFilteredPlaces = (sourcePlaces: any[]) => {
      for (const p of sourcePlaces) {
        const placeId = placeIdFromName(p.name) || placeIdFromName(p.id) || (p.id && typeof p.id === 'string' ? p.id.replace(/^places\//, '') : null);
        if (!placeId || existingSet.has(placeId)) continue;

        const placeLat = p.location?.latitude;
        const placeLng = p.location?.longitude;
        let distanceM: number | undefined;
        if (placeLat != null && placeLng != null && lat != null && lng != null) {
          distanceM = distanceMeters(lat, lng, placeLat, placeLng);
          // Filter out places at or very near the search location (the store's own address).
          if (distanceM < SAME_LOCATION_THRESHOLD_M) continue;
        }

        existingSet.add(placeId);
        const name = p.displayName?.text || p.displayName || 'Unknown';
        const address = p.formattedAddress || undefined;
        const { city, state, zipCode } = parseAddressComponents(p.addressComponents);
        out.push({ placeId, name, address, city, state, zipCode, distanceM });
      }
    };

    // One predictable search path:
    //   - blank input: search for "business"
    //   - manual input: search exactly what the marketer typed
    //   - preset buttons: the UI just writes that button label into the
    //     field, so it behaves exactly like manual input
    //
    // If the fresh search has no usable results after excluding existing
    // businesses/opportunities, automatically widen from 10mi -> 25mi -> 50mi.
    // Pagination must keep using the radius that produced the current page,
    // otherwise Google rejects the page token for mismatched parameters.
    const searchTerm = textQuery || DEFAULT_TEXT_QUERY;
    const radiiToTry = pageToken
      ? [requestedRadiusM]
      : SEARCH_RADII_M.filter((radiusM) => radiusM >= requestedRadiusM);
    let searchRadiusM = requestedRadiusM;

    for (const radiusM of radiiToTry) {
      searchRadiusM = radiusM;
      console.log('Using TEXT SEARCH with query:', searchTerm, `${radiusM}m`, pageToken ? '(page 2+)' : '(fresh search)');
      const reqBody: Record<string, unknown> = {
        textQuery: searchTerm,
        locationRestriction: {
          rectangle: buildBoundingBox(lat!, lng!, radiusM),
        },
        maxResultCount: MAX_RESULTS,
        rankPreference: 'DISTANCE',
      };
      // Google requires the original textQuery + location restriction on every
      // page request, AND the pageToken. Sending the token alone returns an error.
      if (pageToken) reqBody.pageToken = pageToken;
      const textRes = await axios.post(
        'https://places.googleapis.com/v1/places:searchText',
        reqBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': textSearchFieldMask,
          },
        }
      );
      places = textRes.data?.places || [];
      nextPageToken = textRes.data?.nextPageToken || undefined;
      addFilteredPlaces(places);
      if (out.length > 0 || pageToken) break;
    }

    // Sort by distance
    out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    return res.status(200).json({
      places: out,
      nextPageToken,
      searchRadiusM,
      expanded: !pageToken && searchRadiusM > NEARBY_RADIUS_M,
    });
  } catch (err: any) {
    console.error('Places search error:', err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || 'Places search failed';
    return res.status(err?.response?.status || 500).json({ error: msg });
  }
}
