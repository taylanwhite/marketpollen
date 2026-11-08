import { VercelRequest, VercelResponse } from '@vercel/node';
import type OpenAI from 'openai';
import { Resend } from 'resend';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canViewStore } from './lib/store-access.js';
import { isOrgAdmin } from './lib/org-access.js';
import { aiErrorMessage, extractJson, getOpenAI } from './lib/ai.js';
import { brandShell } from './lib/brand-email.js';

/**
 * The weekly highlights email marketers send their owners. "draft" reads the
 * marketer's visits for the week and has the AI write the bullets; "send"
 * emails the (edited) text from MarketPollen with replies going to the marketer.
 */

const SLUG_TO_FIELD: Record<string, string> = {
  freeBundletCard: 'free_bundlet_card',
  dozenBundtinis: 'dozen_bundtinis',
  cake8inch: 'cake_8inch',
  cake10inch: 'cake_10inch',
  sampleTray: 'sample_tray',
  bundtletTower: 'bundtlet_tower',
};

// A busy week is ~60 visits. Past this, the oldest notes are cut short.
const MAX_VISITS = 150;
const MAX_NOTE_CHARS = 600;

type Product = { id: string; slug: string; name: string };

export interface WeekData {
  marketerName: string;
  storeName: string;
  weekLabel: string;
  visits: Array<{
    date: Date;
    type: string;
    note: string;
    business: string;
    city: string | null;
    businessKind: string | null;
    contactName: string;
    newBusiness: boolean;
    firstVisit: boolean;
    ordered: boolean;
    gifts: string[];
    giftNotes: string | null;
  }>;
  events: Array<{ date: Date; title: string; notes: string | null; type: string }>;
  stats: { visits: number; businesses: number; newBusinesses: number; orders: number; itemsGiven: number };
}

function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function personName(c: { first_name: string | null; last_name: string | null }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ');
}

async function storeProducts(orgId: string | null): Promise<Product[]> {
  if (!orgId) {
    return Object.keys(SLUG_TO_FIELD).map((slug) => ({ id: slug, slug, name: slug }));
  }
  const rows = await prisma.campaignProduct.findMany({
    where: { org_id: orgId },
    select: { id: true, slug: true, name: true },
    orderBy: { display_order: 'asc' },
  });
  return rows;
}

/**
 * Everything one marketer logged at one store between `from` (inclusive) and
 * `to` (exclusive). Dates are calendar days; visits store a date, not a time zone.
 */
export async function loadWeek(storeId: string, marketerId: string, from: Date, to: Date): Promise<WeekData> {
  const [store, marketer] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true, organization_id: true } }),
    prisma.user.findUnique({ where: { id: marketerId }, select: { display_name: true, email: true } }),
  ]);
  const products = await storeProducts(store.organization_id);

  const reachouts = await prisma.reachout.findMany({
    where: { created_by: marketerId, date: { gte: from, lt: to }, contact: { store_id: storeId } },
    orderBy: { date: 'asc' },
    take: MAX_VISITS,
    include: {
      contact: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          organization_type: true,
          business: { select: { id: true, name: true, city: true, created_at: true } },
        },
      },
    },
  });

  // A business counts as new to us when nobody visited it before this week.
  const businessIds = [...new Set(reachouts.map((r) => r.contact.business.id))];
  const earlier = await prisma.reachout.findMany({
    where: { date: { lt: from }, contact: { business_id: { in: businessIds } } },
    select: { contact: { select: { business_id: true } } },
    distinct: ['contact_id'],
  });
  const visitedBefore = new Set(earlier.map((r) => r.contact.business_id));
  const seenThisWeek = new Set<string>();

  let itemsGiven = 0;
  const visits = reachouts.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const custom = (r.custom_donations as Record<string, number> | null) || {};
    const gifts: string[] = [];
    for (const p of products) {
      const column = SLUG_TO_FIELD[p.slug];
      const count = column ? Number(row[column]) || 0 : Number(custom[p.id]) || 0;
      if (count > 0) {
        gifts.push(`${count} × ${p.name}`);
        itemsGiven += count;
      }
    }
    const business = r.contact.business;
    const firstVisit = !visitedBefore.has(business.id) && !seenThisWeek.has(business.id);
    seenThisWeek.add(business.id);
    const note = (r.note || r.raw_notes || '').trim();
    return {
      date: r.date,
      type: r.type,
      note: note.length > MAX_NOTE_CHARS ? `${note.slice(0, MAX_NOTE_CHARS)}…` : note,
      business: business.name,
      city: business.city,
      businessKind: r.contact.organization_type,
      contactName: personName(r.contact),
      newBusiness: business.created_at >= from && business.created_at < to,
      firstVisit,
      ordered: r.ordered_from_us,
      gifts,
      giftNotes: r.cakes_donated_notes,
    };
  });

  const events = await prisma.calendarEvent.findMany({
    where: {
      store_id: storeId,
      created_by: marketerId,
      date: { gte: from, lt: to },
      cancelled_at: null,
      follow_up_cadence_id: null,
    },
    select: { date: true, title: true, notes: true, description: true, type: true },
    orderBy: { date: 'asc' },
  });

  const last = new Date(to.getTime() - 86_400_000);
  return {
    marketerName: marketer?.display_name || marketer?.email || 'Marketer',
    storeName: store.name,
    weekLabel: `${shortDate(from)}–${shortDate(last)}`,
    visits,
    events: events.map((e) => ({ date: e.date, title: e.title, notes: e.notes || e.description, type: e.type })),
    stats: {
      visits: visits.length,
      businesses: seenThisWeek.size,
      newBusinesses: visits.filter((v) => v.firstVisit).length,
      orders: visits.filter((v) => v.ordered).length,
      itemsGiven,
    },
  };
}

