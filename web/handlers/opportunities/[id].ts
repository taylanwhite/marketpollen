import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore } from '../lib/store-access.js';

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

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Opportunity id required' });

  const opportunity = await prisma.opportunity.findUnique({ where: { id } });
  if (!opportunity) return res.status(404).json({ error: 'Opportunity not found' });

  const can = await canAccessStore(uid, opportunity.store_id);
  if (!can) return res.status(404).json({ error: 'Opportunity not found' });

  if (req.method === 'GET') return res.status(200).json(toOpportunityJson(opportunity));

  if (req.method === 'PATCH') {
    const body = req.body as { status?: string };
    if (body?.status === 'dismissed') {
      const updated = await prisma.opportunity.update({
        where: { id },
        data: { status: 'dismissed' },
      });
      return res.status(200).json(toOpportunityJson(updated));
    }
    return res.status(400).json({ error: 'Invalid status or no changes' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
