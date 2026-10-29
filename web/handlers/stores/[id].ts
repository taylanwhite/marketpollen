import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore, canViewStore, rejectIfStoreLocked } from '../lib/store-access.js';
import { isOrgAdmin } from '../lib/org-access.js';
import { afterStoreDeleted, archiveStore, BillingHttpError, noteStoreAdded, quoteAddStore } from '../lib/billing.js';
import { isPlatformAdmin } from '../lib/king-admin.js';

function toStoreJson(r: { id: string; name: string; address: string | null; city: string | null; state: string | null; zip_code: string | null; organization_id?: string | null; billing_status?: string; is_demo?: boolean; pause_on?: Date | null; archived_at?: Date | null; created_at: Date; created_by: string }) {
  return {
    id: r.id,
    name: r.name,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zipCode: r.zip_code ?? undefined,
    organizationId: r.organization_id ?? undefined,
    billingStatus: r.billing_status ?? 'active',
    isDemo: r.is_demo ?? false,
    pauseOn: r.pause_on ?? null,
    archivedAt: r.archived_at ?? null,
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
    if (await rejectIfStoreLocked(res, id, uid)) return;

    const body = req.body as { name?: string; address?: string; city?: string; state?: string; zipCode?: string; isDemo?: boolean };
    const before = await prisma.store.findUnique({ where: { id }, select: { is_demo: true, billing_status: true, organization_id: true } });
    const demoChange = typeof body?.isDemo === 'boolean' && body.isDemo !== before?.is_demo;
    if (demoChange && !(await isPlatformAdmin(uid))) {
      return res.status(403).json({ error: 'Only super users can change demo stores' });
    }
    // Turning demo off makes it a billed store. Only allow that when it fits the
    // seats already paid for, so nobody gets charged without seeing a quote.
    if (demoChange && !body.isDemo && before?.organization_id) {
      const quote = await quoteAddStore(before.organization_id, body.name || 'This store');
      if (quote?.needsCharge || quote?.needsCheckout) {
        return res.status(409).json({ error: 'This organization has no free seat for another billed store. Add a store the usual way instead, or archive this demo.' });
      }
    }
    const row = await prisma.store.update({
      where: { id },
      data: {
        ...(body?.name !== undefined && { name: body.name }),
        ...(body?.address !== undefined && { address: body.address }),
        ...(body?.city !== undefined && { city: body.city }),
        ...(body?.state !== undefined && { state: body.state }),
        ...(body?.zipCode !== undefined && { zip_code: body.zipCode }),
        ...(demoChange && { is_demo: body.isDemo }),
      },
    });
    // Turning demo on drops the store from the next bill; turning it off adds it
    // back at renewal (no charge today, like a store added within paid seats).
    if (demoChange && before?.organization_id) {
      try {
        if (body.isDemo) await afterStoreDeleted(before.organization_id, before.billing_status);
        else await noteStoreAdded(before.organization_id, false);
      } catch (err) {
        console.error('Demo setting saved, but the subscription could not be updated', err);
      }
    }
    return res.status(200).json(toStoreJson(row));
  }

  if (req.method === 'POST') {
    const body = req.body as { action?: string };
    if (body?.action !== 'archive') return res.status(400).json({ error: 'Unknown store action' });
    const existing = await prisma.store.findUnique({ where: { id }, select: { organization_id: true } });
    if (!existing) return res.status(404).json({ error: 'Store not found' });
    if (existing.organization_id) {
      if (!(await isOrgAdmin(uid, existing.organization_id))) return res.status(403).json({ error: 'Org admin required' });
    } else if (!(await canAccessStore(uid, id))) {
      return res.status(404).json({ error: 'Store not found' });
    }
    try {
      const quote = await archiveStore(id);
      return res.status(200).json({ quote });
    } catch (err) {
      if (err instanceof BillingHttpError) return res.status(err.status).json(err.body);
      throw err;
    }
  }

  if (req.method === 'DELETE') {
    return res.status(405).json({ error: 'Stores are archived instead of deleted, so contacts and businesses stay on file.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
