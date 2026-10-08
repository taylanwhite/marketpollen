import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canViewStore } from './lib/store-access.js';

const METERS_PER_MILE = 1609.34;
const NEARBY_RADIUS_M = Math.round(10 * METERS_PER_MILE);
const EXPANDED_RADIUS_M = Math.round(25 * METERS_PER_MILE);
const MAX_RADIUS_M = Math.round(50 * METERS_PER_MILE);
const SEARCH_RADII_M = [NEARBY_RADIUS_M, EXPANDED_RADIUS_M, MAX_RADIUS_M] as const;
const MAX_RESULTS = 20;
const SAME_LOCATION_THRESHOLD_M = 50; // Filter out places within 50m of search center
// Nearby Search (New) only accepts a circular radius up to 50km.
const MAX_NEARBY_RADIUS_M = 50_000;

const PLACES_API = 'https://places.googleapis.com/v1/places';
const PLACE_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location';

/**
 * Blank-filter Nearby Search types. Table A only — a Table B value like
 * `food` makes Google reject the whole request with INVALID_ARGUMENT.
 * Ranked by DISTANCE so the closest prospects come back first.
 */
const DEFAULT_BUSINESS_TYPES: string[] = [
  'restaurant', 'cafe', 'bakery', 'bar', 'meal_takeaway',
  'store', 'shopping_mall', 'clothing_store', 'florist', 'gift_shop',
  'jewelry_store', 'book_store',
  'beauty_salon', 'hair_care', 'spa', 'gym',
  'lodging',
  'real_estate_agency', 'insurance_agency', 'lawyer', 'accounting', 'bank',
  'dentist', 'dental_clinic', 'doctor', 'hospital', 'veterinary_care',
  'school', 'church', 'event_venue',
];

const DENTIST_TYPES = ['dentist', 'dental_clinic'];

/**
 * UI filter labels → Google Places Table A types.
 *
 * Known chips/dialog picks go through Nearby Search with these types so
 * results are distance-ranked by category. A dental office named
 * "Complete Smiles" has no "dentist" in the name, so Text Search for
 * "Dentist" can skip it while Nearby Search `includedTypes: dentist +
 * dental_clinic` still returns it.
 *
 * Unmapped free text still uses Text Search. Keys are lowercased.
 */
const UI_TYPE_TO_PLACES_TYPES: Record<string, string[]> = {
  // Quick chips
  'real estate office': ['real_estate_agency'],
  'law firm': ['lawyer'],
  'event venue': ['event_venue'],
  'hospital': ['hospital'],
  'school': ['school'],
  'bank': ['bank'],
  'salon': ['beauty_salon'],
  'dentist': DENTIST_TYPES,
  'dentists': DENTIST_TYPES,
  'dental office': DENTIST_TYPES,
  'dental offices': DENTIST_TYPES,
  'dental clinic': DENTIST_TYPES,
  'dental clinics': DENTIST_TYPES,
  'dentist office': DENTIST_TYPES,
  'dentist offices': DENTIST_TYPES,
  'dental practice': DENTIST_TYPES,
  'dental practices': DENTIST_TYPES,
  // Professional services
  'accountant': ['accounting'],
  'insurance agency': ['insurance_agency'],
  'corporate office': ['corporate_office'],
  'coworking space': ['coworking_space'],
  // Healthcare
  'doctor office': ['doctor'],
  'chiropractor': ['chiropractor'],
  'veterinarian': ['veterinary_care'],
  'physical therapy': ['physiotherapist'],
  'pharmacy': ['pharmacy'],
  // Events & hospitality
  'wedding venue': ['wedding_venue'],
  'hotel': ['lodging'],
  'banquet hall': ['banquet_hall'],
  'convention center': ['convention_center'],
  // Education
  'elementary school': ['primary_school'],
  'high school': ['secondary_school'],
  'preschool': ['preschool'],
  'college': ['university'],
  'library': ['library'],
  // Personal services
  'spa': ['spa'],
  'barber shop': ['barber_shop'],
  'nail salon': ['nail_salon'],
  // Fitness
  'gym': ['gym'],
  'yoga studio': ['yoga_studio'],
  // Retail
  'florist': ['florist'],
  'boutique': ['clothing_store'],
  'jewelry store': ['jewelry_store'],
  'bookstore': ['book_store'],
  'gift shop': ['gift_shop'],
  'furniture store': ['furniture_store'],
  'hardware store': ['hardware_store'],
  // Auto
  'car dealership': ['car_dealer'],
  'auto repair shop': ['car_repair'],
  'tire shop': ['tire_shop'],
  'car wash': ['car_wash'],
  // Faith & community
  'church': ['church'],
  'synagogue': ['synagogue'],
  'community center': ['community_center'],
  'nonprofit': ['non_profit_organization'],
  // Civic
  'city hall': ['city_hall'],
  'post office': ['post_office'],
  'fire station': ['fire_station'],
  'police station': ['police'],
  // End-of-life
  'funeral home': ['funeral_home'],
  'cemetery': ['cemetery'],
};

