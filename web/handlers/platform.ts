import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { is_global_admin: true },
  });
  if (!user?.is_global_admin) return res.status(403).json({ error: 'Admin required' });

  const orgs = await prisma.organization.findMany({
    orderBy: { name: 'asc' },
    include: {
      stores: { where: { archived_at: null }, select: { id: true } },
      members: { where: { is_admin: true }, select: { user: { select: { email: true } } } },
    },
  });

  return res.status(200).json(orgs.map((org) => ({
    id: org.id,
    name: org.name,
    storeCount: org.stores.length,
    monthlyPriceCents: org.monthly_price_cents,
    billingEnabled: org.billing_enabled,
    subscriptionStatus: org.subscription_status,
    paidQuantity: org.paid_quantity,
    admins: org.members.map((member) => member.user.email),
  })));
}
