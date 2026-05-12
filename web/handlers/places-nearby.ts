import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

const NEARBY_RADIUS_M = 2000;
const MAX_RESULTS = 20;
const SAME_LOCATION_THRESHOLD_M = 50; // Filter out places within 50m of search center

/**
 * Broad set of business-shaped Place Types from Google Places API v1
 * Table A. Used as the default `includedTypes` for nearby search when the
 * marketer leaves the filter blank — keeps results to actual prospects
 * (no residences, parks, transit stops). Doubles as the type list that
 * lets us pair with `rankPreference: 'DISTANCE'` (which Google requires
 * to be used WITH a type list).
 */
const DEFAULT_BUSINESS_TYPES: string[] = [
  'restaurant', 'cafe', 'bakery', 'bar', 'meal_takeaway', 'food',
  'store', 'shopping_mall', 'clothing_store', 'florist', 'gift_shop',
  'jewelry_store', 'book_store',
  'beauty_salon', 'hair_care', 'spa', 'gym',
  'lodging',
  'real_estate_agency', 'insurance_agency', 'lawyer', 'accounting',
  'dentist', 'doctor', 'veterinary_care',
  'school', 'church', 'event_venue',
];

/**
 * UI filter labels → Google Places API v1 Table A type enums.
 *
 * The Opportunities page sends a free-text `textQuery` (the chip label or
 * dialog pick). When that label matches a known Place Type below, we route
 * the search through `searchNearby` with `includedTypes: [type]` + DISTANCE
 * rank — distance-ranked, type-filtered, no fuzzy text matching.
 *
 * Anything NOT in this map (free-typed text, "Mortgage company", etc.)
 * still works — it falls through to `searchText` as before. That keeps the
 * full dialog list usable even for categories without a clean Google type
 * (e.g. "Tutoring center", "Coworking space").
 *
 * Keys are lowercased for case-insensitive lookup. Only types we are
 * confident exist in v1 Table A are listed; adding an unknown type would
 * cause Google to reject the request.
 */
