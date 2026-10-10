import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore, canViewStore, rejectIfStoreLocked } from '../lib/store-access.js';

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

  if (!(await canViewStore(uid, business.store_id))) return res.status(404).json({ error: 'Business not found' });

  if (req.method === 'GET') return res.status(200).json(toBusinessJson(business));

  if (!(await canAccessStore(uid, business.store_id))) return res.status(404).json({ error: 'Business not found' });
  if (await rejectIfStoreLocked(res, business.store_id, uid)) return;

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
        ...(body?.placeId !== undefined && { place_id: body.placeId || null }),
      },
    });
    return res.status(200).json(toBusinessJson(updated));
  }

  if (req.method === 'POST' && (req.body as { action?: string })?.action === 'merge') {
    const intoId = String((req.body as { intoId?: string })?.intoId || '').trim();
    if (!intoId || intoId === id) return res.status(400).json({ error: 'Choose a different business to keep' });
    const keeper = await prisma.business.findUnique({ where: { id: intoId } });
    if (!keeper || keeper.store_id !== business.store_id) {
      return res.status(404).json({ error: 'That business is not in this store' });
    }

    const moved = await prisma.$transaction(async (tx) => {
      const moving = await tx.contact.findMany({ where: { business_id: id }, select: { id: true, contact_id: true } });
      const taken = new Set(
        (await tx.contact.findMany({ where: { business_id: intoId }, select: { contact_id: true } })).map((row) => row.contact_id),
      );
      for (const contact of moving) {
        let contactId = contact.contact_id;
        if (taken.has(contactId)) contactId = `${contact.contact_id}-${contact.id.slice(0, 8)}`;
        taken.add(contactId);
        await tx.contact.update({
          where: { id: contact.id },
          data: { business_id: intoId, contact_id: contactId },
        });
      }
      const links = await tx.contactBusiness.findMany({ where: { business_id: id } });
      for (const link of links) {
        const already = await tx.contactBusiness.findUnique({
          where: { contact_id_business_id: { contact_id: link.contact_id, business_id: intoId } },
        });
        await tx.contactBusiness.delete({
          where: { contact_id_business_id: { contact_id: link.contact_id, business_id: id } },
        });
        if (!already) {
          await tx.contactBusiness.create({
            data: { contact_id: link.contact_id, business_id: intoId },
          });
        }
      }
      await tx.calendarEvent.updateMany({ where: { business_id: id }, data: { business_id: intoId } });
      await tx.opportunity.updateMany({ where: { business_id: id }, data: { business_id: intoId } });
      await tx.business.delete({ where: { id } });
      return moving.length;
    });

    return res.status(200).json({ keptId: intoId, keptName: keeper.name, contacts: moved });
  }

  if (req.method === 'DELETE') {
    await prisma.business.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
