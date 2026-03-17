import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { isOrgAdmin, isOrgMember } from '../lib/org-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Organization id required' });

  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  if (!(await isOrgMember(uid, id))) return res.status(404).json({ error: 'Organization not found' });

  if (req.method === 'GET') {
    const [stores, products, members] = await Promise.all([
      prisma.store.findMany({ where: { organization_id: id }, orderBy: { name: 'asc' } }),
      prisma.campaignProduct.findMany({ where: { org_id: id }, orderBy: { display_order: 'asc' } }),
      prisma.organizationMember.findMany({
        where: { org_id: id },
        include: { user: { select: { id: true, email: true, display_name: true } } },
      }),
    ]);

    return res.status(200).json({
      id: org.id,
      name: org.name,
      quarterlyGoal: org.quarterly_goal,
      createdAt: org.created_at,
      stores: stores.map(s => ({
        id: s.id,
        name: s.name,
      })),
      products: products.map(p => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        mouthValue: p.mouth_value,
        displayOrder: p.display_order,
        isActive: p.is_active,
        reachoutColumn: p.reachout_column,
      })),
      members: members.map(m => ({
        userId: m.user.id,
        email: m.user.email,
        displayName: m.user.display_name,
        isAdmin: m.is_admin,
      })),
    });
  }

  if (req.method === 'PATCH') {
    if (!(await isOrgAdmin(uid, id))) return res.status(403).json({ error: 'Org admin required' });

    const body = req.body as { name?: string; quarterlyGoal?: number };
    const updated = await prisma.organization.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.quarterlyGoal !== undefined && { quarterly_goal: body.quarterlyGoal }),
      },
    });

    return res.status(200).json({
      id: updated.id,
      name: updated.name,
      quarterlyGoal: updated.quarterly_goal,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
