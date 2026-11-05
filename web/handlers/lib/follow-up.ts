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

export const MAX_CADENCE_NOTE = 300;
export const MAX_CADENCES_PER_CONTACT = 10;

/** What the reminder says: the note when there is one, else the schedule. */
export function cadenceText(c: { every_days: number; note: string | null }): string {
  const label = cadenceLabel(c.every_days);
  return c.note ? `${c.note} (${label})` : `Scheduled follow-up (${label})`;
}

function nextFrom(lastVisit: Date | undefined, days: number): Date {
  const today = nextFollowUpDate(new Date(), 0);
  const next = nextFollowUpDate(lastVisit || new Date(), lastVisit ? days : 0);
  return next < today ? today : next;
}

/**
 * Sets each cadence's next follow-up: N days after the latest visit (or
 * today, if there are none yet, or if that day already passed). Each one
 * replaces only its own upcoming reminder on the calendar, so follow-ups
 * added by hand and other schedules stay put. Pass no ids to do them all.
 */
export async function scheduleCadences(contactId: string, actingUid: string, cadenceIds?: string[]): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      store_id: true,
      business_id: true,
      first_name: true,
      last_name: true,
      email: true,
      follow_up_cadences: true,
      reachouts: { orderBy: { date: 'desc' }, take: 1, select: { date: true } },
    },
  });
  if (!contact) return;
  const targets = contact.follow_up_cadences.filter((c) => !cadenceIds || cadenceIds.includes(c.id));
  if (targets.length === 0) return;

  const lastVisit = contact.reachouts[0]?.date;
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'Contact';
  await prisma.$transaction(targets.flatMap((cadence) => {
    const next = nextFrom(lastVisit, cadence.every_days);
    return [
      prisma.followUpCadence.update({ where: { id: cadence.id }, data: { next_date: next } }),
      prisma.calendarEvent.updateMany({
        where: { follow_up_cadence_id: cadence.id, status: 'scheduled' },
        data: { status: 'cancelled', cancelled_at: new Date() },
      }),
      prisma.calendarEvent.create({
        data: {
          store_id: contact.store_id,
          title: `Follow-up: ${name}`,
          description: cadenceText(cadence),
          date: next,
          type: 'followup',
          contact_id: contact.id,
          business_id: contact.business_id,
          priority: 'medium',
          status: 'scheduled',
          created_by: cadence.assignee || actingUid,
          follow_up_cadence_id: cadence.id,
        },
      }),
    ];
  }));
  await syncContactFollowUp(contactId);
}

/**
 * Keeps the contact's "next follow-up" on the soonest schedule, which the
 * dashboard and contact lists show. When the last schedule goes away, a
 * date that came from a schedule is cleared; one set some other way stays.
 */
export async function syncContactFollowUp(contactId: string, removedTexts: string[] = []): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { suggested_follow_up_note: true, follow_up_cadences: { where: { next_date: { not: null } }, orderBy: { next_date: 'asc' }, take: 1 } },
  });
  if (!contact) return;
  const soonest = contact.follow_up_cadences[0];
  if (soonest) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { suggested_follow_up_date: soonest.next_date, suggested_follow_up_note: cadenceText(soonest) },
    });
    return;
  }
  const note = contact.suggested_follow_up_note || '';
  if (removedTexts.includes(note) || note.startsWith('Scheduled follow-up (')) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { suggested_follow_up_date: null, suggested_follow_up_note: null },
    });
  }
}

/** Takes the given schedules off the contact and their upcoming reminders off the calendar. */
export async function removeCadences(contactId: string, cadenceIds: string[]): Promise<void> {
  if (cadenceIds.length === 0) return;
  const removed = await prisma.followUpCadence.findMany({ where: { id: { in: cadenceIds }, contact_id: contactId } });
  await prisma.$transaction([
    prisma.calendarEvent.updateMany({
      where: { follow_up_cadence_id: { in: cadenceIds }, status: 'scheduled' },
      data: { status: 'cancelled', cancelled_at: new Date() },
    }),
    prisma.followUpCadence.deleteMany({ where: { id: { in: cadenceIds }, contact_id: contactId } }),
  ]);
  await syncContactFollowUp(contactId, removed.map(cadenceText));
}
