import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { rejectIfStoreLocked } from './lib/store-access.js';
import { adminOrgIds } from './lib/org-access.js';
import { isKingAdminEmail } from './lib/king-admin-email.js';

function toInviteJson(r: { id: string; email: string; store_id: string; can_edit: boolean; can_manage_plans: boolean; invited_by: string; invited_at: Date; status: string; is_global_admin: boolean }) {
  return {
    id: r.id,
    email: r.email,
    storeId: r.store_id,
    canEdit: r.can_edit,
    managesPlans: r.can_edit && r.can_manage_plans,
    invitedBy: r.invited_by,
    invitedAt: r.invited_at,
    status: r.status,
    isGlobalAdmin: r.is_global_admin,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const orgIds = await adminOrgIds(uid);
  if (orgIds !== 'all' && orgIds.length === 0) return res.status(403).json({ error: 'Admin required' });
  const managedStoreIds = orgIds === 'all'
    ? null
    : (await prisma.store.findMany({
      where: { organization_id: { in: orgIds } },
      select: { id: true },
    })).map((store) => store.id);

  if (req.method === 'GET') {
    const storeId = (req.query?.storeId as string)?.trim();
    if (storeId && managedStoreIds && !managedStoreIds.includes(storeId)) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const rows = await prisma.invite.findMany({
      where: storeId
        ? { store_id: storeId }
        : managedStoreIds
          ? { store_id: { in: managedStoreIds } }
          : undefined,
      orderBy: { invited_at: 'desc' },
    });
    const visible = orgIds === 'all'
      ? rows
      : rows.filter((row) => !row.is_global_admin && !isKingAdminEmail(row.email));
    return res.status(200).json(visible.map(toInviteJson));
  }

  if (req.method === 'POST') {
    const body = req.body as { email: string; storeId: string; canEdit?: boolean; managesPlans?: boolean };
    if (!body?.email || !body?.storeId) return res.status(400).json({ error: 'email and storeId required' });
    if (managedStoreIds && !managedStoreIds.includes(body.storeId)) {
      return res.status(404).json({ error: 'Store not found' });
    }
    if (await rejectIfStoreLocked(res, body.storeId, uid)) return;

    const email = body.email.trim().toLowerCase();
    const canEdit = body.canEdit === true;
    // A store manager also edits; managing plans without edit isn't a level.
    const managesPlans = canEdit && body.managesPlans === true;
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingUser) {
      await prisma.storePermission.upsert({
        where: { user_id_store_id: { user_id: existingUser.id, store_id: body.storeId } },
        create: { user_id: existingUser.id, store_id: body.storeId, can_edit: canEdit, can_manage_plans: managesPlans },
        update: { can_edit: canEdit, can_manage_plans: managesPlans },
      });
    }
    const row = await prisma.invite.create({
      data: {
        email,
        store_id: body.storeId,
        can_edit: canEdit,
        can_manage_plans: managesPlans,
        invited_by: uid,
        status: existingUser ? 'accepted' : 'pending',
        is_global_admin: false,
      },
    });
    return res.status(201).json(toInviteJson(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
