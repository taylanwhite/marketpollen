import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

const NEARBY_RADIUS_M = 2000;
const MAX_RESULTS = 20;
const SAME_LOCATION_THRESHOLD_M = 50; // Filter out places within 50m of search center

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

  const body = req.body as { storeId: string; address?: string; lat?: number; lng?: number; textQuery?: string };
  const storeId = body?.storeId?.trim();
  const textQuery = body?.textQuery?.trim();
  console.log('places-nearby request:', { storeId, textQuery, address: body.address, lat: body.lat, lng: body.lng });
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

    if (textQuery) {
      // Text Search API - search by keywords like "Event Venue", "Law firm", etc.
      console.log('Using TEXT SEARCH with query:', textQuery);
      const textRes = await axios.post(
        'https://places.googleapis.com/v1/places:searchText',
        {
          textQuery,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: NEARBY_RADIUS_M,
            },
          },
          maxResultCount: MAX_RESULTS,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location',
          },
        }
      );
      places = textRes.data?.places || [];
    } else {
      // Nearby Search API - general nearby places
      console.log('Using NEARBY SEARCH (no text query)');
      const nearbyRes = await axios.post(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: NEARBY_RADIUS_M,
            },
          },
          maxResultCount: MAX_RESULTS,
          rankPreference: 'DISTANCE',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location',
          },
        }
      );
      places = nearbyRes.data?.places || [];
    }

    const out: Array<{ placeId: string; name: string; address?: string; city?: string; state?: string; zipCode?: string; distanceM?: number }> = [];
    for (const p of places) {
      const placeId = placeIdFromName(p.name) || placeIdFromName(p.id) || (p.id && typeof p.id === 'string' ? p.id.replace(/^places\//, '') : null);
      if (!placeId || existingSet.has(placeId)) continue;

      // Calculate distance from search center
      const placeLat = p.location?.latitude;
      const placeLng = p.location?.longitude;
      let distanceM: number | undefined;
      if (placeLat != null && placeLng != null && lat != null && lng != null) {
        distanceM = distanceMeters(lat, lng, placeLat, placeLng);
        // Filter out places at or very near the search location (the store's own address)
        if (distanceM < SAME_LOCATION_THRESHOLD_M) continue;
      }

      existingSet.add(placeId);
      const name = p.displayName?.text || p.displayName || 'Unknown';
      const address = p.formattedAddress || undefined;
      const { city, state, zipCode } = parseAddressComponents(p.addressComponents);
      out.push({ placeId, name, address, city, state, zipCode, distanceM });
    }

    // Sort by distance
    out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    return res.status(200).json({ places: out });
  } catch (err: any) {
    console.error('Places search error:', err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || 'Places search failed';
    return res.status(err?.response?.status || 500).json({ error: msg });
  }
}
