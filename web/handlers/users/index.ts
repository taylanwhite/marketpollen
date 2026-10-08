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

  if (req.method === 'GET') {
    const rows = await prisma.user.findMany({
      orderBy: { email: 'asc' },
      include: {
        store_permissions: { select: { store_id: true, can_edit: true } },
        organization_memberships: {
          select: { org_id: true, is_admin: true, org: { select: { name: true } } },
        },
      },
    });
    const withPerms = rows.map((r) => ({
      uid: r.id,
      email: r.email,
      displayName: r.display_name ?? undefined,
      createdAt: r.created_at,
      isGlobalAdmin: r.is_global_admin,
      storePermissions: r.store_permissions.map((p) => ({ storeId: p.store_id, canEdit: p.can_edit })),
      orgMemberships: r.organization_memberships.map((membership) => ({
        orgId: membership.org_id,
        orgName: membership.org.name,
        isAdmin: membership.is_admin,
      })),
    }));
    return res.status(200).json(withPerms);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
