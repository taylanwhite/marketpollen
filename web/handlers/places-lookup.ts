import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { getAuthUid } from './lib/auth.js';
import { prisma } from './lib/db.js';
import { canViewStore } from './lib/store-access.js';

const MAX_RESULTS = 10;
// Prefer places this close to the marketer (or the store). It is a
// preference, not a cutoff, so a typed address farther away still works.
const PHONE_BIAS_RADIUS_M = 15_000;
const STORE_BIAS_RADIUS_M = 30_000;

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
  if (!apiKey) return res.status(500).json({ error: 'Google Places API key is not configured' });

  const body = req.body as {
    name: string; address?: string; city?: string; state?: string; zipCode?: string;
    storeAddress?: string; storeCity?: string; storeState?: string; storeZipCode?: string;
    storeId?: string; lat?: number; lng?: number;
  };
  const name = body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Where to search: the phone's location, else the store's map pin.
  let center: { latitude: number; longitude: number } | null = null;
  let biasRadiusM = PHONE_BIAS_RADIUS_M;
  if (typeof body.lat === 'number' && typeof body.lng === 'number' && Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
    center = { latitude: body.lat, longitude: body.lng };
  } else if (body.storeId && (await canViewStore(uid, body.storeId))) {
    const store = await prisma.store.findUnique({ where: { id: body.storeId }, select: { lat: true, lng: true } });
    if (store?.lat != null && store?.lng != null) {
      center = { latitude: store.lat, longitude: store.lng };
      biasRadiusM = STORE_BIAS_RADIUS_M;
    }
  }

  const businessParts = [body.address, body.city, body.state, body.zipCode].filter(Boolean);
  const storeParts = [body.storeAddress, body.storeCity, body.storeState, body.storeZipCode].filter(Boolean);
  // With a search center, the business name alone works best. Without one,
  // add the business or store address so Google searches the right town.
  const locationParts = businessParts.length > 0 ? businessParts : center ? [] : storeParts;
  const textQuery = locationParts.length > 0 ? `${name} near ${locationParts.join(', ')}` : name;

  try {
    const textRes = await axios.post(
      'https://places.googleapis.com/v1/places:searchText',
      {
        textQuery,
        maxResultCount: MAX_RESULTS,
        ...(center && { locationBias: { circle: { center, radius: biasRadiusM } } }),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents',
        },
      }
    );

    const places = textRes.data?.places || [];
    const out = places.map((p: any) => {
      const placeId = placeIdFromName(p.name) || placeIdFromName(p.id) || (p.id && typeof p.id === 'string' ? p.id.replace(/^places\//, '') : null);
      const displayName = p.displayName?.text || p.displayName || 'Unknown';
      const formattedAddress = p.formattedAddress || undefined;
      const { city, state, zipCode } = parseAddressComponents(p.addressComponents);
      return { placeId, name: displayName, address: formattedAddress, city, state, zipCode };
    }).filter((p: any) => p.placeId);

    return res.status(200).json({ places: out });
  } catch (err: any) {
    console.error('Places lookup error:', err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || 'Places lookup failed';
    return res.status(err?.response?.status || 500).json({ error: msg });
  }
}
