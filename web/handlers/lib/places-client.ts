import axios from 'axios';

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

export interface NearbySearchParams {
  centerLat: number;
  centerLng: number;
  radiusM?: number;
  includedTypes?: string[];
  maxResultCount?: number;
}

export interface TextSearchParams {
  textQuery: string;
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
  includedType?: string;
  strictTypeFiltering?: boolean;
  maxResultCount?: number;
}

export interface PlaceBasic {
  placeId: string;
  name: string;
  formattedAddress?: string;
  primaryType?: string;
  lat?: number;
  lng?: number;
}

export interface PlaceDetails extends PlaceBasic {
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  openingHours?: {
    weekdayDescriptions?: string[];
    openNow?: boolean;
  };
}

/** Extract place ID from Places API v1 resource name "places/ChIJ..." */
function placeIdFromName(name: string | undefined): string | null {
  if (!name || typeof name !== 'string') return null;
  const prefix = 'places/';
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function getApiKey(): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY environment variable is not configured');
  }
  return apiKey;
}

/**
 * Nearby Search (New) API - searches for places within a circular area
 * Uses minimal field mask for cost efficiency
 */
export async function searchNearby(params: NearbySearchParams): Promise<PlaceBasic[]> {
  const apiKey = getApiKey();
  const { centerLat, centerLng, radiusM = 2000, includedTypes, maxResultCount = 20 } = params;

  const requestBody: Record<string, unknown> = {
    locationRestriction: {
      circle: {
        center: { latitude: centerLat, longitude: centerLng },
        radius: radiusM,
      },
    },
    maxResultCount,
    rankPreference: 'DISTANCE',
  };

  if (includedTypes && includedTypes.length > 0) {
    requestBody.includedTypes = includedTypes;
  }

  const response = await axios.post(
    `${PLACES_API_BASE}/places:searchNearby`,
    requestBody,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryType,places.location',
      },
    }
  );

  const places = response.data?.places || [];
  return places.map((p: any) => ({
    placeId: placeIdFromName(p.name) || placeIdFromName(p.id) || p.id?.replace(/^places\//, '') || '',
    name: p.displayName?.text || p.displayName || 'Unknown',
    formattedAddress: p.formattedAddress || undefined,
    primaryType: p.primaryType || undefined,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  })).filter((p: PlaceBasic) => p.placeId);
}

/**
 * Text Search (New) API - searches for places using a text query
 * Uses minimal field mask for cost efficiency
 */
export async function searchText(params: TextSearchParams): Promise<PlaceBasic[]> {
  const apiKey = getApiKey();
  const { textQuery, centerLat, centerLng, radiusM = 2000, includedType, strictTypeFiltering = false, maxResultCount = 20 } = params;

  const requestBody: Record<string, unknown> = {
    textQuery,
    maxResultCount,
  };

  if (centerLat != null && centerLng != null) {
    requestBody.locationBias = {
      circle: {
        center: { latitude: centerLat, longitude: centerLng },
        radius: radiusM,
      },
    };
  }

  if (includedType) {
    requestBody.includedType = includedType;
    requestBody.strictTypeFiltering = strictTypeFiltering;
  }

  const response = await axios.post(
    `${PLACES_API_BASE}/places:searchText`,
    requestBody,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryType,places.location',
      },
    }
  );

  const places = response.data?.places || [];
  return places.map((p: any) => ({
    placeId: placeIdFromName(p.name) || placeIdFromName(p.id) || p.id?.replace(/^places\//, '') || '',
    name: p.displayName?.text || p.displayName || 'Unknown',
    formattedAddress: p.formattedAddress || undefined,
    primaryType: p.primaryType || undefined,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  })).filter((p: PlaceBasic) => p.placeId);
}

/**
 * Place Details API - fetches full details for a place
 * Called only for new places to enrich with contact info, ratings, etc.
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const apiKey = getApiKey();

  const response = await axios.get(
    `${PLACES_API_BASE}/places/${placeId}`,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'id',
          'displayName',
          'formattedAddress',
          'primaryType',
          'location',
          'nationalPhoneNumber',
          'internationalPhoneNumber',
          'websiteUri',
          'rating',
          'userRatingCount',
          'priceLevel',
          'currentOpeningHours',
        ].join(','),
      },
    }
  );

  const p = response.data;
  const extractedPlaceId = placeIdFromName(p.name) || placeIdFromName(p.id) || placeId;

  // Map price level enum to number (if present)
  let priceLevel: number | undefined;
  if (p.priceLevel) {
    const priceLevelMap: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };
    priceLevel = priceLevelMap[p.priceLevel];
  }

  return {
    placeId: extractedPlaceId,
    name: p.displayName?.text || p.displayName || 'Unknown',
    formattedAddress: p.formattedAddress || undefined,
    primaryType: p.primaryType || undefined,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || undefined,
    website: p.websiteUri || undefined,
    rating: p.rating,
    reviewCount: p.userRatingCount,
    priceLevel,
    openingHours: p.currentOpeningHours ? {
      weekdayDescriptions: p.currentOpeningHours.weekdayDescriptions,
      openNow: p.currentOpeningHours.openNow,
    } : undefined,
  };
}
