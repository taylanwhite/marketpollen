import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore, canViewStore } from '../lib/store-access.js';
import { isOrgAdmin } from '../lib/org-access.js';
import { afterStoreDeleted, BillingHttpError, quoteDeleteStore } from '../lib/billing.js';

function toStoreJson(r: { id: string; name: string; address: string | null; city: string | null; state: string | null; zip_code: string | null; organization_id?: string | null; billing_status?: string; pause_on?: Date | null; created_at: Date; created_by: string }) {
  return {
    id: r.id,
    name: r.name,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zipCode: r.zip_code ?? undefined,
    organizationId: r.organization_id ?? undefined,
    billingStatus: r.billing_status ?? 'active',
    pauseOn: r.pause_on ?? null,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Store id required' });

  if (!(await canViewStore(uid, id))) return res.status(404).json({ error: 'Store not found' });

  if (req.method === 'GET') {
    const row = await prisma.store.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Store not found' });
    return res.status(200).json(toStoreJson(row));
  }

  if (req.method === 'PATCH') {
    if (!(await canAccessStore(uid, id))) return res.status(404).json({ error: 'Store not found' });

    const body = req.body as { name?: string; address?: string; city?: string; state?: string; zipCode?: string };
    const row = await prisma.store.update({
      where: { id },
      data: {
        ...(body?.name !== undefined && { name: body.name }),
        ...(body?.address !== undefined && { address: body.address }),
        ...(body?.city !== undefined && { city: body.city }),
        ...(body?.state !== undefined && { state: body.state }),
        ...(body?.zipCode !== undefined && { zip_code: body.zipCode }),
      },
    });
    return res.status(200).json(toStoreJson(row));
  }

  if (req.method === 'DELETE') {
    if (!(await canAccessStore(uid, id))) return res.status(404).json({ error: 'Store not found' });
    const existing = await prisma.store.findUnique({
      where: { id },
      include: { organization: { select: { billing_enabled: true, subscription_status: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Store not found' });
    const billed = existing.organization?.billing_enabled && existing.organization.subscription_status === 'active';
    if (billed) {
      if (!existing.organization_id || !(await isOrgAdmin(uid, existing.organization_id))) {
        return res.status(403).json({ error: 'Org admin required' });
      }
      const confirm = req.query?.confirm === '1' || req.query?.confirm === 'true';
      if (!confirm) {
        try {
          const quote = await quoteDeleteStore(id);
          return res.status(409).json({ error: quote.message, quote });
        } catch (err) {
          if (err instanceof BillingHttpError) return res.status(err.status).json(err.body);
          throw err;
        }
      }
    }
    await prisma.store.delete({ where: { id } });
    await afterStoreDeleted(existing.organization_id, existing.billing_status);
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
