import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore } from '../lib/store-access.js';

function reachoutToJson(r: { id: string; date: Date; note: string; raw_notes: string | null; created_by: string; type: string; store_id: string | null; free_bundlet_card: number; dozen_bundtinis: number; cake_8inch: number; cake_10inch: number; sample_tray: number; bundtlet_tower: number; cakes_donated_notes: string | null; ordered_from_us: boolean; followed_up: boolean }) {
  return {
    id: r.id,
    date: r.date,
    note: r.note,
    rawNotes: r.raw_notes ?? null,
    createdBy: r.created_by,
    type: r.type || 'other',
    storeId: r.store_id ?? undefined,
    donation: (r.free_bundlet_card || r.dozen_bundtinis || r.cake_8inch || r.cake_10inch || r.sample_tray || r.bundtlet_tower || r.cakes_donated_notes
      ? {
          freeBundletCard: r.free_bundlet_card ?? 0,
          dozenBundtinis: r.dozen_bundtinis ?? 0,
          cake8inch: r.cake_8inch ?? 0,
          cake10inch: r.cake_10inch ?? 0,
          sampleTray: r.sample_tray ?? 0,
          bundtletTower: r.bundtlet_tower ?? 0,
          cakesDonatedNotes: r.cakes_donated_notes ?? undefined,
          orderedFromUs: r.ordered_from_us ?? false,
          followedUp: r.followed_up ?? false,
        }
      : undefined),
  };
}

function contactToJson(c: { id: string; business_id: string; store_id: string; contact_id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; employee_count: number | null; personal_details: string | null; suggested_follow_up_date: Date | null; suggested_follow_up_method: string | null; suggested_follow_up_note: string | null; suggested_follow_up_priority: string | null; last_reachout_date: Date | null; status: string | null; created_at: Date; created_by: string; reachouts?: Array<{ id: string; date: Date; note: string; raw_notes: string | null; created_by: string; type: string; store_id: string | null; free_bundlet_card: number; dozen_bundtinis: number; cake_8inch: number; cake_10inch: number; sample_tray: number; bundtlet_tower: number; cakes_donated_notes: string | null; ordered_from_us: boolean; followed_up: boolean }> }) {
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

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Contact id required' });

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { reachouts: { orderBy: { date: 'desc' } } },
  });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const can = await canAccessStore(uid, contact.store_id);
  if (!can) return res.status(404).json({ error: 'Contact not found' });

  if (req.method === 'GET') return res.status(200).json(contactToJson(contact));

  if (req.method === 'PATCH') {
    const body = req.body as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      employeeCount?: number;
      personalDetails?: string;
      suggestedFollowUpDate?: string | Date | null;
      suggestedFollowUpMethod?: string | null;
      suggestedFollowUpNote?: string | null;
      suggestedFollowUpPriority?: string | null;
      lastReachoutDate?: string | Date | null;
      status?: string | null;
      businessId?: string;
      reachouts?: Array<{ date: string | Date; note: string; rawNotes?: string | null; createdBy?: string; type?: string; donation?: { freeBundletCard?: number; dozenBundtinis?: number; cake8inch?: number; cake10inch?: number; sampleTray?: number; bundtletTower?: number; cakesDonatedNotes?: string; orderedFromUs?: boolean; followedUp?: boolean } }>;
    };

    const updateData: Parameters<typeof prisma.contact.update>[0]['data'] = {};
    if (body.firstName !== undefined) updateData.first_name = body.firstName;
    if (body.lastName !== undefined) updateData.last_name = body.lastName;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.employeeCount !== undefined) updateData.employee_count = body.employeeCount;
    if (body.personalDetails !== undefined) updateData.personal_details = body.personalDetails;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.businessId !== undefined) updateData.business_id = body.businessId;
    if (body.suggestedFollowUpDate !== undefined) updateData.suggested_follow_up_date = body.suggestedFollowUpDate == null ? null : (body.suggestedFollowUpDate instanceof Date ? body.suggestedFollowUpDate : new Date(body.suggestedFollowUpDate));
    if (body.suggestedFollowUpMethod !== undefined) updateData.suggested_follow_up_method = body.suggestedFollowUpMethod;
    if (body.suggestedFollowUpNote !== undefined) updateData.suggested_follow_up_note = body.suggestedFollowUpNote;
    if (body.suggestedFollowUpPriority !== undefined) updateData.suggested_follow_up_priority = body.suggestedFollowUpPriority;
    if (body.lastReachoutDate !== undefined) updateData.last_reachout_date = body.lastReachoutDate == null ? null : (body.lastReachoutDate instanceof Date ? body.lastReachoutDate : new Date(body.lastReachoutDate));

    if (Object.keys(updateData).length > 0) {
      await prisma.contact.update({ where: { id }, data: updateData });
    }

    if (Array.isArray(body.reachouts)) {
      await prisma.reachout.deleteMany({ where: { contact_id: id } });
      for (const r of body.reachouts) {
        const d = r.donation || {};
        const date = r.date instanceof Date ? r.date : new Date(r.date);
        await prisma.reachout.create({
          data: {
            contact_id: id,
            date,
            note: r.note || '',
            raw_notes: r.rawNotes ?? null,
            created_by: r.createdBy || uid,
            type: (r.type as 'call' | 'email' | 'meeting' | 'other') || 'other',
            store_id: contact.store_id,
            free_bundlet_card: d.freeBundletCard ?? 0,
            dozen_bundtinis: d.dozenBundtinis ?? 0,
            cake_8inch: d.cake8inch ?? 0,
            cake_10inch: d.cake10inch ?? 0,
            sample_tray: d.sampleTray ?? 0,
            bundtlet_tower: d.bundtletTower ?? 0,
            cakes_donated_notes: d.cakesDonatedNotes ?? null,
            ordered_from_us: d.orderedFromUs === true,
            followed_up: d.followedUp === true,
          },
        });
      }
    }

    const updated = await prisma.contact.findUnique({
      where: { id },
      include: { reachouts: { orderBy: { date: 'desc' } } },
    });
    return res.status(200).json(contactToJson(updated!));
  }

  if (req.method === 'DELETE') {
    await prisma.contact.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
