import { prisma } from './db.js';

export const DEFAULT_CAMPAIGN_PRODUCTS = [
  { slug: 'freeBundletCard', name: 'FREE Bundtlet Card', mouth_value: 1, display_order: 0, reachout_column: 'free_bundlet_card' },
  { slug: 'dozenBundtinis', name: 'Dozen Bundtinis', mouth_value: 12, display_order: 1, reachout_column: 'dozen_bundtinis' },
  { slug: 'cake8inch', name: '8" Cake', mouth_value: 10, display_order: 2, reachout_column: 'cake_8inch' },
  { slug: 'cake10inch', name: '10" Cake', mouth_value: 20, display_order: 3, reachout_column: 'cake_10inch' },
  { slug: 'sampleTray', name: 'Sample Tray', mouth_value: 40, display_order: 4, reachout_column: 'sample_tray' },
  { slug: 'bundtletTower', name: 'Bundtlet/Tower', mouth_value: 1, display_order: 5, reachout_column: 'bundtlet_tower' },
];

export async function createDefaultCampaignProducts(orgId: string) {
  await prisma.campaignProduct.createMany({
    data: DEFAULT_CAMPAIGN_PRODUCTS.map((product) => ({
      org_id: orgId,
      slug: product.slug,
      name: product.name,
      mouth_value: product.mouth_value,
      display_order: product.display_order,
      reachout_column: product.reachout_column,
      is_active: true,
    })),
  });
}
