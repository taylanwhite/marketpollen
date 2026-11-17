import { prisma } from './db.js';
import { isPlatformAdmin } from './king-admin.js';

export type MoveResult = {
  businessId: string;
  storeId: string;
  storeName: string;
  /** Contacts whose main business this is; they moved with it. */
  contacts: number;
  /** Links between a contact and a business that ended up in different stores, now removed. */
  unlinked: number;
  /** Upcoming plan stops that moved to the new store's plan. */
  planStops: number;
};

/** Can this person change data in this store (an edit permission, or a platform admin)? */
export async function canEditStore(uid: string, storeId: string): Promise<boolean> {
  if (await isPlatformAdmin(uid)) return true;
  const perm = await prisma.storePermission.findUnique({
    where: { user_id_store_id: { user_id: uid, store_id: storeId } },
    select: { can_edit: true },
  });
  return perm?.can_edit === true;
}

/**
 * Moves a business to another store of the same organization, with everyone
 * whose main business it is: their visits and files (which hang off the
 * contact), follow-ups and calendar items. Upcoming plan stops move to the
 * new store's plan when the person they belong to works there.
 *
 * A contact can also be linked to extra businesses. Those links only make
 * sense inside one store, so any link the move splits across two stores is
 * removed; each contact keeps its main business.
 *
 * The caller checks permissions and that both stores can be written to.
 */
export async function moveBusinessToStore(businessId: string, targetStoreId: string): Promise<MoveResult> {
  const target = await prisma.store.findUniqueOrThrow({ where: { id: targetStoreId }, select: { id: true, name: true } });
  const targetPeople = new Set(
    (await prisma.storePermission.findMany({ where: { store_id: targetStoreId }, select: { user_id: true } })).map((p) => p.user_id),
  );
  // Plan dates have no time zone; a day back keeps "today" in every US zone.
  const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const contacts = await tx.contact.findMany({ where: { business_id: businessId }, select: { id: true } });
    const contactIds = contacts.map((c) => c.id);

    await tx.business.update({ where: { id: businessId }, data: { store_id: targetStoreId } });
    if (contactIds.length) {
      await tx.contact.updateMany({ where: { id: { in: contactIds } }, data: { store_id: targetStoreId } });
    }

    // Links now split across stores: moved contacts to businesses left behind,
    // and contacts left behind to this business.
    const unlinkedAway = contactIds.length
      ? await tx.contactBusiness.deleteMany({
        where: { contact_id: { in: contactIds }, business: { store_id: { not: targetStoreId } } },
      })
      : { count: 0 };
    const unlinkedHere = await tx.contactBusiness.deleteMany({
      where: { business_id: businessId, contact: { store_id: { not: targetStoreId } } },
    });

    await tx.calendarEvent.updateMany({
      where: { OR: [{ business_id: businessId }, ...(contactIds.length ? [{ contact_id: { in: contactIds } }] : [])] },
      data: { store_id: targetStoreId },
    });

    // A follow-up owner who can't open the new store would block saving the
    // contact there, so those reminders fall back to whoever made the contact.
    if (contactIds.length) {
      await tx.followUpCadence.updateMany({
        where: { contact_id: { in: contactIds }, assignee: { not: null, notIn: [...targetPeople] } },
        data: { assignee: null },
      });
    }

    // Upcoming stops go to the end of that day in the new store's plan. Past
    // stops stay where they were done; they keep their own name and address.
    const stops = await tx.planStop.findMany({
      where: { business_id: businessId, status: 'planned', plan_date: { gte: fromDate } },
      select: { id: true, user_id: true, plan_date: true },
    });
    let planStops = 0;
    for (const stop of stops) {
      if (!targetPeople.has(stop.user_id)) continue;
      const last = await tx.planStop.aggregate({
        where: { store_id: targetStoreId, user_id: stop.user_id, plan_date: stop.plan_date },
        _max: { position: true },
      });
      await tx.planStop.update({
        where: { id: stop.id },
        data: { store_id: targetStoreId, position: (last._max.position ?? -1) + 1 },
      });
      planStops++;
    }

    return {
      businessId,
      storeId: target.id,
      storeName: target.name,
      contacts: contactIds.length,
      unlinked: unlinkedAway.count + unlinkedHere.count,
      planStops,
    };
  });
}
