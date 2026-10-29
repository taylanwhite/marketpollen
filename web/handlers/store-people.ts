import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { readableStoreScope } from './lib/store-access.js';

/**
 * Everyone with access to the stores in scope, as { id, name }. Used for
 * marketer pickers: follow-up reminders and the reports filter.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const scope = await readableStoreScope(uid, {
    storeId: req.query?.storeId as string | undefined,
    orgId: req.query?.orgId as string | undefined,
  });
  if (!scope || 'unrestricted' in scope) return res.status(400).json({ error: 'storeId or orgId required' });

  const members = await prisma.storePermission.findMany({
    where: { store_id: { in: scope.storeIds } },
    include: { user: { select: { id: true, display_name: true, email: true } } },
  });
  const byId = new Map<string, { id: string; name: string }>();
  for (const member of members) {
    byId.set(member.user.id, { id: member.user.id, name: member.user.display_name || member.user.email });
  }
  return res.status(200).json([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
}
