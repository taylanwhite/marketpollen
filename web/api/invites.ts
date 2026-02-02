import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

function toInviteJson(r: { id: string; email: string; store_id: string; can_edit: boolean; invited_by: string; invited_at: Date; status: string; is_global_admin: boolean }) {
  return {
    id: r.id,
    email: r.email,
    storeId: r.store_id,
    canEdit: r.can_edit,
    invitedBy: r.invited_by,
    invitedAt: r.invited_at,
    status: r.status,
    isGlobalAdmin: r.is_global_admin,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { is_global_admin: true },
  });
  if (!user?.is_global_admin) return res.status(403).json({ error: 'Admin required' });

  if (req.method === 'GET') {
    const storeId = (req.query?.storeId as string)?.trim();
    if (storeId) {
      const can = await canAccessStore(uid, storeId);
      if (!can) return res.status(404).json({ error: 'Store not found' });
    }
    const rows = await prisma.invite.findMany({
      where: storeId ? { store_id: storeId } : undefined,
      orderBy: { invited_at: 'desc' },
    });
    return res.status(200).json(rows.map(toInviteJson));
  }

  if (req.method === 'POST') {
    const body = req.body as { email: string; storeId: string; canEdit?: boolean; isGlobalAdmin?: boolean };
    if (!body?.email || !body?.storeId) return res.status(400).json({ error: 'email and storeId required' });
    const can = await canAccessStore(uid, body.storeId);
    if (!can) return res.status(404).json({ error: 'Store not found' });
    const row = await prisma.invite.create({
      data: {
        email: body.email.trim().toLowerCase(),
        store_id: body.storeId,
        can_edit: body.canEdit === true,
        invited_by: uid,
        status: 'pending',
        is_global_admin: body.isGlobalAdmin === true,
      },
    });
    return res.status(201).json(toInviteJson(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
