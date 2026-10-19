import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canViewStore } from './lib/store-access.js';
import { loadPlan, parseDateKey } from './lib/plan-stops.js';

const MAX_EMAIL_DRAFTS = 5;
function donationSkipsFollowUp(contact: {
  reachouts?: Array<{
    date: Date;
    no_follow_up: boolean;
    free_bundlet_card: number;
    dozen_bundtinis: number;
    cake_8inch: number;
    cake_10inch: number;
    sample_tray: number;
    bundtlet_tower: number;
    cakes_donated_notes: string | null;
    custom_donations: unknown;
  }>;
}): boolean {
  const donations = (contact.reachouts || []).filter((r) => {
    const custom = r.custom_donations as Record<string, number> | null;
    return (
      r.free_bundlet_card ||
      r.dozen_bundtinis ||
      r.cake_8inch ||
      r.cake_10inch ||
      r.sample_tray ||
      r.bundtlet_tower ||
      r.cakes_donated_notes ||
      (custom && Object.keys(custom).length > 0)
    );
  });
  if (donations.length === 0) return false;
  donations.sort((a, b) => b.date.getTime() - a.date.getTime());
  return donations[0].no_follow_up === true;
}

/** Generate a short follow-up email draft using OpenAI */
async function generateFollowUpEmailDraft(
  contactName: string,
  reachoutNotes: string,
  suggestedMessage: string,
  openai: OpenAI
): Promise<string> {
  const prompt = `You are writing a brief, professional follow-up email for a marketer at Nothing Bundt Cake.

Contact name: ${contactName}
Last reachout notes: ${reachoutNotes || 'None'}
Suggested follow-up context: ${suggestedMessage || 'General check-in'}

Write a short email body (2-4 sentences) that the marketer can copy and paste. Do not include subject line or "Hi X" - only the body. Keep it friendly and concise.`;
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 200,
    });
    const body = res.choices?.[0]?.message?.content?.trim();
    return body || '';
  } catch {
    return '';
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const storeId = (req.query?.storeId as string)?.trim();
  const dateStr = (req.query?.date as string)?.trim();
  if (!storeId || !dateStr) {
    return res.status(400).json({ error: 'storeId and date (YYYY-MM-DD) are required' });
  }

  const can = await canViewStore(uid, storeId);
  if (!can) return res.status(404).json({ error: 'Store not found' });

  let targetDate: Date;
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) throw new Error('Invalid date');
    targetDate = new Date(y, m - 1, d);
    if (isNaN(targetDate.getTime())) throw new Error('Invalid date');
  } catch {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  try {
    const [store, calendarEvents, contacts] = await Promise.all([
      prisma.store.findUnique({ where: { id: storeId } }),
      prisma.calendarEvent.findMany({
        where: {
          store_id: storeId,
          date: { gte: dayStart, lt: dayEnd },
          status: { notIn: ['cancelled', 'completed'] },
        },
        orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      }),
      prisma.contact.findMany({
        where: { store_id: storeId },
        include: {
          business: { select: { id: true, name: true, address: true, city: true, state: true, zip_code: true } },
          reachouts: { orderBy: { date: 'desc' }, take: 5 },
        },
      }),
    ]);

    if (!store) return res.status(404).json({ error: 'Store not found' });

    const storeAddressParts = [store.address, store.city, store.state, store.zip_code].filter(Boolean);
    const storeAddress = storeAddressParts.join(', ') || '';

    // Build follow-up tasks: calendar events for this date with contactId + contacts with suggested_follow_up_date = this date
    const contactMap = new Map(contacts.map((c) => [c.id, c]));
    const taskContactIds = new Set<string>();

    interface FollowUpTask {
      contactId: string;
      contactName: string;
      businessName?: string;
      method: 'email' | 'call' | 'meeting' | 'text' | 'other';
      message: string;
      draftEmail?: string;
      eventTitle?: string;
      eventId?: string;
    }
    const followUpTasks: FollowUpTask[] = [];

    // From calendar events
    for (const ev of calendarEvents) {
      const type = (ev.type || 'other') as string;
      if (!['email', 'call', 'followup', 'meeting', 'text'].includes(type)) continue;
      const contactId = ev.contact_id;
      if (!contactId || taskContactIds.has(contactId)) continue;
      const contact = contactMap.get(contactId);
      if (!contact) continue;
      if (type === 'followup' && donationSkipsFollowUp(contact)) continue;
      taskContactIds.add(contactId);
      const contactName =
        [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
        contact.email ||
        'Contact';
      const method = (type === 'followup' ? contact.suggested_follow_up_method || 'email' : type) as FollowUpTask['method'];
      const message =
        ev.description ||
        contact.suggested_follow_up_note ||
        `Follow up with ${contactName}`;
      followUpTasks.push({
        contactId,
        contactName,
        businessName: contact.business?.name,
        method: method in { email: 1, call: 1, meeting: 1, text: 1, other: 1 } ? (method as FollowUpTask['method']) : 'other',
        message,
        eventTitle: ev.title || undefined,
        eventId: ev.id,
      });
    }

    // From contacts with suggested_follow_up_date = this date (not already added)
    const normalizedTarget = dayStart.getTime();
    for (const contact of contacts) {
      if (taskContactIds.has(contact.id)) continue;
      if (donationSkipsFollowUp(contact)) continue;
      const suggestedDate = contact.suggested_follow_up_date;
      if (!suggestedDate) continue;
      const suggestedNorm = new Date(suggestedDate.getFullYear(), suggestedDate.getMonth(), suggestedDate.getDate()).getTime();
      if (suggestedNorm !== normalizedTarget) continue;
      taskContactIds.add(contact.id);
      const contactName =
        [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || contact.email || 'Contact';
      const method = (contact.suggested_follow_up_method || 'email') as FollowUpTask['method'];
      const message = contact.suggested_follow_up_note || `Follow up with ${contactName}`;
      followUpTasks.push({
        contactId: contact.id,
        contactName,
        businessName: contact.business?.name,
        method: method in { email: 1, call: 1, meeting: 1, text: 1, other: 1 } ? method : 'email',
        message,
      });
    }

    // Generate draft emails for email-type tasks (max MAX_EMAIL_DRAFTS)
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey && followUpTasks.length > 0) {
      const openai = new OpenAI({ apiKey: openaiApiKey });
      let emailCount = 0;
      for (const task of followUpTasks) {
        if (task.method !== 'email' || emailCount >= MAX_EMAIL_DRAFTS) continue;
        const contact = contactMap.get(task.contactId);
        const reachoutNotes = contact?.reachouts?.[0]?.note || '';
        const draft = await generateFollowUpEmailDraft(task.contactName, reachoutNotes, task.message, openai);
        if (draft) {
          task.draftEmail = draft;
          emailCount++;
        }
      }
    }

    // Driving order is the stops this person saved for the day, in their order.
    const planDate = parseDateKey(dateStr);
    const optimizedRoute = planDate
      ? (await loadPlan(storeId, uid, planDate)).map((stop) => ({
        id: stop.id,
        name: stop.name,
        kind: stop.businessId ? 'visit' as const : 'stop' as const,
        address: stop.address,
        city: stop.city,
        state: stop.state,
        zipCode: stop.zipCode,
      }))
      : [];

    return res.status(200).json({
      storeName: store.name,
      storeAddress,
      date: dateStr,
      followUpTasks: followUpTasks.map((t) => ({
        contactId: t.contactId,
        contactName: t.contactName,
        businessName: t.businessName,
        businessId: contactMap.get(t.contactId)?.business?.id,
        method: t.method,
        message: t.message,
        draftEmail: t.draftEmail,
        eventTitle: t.eventTitle,
        eventId: t.eventId,
      })),
      optimizedRoute,
    });
  } catch (err: any) {
    console.error('day-planner error:', err);
    return res.status(500).json({ error: err.message || 'Failed to build day plan' });
  }
}
