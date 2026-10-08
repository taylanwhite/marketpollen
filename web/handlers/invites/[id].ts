import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { adminOrgIds } from '../lib/org-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Invite id required' });

  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite) return res.status(404).json({ error: 'Invite not found' });

  const orgIds = await adminOrgIds(uid);
  if (orgIds !== 'all') {
    const store = await prisma.store.findUnique({
      where: { id: invite.store_id },
      select: { organization_id: true },
    });
    if (!store?.organization_id || !orgIds.includes(store.organization_id)) {
      return res.status(404).json({ error: 'Invite not found' });
    }
  }

  if (req.method === 'DELETE') {
    await prisma.invite.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