const UI_TYPE_TO_PLACES_TYPE: Record<string, string> = {
  // --- Quick chips on the page ---
  'real estate office': 'real_estate_agency',
  'law firm': 'lawyer',
  'event venue': 'event_venue',
  'hospital': 'hospital',
  'school': 'school',
  'bank': 'bank',
  'salon': 'beauty_salon',
  'dentist': 'dentist',
  // --- Professional services (dialog) ---
  'accountant': 'accounting',
  'insurance agency': 'insurance_agency',
  // --- Healthcare (dialog) ---
  'doctor office': 'doctor',
  'chiropractor': 'chiropractor',
  'veterinarian': 'veterinary_care',
  'physical therapy': 'physiotherapist',
  'pharmacy': 'pharmacy',
  // --- Events & hospitality (dialog) ---
  'wedding venue': 'wedding_venue',
  'hotel': 'lodging',
  'banquet hall': 'banquet_hall',
  'convention center': 'convention_center',
  // --- Education (dialog) ---
  'elementary school': 'primary_school',
  'high school': 'secondary_school',
  'preschool': 'preschool',
  'college': 'university',
  'library': 'library',
  // --- Personal services (dialog) ---
  'spa': 'spa',
  'barber shop': 'barber_shop',
  'nail salon': 'nail_salon',
  // --- Fitness & wellness (dialog) ---
  'gym': 'gym',
  'yoga studio': 'yoga_studio',
  // --- Retail & local (dialog) ---
  'florist': 'florist',
  'boutique': 'clothing_store',
  'jewelry store': 'jewelry_store',
  'bookstore': 'book_store',
  'gift shop': 'gift_shop',
  'furniture store': 'furniture_store',
  'hardware store': 'hardware_store',
  // --- Auto (dialog) ---
  'car dealership': 'car_dealer',
  'auto repair shop': 'car_repair',
  'car wash': 'car_wash',
  // --- Faith & community (dialog) ---
  'church': 'church',
  'synagogue': 'synagogue',
  'community center': 'community_center',
  // --- Civic (dialog) ---
  'city hall': 'city_hall',
  'post office': 'post_office',
  'fire station': 'fire_station',
  'police station': 'police',
  // --- End-of-life (dialog) ---
  'funeral home': 'funeral_home',
  'cemetery': 'cemetery',
};

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

  const body = req.body as { storeId: string; address?: string; lat?: number; lng?: number; textQuery?: string; pageToken?: string };
  const storeId = body?.storeId?.trim();
  const textQuery = body?.textQuery?.trim();
  // Google Places v1 returns up to 20 results per call and a nextPageToken
  // we can echo back to grab the next batch (up to 60 total). The token is
  // opaque and short-lived (~2min), so the client treats it as ephemeral.
  const pageToken = typeof body?.pageToken === 'string' ? body.pageToken.trim() : '';
  console.log('places-nearby request:', { storeId, textQuery, address: body.address, lat: body.lat, lng: body.lng, hasPageToken: !!pageToken });
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

    // Field masks: we keep them tight so we only pay for fields we render.
    //
    // IMPORTANT: `nextPageToken` is ONLY a valid response field on
    // `places:searchText`. The `places:searchNearby` endpoint doesn't
    // paginate (Google caps it at 20 results, no token), and including
    // `nextPageToken` in its field mask makes Google reject the entire
    // request with "Request contains an invalid argument" — which is
    // exactly the symptom users hit on every chip tap.
    const placeFields = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location';
    const textSearchFieldMask = `${placeFields},nextPageToken`;
    const nearbyFieldMask = placeFields;

    // Decide which Google endpoint to hit based on the filter:
    //
    //   1. No filter            → searchNearby + DEFAULT_BUSINESS_TYPES + DISTANCE
    //   2. Filter maps to type  → searchNearby + [mappedType]          + DISTANCE
    //   3. Filter is free-text  → searchText  (popularity-ranked, but the only
    //                                          way to honor arbitrary phrases
    //                                          like "Mortgage company" that
    //                                          Google has no enum for)
    //
    // Branches 1 and 2 are the preferred path because searchNearby supports
    // DISTANCE rank — that's what the field marketer actually needs (closest
    // prospects to their store, not most popular). Branch 3 is the escape
    // hatch that keeps every entry in the dialog usable, even ones we don't
    // have a Place Type for.
    const mappedType = textQuery ? UI_TYPE_TO_PLACES_TYPE[textQuery.toLowerCase()] : undefined;
    const useTextSearch = !!textQuery && !mappedType;

    if (useTextSearch) {
      // Free-text fallback. Used when the marketer typed something custom
      // or picked a dialog entry without a clean Google Place Type. Note:
      // searchText is popularity-ranked — there's no DISTANCE option on
      // this endpoint — but locationBias keeps results in the radius and
      // we still re-sort by computed distance in the loop below.
      console.log('Using TEXT SEARCH with query:', textQuery, pageToken ? '(page 2+)' : '(page 1)');
      const reqBody: Record<string, unknown> = {
        textQuery,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: NEARBY_RADIUS_M,
          },
        },
        maxResultCount: MAX_RESULTS,
      };
      // Google requires the original textQuery + locationBias on every page
      // request, AND the pageToken. Sending the token alone returns an error.
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
    } else {
      // Nearby Search — distance-ranked, type-filtered.
      //
      // CRITICAL: this MUST stay distance-ranked. Marketers in the field walk
      // a route from their selected store and need the closest prospects
      // first, not Google's most popular ones (a popular place 1.8km away is
      // useless if there's an unvisited business 200m away).
      //
      // Google Places v1 has two interlocking constraints we honor together
      // to make distance-ranked nearby search work:
      //   1. `rankPreference: DISTANCE` is ONLY valid when the request also
      //      specifies `includedTypes` or `includedPrimaryTypes`. Sending
      //      DISTANCE without types returns "Request contains an invalid
      //      argument".
      //   2. Without any type list, searchNearby returns a grab-bag that
      //      includes residences, parks, transit stops, etc. that aren't
      //      useful prospects for a wholesale bakery.
      //
      // Solution: ALWAYS send a type list AND keep DISTANCE rank. When the
      // marketer picked a known category we narrow to that single type; when
      // they left the filter blank we fall back to the broad default list.
      const includedTypes = mappedType ? [mappedType] : DEFAULT_BUSINESS_TYPES;
      console.log(
        'Using NEARBY SEARCH',
        mappedType ? `(mapped "${textQuery}" -> ${mappedType})` : '(no text query, default types)'
      );
      // NOTE: places:searchNearby does NOT support pagination in v1 — there's
      // no `pageToken` request param and no `nextPageToken` response field.
      // The client may still send a pageToken (it doesn't know which Google
      // endpoint we'll route to), but we deliberately ignore it here and let
      // the response carry an undefined nextPageToken so the UI's infinite
      // scroll cleanly stops at "That's everything Google found."
      const reqBody: Record<string, unknown> = {
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: NEARBY_RADIUS_M,
          },
        },
        maxResultCount: MAX_RESULTS,
        // Closest business-shaped places first - see the comment block above
        // for why we cannot drop this. The in-memory sort below only
        // re-orders Google's chosen 20; without DISTANCE we get
        // popular-but-far places, not the actual nearest.
        rankPreference: 'DISTANCE',
        includedTypes,
      };
      const nearbyRes = await axios.post(
        'https://places.googleapis.com/v1/places:searchNearby',
        reqBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': nearbyFieldMask,
          },
        }
      );
      places = nearbyRes.data?.places || [];
      nextPageToken = undefined;
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
    return res.status(200).json({ places: out, nextPageToken });
  } catch (err: any) {
    console.error('Places search error:', err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || 'Places search failed';
    return res.status(err?.response?.status || 500).json({ error: msg });
  }
}