const SYSTEM_PROMPT = `You write a bakery marketer's weekly highlights email to the store owners. The bakery is Nothing Bundt Cakes. Marketers visit local businesses, give away free cake to build relationships, and look for orders (gifts, parties, catering, corporate accounts).

You get every visit and event the marketer logged this week. Write the email the way the marketer would: first person ("I"), friendly, plain, short. No hype, no exclamation points except for a real win, no emojis, no business jargon.

Pick what an owner wants to hear about, best first:
1. Orders, purchases, and promised or likely orders (say who and what, e.g. "will buy a few more next week as closing gifts").
2. Upcoming opportunities: holiday parties, events, catering, corporate gifting, vendor lists, being added as a supplier.
3. New kinds of businesses or areas reached, and what happened (e.g. barbers, blue collar shops, a new part of town).
4. Events the marketer worked (fundraisers, expos) and what they learned.
5. Goodwill: donations to schools, nonprofits, teachers, first responders, and how they were received.
6. Useful lessons or patterns (e.g. "leasing offices have small budgets, but some do have room").

Rules:
- Group similar visits into one bullet ("Visited 4 construction companies who may need us for Christmas parties") instead of one bullet per visit.
- Name a business only when it helps (a buyer, a notable account). Otherwise describe it by type and city.
- Never invent anything. Use only what the notes and the marketer's extra details say. If they are thin, write fewer bullets.
- Always include the marketer's extra details when given; they chose to mention them.
- Leave out routine drop-offs with nothing notable to say.
- Write 4 to 8 bullets, each one or two sentences. Fewer when the week was light.
- Do not include counts of visits or items given; those are added separately.
- The intro is one short sentence, like "Hi! Here are my highlights from this week."`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intro: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
  },
  required: ['intro', 'bullets'],
};

function visitLine(v: WeekData['visits'][number]): string {
  const parts = [
    shortDate(v.date),
    v.business + (v.city ? ` (${v.city})` : ''),
    v.businessKind ? `type: ${v.businessKind}` : '',
    v.contactName ? `contact: ${v.contactName}` : '',
    v.type !== 'meeting' ? `by ${v.type}` : '',
    v.firstVisit ? 'FIRST VISIT' : '',
    v.ordered ? 'ORDERED FROM US' : '',
    v.gifts.length ? `gave ${v.gifts.join(', ')}` : '',
    v.giftNotes ? `gift notes: ${v.giftNotes}` : '',
  ].filter(Boolean);
  return `- ${parts.join(' | ')}\n  Notes: ${v.note || '(none)'}`;
}

// Room for a few paragraphs of typed or dictated extras.
const MAX_EXTRA_CHARS = 4000;

function cleanExtra(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_EXTRA_CHARS) : '';
}

function extraSection(extra: string): string {
  return extra
    ? `\n\nExtra details from the marketer (things not logged in the app; treat them as true and work them into the bullets where they fit best, grouped with related visits):\n${extra}`
    : '';
}

