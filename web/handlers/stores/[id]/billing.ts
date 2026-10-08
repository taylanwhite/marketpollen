import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { isOrgAdmin } from '../../lib/org-access.js';
import { BillingHttpError, keepStoreOpen, pauseStore, resumeStore } from '../../lib/billing.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Store id required' });

  const store = await prisma.store.findUnique({ where: { id }, select: { id: true, organization_id: true } });
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (!store.organization_id || !(await isOrgAdmin(uid, store.organization_id))) {
    return res.status(403).json({ error: 'Org admin required' });
  }

  const body = (req.body ?? {}) as {
    action?: string;
    confirmCharge?: boolean;
    expectedDueCents?: number;
    idempotencyKey?: string;
  };

  try {
    if (body.action === 'pause') {
      const quote = await pauseStore(id);
      return res.status(200).json({ quote });
    }
    if (body.action === 'keep_open') {
      const quote = await keepStoreOpen(id);
      return res.status(200).json({ quote });
    }
    if (body.action === 'resume') {
      const quote = await resumeStore({
        storeId: id,
        confirmCharge: body.confirmCharge === true,
        expectedDueCents: body.expectedDueCents,
        idempotencyKey: body.idempotencyKey,
      });
      return res.status(200).json({ quote });
    }
    return res.status(400).json({ error: 'Unknown store billing action' });
  } catch (err) {
    if (err instanceof BillingHttpError) return res.status(err.status).json(err.body);
    console.error(err);
    const message = err instanceof Error ? err.message : 'Store billing failed';
    return res.status(500).json({ error: message });
  }
}
