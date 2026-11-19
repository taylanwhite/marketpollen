import { prisma } from './db.js';

/**
 * "Followed up" lives in two places: on the contact's latest visit with
 * bites (what the Bites tab shows as "Needs follow-up") and on the
 * follow-up itself on the Plan tab (a calendar event, or the contact's
 * suggested follow-up). These keep the two in step.
 */

/** Calendar event types that count as a follow-up with a contact (same list as the day planner). */
export const FOLLOW_UP_EVENT_TYPES = ['followup', 'email', 'call', 'text', 'meeting'];

type VisitRow = {
  id: string;
  date: Date;
  followed_up: boolean;
  free_bundlet_card: number;
  dozen_bundtinis: number;
  cake_8inch: number;
  cake_10inch: number;
  sample_tray: number;
  bundtlet_tower: number;
  cakes_donated_notes: string | null;
  custom_donations: unknown;
};

/** Whether a visit shows on the Bites tab (same rule the contact JSON uses). */
export function visitHasBites(r: Omit<VisitRow, 'id' | 'date' | 'followed_up'>): boolean {
  const custom = r.custom_donations as Record<string, number> | null;
  return !!(
    r.free_bundlet_card || r.dozen_bundtinis || r.cake_8inch || r.cake_10inch || r.sample_tray || r.bundtlet_tower
    || r.cakes_donated_notes || (custom && typeof custom === 'object' && Object.keys(custom).length > 0)
  );
}

/** The newest visit with bites, if any. */
export function latestVisitWithBites<T extends VisitRow>(visits: T[]): T | null {
  return visits
    .filter((r) => visitHasBites(r))
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;
}

/**
 * A follow-up was completed on the Plan tab: mark the contact's latest
 * visit with bites as followed up so the Bites tab agrees.
 */
export async function markLatestVisitFollowedUp(contactId: string): Promise<boolean> {
  const visits = await prisma.reachout.findMany({ where: { contact_id: contactId } });
  const latest = latestVisitWithBites(visits);
  if (!latest || latest.followed_up) return false;
  await prisma.reachout.update({ where: { id: latest.id }, data: { followed_up: true } });
  return true;
}

/**
 * "Followed up" was ticked on a visit: complete the contact's open
 * follow-ups on the Plan tab (due by tomorrow; later reminders stay) and
 * clear the suggested follow-up, the same as Done on the Plan tab.
 */
export async function completeOpenFollowUps(contactId: string): Promise<number> {
  const dueBy = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const done = await prisma.calendarEvent.updateMany({
    where: {
      contact_id: contactId,
      type: { in: FOLLOW_UP_EVENT_TYPES },
      date: { lte: dueBy },
      OR: [{ status: 'scheduled' }, { status: null }],
    },
    data: { status: 'completed', completed_at: new Date() },
  });
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      suggested_follow_up_date: null,
      suggested_follow_up_method: null,
      suggested_follow_up_note: null,
      suggested_follow_up_priority: null,
    },
  });
  return done.count;
}
