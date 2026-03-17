import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_PRODUCTS = [
  { slug: 'freeBundletCard', name: 'FREE Bundtlet Card', mouth_value: 1, display_order: 0, reachout_column: 'free_bundlet_card' },
  { slug: 'dozenBundtinis', name: 'Dozen Bundtinis', mouth_value: 12, display_order: 1, reachout_column: 'dozen_bundtinis' },
  { slug: 'cake8inch', name: '8" Cake', mouth_value: 10, display_order: 2, reachout_column: 'cake_8inch' },
  { slug: 'cake10inch', name: '10" Cake', mouth_value: 20, display_order: 3, reachout_column: 'cake_10inch' },
  { slug: 'sampleTray', name: 'Sample Tray', mouth_value: 40, display_order: 4, reachout_column: 'sample_tray' },
  { slug: 'bundtletTower', name: 'Bundtlet/Tower', mouth_value: 1, display_order: 5, reachout_column: 'bundtlet_tower' },
];

async function main() {
  const existingOrg = await prisma.organization.findFirst();
  if (existingOrg) {
    console.log('Organization already exists, skipping seed.');
    return;
  }

  const admin = await prisma.user.findFirst({ where: { is_global_admin: true } });
  if (!admin) {
    console.error('No global admin found. Create a user first.');
    return;
  }

  const org = await prisma.organization.create({
    data: {
      name: 'Nothing Bundt Cakes',
      quarterly_goal: 10000,
      created_by: admin.id,
    },
  });
  console.log(`Created organization: ${org.name} (${org.id})`);

  await prisma.organizationMember.create({
    data: { user_id: admin.id, org_id: org.id, is_admin: true },
  });
  console.log(`Added ${admin.email} as org admin`);

  for (const p of DEFAULT_PRODUCTS) {
    await prisma.campaignProduct.create({
      data: {
        org_id: org.id,
        slug: p.slug,
        name: p.name,
        mouth_value: p.mouth_value,
        display_order: p.display_order,
        reachout_column: p.reachout_column,
        is_active: true,
      },
    });
  }
  console.log(`Created ${DEFAULT_PRODUCTS.length} default campaign products`);

  const stores = await prisma.store.findMany();
  for (const store of stores) {
    await prisma.store.update({
      where: { id: store.id },
      data: { organization_id: org.id },
    });
    console.log(`Assigned store "${store.name}" to org`);
  }

  const members = await prisma.user.findMany();
  for (const user of members) {
    if (user.id === admin.id) continue;
    const hasPerm = await prisma.storePermission.findFirst({ where: { user_id: user.id } });
    if (hasPerm) {
      await prisma.organizationMember.upsert({
        where: { user_id_org_id: { user_id: user.id, org_id: org.id } },
        update: {},
        create: { user_id: user.id, org_id: org.id, is_admin: false },
      });
      console.log(`Added ${user.email} as org member`);
    }
  }

  console.log('Seed complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
