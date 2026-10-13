import { prisma } from './db.js';
import { isKingAdminEmail } from './king-admin-email.js';

export async function isKingAdmin(uid: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { email: true },
  });
  return isKingAdminEmail(user?.email);
}

/** Platform-wide access: the owner, or anyone the owner has marked as a super user. */
export async function isPlatformAdmin(uid: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { email: true, is_global_admin: true },
  });
  return isKingAdminEmail(user?.email) || user?.is_global_admin === true;
}
