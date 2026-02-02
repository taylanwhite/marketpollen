import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

function toOpportunityJson(r: { id: string; store_id: string; place_id: string; name: string; address: string | null; city: string | null; state: string | null; zip_code: string | null; status: string; business_id: string | null; created_at: Date; created_by: string; converted_at: Date | null }) {
  return {
    id: r.id,
    storeId: r.store_id,
    placeId: r.place_id,
    name: r.name,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zipCode: r.zip_code ?? undefined,
    status: r.status,
    businessId: r.business_id ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by,
    convertedAt: r.converted_at ?? undefined,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const storeId = (req.query?.storeId as string)?.trim();
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  const can = await canAccessStore(uid, storeId);
  if (!can) return res.status(404).json({ error: 'Store not found' });

  if (req.method === 'GET') {
    const status = (req.query?.status as string)?.trim() || 'new';
    const rows = await prisma.opportunity.findMany({
      where: { store_id: storeId, status },
      orderBy: { created_at: 'desc' },
    });
    return res.status(200).json(rows.map(toOpportunityJson));
  }

  if (req.method === 'POST') {
    const body = req.body as {
      opportunities: Array<{ placeId: string; name: string; address?: string; city?: string; state?: string; zipCode?: string }>;
    };
    if (!Array.isArray(body?.opportunities) || body.opportunities.length === 0) {
      return res.status(400).json({ error: 'opportunities array is required' });
    }
    const inserted: ReturnType<typeof toOpportunityJson>[] = [];
    for (const opp of body.opportunities) {
      if (!opp?.placeId || typeof opp.placeId !== 'string' || !opp?.name || typeof opp.name !== 'string') continue;
      try {
        const row = await prisma.opportunity.create({
          data: {
            store_id: storeId,
            place_id: opp.placeId,
            name: opp.name,
            address: opp.address ?? null,
            city: opp.city ?? null,
            state: opp.state ?? null,
            zip_code: opp.zipCode ?? null,
            status: 'new',
            created_by: uid,
          },
        });
        inserted.push(toOpportunityJson(row));
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') continue;
        throw e;
      }
    }
    return res.status(201).json(inserted);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
