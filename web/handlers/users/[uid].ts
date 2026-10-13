import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { adminOrgIds } from '../lib/org-access.js';
import { isKingAdmin } from '../lib/king-admin.js';
import { isKingAdminEmail } from '../lib/king-admin-email.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const orgIds = await adminOrgIds(uid);
  if (orgIds !== 'all' && orgIds.length === 0) return res.status(403).json({ error: 'Admin required' });

  const targetUid = (req.query?.uid as string)?.trim();
  if (!targetUid) return res.status(400).json({ error: 'User uid required' });

  const target = await prisma.user.findUnique({
    where: { id: targetUid },
    select: { email: true, is_global_admin: true },
  });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if ((target.is_global_admin || isKingAdminEmail(target.email)) && orgIds !== 'all') {
    return res.status(404).json({ error: 'User not found' });
  }

  if (req.method === 'PATCH') {
    const body = req.body as {
      isOrgAdmin?: boolean;
      orgId?: string;
      scopedStoreIds?: string[];
      storePermissions?: { storeId: string; canEdit: boolean }[];
    };
    if (orgIds !== 'all') {
      if (!body.orgId || !orgIds.includes(body.orgId)) {
        return res.status(403).json({ error: 'You can only manage people in your organization' });
      }
      const allowedStores = new Set((await prisma.store.findMany({
        where: { organization_id: body.orgId },
        select: { id: true },
      })).map((store) => store.id));
      const requestedIds = [
        ...(body.scopedStoreIds || []),
        ...(body.storePermissions || []).map((permission) => permission.storeId),
      ];
      if (requestedIds.some((storeId) => storeId && !allowedStores.has(storeId))) {
        return res.status(403).json({ error: 'You can only manage stores in your organization' });
      }
    }
    if (body.isOrgAdmin !== undefined && body.orgId) {
      const existing = await prisma.organizationMember.findUnique({
        where: { user_id_org_id: { user_id: targetUid, org_id: body.orgId } },
        select: { is_admin: true },
      });
      const nextAdmin = body.isOrgAdmin === true;
      if ((existing?.is_admin === true) !== nextAdmin && !(await isKingAdmin(uid))) {
        return res.status(403).json({ error: 'Only the platform owner can change admin access' });
      }
      await prisma.organizationMember.upsert({
        where: { user_id_org_id: { user_id: targetUid, org_id: body.orgId } },
        create: { user_id: targetUid, org_id: body.orgId, is_admin: nextAdmin },
        update: { is_admin: nextAdmin },
      });
    }
    if (Array.isArray(body.storePermissions)) {
      const scopedStoreIds = Array.isArray(body.scopedStoreIds) ? body.scopedStoreIds.filter(Boolean) : [];
      await prisma.storePermission.deleteMany({
        where: {
          user_id: targetUid,
          ...(scopedStoreIds.length > 0 ? { store_id: { in: scopedStoreIds } } : {}),
        },
      });
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
      isGlobalAdmin: isKingAdminEmail(user.email),
      storePermissions: perms.map((p) => ({ storeId: p.store_id, canEdit: p.can_edit })),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
