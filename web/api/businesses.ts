import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

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

  const storeId = (req.query?.storeId as string)?.trim();
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  const can = await canAccessStore(uid, storeId);
  if (!can) return res.status(404).json({ error: 'Store not found' });

  if (req.method === 'GET') {
    const rows = await prisma.business.findMany({
      where: { store_id: storeId },
      orderBy: { name: 'asc' },
    });
    return res.status(200).json(rows.map(toBusinessJson));
  }

  if (req.method === 'POST') {
    const body = req.body as { name: string; address?: string; city?: string; state?: string; zipCode?: string; placeId?: string };
    if (!body?.name || typeof body.name !== 'string') return res.status(400).json({ error: 'name is required' });
    const row = await prisma.business.create({
      data: {
        store_id: storeId,
        name: body.name,
        address: body.address ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        zip_code: body.zipCode ?? null,
        place_id: body.placeId ?? null,
        created_by: uid,
      },
    });
    return res.status(201).json(toBusinessJson(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
