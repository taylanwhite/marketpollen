import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { isOrgAdmin, isOrgMember } from '../../lib/org-access.js';

function toProductJson(p: any) {
  return {
    id: p.id,
    orgId: p.org_id,
    slug: p.slug,
    name: p.name,
    mouthValue: p.mouth_value,
    displayOrder: p.display_order,
    isActive: p.is_active,
    reachoutColumn: p.reachout_column,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const orgId = (req.query?.id as string)?.trim();
  if (!orgId) return res.status(400).json({ error: 'Organization id required' });

  if (!(await isOrgMember(uid, orgId))) return res.status(404).json({ error: 'Organization not found' });

  if (req.method === 'GET') {
    const products = await prisma.campaignProduct.findMany({
      where: { org_id: orgId },
      orderBy: { display_order: 'asc' },
    });
    return res.status(200).json(products.map(toProductJson));
  }

  if (!(await isOrgAdmin(uid, orgId))) return res.status(403).json({ error: 'Org admin required' });

  if (req.method === 'POST') {
    const body = req.body as { name: string; slug: string; mouthValue: number; displayOrder?: number };
    if (!body?.name?.trim() || !body?.slug?.trim()) return res.status(400).json({ error: 'name and slug are required' });
    if (typeof body.mouthValue !== 'number' || body.mouthValue < 0) return res.status(400).json({ error: 'mouthValue must be a non-negative number' });

    const existing = await prisma.campaignProduct.findUnique({
      where: { org_id_slug: { org_id: orgId, slug: body.slug.trim() } },
    });
    if (existing) return res.status(409).json({ error: 'A product with that slug already exists' });

    const maxOrder = await prisma.campaignProduct.aggregate({
      where: { org_id: orgId },
      _max: { display_order: true },
    });

    const product = await prisma.campaignProduct.create({
      data: {
        org_id: orgId,
        name: body.name.trim(),
        slug: body.slug.trim(),
        mouth_value: body.mouthValue,
        display_order: body.displayOrder ?? (maxOrder._max.display_order ?? 0) + 1,
        is_active: true,
        reachout_column: null,
      },
    });
    return res.status(201).json(toProductJson(product));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
