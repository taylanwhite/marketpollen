import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { isOrgAdmin } from '../../lib/org-access.js';
import {
  billingView,
  BillingHttpError,
  createCheckout,
  createPortal,
  quoteAddStore,
  quoteDeleteStore,
  quoteKeepOpen,
  quotePauseStore,
  quoteResumeStore,
  setBillingEnabled,
  syncCheckoutSession,
} from '../../lib/billing.js';

async function isGlobalAdmin(uid: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { is_global_admin: true } });
  return user?.is_global_admin === true;
}

function sendError(res: VercelResponse, err: unknown) {
  if (err instanceof BillingHttpError) return res.status(err.status).json(err.body);
  console.error(err);
  const message = err instanceof Error ? err.message : 'Billing request failed';
  return res.status(500).json({ error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const orgId = (req.query?.id as string)?.trim();
  if (!orgId) return res.status(400).json({ error: 'Organization id required' });
  if (!(await isOrgAdmin(uid, orgId))) return res.status(403).json({ error: 'Org admin required' });

  try {
    if (req.method === 'GET') {
      const billing = await billingView(orgId);
      if (!billing) return res.status(404).json({ error: 'Organization not found' });
      return res.status(200).json(billing);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = (req.body ?? {}) as {
      action?: string;
      quantity?: number;
      enabled?: boolean;
      sessionId?: string;
      intent?: string;
      storeId?: string;
      storeName?: string;
    };

    if (body.action === 'checkout') {
      const url = await createCheckout(orgId, Number(body.quantity));
      return res.status(200).json({ url });
    }

    if (body.action === 'portal') {
      const url = await createPortal(orgId);
      return res.status(200).json({ url });
    }

    if (body.action === 'sync_checkout') {
      if (!body.sessionId) return res.status(400).json({ error: 'sessionId is required' });
      await syncCheckoutSession(orgId, body.sessionId);
      const billing = await billingView(orgId);
      return res.status(200).json(billing);
    }

    if (body.action === 'enable') {
      if (!(await isGlobalAdmin(uid))) return res.status(403).json({ error: 'Global admin required' });
      await setBillingEnabled(orgId, body.enabled !== false);
      const billing = await billingView(orgId);
      return res.status(200).json(billing);
    }

    if (body.action === 'preview') {
      if (body.intent === 'add_store') {
        const quote = await quoteAddStore(orgId, body.storeName || 'this store');
        if (!quote) return res.status(200).json({ quote: null });
        return res.status(200).json({ quote });
      }
      if (!body.storeId) return res.status(400).json({ error: 'storeId is required' });
      const store = await prisma.store.findFirst({ where: { id: body.storeId, organization_id: orgId } });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      if (body.intent === 'pause_store') return res.status(200).json({ quote: await quotePauseStore(store.id) });
      if (body.intent === 'keep_open') return res.status(200).json({ quote: await quoteKeepOpen(store.id) });
      if (body.intent === 'resume_store') return res.status(200).json({ quote: await quoteResumeStore(store.id) });
      if (body.intent === 'delete_store') return res.status(200).json({ quote: await quoteDeleteStore(store.id) });
      return res.status(400).json({ error: 'Unknown preview' });
    }

    return res.status(400).json({ error: 'Unknown billing action' });
  } catch (err) {
    return sendError(res, err);
  }
}
