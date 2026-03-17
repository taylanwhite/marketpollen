import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';

interface ProductConfig {
  id: string;
  slug: string;
  mouthValue: number;
}

const SLUG_TO_FIELD: Record<string, string> = {
  freeBundletCard: 'free_bundlet_card',
  dozenBundtinis: 'dozen_bundtinis',
  cake8inch: 'cake_8inch',
  cake10inch: 'cake_10inch',
  sampleTray: 'sample_tray',
  bundtletTower: 'bundtlet_tower',
};

function getQuarterRange(date: Date): { start: Date; end: Date } {
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3);
  const startMonth = quarter * 3;
  const endMonth = startMonth + 2;
  return {
    start: new Date(year, startMonth, 1, 0, 0, 0, 0),
    end: new Date(year, endMonth + 1, 0, 23, 59, 59, 999),
  };
}

function calculateReachoutMouths(r: any, products: ProductConfig[]): number {
  let total = 0;
  for (const p of products) {
    const col = SLUG_TO_FIELD[p.slug];
    if (col) {
      total += ((r[col] as number) || 0) * p.mouthValue;
    }
  }
  const custom = r.custom_donations as Record<string, number> | null;
  if (custom) {
    for (const p of products) {
      if (!SLUG_TO_FIELD[p.slug] && custom[p.id]) {
        total += (custom[p.id] || 0) * p.mouthValue;
      }
    }
  }
  return total;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { is_global_admin: true },
    });

    const perms = await prisma.storePermission.findMany({
      where: { user_id: uid },
      select: { store_id: true },
    });
    const permStoreIds = perms.map(p => p.store_id);

    const stores = user?.is_global_admin
      ? await prisma.store.findMany({ select: { id: true, organization_id: true } })
      : await prisma.store.findMany({
          where: { id: { in: permStoreIds } },
          select: { id: true, organization_id: true },
        });

    if (stores.length === 0) return res.status(200).json({ stores: [] });

    const storeIds = stores.map(s => s.id);

    const orgIds = [...new Set(stores.map(s => s.organization_id).filter(Boolean))] as string[];
    const orgs = await prisma.organization.findMany({
      where: { id: { in: orgIds } },
      include: { products: { where: { is_active: true }, orderBy: { display_order: 'asc' } } },
    });
    const orgMap = new Map(orgs.map(o => [o.id, o]));

    const { start, end } = getQuarterRange(new Date());

    const contacts = await prisma.contact.findMany({
      where: { store_id: { in: storeIds } },
      select: {
        store_id: true,
        reachouts: {
          where: { date: { gte: start, lte: end } },
          select: {
            free_bundlet_card: true,
            dozen_bundtinis: true,
            cake_8inch: true,
            cake_10inch: true,
            sample_tray: true,
            bundtlet_tower: true,
            custom_donations: true,
          },
        },
      },
    });

    const mouthsByStore = new Map<string, number>();
    for (const storeId of storeIds) {
      mouthsByStore.set(storeId, 0);
    }

    for (const contact of contacts) {
      const storeId = contact.store_id;
      const store = stores.find(s => s.id === storeId);
      const org = store?.organization_id ? orgMap.get(store.organization_id) : undefined;
      const products: ProductConfig[] = org?.products.map(p => ({
        id: p.id,
        slug: p.slug,
        mouthValue: p.mouth_value,
      })) || [
        { id: 'freeBundletCard', slug: 'freeBundletCard', mouthValue: 1 },
        { id: 'dozenBundtinis', slug: 'dozenBundtinis', mouthValue: 12 },
        { id: 'cake8inch', slug: 'cake8inch', mouthValue: 10 },
        { id: 'cake10inch', slug: 'cake10inch', mouthValue: 20 },
        { id: 'sampleTray', slug: 'sampleTray', mouthValue: 40 },
        { id: 'bundtletTower', slug: 'bundtletTower', mouthValue: 1 },
      ];

      for (const r of contact.reachouts) {
        const hasDonation = r.free_bundlet_card || r.dozen_bundtinis || r.cake_8inch || r.cake_10inch || r.sample_tray || r.bundtlet_tower || (r.custom_donations && typeof r.custom_donations === 'object' && Object.keys(r.custom_donations as object).length > 0);
        if (!hasDonation) continue;

        const mouths = calculateReachoutMouths(r, products);
        mouthsByStore.set(storeId, (mouthsByStore.get(storeId) || 0) + mouths);
      }
    }

    const result = stores.map(s => {
      const org = s.organization_id ? orgMap.get(s.organization_id) : undefined;
      const goal = org?.quarterly_goal ?? 10000;
      const totalMouths = mouthsByStore.get(s.id) || 0;
      return {
        storeId: s.id,
        totalMouths,
        goal,
        percentage: goal > 0 ? (totalMouths / goal) * 100 : 0,
      };
    });

    return res.status(200).json({ stores: result });
  } catch (err: any) {
    console.error('store-progress error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load store progress' });
  }
}
