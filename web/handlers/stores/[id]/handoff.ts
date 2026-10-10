import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { isOrgAdmin } from '../../lib/org-access.js';
import { rejectIfStoreLocked } from '../../lib/store-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const storeId = (req.query?.id as string)?.trim();
  if (!storeId) return res.status(400).json({ error: 'Store id required' });
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, organization_id: true } });
  if (!store?.organization_id) return res.status(404).json({ error: 'Store not found' });
  if (!(await isOrgAdmin(uid, store.organization_id))) return res.status(403).json({ error: 'Organization admin required' });
  if (await rejectIfStoreLocked(res, storeId, uid)) return;

  const body = (req.body || {}) as { fromUserId?: string; toUserId?: string };
  const fromUserId = body.fromUserId?.trim();
  const toUserId = body.toUserId?.trim();
  if (!fromUserId || !toUserId) return res.status(400).json({ error: 'Choose who has the book and who should receive it' });
  if (fromUserId === toUserId) return res.status(400).json({ error: 'Choose two different people' });

  const [fromUser, toUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: fromUserId }, select: { id: true, display_name: true, email: true } }),
    prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, display_name: true, email: true } }),
  ]);
  if (!fromUser || !toUser) return res.status(404).json({ error: 'One of those people is not in Market Pollen' });

  const [contacts, businesses] = await prisma.$transaction([
    prisma.contact.updateMany({
      where: { store_id: storeId, created_by: fromUserId },
      data: { created_by: toUserId },
    }),
    prisma.business.updateMany({
      where: { store_id: storeId, created_by: fromUserId },
      data: { created_by: toUserId },
    }),
    prisma.storePermission.upsert({
      where: { user_id_store_id: { user_id: toUserId, store_id: storeId } },
      create: { user_id: toUserId, store_id: storeId, can_edit: true },
      update: { can_edit: true },
    }),
  ]);

  return res.status(200).json({
    contacts: contacts.count,
    businesses: businesses.count,
    toName: toUser.display_name || toUser.email,
  });
}
