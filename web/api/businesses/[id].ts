import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore } from '../lib/store-access.js';

function toBusinessJson(r: { id: string; store_id: string; name: string; address: string | null; city: string | null; state: string | null; zip_code: string | null; place_id: string | null; created_at: Date; created_by: string }) {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zipCode: r.zip_code ?? undefined,
    placeId: r.place_id ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Business id required' });

  const business = await prisma.business.findUnique({ where: { id } });
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const can = await canAccessStore(uid, business.store_id);
  if (!can) return res.status(404).json({ error: 'Business not found' });

  if (req.method === 'GET') return res.status(200).json(toBusinessJson(business));

  if (req.method === 'PATCH') {
    const body = req.body as { name?: string; address?: string; city?: string; state?: string; zipCode?: string; placeId?: string };
    const updated = await prisma.business.update({
      where: { id },
      data: {
        ...(body?.name !== undefined && { name: body.name }),
        ...(body?.address !== undefined && { address: body.address }),
        ...(body?.city !== undefined && { city: body.city }),
        ...(body?.state !== undefined && { state: body.state }),
        ...(body?.zipCode !== undefined && { zip_code: body.zipCode }),
        ...(body?.placeId !== undefined && { place_id: body.placeId }),
      },
    });
    return res.status(200).json(toBusinessJson(updated));
  }

  if (req.method === 'DELETE') {
    await prisma.business.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
