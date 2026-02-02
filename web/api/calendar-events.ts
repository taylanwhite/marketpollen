import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

function toEventJson(r: { id: string; store_id: string; title: string; description: string | null; date: Date; start_time: string | null; end_time: string | null; type: string; contact_id: string | null; business_id: string | null; priority: string | null; status: string | null; created_by: string; created_at: Date; completed_at: Date | null }) {
  return {
    id: r.id,
    storeId: r.store_id,
    title: r.title,
    description: r.description ?? undefined,
    date: r.date,
    startTime: r.start_time ?? undefined,
    endTime: r.end_time ?? undefined,
    type: r.type || 'other',
    contactId: r.contact_id ?? undefined,
    businessId: r.business_id ?? undefined,
    priority: r.priority ?? undefined,
    status: r.status ?? undefined,
    createdBy: r.created_by,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
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
    const dateStr = (req.query?.date as string)?.trim();
    const where: { store_id: string; date?: { gte: Date; lt: Date } } = { store_id: storeId };
    if (dateStr) {
      const start = new Date(dateStr);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.date = { gte: start, lt: end };
    }
    const rows = await prisma.calendarEvent.findMany({
      where,
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
    });
    return res.status(200).json(rows.map(toEventJson));
  }

  if (req.method === 'POST') {
    const body = req.body as {
      title: string;
      description?: string;
      date: string | Date;
      startTime?: string;
      endTime?: string;
      type?: string;
      contactId?: string;
      businessId?: string;
      priority?: string;
      status?: string;
    };
    if (!body?.title) return res.status(400).json({ error: 'title is required' });
    const eventDate = body.date instanceof Date ? body.date : new Date(body.date);
    const row = await prisma.calendarEvent.create({
      data: {
        store_id: storeId,
        title: body.title,
        description: body.description ?? null,
        date: eventDate,
        start_time: body.startTime ?? null,
        end_time: body.endTime ?? null,
        type: body.type || 'other',
        contact_id: body.contactId ?? null,
        business_id: body.businessId ?? null,
        priority: body.priority ?? null,
        status: body.status ?? 'scheduled',
        created_by: uid,
      },
    });
    return res.status(201).json(toEventJson(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
