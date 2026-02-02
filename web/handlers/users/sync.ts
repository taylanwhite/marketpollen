import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

/**
 * Sync current Firebase user to DB. Call after signup or login.
 * Body: { email, displayName? }. Creates user if not exists.
 * If user signed up via invite, marks matching pending invites as accepted and copies permissions.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await requireAuth(req).catch(() => null);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const body = (req.body || {}) as { email?: string; displayName?: string };
  const email = body.email?.trim();
  if (!email) return res.status(400).json({ error: 'email is required' });

  const existing = await prisma.user.findUnique({ where: { id: uid } });
  if (existing) {
    await prisma.user.update({
      where: { id: uid },
      data: { email, display_name: body.displayName ?? null },
    });
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, email: true, display_name: true, created_at: true, is_global_admin: true },
    });
    if (!user) return res.status(500).json({ error: 'Update failed' });
    const perms = await prisma.storePermission.findMany({
      where: { user_id: uid },
      select: { store_id: true, can_edit: true },
    });
    return res.status(200).json({
      user: {
        uid: user.id,
        email: user.email,
        displayName: user.display_name ?? undefined,
        createdAt: user.created_at,
        isGlobalAdmin: user.is_global_admin,
      },
      storePermissions: perms.map((p) => ({ storeId: p.store_id, canEdit: p.can_edit })),
    });
  }

  const invites = await prisma.invite.findMany({
    where: { email: email.toLowerCase(), status: 'pending' },
    select: { id: true, store_id: true, can_edit: true, is_global_admin: true },
  });

  let isGlobalAdmin = false;
  const permissions: { storeId: string; canEdit: boolean }[] = [];
  for (const inv of invites) {
    if (inv.is_global_admin) isGlobalAdmin = true;
    else permissions.push({ storeId: inv.store_id, canEdit: inv.can_edit });
  }

  await prisma.user.create({
    data: {
      id: uid,
      email,
      display_name: body.displayName ?? null,
      is_global_admin: isGlobalAdmin,
    },
  });

  for (const p of permissions) {
    await prisma.storePermission.upsert({
      where: { user_id_store_id: { user_id: uid, store_id: p.storeId } },
      create: { user_id: uid, store_id: p.storeId, can_edit: p.canEdit },
      update: { can_edit: p.canEdit },
    });
  }

  for (const inv of invites) {
    await prisma.invite.update({
      where: { id: inv.id },
      data: { status: 'accepted' },
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, email: true, display_name: true, created_at: true, is_global_admin: true },
  });
  if (!user) return res.status(500).json({ error: 'Create failed' });
  const perms = await prisma.storePermission.findMany({
    where: { user_id: uid },
    select: { store_id: true, can_edit: true },
  });

  return res.status(201).json({
    user: {
      uid: user.id,
      email: user.email,
      displayName: user.display_name ?? undefined,
      createdAt: user.created_at,
      isGlobalAdmin: user.is_global_admin,
    },
    storePermissions: perms.map((p) => ({ storeId: p.store_id, canEdit: p.can_edit })),
  });
}
