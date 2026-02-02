import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { requireAuth } from './lib/auth.js';

function toStoreJson(r: { id: string; name: string; address: string | null; city: string | null; state: string | null; zip_code: string | null; created_at: Date; created_by: string }) {
  return {
    id: r.id,
    name: r.name,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zipCode: r.zip_code ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { is_global_admin: true, store_permissions: { select: { store_id: true } } },
    });
    if (!user) return res.status(200).json([]);
    const storeIds = user.is_global_admin
      ? undefined
      : user.store_permissions.map((p) => p.store_id);
    const rows = await prisma.store.findMany({
      where: user.is_global_admin ? undefined : { id: { in: storeIds! } },
      orderBy: { name: 'asc' },
    });
    return res.status(200).json(rows.map(toStoreJson));
  }

  if (req.method === 'POST') {
    await requireAuth(req);
    const body = req.body as { name: string; address?: string; city?: string; state?: string; zipCode?: string };
    if (!body?.name || typeof body.name !== 'string') return res.status(400).json({ error: 'name is required' });
    const row = await prisma.store.create({
      data: {
        name: body.name,
        address: body.address ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        zip_code: body.zipCode ?? null,
        created_by: uid,
      },
    });
    return res.status(201).json(toStoreJson(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
