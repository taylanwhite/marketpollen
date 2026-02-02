import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import OpenAI from 'openai';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore } from './lib/store-access.js';

const MAX_EMAIL_DRAFTS = 5;
const MAX_OPPORTUNITIES_IN_PLAN = 10;

/** Haversine distance in meters */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocode(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  if (!address.trim()) return null;
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: address.trim(), key: apiKey },
    });
    if (res.data?.status !== 'OK' && res.data?.status !== 'ZERO_RESULTS') return null;
    const loc = res.data?.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null;
  }
}

/** Nearest-neighbor route: start at store, then repeatedly visit nearest unvisited opportunity. */
function orderOpportunitiesByRoute(
  storeLat: number,
  storeLng: number,
  opportunities: Array<{ id: string; name: string; address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null; lat: number; lng: number }>
): Array<{ id: string; name: string; address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null }> {
  if (opportunities.length === 0) return [];
  const withCoords = opportunities.map((o) => ({ ...o, lat: o.lat, lng: o.lng }));
  const ordered: typeof withCoords = [];
  let currentLat = storeLat;
  let currentLng = storeLng;
  let remaining = [...withCoords];
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = distanceMeters(currentLat, currentLng, remaining[0].lat, remaining[0].lng);
    for (let i = 1; i < remaining.length; i++) {
      const d = distanceMeters(currentLat, currentLng, remaining[i].lat, remaining[i].lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const next = remaining[nearestIdx];
    ordered.push(next);
    currentLat = next.lat;
    currentLng = next.lng;
    remaining = remaining.filter((_, i) => i !== nearestIdx);
  }
  return ordered.map(({ id, name, address, city, state, zipCode }) => ({ id, name, address, city, state, zipCode }));
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

  const can = await canAccessStore(uid, storeId);
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
    const [store, opportunities, calendarEvents, contacts] = await Promise.all([
      prisma.store.findUnique({ where: { id: storeId } }),
      prisma.opportunity.findMany({
        where: { store_id: storeId, status: 'new' },
        orderBy: { created_at: 'desc' },
      }),
      prisma.calendarEvent.findMany({
        where: {
          store_id: storeId,
          date: { gte: dayStart, lt: dayEnd },
          status: { not: 'cancelled' },
        },
        orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      }),
      prisma.contact.findMany({
        where: { store_id: storeId },
        include: { reachouts: { orderBy: { date: 'desc' }, take: 5 } },
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
      method: 'email' | 'call' | 'meeting' | 'text' | 'other';
      message: string;
      draftEmail?: string;
      eventTitle?: string;
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
        method: method in { email: 1, call: 1, meeting: 1, text: 1, other: 1 } ? (method as FollowUpTask['method']) : 'other',
        message,
        eventTitle: ev.title || undefined,
      });
    }

    // From contacts with suggested_follow_up_date = this date (not already added)
    const normalizedTarget = dayStart.getTime();
    for (const contact of contacts) {
      if (taskContactIds.has(contact.id)) continue;
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

    // Optimized route: geocode store + opportunities, then order by nearest neighbor
    const googleKey = process.env.GOOGLE_PLACES_API_KEY;
    let optimizedRoute: Array<{ id: string; name: string; address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null }> = [];

    if (googleKey && storeAddress && opportunities.length > 0) {
      const storeCoords = await geocode(storeAddress, googleKey);
      if (storeCoords) {
        const oppsWithCoords: Array<{ id: string; name: string; address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null; lat: number; lng: number }> = [];
        for (const o of opportunities) {
          const parts = [o.address, o.city, o.state, o.zip_code].filter(Boolean);
          const addr = parts.join(', ');
          if (!addr) continue;
          const coords = await geocode(addr, googleKey);
          if (coords) {
            oppsWithCoords.push({
              id: o.id,
              name: o.name,
              address: o.address ?? undefined,
              city: o.city ?? undefined,
              state: o.state ?? undefined,
              zipCode: o.zip_code ?? undefined,
              lat: coords.lat,
              lng: coords.lng,
            });
          }
        }
        optimizedRoute = orderOpportunitiesByRoute(storeCoords.lat, storeCoords.lng, oppsWithCoords);
      } else {
        // Fallback: return opportunities in existing order
        optimizedRoute = opportunities.map((o) => ({
          id: o.id,
          name: o.name,
          address: o.address ?? undefined,
          city: o.city ?? undefined,
          state: o.state ?? undefined,
          zipCode: o.zip_code ?? undefined,
        }));
      }
    } else if (opportunities.length > 0) {
      optimizedRoute = opportunities.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address ?? undefined,
        city: o.city ?? undefined,
        state: o.state ?? undefined,
        zipCode: o.zip_code ?? undefined,
      }));
    }

    return res.status(200).json({
      storeName: store.name,
      storeAddress,
      date: dateStr,
      followUpTasks: followUpTasks.map((t) => ({
        contactId: t.contactId,
        contactName: t.contactName,
        method: t.method,
        message: t.message,
        draftEmail: t.draftEmail,
        eventTitle: t.eventTitle,
      })),
      optimizedRoute: optimizedRoute.slice(0, MAX_OPPORTUNITIES_IN_PLAN),
    });
  } catch (err: any) {
    console.error('day-planner error:', err);
    return res.status(500).json({ error: err.message || 'Failed to build day plan' });
  }
}
