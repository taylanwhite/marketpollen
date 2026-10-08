import { VercelRequest, VercelResponse } from '@vercel/node';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore, readableStoreScope, rejectIfStoreLocked, storeIdWhere } from './lib/store-access.js';
import { contactInclude, contactToJson } from './lib/contact-json.js';
import { syncContactBusinesses } from './lib/contact-businesses.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const storeId = (req.query?.storeId as string)?.trim();
  const orgId = (req.query?.orgId as string)?.trim();
  const allStores = req.query?.allStores;

  if (req.method === 'GET') {
    const scope = await readableStoreScope(uid, { storeId, orgId, allStores });
    if (!scope) return res.status(400).json({ error: 'storeId required' });
    try {
      const rows = await prisma.contact.findMany({
        where: storeIdWhere(scope),
        include: contactInclude,
        orderBy: [{ last_reachout_date: 'desc' }, { created_at: 'desc' }],
      });
      return res.status(200).json(rows.map(contactToJson));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2023') {
        return res.status(400).json({ error: 'Invalid store id format' });
      }
      throw err;
    }
  }

  if (req.method === 'POST') {
    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    const can = await canAccessStore(uid, storeId);
    if (!can) return res.status(404).json({ error: 'Store not found' });
    if (await rejectIfStoreLocked(res, storeId, uid)) return;

    const body = req.body as {
      id?: string;
      businessId: string;
      contactId?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      employeeCount?: number;
      personalDetails?: string;
      status?: string;
      businessIds?: string[];
    };
    if (!body?.businessId) return res.status(400).json({ error: 'businessId is required' });

    // Idempotency: if a client id was supplied (offline replay), return the
    // existing row instead of creating a duplicate.
    if (body.id) {
      if (!UUID_RE.test(body.id)) return res.status(400).json({ error: 'id must be a UUID' });
      const existing = await prisma.contact.findUnique({
        where: { id: body.id },
        include: contactInclude,
      });
      if (existing) {
        if (existing.store_id !== storeId) {
          return res.status(409).json({ error: 'Contact id belongs to another store' });
        }
        return res.status(200).json(contactToJson(existing));
      }
    }

    const contactIdApp = body.contactId || `contact-${Date.now()}`;
    try {
      const row = await prisma.contact.create({
        data: {
          ...(body.id ? { id: body.id } : {}),
          business_id: body.businessId,
          store_id: storeId,
          contact_id: contactIdApp,
          first_name: body.firstName ?? null,
          last_name: body.lastName ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          employee_count: body.employeeCount ?? null,
          personal_details: body.personalDetails ?? null,
          status: body.status ?? 'new',
          created_by: uid,
        },
        include: contactInclude,
      });
      const linked = Array.isArray(body.businessIds) && body.businessIds.length > 0
        ? body.businessIds
        : [body.businessId];
      await syncContactBusinesses(row.id, storeId, linked);
      const saved = await prisma.contact.findUnique({ where: { id: row.id }, include: contactInclude });
      return res.status(201).json(contactToJson(saved || row));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2023') return res.status(400).json({ error: 'Invalid store id format' });
        if (err.code === 'P2002' && body.id) {
          const existing = await prisma.contact.findUnique({
            where: { id: body.id },
            include: contactInclude,
          });
          if (existing) return res.status(200).json(contactToJson(existing));
        }
      }
      throw err;
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
