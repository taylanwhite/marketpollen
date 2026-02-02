import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';

interface DiscoveredPlaceResponse {
  id: string;
  placeId: string;
  name: string | null;
  primaryType: string | null;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  enrichedAt: string | null;
  status: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  openingHours: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uid = await getAuthUid(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Verify user exists (any authenticated user can query discovered places)
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true },
  });
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  try {
    const { status, primaryType, limit, offset } = req.query;

    const where: Record<string, unknown> = {};

    if (status && typeof status === 'string') {
      where.status = status;
    }

    if (primaryType && typeof primaryType === 'string') {
      where.primary_type = primaryType;
    }

    const take = Math.min(parseInt(limit as string) || 50, 100);
    const skip = parseInt(offset as string) || 0;

    const [places, total] = await Promise.all([
      prisma.discoveredPlace.findMany({
        where,
        orderBy: { last_seen_at: 'desc' },
        take,
        skip,
      }),
      prisma.discoveredPlace.count({ where }),
    ]);

    const response: DiscoveredPlaceResponse[] = places.map(p => ({
      id: p.id,
      placeId: p.place_id,
      name: p.name,
      primaryType: p.primary_type,
      formattedAddress: p.formatted_address,
      lat: p.lat,
      lng: p.lng,
      firstSeenAt: p.first_seen_at.toISOString(),
      lastSeenAt: p.last_seen_at.toISOString(),
      enrichedAt: p.enriched_at?.toISOString() || null,
      status: p.status,
      phone: p.phone,
      website: p.website,
      rating: p.rating,
      reviewCount: p.review_count,
      priceLevel: p.price_level,
      openingHours: p.opening_hours,
    }));

    return res.status(200).json({
      places: response,
      total,
      limit: take,
      offset: skip,
    });
  } catch (err: any) {
    console.error('Discovered places query error:', err);
    return res.status(500).json({ error: err?.message || 'Query failed' });
  }
}