function mapQueryToPlaceTypes(query?: string): string[] | undefined {
  if (!query) return undefined;
  const key = query.toLowerCase().trim().replace(/\s+/g, ' ');
  if (UI_TYPE_TO_PLACES_TYPES[key]) return UI_TYPE_TO_PLACES_TYPES[key];
  // Marketers often type "dental offices" instead of tapping the Dentist chip.
  if (/\bdentists?\b/.test(key) || /\bdental (office|offices|clinic|clinics|practice|practices)\b/.test(key)) {
    return DENTIST_TYPES;
  }
  return undefined;
}

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

/**
 * Stores in the same organization share a prospect pool: a dentist already
 * being worked (or already a customer) at West Jordan should not reappear
 * when the marketer generates around a sister store 8 miles away.
 *
 * Unassigned stores (no org) stay store-scoped.
 */
async function siblingStoreIds(storeId: string): Promise<string[]> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { organization_id: true },
  });
  if (!store?.organization_id) return [storeId];
  const siblings = await prisma.store.findMany({
    where: { organization_id: store.organization_id },
    select: { id: true },
  });
  return siblings.length > 0 ? siblings.map((s) => s.id) : [storeId];
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
  // Google Places v1 Text Search returns up to 20 results per call and a
  // nextPageToken we can echo back (up to 60 total). Nearby Search does
  // not paginate. The token is opaque and short-lived (~2min).
  const pageToken = typeof body?.pageToken === 'string' ? body.pageToken.trim() : '';
  const requestedRadiusM = typeof body.radiusM === 'number' && SEARCH_RADII_M.includes(body.radiusM as typeof SEARCH_RADII_M[number])
    ? body.radiusM
    : NEARBY_RADIUS_M;
  console.log('places-nearby request:', { storeId, textQuery, address: body.address, lat: body.lat, lng: body.lng, hasPageToken: !!pageToken, requestedRadiusM });
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  const can = await canViewStore(uid, storeId);
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

  const orgStoreIds = await siblingStoreIds(storeId);
  const [businessRows, oppRows] = await Promise.all([
    prisma.business.findMany({
      where: { store_id: { in: orgStoreIds }, place_id: { not: null } },
      select: { place_id: true },
    }),
    // This store: hide every opportunity, including dismissed (they already
    // passed on it here). Sister stores: hide only active/converted ones so
    // a "too far from us" dismiss at one location can still surface at another.
    prisma.opportunity.findMany({
      where: {
        OR: [
          { store_id: storeId },
          { store_id: { in: orgStoreIds }, status: { in: ['new', 'hold', 'converted'] } },
        ],
      },
      select: { place_id: true },
    }),
  ]);
  const existingSet = new Set<string>([
    ...businessRows.map((r) => r.place_id!).filter(Boolean),
    ...oppRows.map((r) => r.place_id),
  ]);

  try {
    let places: any[] = [];
    let nextPageToken: string | undefined;

    const out: Array<{ placeId: string; name: string; address?: string; city?: string; state?: string; zipCode?: string; distanceM?: number }> = [];
    const addFilteredPlaces = (sourcePlaces: any[], maxDistanceM: number) => {
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
          // Keep a true circular radius. Text Search uses a bounding box whose
          // corners sit ~1.41× farther than the requested miles.
          if (distanceM > maxDistanceM) continue;
        }

        existingSet.add(placeId);
        const name = p.displayName?.text || p.displayName || 'Unknown';
        const address = p.formattedAddress || undefined;
        const { city, state, zipCode } = parseAddressComponents(p.addressComponents);
        out.push({ placeId, name, address, city, state, zipCode, distanceM });
      }
    };

    // Search path:
    //   1. Known category (chip / dialog / "dental offices") → Nearby Search
    //      by Place Type, ranked by DISTANCE. This is the path marketers need:
    //      closest dentists, not the most-Googled ones 7 miles away.
    //   2. Blank filter → Nearby Search over DEFAULT_BUSINESS_TYPES.
    //   3. Free-typed phrase with no Place Type → Text Search.
    //
    // Nearby Search does not paginate (cap 20). If a fresh search has no
    // *new* results after excluding existing businesses/opportunities,
    // widen 10mi → 25mi → 50mi. Pagination must keep the radius that
    // produced the page token or Google rejects it.
    const mappedTypes = mapQueryToPlaceTypes(textQuery);
    const useNearbySearch = !pageToken && (mappedTypes != null || !textQuery);
    const includedTypes = mappedTypes || DEFAULT_BUSINESS_TYPES;
    const searchTerm = textQuery || 'business';
    const radiiToTry = pageToken
      ? [requestedRadiusM]
      : SEARCH_RADII_M.filter((radiusM) => radiusM >= requestedRadiusM);
    let searchRadiusM = requestedRadiusM;

    for (const radiusM of radiiToTry) {
      searchRadiusM = radiusM;

      if (useNearbySearch) {
        const nearbyRadiusM = Math.min(radiusM, MAX_NEARBY_RADIUS_M);
        console.log(
          'Using NEARBY SEARCH',
          mappedTypes ? `(mapped "${textQuery}" -> ${includedTypes.join(',')})` : '(no text query, default types)',
          `${nearbyRadiusM}m`
        );
        const nearbyRes = await axios.post(
          `${PLACES_API}:searchNearby`,
          {
            locationRestriction: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: nearbyRadiusM,
              },
            },
            maxResultCount: MAX_RESULTS,
            rankPreference: 'DISTANCE',
            includedTypes,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              // nextPageToken is invalid on searchNearby and Google rejects
              // the request if it appears in the field mask.
              'X-Goog-FieldMask': PLACE_FIELDS,
            },
          }
        );
        places = nearbyRes.data?.places || [];
        nextPageToken = undefined;
        addFilteredPlaces(places, nearbyRadiusM);
        if (out.length > 0) break;
        // DISTANCE rank always returns the closest N. If we already got a
        // full page and every hit was an existing business/opportunity,
        // a larger radius returns the same N.
        if (places.length === MAX_RESULTS) break;
      } else {
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
          `${PLACES_API}:searchText`,
          reqBody,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': `${PLACE_FIELDS},nextPageToken`,
            },
          }
        );
        places = textRes.data?.places || [];
        nextPageToken = textRes.data?.nextPageToken || undefined;
        addFilteredPlaces(places, radiusM);
        if (out.length > 0 || pageToken) break;
      }
    }

    // Sort by distance
    out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    return res.status(200).json({
      places: out,
      nextPageToken,
      searchRadiusM,
      expanded: !pageToken && searchRadiusM > requestedRadiusM,
    });
  } catch (err: any) {
    console.error('Places search error:', err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || 'Places search failed';
    return res.status(err?.response?.status || 500).json({ error: msg });
  }
}
