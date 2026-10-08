import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { getAccessibleStores } from './lib/store-access.js';
import { isOrgAdmin } from './lib/org-access.js';
import { BillingHttpError, commitAddStoreCharge, noteStoreAdded } from './lib/billing.js';
import { sendStoreInvoiceEmail } from './lib/payment-grace.js';
import { STORE_UNIT_CENTS, pausedBanner, scheduledPauseBanner } from './lib/billing-copy.js';

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  organization_id: string | null;
  billing_status: string;
  pause_on: Date | null;
  archived_at: Date | null;
  created_at: Date;
  created_by: string;
  organization?: {
    billing_enabled: boolean;
    subscription_status: string | null;
    paid_quantity: number;
    monthly_price_cents: number;
  } | null;
  statusMessage?: string | null;
  billingActive?: boolean;
};

function toStoreJson(r: StoreRow) {
  return {
    id: r.id,
    name: r.name,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zipCode: r.zip_code ?? undefined,
    organizationId: r.organization_id ?? undefined,
    billingStatus: r.billing_status ?? 'active',
    pauseOn: r.pause_on,
    archivedAt: r.archived_at,
    statusMessage: r.statusMessage ?? null,
    billingActive: r.billingActive ?? false,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

function withStatusMessages(rows: StoreRow[]): StoreRow[] {
  const byOrg = new Map<string, StoreRow[]>();
  for (const row of rows) {
    if (!row.organization_id) continue;
    const list = byOrg.get(row.organization_id) ?? [];
    list.push(row);
    byOrg.set(row.organization_id, list);
  }
  return rows.map((row) => {
    const org = row.organization;
    if (!org?.billing_enabled || org.subscription_status !== 'active' || !row.organization_id) return row;
    const siblings = byOrg.get(row.organization_id) ?? [];
    const active = siblings.filter((store) => store.billing_status === 'active').length;
    const unit = org.monthly_price_cents > 0 ? org.monthly_price_cents : STORE_UNIT_CENTS;
    const current = org.paid_quantity * unit;
    const next = active * unit;
    let statusMessage: string | null = null;
    if (row.billing_status === 'pause_scheduled' && row.pause_on) {
      statusMessage = scheduledPauseBanner(row.name, row.pause_on, current, next);
    } else if (row.billing_status === 'paused') {
      statusMessage = pausedBanner(row.name, unit);
    }
    return {
      ...row,
      statusMessage,
      billingActive: true,
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const access = await getAccessibleStores(uid);
    const archivedOnly = req.query?.archived === '1' || req.query?.archived === 'true';
    const rows = await prisma.store.findMany({
      where: {
        ...('all' in access ? {} : { id: { in: access.ids } }),
        archived_at: archivedOnly ? { not: null } : null,
      },
      include: {
        organization: {
          select: { billing_enabled: true, subscription_status: true, paid_quantity: true, monthly_price_cents: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    return res.status(200).json(withStatusMessages(rows).map(toStoreJson));
  }

  if (req.method === 'POST') {
    const body = req.body as {
      name: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      organizationId?: string;
      confirmCharge?: boolean;
      expectedDueCents?: number;
      idempotencyKey?: string;
    };
    if (!body?.name || typeof body.name !== 'string') return res.status(400).json({ error: 'name is required' });

    let orgId = body.organizationId?.trim() || null;
    if (!orgId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { user_id: uid },
        select: { org_id: true },
      });
      orgId = membership?.org_id ?? null;
    }

    if (orgId) {
      if (!(await isOrgAdmin(uid, orgId))) return res.status(403).json({ error: 'Org admin required' });
    } else {
      const user = await prisma.user.findUnique({ where: { id: uid }, select: { is_global_admin: true } });
      if (!user?.is_global_admin) return res.status(403).json({ error: 'Org admin required' });
    }

    try {
      const charge = orgId
        ? await commitAddStoreCharge({
          orgId,
          storeName: body.name,
          confirmCharge: body.confirmCharge === true,
          expectedDueCents: typeof body.expectedDueCents === 'number' ? body.expectedDueCents : undefined,
          idempotencyKey: body.idempotencyKey,
        })
        : { charged: false, quote: null };

      const row = await prisma.store.create({
        data: {
          name: body.name,
          address: body.address ?? null,
          city: body.city ?? null,
          state: body.state ?? null,
          zip_code: body.zipCode ?? null,
          created_by: uid,
          organization_id: orgId,
        },
      });
      if (orgId) {
        const admins = await prisma.organizationMember.findMany({
          where: { org_id: orgId, is_admin: true },
          select: { user_id: true },
        });
        for (const admin of admins) {
          await prisma.storePermission.upsert({
            where: { user_id_store_id: { user_id: admin.user_id, store_id: row.id } },
            create: { user_id: admin.user_id, store_id: row.id, can_edit: true },
            update: { can_edit: true },
          });
        }
        try {
          await noteStoreAdded(orgId, charge.charged);
        } catch (err) {
          console.error('Store was created, but the subscription could not be updated', err);
        }
        if (charge.quote) {
          try {
            await sendStoreInvoiceEmail(orgId, charge.quote);
          } catch (err) {
            console.error('Store was created, but the invoice email was not sent', err);
          }
        }
      }
      return res.status(201).json(toStoreJson(row));
    } catch (err) {
      if (err instanceof BillingHttpError) return res.status(err.status).json(err.body);
      throw err;
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
