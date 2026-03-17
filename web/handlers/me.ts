import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, email: true, display_name: true, created_at: true, is_global_admin: true },
  });

  if (!user) {
    return res.status(200).json({
      user: null,
      storePermissions: [],
      stores: [],
    });
  }

  const perms = await prisma.storePermission.findMany({
    where: { user_id: uid },
    select: { store_id: true, can_edit: true },
  });

  const storeIds = perms.map((p) => p.store_id);
  const stores = user.is_global_admin
    ? await prisma.store.findMany({ orderBy: { name: 'asc' } })
    : await prisma.store.findMany({
        where: { id: { in: storeIds } },
        orderBy: { name: 'asc' },
      });

  const orgMemberships = await prisma.organizationMember.findMany({
    where: { user_id: uid },
    include: {
      org: {
        include: {
          products: { orderBy: { display_order: 'asc' } },
          stores: { select: { id: true, name: true } },
        },
      },
    },
  });

  const mapOrg = (org: any, isAdmin: boolean) => ({
    id: org.id,
    name: org.name,
    quarterlyGoal: org.quarterly_goal,
    isAdmin,
    stores: org.stores.map((s: any) => ({ id: s.id, name: s.name })),
    products: org.products.map((p: any) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      mouthValue: p.mouth_value,
      displayOrder: p.display_order,
      isActive: p.is_active,
      reachoutColumn: p.reachout_column,
    })),
  });

  let organizations: ReturnType<typeof mapOrg>[];
  if (user.is_global_admin && orgMemberships.length === 0) {
    const allOrgs = await prisma.organization.findMany({
      include: {
        products: { orderBy: { display_order: 'asc' } },
        stores: { select: { id: true, name: true } },
      },
    });
    organizations = allOrgs.map((org) => mapOrg(org, true));
  } else if (orgMemberships.length > 0) {
    organizations = orgMemberships.map((m) =>
      mapOrg(m.org, m.is_admin || user.is_global_admin)
    );
  } else {
    // User has no explicit org membership — derive orgs from their store permissions
    const storeOrgIds = [...new Set(stores.map(s => s.organization_id).filter(Boolean))] as string[];
    if (storeOrgIds.length > 0) {
      const derivedOrgs = await prisma.organization.findMany({
        where: { id: { in: storeOrgIds } },
        include: {
          products: { orderBy: { display_order: 'asc' } },
          stores: { select: { id: true, name: true } },
        },
      });
      organizations = derivedOrgs.map((org) => mapOrg(org, false));
    } else {
      organizations = [];
    }
  }

  return res.status(200).json({
    user: {
      uid: user.id,
      email: user.email,
      displayName: user.display_name ?? undefined,
      createdAt: user.created_at,
      isGlobalAdmin: user.is_global_admin,
    },
    storePermissions: perms.map((p) => ({ storeId: p.store_id, canEdit: p.can_edit })),
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address ?? undefined,
      city: s.city ?? undefined,
      state: s.state ?? undefined,
      zipCode: s.zip_code ?? undefined,
      createdAt: s.created_at,
      createdBy: s.created_by,
      organizationId: s.organization_id ?? undefined,
    })),
    organizations,
  });
}