export function weekPrompt(week: WeekData, extra = ''): string {
  const events = week.events.length
    ? week.events.map((e) => `- ${shortDate(e.date)} | ${e.title} (${e.type})${e.notes ? `\n  Notes: ${e.notes}` : ''}`).join('\n')
    : '(none)';
  return `Marketer: ${week.marketerName}
Store: ${week.storeName}
Week: ${week.weekLabel}

Visits (${week.visits.length}):
${week.visits.map(visitLine).join('\n') || '(none)'}

Calendar events:
${events}${extraSection(extra)}`;
}

export async function draftHighlights(openai: OpenAI, week: WeekData, extra = '') {
  return extractJson<{ intro: string; bullets: string[] }>(openai, {
    name: 'weekly_highlights',
    system: SYSTEM_PROMPT,
    content: weekPrompt(week, extra),
    schema: SCHEMA,
  });
}

const ADD_PROMPT = `You help a bakery marketer (Nothing Bundt Cakes) finish their weekly highlights email to the store owners. They already have a draft they may have edited by hand, and they want to add some extra details.

Return the whole email as an intro and bullets:
- Keep the existing intro and bullets as they are, word for word, unless an extra detail belongs inside one of them (then fold it into that bullet).
- Turn the remaining extra details into new bullets in the same voice: first person, friendly, plain, short, one or two sentences each.
- Put new bullets where they fit: orders and likely deals near the top, goodwill and lessons lower down.
- Use only what the marketer wrote. Do not invent names, numbers, or outcomes.
- If the draft has no intro, write one short one, like "Hi! Here are my highlights from this week."`;

/** Works the marketer's extra details into a draft they already have. */
export async function addToHighlights(openai: OpenAI, currentBody: string, extra: string) {
  return extractJson<{ intro: string; bullets: string[] }>(openai, {
    name: 'weekly_highlights_add',
    system: ADD_PROMPT,
    content: `Current email:\n${currentBody || '(empty)'}\n\nExtra details to add:\n${extra}`,
    schema: SCHEMA,
  });
}

export function statsLine(stats: WeekData['stats']): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    count(stats.visits, 'visit', 'visits'),
    count(stats.newBusinesses, 'new business', 'new businesses'),
    count(stats.orders, 'order', 'orders'),
    count(stats.itemsGiven, 'item given', 'items given'),
  ].join(' · ');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Lines starting with "-", "•" or "*" become list items; other lines are paragraphs. */
function bodyHtml(body: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:1.55;color:#2d2d2d;">${list.join('')}</ul>`);
    list = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      list.push(`<li style="margin:0 0 8px 0;">${escapeHtml(bullet[1])}</li>`);
    } else {
      flush();
      if (line) out.push(`<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#2d2d2d;">${escapeHtml(line)}</p>`);
    }
  }
  flush();
  return out.join('');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function canActFor(uid: string, marketerId: string, storeId: string): Promise<boolean> {
  if (uid === marketerId) return true;
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { organization_id: true } });
  return !!store?.organization_id && isOrgAdmin(uid, store.organization_id);
}

