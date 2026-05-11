import { VercelRequest, VercelResponse } from '@vercel/node';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reachoutToJson(r: any) {
  const customDonations = r.custom_donations as Record<string, number> | null;
  const hasDonation = r.free_bundlet_card || r.dozen_bundtinis || r.cake_8inch || r.cake_10inch || r.sample_tray || r.bundtlet_tower || r.cakes_donated_notes || (customDonations && Object.keys(customDonations).length > 0);
  return {
    id: r.id,
    date: r.date,
    note: r.note,
    rawNotes: r.raw_notes ?? null,
    createdBy: r.created_by,
    type: r.type || 'other',
    donation: hasDonation
      ? {
          freeBundletCard: r.free_bundlet_card ?? 0,
          dozenBundtinis: r.dozen_bundtinis ?? 0,
          cake8inch: r.cake_8inch ?? 0,
          cake10inch: r.cake_10inch ?? 0,
          sampleTray: r.sample_tray ?? 0,
          bundtletTower: r.bundtlet_tower ?? 0,
          customItems: customDonations ?? undefined,
          cakesDonatedNotes: r.cakes_donated_notes ?? undefined,
          orderedFromUs: r.ordered_from_us ?? false,
          followedUp: r.followed_up ?? false,
        }
      : undefined,
  };
}

function contactToJson(c: any) {
  return {
    id: c.id,
    businessId: c.business_id,
    storeId: c.store_id,
    contactId: c.contact_id,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    employeeCount: c.employee_count ?? null,
    personalDetails: c.personal_details ?? null,
    suggestedFollowUpDate: c.suggested_follow_up_date ?? null,
    suggestedFollowUpMethod: c.suggested_follow_up_method ?? null,
    suggestedFollowUpNote: c.suggested_follow_up_note ?? null,
    suggestedFollowUpPriority: c.suggested_follow_up_priority ?? null,
    lastReachoutDate: c.last_reachout_date ?? null,
    status: c.status ?? null,
    createdAt: c.created_at,
    createdBy: c.created_by,
    reachouts: (c.reachouts || []).map(reachoutToJson),
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
    try {
      const rows = await prisma.contact.findMany({
        where: { store_id: storeId },
        include: { reachouts: { orderBy: { date: 'desc' } } },
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
    };
    if (!body?.businessId) return res.status(400).json({ error: 'businessId is required' });

    // Idempotency: if a client id was supplied (offline replay), return the
    // existing row instead of creating a duplicate.
    if (body.id) {
      if (!UUID_RE.test(body.id)) return res.status(400).json({ error: 'id must be a UUID' });
      const existing = await prisma.contact.findUnique({
        where: { id: body.id },
        include: { reachouts: true },
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
        include: { reachouts: true },
      });
      return res.status(201).json(contactToJson(row));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2023') return res.status(400).json({ error: 'Invalid store id format' });
        if (err.code === 'P2002' && body.id) {
          const existing = await prisma.contact.findUnique({
            where: { id: body.id },
            include: { reachouts: true },
          });
          if (existing) return res.status(200).json(contactToJson(existing));
        }
      }
      throw err;
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
