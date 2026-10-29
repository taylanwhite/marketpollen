import { prisma } from './db.js';

export const MAX_FOLLOW_UP_DAYS = 730;

/** A whole number of days from 1 to two years, or null to stop the schedule. */
export function cleanEveryDays(value: unknown): number | null {
  if (value == null || value === '') return null;
  const days = Math.round(Number(value));
  if (!Number.isFinite(days) || days < 1) return null;
  return Math.min(days, MAX_FOLLOW_UP_DAYS);
}

export function cadenceLabel(days: number): string {
  if (days === 7) return 'every week';
  if (days === 14) return 'every 2 weeks';
  if (days === 30) return 'every month';
  if (days === 60) return 'every 2 months';
  if (days === 90) return 'every 3 months';
  if (days === 365) return 'every year';
  return `every ${days} days`;
}

/**
 * Noon UTC on the day `days` after `from`. Noon keeps the calendar day the
 * same in every US time zone, matching how the app saves follow-up dates.
 */
export function nextFollowUpDate(from: Date, days: number): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12));
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Sets the contact's next follow-up from its schedule: N days after the
 * latest visit (or today, if there are none yet, or if that day already
 * passed). Replaces any scheduled follow-up on the calendar with one for
 * the new date. Does nothing when the contact has no schedule.
 */
export async function scheduleNextFollowUp(contactId: string, actingUid: string): Promise<Date | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      store_id: true,
      business_id: true,
      first_name: true,
      last_name: true,
      email: true,
      follow_up_every_days: true,
      follow_up_assignee: true,
      reachouts: { orderBy: { date: 'desc' }, take: 1, select: { date: true } },
    },
  });
  const days = contact?.follow_up_every_days;
  if (!contact || !days) return null;

  const lastVisit = contact.reachouts[0]?.date;
  const today = nextFollowUpDate(new Date(), 0);
  let next = nextFollowUpDate(lastVisit || new Date(), lastVisit ? days : 0);
  if (next < today) next = today;

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'Contact';
  const note = `Scheduled follow-up (${cadenceLabel(days)})`;

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contactId },
      data: { suggested_follow_up_date: next, suggested_follow_up_note: note },
    }),
    prisma.calendarEvent.updateMany({
      where: { contact_id: contactId, type: 'followup', status: 'scheduled' },
      data: { status: 'cancelled', cancelled_at: new Date() },
    }),
    prisma.calendarEvent.create({
      data: {
        store_id: contact.store_id,
        title: `Follow-up: ${name}`,
        description: note,
        date: next,
        type: 'followup',
        contact_id: contact.id,
        business_id: contact.business_id,
        priority: 'medium',
        status: 'scheduled',
        created_by: contact.follow_up_assignee || actingUid,
      },
    }),
  ]);
  return next;
}
