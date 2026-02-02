import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore } from '../lib/store-access.js';
import { searchNearby, searchText, getPlaceDetails, PlaceBasic, PlaceDetails } from '../lib/places-client.js';

interface DiscoverySearchRequest {
  storeId: string;
  mode: 'NEARBY' | 'TEXT';
  // For NEARBY mode
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
  includedTypes?: string[];
  // For TEXT mode
  textQuery?: string;
  includedType?: string;
  strictTypeFiltering?: boolean;
}

interface DiscoverySearchResponse {
  newPlaces: PlaceDetails[];
  existingCount: number;
  totalSearchResults: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uid = await getAuthUid(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body as DiscoverySearchRequest;
  const { storeId, mode } = body;

  if (!storeId?.trim()) {
    return res.status(400).json({ error: 'storeId required' });
  }

  if (!mode || !['NEARBY', 'TEXT'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "NEARBY" or "TEXT"' });
  }

  const can = await canAccessStore(uid, storeId);
  if (!can) {
    return res.status(404).json({ error: 'Store not found' });
  }

  try {
    // Step 1: Execute search based on mode
    let searchResults: PlaceBasic[];

    if (mode === 'NEARBY') {
      const { centerLat, centerLng, radiusM, includedTypes } = body;
      if (centerLat == null || centerLng == null) {
        return res.status(400).json({ error: 'centerLat and centerLng required for NEARBY mode' });
      }
      searchResults = await searchNearby({
        centerLat,
        centerLng,
        radiusM,
        includedTypes,
      });
    } else {
      const { textQuery, centerLat, centerLng, radiusM, includedType, strictTypeFiltering } = body;
      if (!textQuery?.trim()) {
        return res.status(400).json({ error: 'textQuery required for TEXT mode' });
      }
      searchResults = await searchText({
        textQuery,
        centerLat,
        centerLng,
        radiusM,
        includedType,
        strictTypeFiltering,
      });
    }

    const totalSearchResults = searchResults.length;

    if (totalSearchResults === 0) {
      return res.status(200).json({
        newPlaces: [],
        existingCount: 0,
        totalSearchResults: 0,
      } as DiscoverySearchResponse);
    }

    // Step 2: Check which places already exist in DiscoveredPlace table
    const placeIds = searchResults.map(p => p.placeId);
    const existingPlaces = await prisma.discoveredPlace.findMany({
      where: { place_id: { in: placeIds } },
      select: { place_id: true },
    });
    const existingPlaceIds = new Set(existingPlaces.map(p => p.place_id));

    // Step 3: Separate new vs existing places
    const newBasicPlaces = searchResults.filter(p => !existingPlaceIds.has(p.placeId));
    const existingCount = totalSearchResults - newBasicPlaces.length;

    // Step 4: Update last_seen_at for existing places
    if (existingPlaceIds.size > 0) {
      await prisma.discoveredPlace.updateMany({
        where: { place_id: { in: Array.from(existingPlaceIds) } },
        data: { last_seen_at: new Date() },
      });
    }

    // Step 5: Enrich and insert new places
    const newPlaces: PlaceDetails[] = [];

    for (const basicPlace of newBasicPlaces) {
      try {
        // Call Place Details API for enrichment
        const details = await getPlaceDetails(basicPlace.placeId);

        // Insert into DiscoveredPlace table with ENRICHED status
        await prisma.discoveredPlace.create({
          data: {
            place_id: details.placeId,
            name: details.name,
            primary_type: details.primaryType,
            formatted_address: details.formattedAddress,
            lat: details.lat,
            lng: details.lng,
            status: 'ENRICHED',
            enriched_at: new Date(),
            phone: details.phone,
            website: details.website,
            rating: details.rating,
            review_count: details.reviewCount,
            price_level: details.priceLevel,
            opening_hours: details.openingHours || undefined,
          },
        });

        newPlaces.push(details);
      } catch (err: any) {
        // If enrichment fails, insert with NEW status and basic info
        console.error(`Failed to enrich place ${basicPlace.placeId}:`, err?.message);
        try {
          await prisma.discoveredPlace.create({
            data: {
              place_id: basicPlace.placeId,
              name: basicPlace.name,
              primary_type: basicPlace.primaryType,
              formatted_address: basicPlace.formattedAddress,
              lat: basicPlace.lat,
              lng: basicPlace.lng,
              status: 'NEW',
            },
          });
          // Still include in response with basic info
          newPlaces.push({
            placeId: basicPlace.placeId,
            name: basicPlace.name,
            formattedAddress: basicPlace.formattedAddress,
            primaryType: basicPlace.primaryType,
            lat: basicPlace.lat,
            lng: basicPlace.lng,
          });
        } catch (insertErr: any) {
          // Skip if insert also fails (e.g., race condition duplicate)
          console.error(`Failed to insert place ${basicPlace.placeId}:`, insertErr?.message);
        }
      }
    }

    return res.status(200).json({
      newPlaces,
      existingCount,
      totalSearchResults,
    } as DiscoverySearchResponse);
  } catch (err: any) {
    console.error('Discovery search error:', err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || 'Discovery search failed';
    return res.status(err?.response?.status || 500).json({ error: msg });
  }
}
