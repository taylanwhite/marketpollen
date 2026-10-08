import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { adminOrgIds } from '../lib/org-access.js';

function toUserJson(
  user: {
    id: string;
    email: string;
    display_name: string | null;
    created_at: Date;
    is_global_admin: boolean;
    store_permissions: Array<{ store_id: string; can_edit: boolean }>;
    organization_memberships: Array<{ org_id: string; is_admin: boolean; org: { name: string } }>;
  },
  scope: { storeIds: Set<string> | null; orgIds: Set<string> | null },
) {
  const storePermissions = user.store_permissions
    .filter((permission) => !scope.storeIds || scope.storeIds.has(permission.store_id))
    .map((permission) => ({ storeId: permission.store_id, canEdit: permission.can_edit }));
  const orgMemberships = user.organization_memberships
    .filter((membership) => !scope.orgIds || scope.orgIds.has(membership.org_id))
    .map((membership) => ({
      orgId: membership.org_id,
      orgName: membership.org.name,
      isAdmin: membership.is_admin,
    }));
  return {
    uid: user.id,
    email: user.email,
    displayName: user.display_name ?? undefined,
    createdAt: user.created_at,
    isGlobalAdmin: scope.orgIds ? false : user.is_global_admin,
    storePermissions,
    orgMemberships,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const orgIds = await adminOrgIds(uid);
  if (orgIds !== 'all' && orgIds.length === 0) return res.status(403).json({ error: 'Admin required' });

  if (req.method === 'GET') {
    const storeIds = orgIds === 'all'
      ? null
      : new Set((await prisma.store.findMany({
        where: { organization_id: { in: orgIds } },
        select: { id: true },
      })).map((store) => store.id));
    const orgIdSet = orgIds === 'all' ? null : new Set(orgIds);
    const rows = await prisma.user.findMany({
      where: orgIds === 'all' ? undefined : {
        OR: [
          { organization_memberships: { some: { org_id: { in: orgIds } } } },
          { store_permissions: { some: { store: { organization_id: { in: orgIds } } } } },
        ],
      },
      orderBy: { email: 'asc' },
      include: {
        store_permissions: { select: { store_id: true, can_edit: true } },
        organization_memberships: {
          select: { org_id: true, is_admin: true, org: { select: { name: true } } },
        },
      },
    });
    return res.status(200).json(rows.map((user) => toUserJson(user, { storeIds, orgIds: orgIdSet })));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
