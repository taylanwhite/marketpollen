import { VercelRequest, VercelResponse } from '@vercel/node';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const body = req.body as { id?: string; name: string; address?: string; city?: string; state?: string; zipCode?: string; placeId?: string };
    if (!body?.name || typeof body.name !== 'string') return res.status(400).json({ error: 'name is required' });

    // Idempotency: if the client supplied an id (offline-queue replay), and a
    // row with that id already exists in this store, return it instead of
    // creating a duplicate.
    if (body.id) {
      if (!UUID_RE.test(body.id)) return res.status(400).json({ error: 'id must be a UUID' });
      const existing = await prisma.business.findUnique({ where: { id: body.id } });
      if (existing) {
        if (existing.store_id !== storeId) {
          return res.status(409).json({ error: 'Business id belongs to another store' });
        }
        return res.status(200).json(toBusinessJson(existing));
      }
    }

    let row;
    try {
      row = await prisma.business.create({
        data: {
          ...(body.id ? { id: body.id } : {}),
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
    } catch (err) {
      // Race with another in-flight retry of the same client id — return the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && body.id) {
        const existing = await prisma.business.findUnique({ where: { id: body.id } });
        if (existing) return res.status(200).json(toBusinessJson(existing));
      }
      throw err;
    }

    if (body.placeId) {
      const matchingOpps = await prisma.opportunity.findMany({
        where: { store_id: storeId, place_id: body.placeId, status: 'new' },
      });
      if (matchingOpps.length > 0) {
        await prisma.opportunity.updateMany({
          where: { id: { in: matchingOpps.map(o => o.id) } },
          data: { status: 'converted', business_id: row.id, converted_at: new Date() },
        });
      }
    }

    return res.status(201).json(toBusinessJson(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
