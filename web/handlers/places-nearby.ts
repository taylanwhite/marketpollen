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
// Smallest area the map's "Search this area" will search.
const MIN_AREA_RADIUS_M = 400;
const SAME_LOCATION_THRESHOLD_M = 50; // Filter out places within 50m of search center
// Nearby Search (New) only accepts a circular radius up to 50km.
const MAX_NEARBY_RADIUS_M = 50_000;
// Nearby Search only returns the 20 closest places. When those are already
// businesses or opportunities somewhere in the organization, search again from
// points spread around the store so places farther out still show up.
const RING_FRACTIONS = [0.25, 0.55];
const RING_BEARINGS_DEG = [0, 60, 120, 180, 240, 300];
const MAX_RETURNED = 40;
// Text Search pages hold 20 results and stop after 3 pages.
const MAX_TEXT_EXTRA_PAGES = 2;

type GooglePlace = {
  id?: string;
  name?: string;
  displayName?: { text?: string } | string;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
};

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
  'real estate': ['real_estate_agency'],
  'real estate agent': ['real_estate_agency'],
  'real estate agents': ['real_estate_agency'],
  'realtor': ['real_estate_agency'],
  'realtors': ['real_estate_agency'],
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
  // Education. "Middle school" stays unmapped: Google has no middle_school
  // type, and secondary_school is the high-school bucket. Text Search for
  // the phrase matches school names.
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

