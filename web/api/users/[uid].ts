import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const me = await prisma.user.findUnique({
    where: { id: uid },
    select: { is_global_admin: true },
  });
  if (!me?.is_global_admin) return res.status(403).json({ error: 'Admin required' });

  const targetUid = (req.query?.uid as string)?.trim();
  if (!targetUid) return res.status(400).json({ error: 'User uid required' });

  if (req.method === 'PATCH') {
    const body = req.body as { isGlobalAdmin?: boolean; storePermissions?: { storeId: string; canEdit: boolean }[] };
    if (body.isGlobalAdmin !== undefined) {
      await prisma.user.update({
        where: { id: targetUid },
        data: { is_global_admin: body.isGlobalAdmin },
      });
    }
    if (Array.isArray(body.storePermissions)) {
      await prisma.storePermission.deleteMany({ where: { user_id: targetUid } });
      for (const p of body.storePermissions) {
        if (!p.storeId) continue;
        await prisma.storePermission.upsert({
          where: { user_id_store_id: { user_id: targetUid, store_id: p.storeId } },
          create: { user_id: targetUid, store_id: p.storeId, can_edit: p.canEdit === true },
          update: { can_edit: p.canEdit === true },
        });
      }
    }
    const user = await prisma.user.findUnique({
      where: { id: targetUid },
      select: { id: true, email: true, display_name: true, created_at: true, is_global_admin: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const perms = await prisma.storePermission.findMany({
      where: { user_id: targetUid },
      select: { store_id: true, can_edit: true },
    });
    return res.status(200).json({
      uid: user.id,
      email: user.email,
      displayName: user.display_name ?? undefined,
      createdAt: user.created_at,
      isGlobalAdmin: user.is_global_admin,
      storePermissions: perms.map((p) => ({ storeId: p.store_id, canEdit: p.can_edit })),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
