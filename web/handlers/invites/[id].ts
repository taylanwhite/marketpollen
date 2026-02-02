import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore } from '../lib/store-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { is_global_admin: true },
  });
  if (!user?.is_global_admin) return res.status(403).json({ error: 'Admin required' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Invite id required' });

  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite) return res.status(404).json({ error: 'Invite not found' });

  const can = await canAccessStore(uid, invite.store_id);
  if (!can) return res.status(404).json({ error: 'Invite not found' });

  if (req.method === 'DELETE') {
    await prisma.invite.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
