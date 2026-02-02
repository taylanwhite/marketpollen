import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

const NEARBY_RADIUS_M = 2000;
const MAX_RESULTS = 20;

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

  const body = req.body as { storeId: string; address?: string; lat?: number; lng?: number };
  const storeId = body?.storeId?.trim();
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
      const loc = geoRes.data?.results?.[0]?.geometry?.location;
      if (!loc) return res.status(400).json({ error: 'Could not geocode address' });
      lat = loc.lat;
      lng = loc.lng;
    } catch (e) {
      console.error('Geocode error:', e);
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
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents',
        },
      }
    );
    const places = nearbyRes.data?.places || [];
    const out: Array<{ placeId: string; name: string; address?: string; city?: string; state?: string; zipCode?: string }> = [];
    for (const p of places) {
      const placeId = placeIdFromName(p.name) || placeIdFromName(p.id) || (p.id && typeof p.id === 'string' ? p.id.replace(/^places\//, '') : null);
      if (!placeId || existingSet.has(placeId)) continue;
      existingSet.add(placeId);
      const name = p.displayName?.text || p.displayName || 'Unknown';
      const address = p.formattedAddress || undefined;
      const { city, state, zipCode } = parseAddressComponents(p.addressComponents);
      out.push({ placeId, name, address, city, state, zipCode });
    }
    return res.status(200).json({ places: out });
  } catch (err: any) {
    console.error('Places nearby error:', err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || 'Nearby search failed';
    return res.status(err?.response?.status || 500).json({ error: msg });
  }
}
