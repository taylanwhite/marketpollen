import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../../lib/db.js';
import { getAuthUid } from '../../../lib/auth.js';
import { isOrgAdmin } from '../../../lib/org-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const orgId = (req.query?.id as string)?.trim();
  const pid = (req.query?.pid as string)?.trim();
  if (!orgId || !pid) return res.status(400).json({ error: 'Organization id and product id required' });

  if (!(await isOrgAdmin(uid, orgId))) return res.status(403).json({ error: 'Org admin required' });

  const product = await prisma.campaignProduct.findFirst({ where: { id: pid, org_id: orgId } });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (req.method === 'PATCH') {
    const body = req.body as { name?: string; mouthValue?: number; isActive?: boolean; displayOrder?: number };
    const updated = await prisma.campaignProduct.update({
      where: { id: pid },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.mouthValue !== undefined && { mouth_value: body.mouthValue }),
        ...(body.isActive !== undefined && { is_active: body.isActive }),
        ...(body.displayOrder !== undefined && { display_order: body.displayOrder }),
      },
    });
    return res.status(200).json({
      id: updated.id,
      orgId: updated.org_id,
      slug: updated.slug,
      name: updated.name,
      mouthValue: updated.mouth_value,
      displayOrder: updated.display_order,
      isActive: updated.is_active,
      reachoutColumn: updated.reachout_column,
    });
  }

  if (req.method === 'DELETE') {
    if (product.reachout_column) {
      return res.status(400).json({ error: 'Cannot delete a default product. Deactivate it instead.' });
    }
    await prisma.campaignProduct.delete({ where: { id: pid } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
