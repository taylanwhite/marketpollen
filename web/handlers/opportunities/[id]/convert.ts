import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { canAccessStore } from '../../lib/store-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Opportunity id required' });

  const opportunity = await prisma.opportunity.findUnique({ where: { id } });
  if (!opportunity) return res.status(404).json({ error: 'Opportunity not found' });
  if (opportunity.status === 'converted') {
    return res.status(400).json({ error: 'Opportunity already converted' });
  }

  const can = await canAccessStore(uid, opportunity.store_id);
  if (!can) return res.status(404).json({ error: 'Opportunity not found' });

  const body = req.body as { name?: string; address?: string; city?: string; state?: string; zipCode?: string } | undefined;
  const name = (body?.name ?? opportunity.name) || opportunity.name;
  const address = body?.address !== undefined ? body.address : opportunity.address;
  const city = body?.city !== undefined ? body.city : opportunity.city;
  const state = body?.state !== undefined ? body.state : opportunity.state;
  const zipCode = body?.zipCode !== undefined ? body.zipCode : opportunity.zip_code;

  const business = await prisma.business.create({
    data: {
      store_id: opportunity.store_id,
      name,
      address: address ?? null,
      city: city ?? null,
      state: state ?? null,
      zip_code: zipCode ?? null,
      place_id: opportunity.place_id,
      created_by: uid,
    },
  });

  const updatedOpp = await prisma.opportunity.update({
    where: { id },
    data: { status: 'converted', business_id: business.id, converted_at: new Date() },
  });

  return res.status(200).json({
    business: {
      id: business.id,
      storeId: business.store_id,
      name: business.name,
      address: business.address ?? undefined,
      city: business.city ?? undefined,
      state: business.state ?? undefined,
      zipCode: business.zip_code ?? undefined,
      placeId: business.place_id ?? undefined,
      createdAt: business.created_at,
      createdBy: business.created_by,
    },
    opportunity: {
      id: updatedOpp.id,
      storeId: updatedOpp.store_id,
      placeId: updatedOpp.place_id,
      name: updatedOpp.name,
      address: updatedOpp.address ?? undefined,
      city: updatedOpp.city ?? undefined,
      state: updatedOpp.state ?? undefined,
      zipCode: updatedOpp.zip_code ?? undefined,
      status: updatedOpp.status,
      businessId: updatedOpp.business_id ?? undefined,
      createdAt: updatedOpp.created_at,
      createdBy: updatedOpp.created_by,
      convertedAt: updatedOpp.converted_at ?? undefined,
    },
  });
}
