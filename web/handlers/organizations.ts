import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';

function toOrgJson(o: any) {
  return {
    id: o.id,
    name: o.name,
    quarterlyGoal: o.quarterly_goal,
    createdAt: o.created_at,
    createdBy: o.created_by,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const user = await prisma.user.findUnique({ where: { id: uid }, select: { is_global_admin: true } });

    let orgs;
    if (user?.is_global_admin) {
      orgs = await prisma.organization.findMany({ orderBy: { name: 'asc' } });
    } else {
      const memberships = await prisma.organizationMember.findMany({ where: { user_id: uid }, select: { org_id: true } });
      const orgIds = memberships.map(m => m.org_id);
      orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } }, orderBy: { name: 'asc' } });
    }

    return res.status(200).json(orgs.map(toOrgJson));
  }

  if (req.method === 'POST') {
    const user = await prisma.user.findUnique({ where: { id: uid }, select: { is_global_admin: true } });
    if (!user?.is_global_admin) return res.status(403).json({ error: 'Only global admins can create organizations' });

    const body = req.body as { name: string; quarterlyGoal?: number };
    if (!body?.name?.trim()) return res.status(400).json({ error: 'name is required' });

    const org = await prisma.organization.create({
      data: {
        name: body.name.trim(),
        quarterly_goal: body.quarterlyGoal ?? 10000,
        created_by: uid,
      },
    });

    await prisma.organizationMember.create({
      data: { user_id: uid, org_id: org.id, is_admin: true },
    });

    return res.status(201).json(toOrgJson(org));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
