import { prisma } from './db.js';
import { isPlatformAdmin } from './king-admin.js';

/** Every organization this person administers. `'all'` is only the platform owner. */
export async function adminOrgIds(uid: string): Promise<string[] | 'all'> {
  if (await isPlatformAdmin(uid)) return 'all';
  const memberships = await prisma.organizationMember.findMany({
    where: { user_id: uid, is_admin: true },
    select: { org_id: true },
  });
  return memberships.map((membership) => membership.org_id);
}

export async function isOrgAdmin(uid: string, orgId: string): Promise<boolean> {
  if (await isPlatformAdmin(uid)) return true;

  const member = await prisma.organizationMember.findUnique({
    where: { user_id_org_id: { user_id: uid, org_id: orgId } },
  });
  return member?.is_admin ?? false;
}

export async function isOrgMember(uid: string, orgId: string): Promise<boolean> {
  if (await isPlatformAdmin(uid)) return true;

  const member = await prisma.organizationMember.findUnique({
    where: { user_id_org_id: { user_id: uid, org_id: orgId } },
  });
  if (member) return true;

  const storeAccess = await prisma.storePermission.findFirst({
    where: {
      user_id: uid,
      store: { organization_id: orgId },
    },
  });
  return !!storeAccess;
}
