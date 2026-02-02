import { prisma } from './db.js';

/**
 * Check if user (uid) can access store (storeId). Returns true if global admin or has permission.
 */
export async function canAccessStore(uid: string, storeId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { is_global_admin: true },
  });
  if (!user) return false;
  if (user.is_global_admin) return true;
  const perm = await prisma.storePermission.findUnique({
    where: { user_id_store_id: { user_id: uid, store_id: storeId } },
  });
  return !!perm;
}
