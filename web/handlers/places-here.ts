import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canViewStore } from './lib/store-access.js';

/**
 * "Near you" suggestions on the add-visit form: the places right around the
 * marketer's phone, closest first. Unlike /places-nearby (which finds new
 * prospects), this keeps businesses the store already has, because the
 * marketer is often standing in one of them.
 */

const MIN_RADIUS_M = 150;
const MAX_RADIUS_M = 1500;
const MAX_RETURNED = 8;

// Things that show up on the map but are never a business to visit.
const EXCLUDED_PRIMARY_TYPES = ['parking', 'atm', 'bus_station', 'transit_station', 'electric_vehicle_charging_station'];

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
}

interface HerePlace {
  placeId?: string;
  businessId?: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  distanceM?: number;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addressParts(components: GooglePlace['addressComponents']) {
  const out: { city?: string; state?: string; zipCode?: string } = {};
  for (const c of components || []) {
    const types = c.types || [];
    const name = c.longText ?? c.shortText ?? '';
    if (types.includes('locality')) out.city = name;
    else if (types.includes('administrative_area_level_1')) out.state = name;
    else if (types.includes('postal_code')) out.zipCode = name;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google Places API key is not configured' });

  const body = req.body as { storeId?: string; lat?: number; lng?: number; accuracyM?: number };
  const storeId = body?.storeId?.trim();
  const { lat, lng } = body;
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  if (!(await canViewStore(uid, storeId))) return res.status(404).json({ error: 'Store not found' });

  // Search wider when the phone is unsure where it is.
  const accuracy = typeof body.accuracyM === 'number' && Number.isFinite(body.accuracyM) ? body.accuracyM : 0;
  const radiusM = Math.round(Math.min(Math.max(accuracy * 1.5, MIN_RADIUS_M), MAX_RADIUS_M));

  // Rough box first so the database only returns businesses close by.
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
  const [nearbySaved, savedWithPlace] = await Promise.all([
    prisma.business.findMany({
      where: {
        store_id: storeId,
        lat: { gte: lat - latDelta, lte: lat + latDelta },
        lng: { gte: lng - lngDelta, lte: lng + lngDelta },
      },
      select: { id: true, name: true, address: true, city: true, state: true, zip_code: true, place_id: true, lat: true, lng: true },
    }),
    prisma.business.findMany({
      where: { store_id: storeId, place_id: { not: null } },
      select: { id: true, name: true, place_id: true },
    }),
  ]);
  const businessByPlace = new Map(savedWithPlace.map((b) => [b.place_id!, b]));

  const out: HerePlace[] = [];
  const seenBusinesses = new Set<string>();

  for (const b of nearbySaved) {
    const distanceM = distanceMeters(lat, lng, b.lat!, b.lng!);
    if (distanceM > radiusM) continue;
    seenBusinesses.add(b.id);
    out.push({
      businessId: b.id,
      placeId: b.place_id || undefined,
      name: b.name,
      address: b.address || undefined,
      city: b.city || undefined,
      state: b.state || undefined,
      zipCode: b.zip_code || undefined,
      distanceM,
    });
  }

  try {
    const response = await axios.post(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        excludedPrimaryTypes: EXCLUDED_PRIMARY_TYPES,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location',
        },
      },
    );
    for (const p of (response.data?.places || []) as GooglePlace[]) {
      const placeId = p.id?.replace(/^places\//, '');
      if (!placeId) continue;
      const pLat = p.location?.latitude;
      const pLng = p.location?.longitude;
      const distanceM = pLat != null && pLng != null ? distanceMeters(lat, lng, pLat, pLng) : undefined;
      const saved = businessByPlace.get(placeId);
      if (saved) {
        if (seenBusinesses.has(saved.id)) continue;
        seenBusinesses.add(saved.id);
        out.push({ businessId: saved.id, placeId, name: saved.name, address: p.formattedAddress, distanceM, ...addressParts(p.addressComponents) });
        continue;
      }
      out.push({
        placeId,
        name: p.displayName?.text || 'Unknown',
        address: p.formattedAddress,
        distanceM,
        ...addressParts(p.addressComponents),
      });
    }
  } catch (err: any) {
    // Saved businesses are still useful when Google fails.
    console.error('places-here Google search failed:', err?.response?.data || err?.message);
  }

  out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  return res.status(200).json({ places: out.slice(0, MAX_RETURNED), radiusM });
}