/** Org admins and store editors, minus the marketer: the people who usually get this email. */
async function suggestedRecipients(storeId: string, marketerId: string) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { organization_id: true } });
  const [admins, editors] = await Promise.all([
    store?.organization_id
      ? prisma.organizationMember.findMany({
        where: { org_id: store.organization_id, is_admin: true },
        select: { user: { select: { id: true, email: true, display_name: true } } },
      })
      : [],
    prisma.storePermission.findMany({
      where: { store_id: storeId, can_edit: true },
      select: { user: { select: { id: true, email: true, display_name: true } } },
    }),
  ]);
  const byEmail = new Map<string, { email: string; name: string; admin: boolean }>();
  for (const { user } of admins) {
    if (user.id !== marketerId) byEmail.set(user.email.toLowerCase(), { email: user.email, name: user.display_name || user.email, admin: true });
  }
  for (const { user } of editors) {
    const key = user.email.toLowerCase();
    if (user.id !== marketerId && !byEmail.has(key)) byEmail.set(key, { email: user.email, name: user.display_name || user.email, admin: false });
  }
  return [...byEmail.values()];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body || {};
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  const marketerId = typeof body.marketerId === 'string' && body.marketerId ? body.marketerId : uid;
  if (!storeId) return res.status(400).json({ error: 'storeId is required' });
  if (!(await canViewStore(uid, storeId))) return res.status(403).json({ error: 'No access to this store' });
  if (!(await canActFor(uid, marketerId, storeId))) {
    return res.status(403).json({ error: 'Only an admin can write highlights for someone else' });
  }

  if (body.action === 'send') return send(req, res, uid, storeId);
  const extra = cleanExtra(body.extra);

  if (body.action === 'add') {
    if (!extra) return res.status(400).json({ error: 'Type the details you want to add' });
    const currentBody = typeof body.currentBody === 'string' ? body.currentBody.trim().slice(0, 20_000) : '';
    const openai = getOpenAI();
    if (!openai) return res.status(500).json({ error: 'AI is not set up (OPENAI_API_KEY missing)' });
    try {
      return res.status(200).json(await addToHighlights(openai, currentBody, extra));
    } catch (err) {
      console.error('Weekly highlights add failed:', err);
      return res.status(500).json({ error: aiErrorMessage(err) });
    }
  }

  const from = parseDay(body.from);
  const to = parseDay(body.to);
  if (!from || !to || to <= from || to.getTime() - from.getTime() > 31 * 86_400_000) {
    return res.status(400).json({ error: 'Pick a week to summarize' });
  }
  // `to` is the last day shown; the query runs up to the start of the next day.
  const end = new Date(to.getTime() + 86_400_000);

  try {
    const week = await loadWeek(storeId, marketerId, from, end);
    const recipients = await suggestedRecipients(storeId, marketerId);
    const subject = `Weekly Highlights ${week.weekLabel}`;
    if (week.visits.length === 0 && week.events.length === 0 && !extra) {
      return res.status(200).json({
        subject, intro: '', bullets: [], stats: week.stats, statsLine: statsLine(week.stats), recipients, empty: true,
      });
    }
    const openai = getOpenAI();
    if (!openai) return res.status(500).json({ error: 'AI is not set up (OPENAI_API_KEY missing)' });
    const draft = await draftHighlights(openai, week, extra);
    return res.status(200).json({
      subject,
      intro: draft.intro,
      bullets: draft.bullets,
      stats: week.stats,
      statsLine: statsLine(week.stats),
      recipients,
      empty: false,
    });
  } catch (err) {
    console.error('Weekly highlights draft failed:', err);
    return res.status(500).json({ error: aiErrorMessage(err) });
  }
}

async function send(req: VercelRequest, res: VercelResponse, uid: string, storeId: string) {
  const body = req.body || {};
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) : '';
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 20_000) : '';
  // "Send to me" goes only to the signed-in person, e.g. to forward it themselves.
  const toSelf = body.toSelf === true;
  const listed: string[] = Array.isArray(body.to)
    ? [...new Set<string>(body.to.filter((e: unknown): e is string => typeof e === 'string').map((e: string) => e.trim()).filter(Boolean))]
    : [];
  if (!subject || !text) return res.status(400).json({ error: 'Subject and message are required' });
  if (!toSelf && listed.length === 0) return res.status(400).json({ error: 'Add at least one person to send it to' });
  if (listed.length > 20) return res.status(400).json({ error: 'Send to 20 people or fewer' });
  const bad = listed.find((e) => !EMAIL_RE.test(e));
  if (bad) return res.status(400).json({ error: `"${bad}" is not an email address` });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Email is not set up (RESEND_API_KEY missing)' });

  const [sender, store] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid }, select: { email: true, display_name: true } }),
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
  ]);
  if (!sender) return res.status(400).json({ error: 'Your account was not found' });
  const to = toSelf ? [sender.email] : listed;
  const senderName = sender.display_name || sender.email;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'MarketPollen <onboarding@resend.dev>';
  // Show the marketer's name; the address stays MarketPollen's so it isn't marked as spoofed.
  const fromAddress = fromEmail.match(/<([^>]+)>/)?.[1] || fromEmail;
  const from = `${senderName.replace(/[<>"]/g, '')} via MarketPollen <${fromAddress}>`;

  const html = brandShell({
    headline: subject,
    contentHtml: bodyHtml(text),
    footnote: `Sent by ${senderName}${store ? ` (${store.name})` : ''} through MarketPollen. Reply to this email to reach them directly.`,
  });

  const resend = new Resend(apiKey);
  const cc = to.some((e) => e.toLowerCase() === sender.email.toLowerCase()) ? undefined : [sender.email];
  const { error } = await resend.emails.send({ from, to, cc, replyTo: sender.email, subject, html, text });
  if (error) {
    console.error('Weekly highlights email failed:', error);
    return res.status(502).json({ error: 'The email did not send. Try again in a moment.' });
  }
  return res.status(200).json({ sent: true, to, cc: cc || [] });
}
