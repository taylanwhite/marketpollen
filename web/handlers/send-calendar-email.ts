import { Resend } from 'resend';
import { prisma } from './lib/db.js';
import { brandShell } from './lib/brand-email.js';

interface CalendarEventEmailData {
  title: string;
  description?: string;
  date: Date;
  startTime?: string;
  endTime?: string;
  type: string;
  priority?: string;
  contactName?: string;
  businessName?: string;
  storeName?: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'call': return 'Phone Call';
    case 'email': return 'Email';
    case 'meeting': return 'Meeting';
    case 'followup': return 'Follow-up';
    case 'delivery': return 'Delivery';
    default: return 'Event';
  }
}

function toICSDateString(date: Date, time?: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (time) {
    const [h, m] = time.split(':').map(Number);
    return `${year}${month}${day}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
  }
  return `${year}${month}${day}`;
}

function generateICS(event: CalendarEventEmailData): string {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@marketpollen.com`;
  const now = new Date();
  const stamp = toICSDateString(now, `${now.getHours()}:${now.getMinutes()}`);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MarketPollen//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}Z`,
  ];

  if (event.startTime) {
    lines.push(`DTSTART:${toICSDateString(event.date, event.startTime)}`);
    if (event.endTime) {
      lines.push(`DTEND:${toICSDateString(event.date, event.endTime)}`);
    } else {
      // Default 1 hour duration
      const [h, m] = event.startTime.split(':').map(Number);
      const endH = h + 1;
      lines.push(`DTEND:${toICSDateString(event.date, `${endH}:${m}`)}`);
    }
  } else {
    lines.push(`DTSTART;VALUE=DATE:${toICSDateString(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${toICSDateString(event.date)}`);
  }

  lines.push(`SUMMARY:${escapeICS(event.title)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  }
  if (event.storeName) {
    lines.push(`LOCATION:${escapeICS(event.storeName)}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function escapeICS(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function generateGoogleCalendarUrl(event: CalendarEventEmailData): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);

  if (event.startTime) {
    const startDt = toICSDateString(event.date, event.startTime);
    let endDt: string;
    if (event.endTime) {
      endDt = toICSDateString(event.date, event.endTime);
    } else {
      const [h, m] = event.startTime.split(':').map(Number);
      endDt = toICSDateString(event.date, `${h + 1}:${m}`);
    }
    params.set('dates', `${startDt}/${endDt}`);
  } else {
    const dateStr = toICSDateString(event.date);
    params.set('dates', `${dateStr}/${dateStr}`);
  }

  if (event.description) params.set('details', event.description);
  if (event.storeName) params.set('location', event.storeName);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function sendCalendarEventEmail(
  userId: string,
  eventData: CalendarEventEmailData,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { success: false, error: 'Email service not configured' };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, display_name: true },
  });
  if (!user?.email) return { success: false, error: 'User email not found' };

  const resend = new Resend(apiKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'MarketPollen <onboarding@resend.dev>';
  const googleUrl = generateGoogleCalendarUrl(eventData);
  const icsContent = generateICS(eventData);
  const icsBase64 = Buffer.from(icsContent).toString('base64');

  const typeLabel = getTypeLabel(eventData.type);
  const dateStr = formatDate(eventData.date);
  const timeStr = eventData.startTime
    ? eventData.endTime
      ? `${formatTime(eventData.startTime)} – ${formatTime(eventData.endTime)}`
      : formatTime(eventData.startTime)
    : 'All day';

  const detailRows: string[] = [];

  if (eventData.contactName) {
    detailRows.push(`
      <tr>
        <td style="padding: 8px 12px; color: #6b7280; font-size: 14px; white-space: nowrap;">Contact</td>
        <td style="padding: 8px 12px; font-size: 14px; font-weight: 500;">${eventData.contactName}</td>
      </tr>`);
  }
  if (eventData.businessName) {
    detailRows.push(`
      <tr>
        <td style="padding: 8px 12px; color: #6b7280; font-size: 14px; white-space: nowrap;">Business</td>
        <td style="padding: 8px 12px; font-size: 14px; font-weight: 500;">${eventData.businessName}</td>
      </tr>`);
  }
  if (eventData.storeName) {
    detailRows.push(`
      <tr>
        <td style="padding: 8px 12px; color: #6b7280; font-size: 14px; white-space: nowrap;">Store</td>
        <td style="padding: 8px 12px; font-size: 14px; font-weight: 500;">${eventData.storeName}</td>
      </tr>`);
  }
  if (eventData.description) {
    detailRows.push(`
      <tr>
        <td style="padding: 8px 12px; color: #6b7280; font-size: 14px; white-space: nowrap; vertical-align: top;">Notes</td>
        <td style="padding: 8px 12px; font-size: 14px;">${eventData.description.replace(/\n/g, '<br>')}</td>
      </tr>`);
  }

  const html = brandShell({
    headline: eventData.title,
    intro: `${typeLabel} · ${dateStr} · ${timeStr}`,
    contentHtml: `
      ${detailRows.length > 0 ? `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><tbody>${detailRows.join('')}</tbody></table>` : ''}
      <p style="font-size:13px;letter-spacing:0.6px;text-transform:uppercase;color:#a39888;margin:0 0 12px;font-weight:700;">Add to your calendar</p>
      <a href="${googleUrl}" style="display:inline-block;background:#f5c842;color:#2d2d2d;padding:12px 18px;text-decoration:none;border-radius:999px;font-weight:700;font-size:14px;margin:0 8px 8px 0;">Google Calendar</a>
      <p style="font-size:13px;line-height:1.5;color:#8a8175;margin:8px 0 0;">The .ics file is attached for Apple Calendar or Outlook.</p>
    `,
    footnote: 'Sent because a visit was added to your MarketPollen calendar.',
  });

  const textContent = [
    `New Event: ${eventData.title}`,
    '',
    `Type: ${typeLabel}`,
    `Date: ${dateStr}`,
    `Time: ${timeStr}`,
    eventData.priority ? `Priority: ${eventData.priority.toUpperCase()}` : '',
    eventData.contactName ? `Contact: ${eventData.contactName}` : '',
    eventData.businessName ? `Business: ${eventData.businessName}` : '',
    eventData.storeName ? `Store: ${eventData.storeName}` : '',
    eventData.description ? `\nNotes: ${eventData.description}` : '',
    '',
    `Add to Google Calendar: ${googleUrl}`,
    '',
    'Download the attached .ics file to add to Apple Calendar or Outlook.',
  ].filter(Boolean).join('\n');

  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: user.email,
      subject: `📅 ${eventData.title} — ${dateStr}`,
      html,
      text: textContent,
      attachments: [
        {
          filename: 'event.ics',
          content: icsBase64,
          contentType: 'text/calendar',
        },
      ],
    });

    if (error) {
      console.error('Calendar email error:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Calendar email error:', err);
    return { success: false, error: err.message || 'Failed to send email' };
  }
}
