import { prisma } from './db.js';
import { isKingAdminEmail } from './king-admin-email.js';

export async function isKingAdmin(uid: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { email: true },
  });
  return isKingAdminEmail(user?.email);
}