/** The point `distanceM` meters from (lat, lng) in the given compass direction. */
function offsetPoint(lat: number, lng: number, distanceM: number, bearingDeg: number) {
  const R = 6371000;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const angular = distanceM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
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

const MAX_ZIP_CODES = 10;
const ZIPS_IN_PARALLEL = 3;
// A zip's search circle covers its whole area, within these limits.
const MIN_ZIP_RADIUS_M = 1500;
const MAX_ZIP_RADIUS_M = Math.round(15 * METERS_PER_MILE);

/** "84095, 84096 84020" or ["84095"] -> unique 5-digit zips, in order. */
function parseZipCodes(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
  const zips = raw.match(/\b\d{5}\b/g) || [];
  return [...new Set(zips)].slice(0, MAX_ZIP_CODES);
}

/** The center of a US zip code and a radius that reaches its corners. */
async function zipArea(zip: string, apiKey: string): Promise<{ lat: number; lng: number; radiusM: number } | null> {
  try {
    const geoRes = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { components: `postal_code:${zip}|country:US`, key: apiKey },
    });
    const result = geoRes.data?.results?.[0];
    const loc = result?.geometry?.location;
    if (!loc || !(result.types || []).includes('postal_code')) return null;
    const box = result.geometry.bounds || result.geometry.viewport;
    let radiusM = MIN_ZIP_RADIUS_M;
    if (box?.northeast && box?.southwest) {
      radiusM = Math.max(
        distanceMeters(loc.lat, loc.lng, box.northeast.lat, box.northeast.lng),
        distanceMeters(loc.lat, loc.lng, box.southwest.lat, box.southwest.lng),
      );
    }
    return { lat: loc.lat, lng: loc.lng, radiusM: Math.round(Math.min(Math.max(radiusM, MIN_ZIP_RADIUS_M), MAX_ZIP_RADIUS_M)) };
  } catch (err: any) {
    console.error('Zip geocode error:', zip, err?.response?.data || err?.message);
    return null;
  }
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

  // `exactRadius` is the Map tab's "Search this area": search only the circle
  // on screen, at any size, and never widen it.
  const body = req.body as { storeId: string; address?: string; lat?: number; lng?: number; textQuery?: string; pageToken?: string; radiusM?: number; exactRadius?: boolean; zipCodes?: unknown };
  const zipCodes = parseZipCodes(body?.zipCodes);
  const exactRadius = body?.exactRadius === true && typeof body.radiusM === 'number' && Number.isFinite(body.radiusM);
  const storeId = body?.storeId?.trim();
  const textQuery = body?.textQuery?.trim();
  // Google Places v1 Text Search returns up to 20 results per call and a
  // nextPageToken we can echo back (up to 60 total). Nearby Search does
  // not paginate. The token is opaque and short-lived (~2min).
  const pageToken = typeof body?.pageToken === 'string' ? body.pageToken.trim() : '';
  const requestedRadiusM = exactRadius
    ? Math.round(Math.min(Math.max(body.radiusM!, MIN_AREA_RADIUS_M), MAX_RADIUS_M))
    : typeof body.radiusM === 'number' && SEARCH_RADII_M.includes(body.radiusM as typeof SEARCH_RADII_M[number])
      ? body.radiusM
      : NEARBY_RADIUS_M;
  console.log('places-nearby request:', { storeId, textQuery, zipCodes, address: body.address, lat: body.lat, lng: body.lng, hasPageToken: !!pageToken, requestedRadiusM });
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  const can = await canViewStore(uid, storeId);
  if (!can) return res.status(404).json({ error: 'Store not found' });

  let lat = body.lat;
  let lng = body.lng;
  if (zipCodes.length === 0 && (lat == null || lng == null)) {
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

  type OutPlace = { placeId: string; name: string; address?: string; city?: string; state?: string; zipCode?: string; distanceM?: number; lat?: number; lng?: number };

  /**
   * Search around one center point and return places not yet in the
   * organization. `onlyZip` keeps just the places inside that zip code.
   */
  const searchFrom = async (
    centerLat: number,
    centerLng: number,
    radiiToTry: number[],
    opts: { pageToken?: string; onlyZip?: string; skipStoreSpot?: boolean } = {},
  ): Promise<{ out: OutPlace[]; nextPageToken?: string; searchRadiusM: number }> => {
    let places: any[] = [];
    let nextPageToken: string | undefined;

    const out: OutPlace[] = [];
    const addFilteredPlaces = (sourcePlaces: any[], maxDistanceM: number) => {
      for (const p of sourcePlaces) {
        const placeId = placeIdFromName(p.name) || placeIdFromName(p.id) || (p.id && typeof p.id === 'string' ? p.id.replace(/^places\//, '') : null);
        if (!placeId || existingSet.has(placeId)) continue;

        const { city, state, zipCode } = parseAddressComponents(p.addressComponents);
        if (opts.onlyZip && zipCode?.slice(0, 5) !== opts.onlyZip) continue;

        const placeLat = p.location?.latitude;
        const placeLng = p.location?.longitude;
        let distanceM: number | undefined;
        if (placeLat != null && placeLng != null) {
          distanceM = distanceMeters(centerLat, centerLng, placeLat, placeLng);
          // Filter out places at or very near the search location (the store's own address).
          if (!opts.skipStoreSpot && distanceM < SAME_LOCATION_THRESHOLD_M) continue;
          // Keep a true circular radius. Text Search uses a bounding box whose
          // corners sit ~1.41× farther than the requested miles.
          if (distanceM > maxDistanceM) continue;
        }

        existingSet.add(placeId);
        const name = p.displayName?.text || p.displayName || 'Unknown';
        const address = p.formattedAddress || undefined;
        out.push({ placeId, name, address, city, state, zipCode, distanceM, lat: placeLat, lng: placeLng });
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
    const token = opts.pageToken || '';
    const mappedTypes = mapQueryToPlaceTypes(textQuery);
    const useNearbySearch = !token && (mappedTypes != null || !textQuery);
    const includedTypes = mappedTypes || DEFAULT_BUSINESS_TYPES;
    const searchTerm = textQuery || 'business';
    let searchRadiusM = radiiToTry[0];

    for (const radiusM of radiiToTry) {
      searchRadiusM = radiusM;

      if (useNearbySearch) {
        const nearbyRadiusM = Math.min(radiusM, MAX_NEARBY_RADIUS_M);
        const searchNearbyFrom = async (fromLat: number, fromLng: number): Promise<GooglePlace[]> => {
          const nearbyRes = await axios.post(
            `${PLACES_API}:searchNearby`,
            {
              locationRestriction: {
                circle: {
                  center: { latitude: fromLat, longitude: fromLng },
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
          return nearbyRes.data?.places || [];
        };

        places = await searchNearbyFrom(centerLat, centerLng);
        nextPageToken = undefined;
        addFilteredPlaces(places, nearbyRadiusM);

        // A full page means there are more places past the closest 20.
        // Search from rings of points around the center until we have a full list.
        if (out.length < MAX_RESULTS && places.length === MAX_RESULTS) {
          for (const fraction of RING_FRACTIONS) {
            const ringResults = await Promise.all(
              RING_BEARINGS_DEG.map((bearing) => {
                const point = offsetPoint(centerLat, centerLng, nearbyRadiusM * fraction, bearing);
                return searchNearbyFrom(point.lat, point.lng).catch((err) => {
                  console.error('Ring nearby search failed:', err?.response?.data || err?.message);
                  return [] as GooglePlace[];
                });
              })
            );
            for (const ringPlaces of ringResults) addFilteredPlaces(ringPlaces, nearbyRadiusM);
            if (out.length >= MAX_RESULTS) break;
          }
        }
        if (out.length > 0) break;
      } else {
        const searchTextFrom = async (
          fromLat: number,
          fromLng: number,
          pageTok?: string,
        ): Promise<{ places: GooglePlace[]; nextPageToken?: string }> => {
          const reqBody: Record<string, unknown> = {
            textQuery: searchTerm,
            locationRestriction: {
              rectangle: buildBoundingBox(fromLat, fromLng, radiusM),
            },
            maxResultCount: MAX_RESULTS,
            rankPreference: 'DISTANCE',
          };
          // Google requires the original textQuery + location restriction on every
          // page request, AND the pageToken. Sending the token alone returns an error.
          if (pageTok) reqBody.pageToken = pageTok;
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
          return { places: textRes.data?.places || [], nextPageToken: textRes.data?.nextPageToken || undefined };
        };

        const first = await searchTextFrom(centerLat, centerLng, token || undefined);
        places = first.places;
        nextPageToken = first.nextPageToken;
        addFilteredPlaces(places, radiusM);
        if (token) break;

        // The closest matches are often already taken in the organization.
        // Keep reading Google's next pages (up to 60 total) before giving up.
        let extraPages = 0;
        while (out.length < MAX_RESULTS && nextPageToken && extraPages < MAX_TEXT_EXTRA_PAGES) {
          extraPages += 1;
          const page = await searchTextFrom(centerLat, centerLng, nextPageToken);
          nextPageToken = page.nextPageToken;
          addFilteredPlaces(page.places, radiusM);
        }

        // Still short and Google ran out of pages: search again from points
        // around the center to reach places past Google's 60-result limit.
        if (out.length < MAX_RESULTS && !nextPageToken && places.length === MAX_RESULTS) {
          for (const fraction of RING_FRACTIONS) {
            const ringResults = await Promise.all(
              RING_BEARINGS_DEG.map((bearing) => {
                const point = offsetPoint(centerLat, centerLng, radiusM * fraction, bearing);
                return searchTextFrom(point.lat, point.lng).catch((err) => {
                  console.error('Ring text search failed:', err?.response?.data || err?.message);
                  return { places: [] as GooglePlace[] };
                });
              })
            );
            for (const ring of ringResults) addFilteredPlaces(ring.places, radiusM);
            if (out.length >= MAX_RESULTS) break;
          }
        }
        if (out.length > 0) break;
      }
    }

    return { out, nextPageToken, searchRadiusM };
  };

  try {
    if (zipCodes.length > 0) {
      // One search per zip, each inside that zip's own area. Places that
      // Google returns from a neighboring zip are dropped.
      const areas = await Promise.all(zipCodes.map((zip) => zipArea(zip, apiKey)));
      const missing = zipCodes.filter((_, i) => !areas[i]);
      const zipResults: Array<{ zip: string; places: OutPlace[] }> = [];
      // A few zips at a time keeps Google from rate-limiting the ring searches.
      for (let i = 0; i < zipCodes.length; i += ZIPS_IN_PARALLEL) {
        const batch = zipCodes.slice(i, i + ZIPS_IN_PARALLEL).map(async (zip, j) => {
          const area = areas[i + j];
          if (!area) return null;
          const { out } = await searchFrom(area.lat, area.lng, [area.radiusM], { onlyZip: zip, skipStoreSpot: true });
          out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
          return { zip, places: out };
        });
        for (const result of await Promise.all(batch)) if (result) zipResults.push(result);
      }
      // Take from each zip in turn so one busy zip can't crowd out the rest.
      const merged: OutPlace[] = [];
      const limit = Math.max(MAX_RETURNED, zipCodes.length * 10);
      for (let round = 0; merged.length < limit; round += 1) {
        let added = false;
        for (const { places } of zipResults) {
          if (places[round]) {
            merged.push({ ...places[round], distanceM: undefined });
            added = true;
          }
        }
        if (!added) break;
      }
      return res.status(200).json({
        places: merged.slice(0, limit),
        zipCodes: zipResults.map((r) => ({ zip: r.zip, count: r.places.length })),
        missingZipCodes: missing,
      });
    }

    const radiiToTry = pageToken || exactRadius
      ? [requestedRadiusM]
      : SEARCH_RADII_M.filter((radiusM) => radiusM >= requestedRadiusM);
    const { out, nextPageToken, searchRadiusM } = await searchFrom(lat!, lng!, radiiToTry, { pageToken });

    // Sort by distance
    out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    return res.status(200).json({
      places: out.slice(0, MAX_RETURNED),
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
