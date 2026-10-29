import { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { prisma } from './lib/db.js';
import { appUrl } from './lib/app-url.js';
import { brandShell } from './lib/brand-email.js';
import { cadenceLabel } from './lib/follow-up.js';

// Longest list in one email; the rest are summarized as "and N more".
const MAX_LINES = 25;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Due = { name: string; business: string; store: string; date: Date; everyDays: number };

function line(item: Due, today: Date): string {
  const days = Math.round((today.getTime() - Date.UTC(item.date.getUTCFullYear(), item.date.getUTCMonth(), item.date.getUTCDate())) / 86_400_000);
  const when = days <= 0 ? 'due today' : days === 1 ? '1 day overdue' : `${days} days overdue`;
  return `${item.name}${item.business ? ` at ${item.business}` : ''} · ${when} · ${cadenceLabel(item.everyDays)}`;
}

/**
 * Daily email to each person with repeating follow-ups that are due. Sent when
 * something is due today, and on Mondays as a catch-up for anything overdue,
 * so a long overdue list doesn't arrive every single day.
 */
export async function sendFollowUpReminders(now = new Date()) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  const resend = new Resend(apiKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'MarketPollen <onboarding@resend.dev>';

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfToday = new Date(today.getTime() + 86_400_000 - 1);
  const isMonday = today.getUTCDay() === 1;

  const contacts = await prisma.contact.findMany({
    where: {
      follow_up_every_days: { not: null },
      suggested_follow_up_date: { lte: endOfToday },
      store: { archived_at: null, is_demo: false },
    },
    select: {
      first_name: true,
      last_name: true,
      email: true,
      created_by: true,
      follow_up_assignee: true,
      follow_up_every_days: true,
      suggested_follow_up_date: true,
      business: { select: { name: true } },
      store: { select: { name: true } },
    },
    orderBy: { suggested_follow_up_date: 'asc' },
  });

  const byPerson = new Map<string, Due[]>();
  for (const c of contacts) {
    const recipient = c.follow_up_assignee || c.created_by;
    const list = byPerson.get(recipient) || [];
    list.push({
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'A contact',
      business: c.business?.name || '',
      store: c.store.name,
      date: c.suggested_follow_up_date!,
      everyDays: c.follow_up_every_days!,
    });
    byPerson.set(recipient, list);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...byPerson.keys()] } },
    select: { id: true, email: true, display_name: true },
  });

  let sent = 0;
  let skipped = 0;
  for (const user of users) {
    const items = byPerson.get(user.id) || [];
    const dueToday = items.filter((item) => item.date >= today);
    if (dueToday.length === 0 && !isMonday) {
      skipped += 1;
      continue;
    }
    const stores = new Set(items.map((item) => item.store));
    const shown = items.slice(0, MAX_LINES);
    const rows = shown.map((item) => {
      const store = stores.size > 1 ? ` <span style="color:#8a8175;">(${escapeHtml(item.store)})</span>` : '';
      return `<li style="margin:0 0 8px 0;">${escapeHtml(line(item, today))}${store}</li>`;
    });
    if (items.length > shown.length) rows.push(`<li style="margin:0;color:#8a8175;">and ${items.length - shown.length} more</li>`);

    const headline = dueToday.length > 0
      ? `${dueToday.length} follow-up${dueToday.length === 1 ? '' : 's'} due today`
      : `${items.length} follow-up${items.length === 1 ? ' is' : 's are'} overdue`;
    const html = brandShell({
      headline,
      intro: 'These contacts are on a repeating follow-up schedule. Log a visit, call, or email and the next one is scheduled for you.',
      contentHtml: `<ul style="margin:8px 0 0 0;padding-left:20px;font-size:14px;line-height:1.5;color:#2d2d2d;">${rows.join('')}</ul>`,
      buttonLabel: 'Open MarketPollen',
      buttonUrl: appUrl(),
      footnote: 'You get this because you are the follow-up owner for these contacts. Change the schedule on a contact to stop these reminders.',
    });
    const text = `${headline}\n\n${shown.map((item) => `- ${line(item, today)}`).join('\n')}${items.length > shown.length ? `\n- and ${items.length - shown.length} more` : ''}\n\nOpen MarketPollen: ${appUrl()}`;

    const { error } = await resend.emails.send({ from: fromEmail, to: user.email, subject: headline, html, text });
    if (error) {
      console.error('Follow-up reminder email failed:', user.id, error);
      continue;
    }
    sent += 1;
  }
  return { people: users.length, sent, skipped, contacts: contacts.length };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  try {
    return res.status(200).json(await sendFollowUpReminders());
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Follow-up reminders failed';
    return res.status(500).json({ error: message });
  }
}
