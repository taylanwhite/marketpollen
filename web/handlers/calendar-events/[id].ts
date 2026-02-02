import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore } from '../lib/store-access.js';

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

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Event id required' });

  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const can = await canAccessStore(uid, event.store_id);
  if (!can) return res.status(404).json({ error: 'Event not found' });

  if (req.method === 'GET') return res.status(200).json(toEventJson(event));

  if (req.method === 'PATCH') {
    const body = req.body as {
      title?: string;
      description?: string;
      date?: string | Date;
      startTime?: string;
      endTime?: string;
      type?: string;
      contactId?: string;
      businessId?: string;
      priority?: string;
      status?: string;
      completedAt?: string | Date | null;
    };
    const eventDate = body.date != null ? (body.date instanceof Date ? body.date : new Date(body.date)) : undefined;
    const completedAt = body.completedAt !== undefined
      ? (body.completedAt == null ? null : body.completedAt instanceof Date ? body.completedAt : new Date(body.completedAt as string))
      : undefined;
    const updated = await prisma.calendarEvent.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(eventDate !== undefined && { date: eventDate }),
        ...(body.startTime !== undefined && { start_time: body.startTime }),
        ...(body.endTime !== undefined && { end_time: body.endTime }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.contactId !== undefined && { contact_id: body.contactId }),
        ...(body.businessId !== undefined && { business_id: body.businessId }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.status !== undefined && { status: body.status }),
        ...(completedAt !== undefined && { completed_at: completedAt }),
      },
    });
    return res.status(200).json(toEventJson(updated));
  }

  if (req.method === 'DELETE') {
    await prisma.calendarEvent.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
