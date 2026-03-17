import { prisma } from './db.js';

export async function isOrgAdmin(uid: string, orgId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { is_global_admin: true },
  });
  if (user?.is_global_admin) return true;

  const member = await prisma.organizationMember.findUnique({
    where: { user_id_org_id: { user_id: uid, org_id: orgId } },
  });
  return member?.is_admin ?? false;
}

export async function isOrgMember(uid: string, orgId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { is_global_admin: true },
  });
  if (user?.is_global_admin) return true;

  const member = await prisma.organizationMember.findUnique({
    where: { user_id_org_id: { user_id: uid, org_id: orgId } },
  });
  return !!member;
}
