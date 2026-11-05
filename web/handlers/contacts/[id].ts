import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { canAccessStore, canViewStore, rejectIfStoreLocked } from '../lib/store-access.js';
import { contactInclude, contactToJson } from '../lib/contact-json.js';
import { syncContactBusinesses } from '../lib/contact-businesses.js';
import { contactProfileData } from '../lib/contact-profile.js';
import {
  MAX_CADENCES_PER_CONTACT,
  MAX_CADENCE_NOTE,
  cleanEveryDays,
  removeCadences,
  scheduleCadences,
} from '../lib/follow-up.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CadenceInput = { id?: string | null; everyDays?: number | null; note?: string | null; assignee?: string | null };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Contact id required' });

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: contactInclude,
  });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  if (!(await canViewStore(uid, contact.store_id))) return res.status(404).json({ error: 'Contact not found' });

  if (req.method === 'GET') return res.status(200).json(contactToJson(contact));

  if (!(await canAccessStore(uid, contact.store_id))) return res.status(404).json({ error: 'Contact not found' });
  if (await rejectIfStoreLocked(res, contact.store_id, uid)) return;

  if (req.method === 'PATCH') {
    const body = req.body as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      employeeCount?: number;
      personalDetails?: string;
      suggestedFollowUpDate?: string | Date | null;
      suggestedFollowUpMethod?: string | null;
      suggestedFollowUpNote?: string | null;
      suggestedFollowUpPriority?: string | null;
      lastReachoutDate?: string | Date | null;
      status?: string | null;
      organizationType?: string | null;
      /** The contact's repeating follow-ups, as a full list: left-out ones are removed. */
      followUpCadences?: CadenceInput[];
      /** Older app versions sent one schedule; still read so queued offline edits land. */
      followUpEveryDays?: number | null;
      followUpAssignee?: string | null;
      businessId?: string;
      businessIds?: string[];
      reachouts?: Array<{ date: string | Date; note: string; rawNotes?: string | null; createdBy?: string; type?: string; donation?: { freeBundletCard?: number; dozenBundtinis?: number; cake8inch?: number; cake10inch?: number; sampleTray?: number; bundtletTower?: number; customItems?: Record<string, number>; cakesDonatedNotes?: string; orderedFromUs?: boolean; followedUp?: boolean; noFollowUp?: boolean } }>;
    };

    const updateData: Parameters<typeof prisma.contact.update>[0]['data'] = {};
    if (body.firstName !== undefined) updateData.first_name = body.firstName;
    if (body.lastName !== undefined) updateData.last_name = body.lastName;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.employeeCount !== undefined) updateData.employee_count = body.employeeCount;
    if (body.personalDetails !== undefined) updateData.personal_details = body.personalDetails;
    if (body.status !== undefined) updateData.status = body.status;
    Object.assign(updateData, contactProfileData(body, true));
    if (body.businessId !== undefined) updateData.business_id = body.businessId;
    const linkedBusinesses = Array.isArray(body.businessIds)
      ? body.businessIds
      : body.businessId
        ? [body.businessId]
        : null;
    if (body.suggestedFollowUpDate !== undefined) updateData.suggested_follow_up_date = body.suggestedFollowUpDate == null ? null : (body.suggestedFollowUpDate instanceof Date ? body.suggestedFollowUpDate : new Date(body.suggestedFollowUpDate));
    if (body.suggestedFollowUpMethod !== undefined) updateData.suggested_follow_up_method = body.suggestedFollowUpMethod;
    if (body.suggestedFollowUpNote !== undefined) updateData.suggested_follow_up_note = body.suggestedFollowUpNote;
    if (body.suggestedFollowUpPriority !== undefined) updateData.suggested_follow_up_priority = body.suggestedFollowUpPriority;
    // Repeating follow-ups. Changes are saved now and put on the calendar at
    // the end, after any new visit below restarts the countdown.
    let cadencesToSchedule: string[] = [];
    let cadenceInput = Array.isArray(body.followUpCadences) ? body.followUpCadences : null;
    if (!cadenceInput && body.followUpEveryDays !== undefined) {
      // Old clients only knew one schedule: it edits the first and keeps the rest.
      const [first, ...rest] = contact.follow_up_cadences.map((c) => ({ id: c.id, everyDays: c.every_days, note: c.note, assignee: c.assignee }));
      cadenceInput = body.followUpEveryDays == null
        ? []
        : [{ ...first, everyDays: body.followUpEveryDays, assignee: body.followUpAssignee ?? first?.assignee }, ...rest];
    }
    if (cadenceInput) {
      const wanted: Array<{ id: string | null; every_days: number; note: string | null; assignee: string | null }> = [];
      for (const item of cadenceInput.slice(0, MAX_CADENCES_PER_CONTACT)) {
        const days = cleanEveryDays(item?.everyDays);
        if (!days) continue;
        const note = typeof item.note === 'string' ? item.note.replace(/\s+/g, ' ').trim().slice(0, MAX_CADENCE_NOTE) : '';
        const assignee = typeof item.assignee === 'string' ? item.assignee.trim() : '';
        wanted.push({ id: typeof item.id === 'string' ? item.id : null, every_days: days, note: note || null, assignee: assignee || null });
      }
      const people = [...new Set(wanted.map((c) => c.assignee).filter((a): a is string => Boolean(a)))];
      if (people.length) {
        const members = await prisma.storePermission.findMany({
          where: { store_id: contact.store_id, user_id: { in: people } },
          select: { user_id: true },
        });
        if (members.length < people.length) return res.status(400).json({ error: 'That person does not have access to this store' });
      }

      const existing = new Map(contact.follow_up_cadences.map((c) => [c.id, c]));
      const kept = new Set<string>();
      for (const c of wanted) {
        const before = c.id ? existing.get(c.id) : undefined;
        if (before && !kept.has(before.id)) {
          kept.add(before.id);
          if (before.every_days !== c.every_days || before.note !== c.note || before.assignee !== c.assignee) {
            await prisma.followUpCadence.update({ where: { id: before.id }, data: { every_days: c.every_days, note: c.note, assignee: c.assignee } });
            cadencesToSchedule.push(before.id);
          }
        } else {
          // The app picks the id for a new schedule, so a save sent twice adds it once.
          const clientId = c.id && UUID.test(c.id) && !kept.has(c.id) && !(await prisma.followUpCadence.findUnique({ where: { id: c.id }, select: { id: true } }))
            ? c.id
            : undefined;
          const created = await prisma.followUpCadence.create({
            data: { id: clientId, contact_id: id, every_days: c.every_days, note: c.note, assignee: c.assignee, created_by: uid },
          });
          kept.add(created.id);
          cadencesToSchedule.push(created.id);
        }
      }
      await removeCadences(id, contact.follow_up_cadences.filter((c) => !kept.has(c.id)).map((c) => c.id));
    }
    if (body.lastReachoutDate !== undefined) updateData.last_reachout_date = body.lastReachoutDate == null ? null : (body.lastReachoutDate instanceof Date ? body.lastReachoutDate : new Date(body.lastReachoutDate));

    if (Object.keys(updateData).length > 0) {
      await prisma.contact.update({ where: { id }, data: updateData });
    }
    if (linkedBusinesses) {
      await syncContactBusinesses(id, contact.store_id, linkedBusinesses);
    }

    if (Array.isArray(body.reachouts)) {
      const existing = await prisma.reachout.findMany({
        where: { contact_id: id },
        select: { no_follow_up: true },
      });
      const previousNoFollowUp = existing.filter((r) => r.no_follow_up).length;
      const isNewReachout = body.reachouts.length > existing.length;

      await prisma.reachout.deleteMany({ where: { contact_id: id } });
      for (const r of body.reachouts) {
        const d = r.donation || {};
        const date = r.date instanceof Date ? r.date : new Date(r.date);
        const noFollowUp = d.noFollowUp === true;
        await prisma.reachout.create({
          data: {
            contact_id: id,
            date,
            note: r.note || '',
            raw_notes: r.rawNotes ?? null,
            created_by: r.createdBy || uid,
            type: (r.type as 'call' | 'email' | 'meeting' | 'other') || 'other',
            free_bundlet_card: d.freeBundletCard ?? 0,
            dozen_bundtinis: d.dozenBundtinis ?? 0,
            cake_8inch: d.cake8inch ?? 0,
            cake_10inch: d.cake10inch ?? 0,
            sample_tray: d.sampleTray ?? 0,
            bundtlet_tower: d.bundtletTower ?? 0,
            cakes_donated_notes: d.cakesDonatedNotes ?? null,
            ordered_from_us: d.orderedFromUs === true,
            followed_up: noFollowUp ? false : d.followedUp === true,
            no_follow_up: noFollowUp,
            custom_donations: d.customItems && Object.keys(d.customItems).length > 0 ? d.customItems : undefined,
          },
        });
      }

      const nextNoFollowUp = body.reachouts.filter((r) => r.donation?.noFollowUp === true).length;
      if (nextNoFollowUp > previousNoFollowUp) {
        await prisma.calendarEvent.updateMany({
          where: {
            contact_id: id,
            type: 'followup',
            status: 'scheduled',
          },
          data: {
            status: 'cancelled',
            cancelled_at: new Date(),
          },
        });
        // "No follow-up" also stops every repeating schedule.
        const all = await prisma.followUpCadence.findMany({ where: { contact_id: id }, select: { id: true } });
        await removeCadences(id, all.map((c) => c.id));
        await prisma.contact.update({
          where: { id },
          data: {
            suggested_follow_up_date: null,
            suggested_follow_up_method: null,
            suggested_follow_up_note: null,
            suggested_follow_up_priority: null,
          },
        });
        cadencesToSchedule = [];
      } else if (isNewReachout) {
        // A new visit restarts the countdown on every schedule.
        const all = await prisma.followUpCadence.findMany({ where: { contact_id: id }, select: { id: true } });
        cadencesToSchedule = all.map((c) => c.id);
      }

      if (isNewReachout) {
        await prisma.calendarEvent.updateMany({
          where: {
            contact_id: id,
            status: 'scheduled',
          },
          data: {
            status: 'completed',
            completed_at: new Date(),
          },
        });
      }
    }

    if (cadencesToSchedule.length) await scheduleCadences(id, uid, cadencesToSchedule);

    const updated = await prisma.contact.findUnique({
      where: { id },
      include: contactInclude,
    });
    return res.status(200).json(contactToJson(updated!));
  }

  if (req.method === 'DELETE') {
    await prisma.contact.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
