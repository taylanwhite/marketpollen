import { prisma } from './db.js';

/** Keep a contact linked to every selected business. The first id stays the primary business. */
export async function syncContactBusinesses(contactId: string, storeId: string, businessIds: string[]): Promise<void> {
  const requested = [...new Set(businessIds.map((id) => id.trim()).filter(Boolean))];
  if (requested.length === 0) return;
  const found = await prisma.business.findMany({
    where: { id: { in: requested }, store_id: storeId },
    select: { id: true },
  });
  const allowed = requested.filter((id) => found.some((business) => business.id === id));
  if (allowed.length === 0) return;
  await prisma.contact.update({ where: { id: contactId }, data: { business_id: allowed[0] } });
  await prisma.contactBusiness.deleteMany({ where: { contact_id: contactId } });
  await prisma.contactBusiness.createMany({
    data: allowed.map((businessId) => ({ contact_id: contactId, business_id: businessId })),
  });
}

/** Whether at least one of these businesses is in the store (a contact's main business must be). */
export async function anyBusinessInStore(businessIds: string[], storeId: string): Promise<boolean> {
  const ids = [...new Set(businessIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return false;
  try {
    return (await prisma.business.count({ where: { id: { in: ids }, store_id: storeId } })) > 0;
  } catch {
    return false; // a malformed id
  }
}
