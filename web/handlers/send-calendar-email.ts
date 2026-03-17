import { Resend } from 'resend';
import { prisma } from './lib/db.js';

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

function getTypeEmoji(type: string): string {
  switch (type) {
    case 'call': return '📞';
    case 'email': return '📧';
    case 'meeting': return '🤝';
    case 'followup': return '🔄';
    case 'delivery': return '🚚';
    default: return '📅';
  }
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

function getPriorityBadge(priority?: string): string {
  switch (priority) {
    case 'high': return '<span style="background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">HIGH</span>';
    case 'medium': return '<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">MEDIUM</span>';
    case 'low': return '<span style="background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">LOW</span>';
    default: return '';
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

  const typeEmoji = getTypeEmoji(eventData.type);
  const typeLabel = getTypeLabel(eventData.type);
  const priorityBadge = getPriorityBadge(eventData.priority);
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

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 24px 16px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 28px 24px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="color: #f4c430; margin: 0 0 4px; font-size: 24px; letter-spacing: 1px;">MARKET POLLEN</h1>
      <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 13px;">New Event Added to Your Calendar</p>
    </div>

    <!-- Body -->
    <div style="background: #ffffff; padding: 32px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <!-- Event title card -->
      <div style="background: #fefce8; border: 1px solid rgba(244, 196, 48, 0.3); border-radius: 10px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 20px; margin-right: 8px;">${typeEmoji}</span>
          <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #92400e; font-weight: 600;">${typeLabel}</span>
          ${priorityBadge ? `<span style="margin-left: 8px;">${priorityBadge}</span>` : ''}
        </div>
        <h2 style="margin: 0 0 12px; color: #1a1a1a; font-size: 20px; line-height: 1.3;">${eventData.title}</h2>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 16px;">📅</span>
          <span style="font-size: 15px; color: #374151; font-weight: 500;">${dateStr}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
          <span style="font-size: 16px;">🕐</span>
          <span style="font-size: 15px; color: #374151;">${timeStr}</span>
        </div>
      </div>

      ${detailRows.length > 0 ? `
      <!-- Details table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tbody>
          ${detailRows.join('')}
        </tbody>
      </table>
      ` : ''}

      <!-- Add to Calendar buttons -->
      <p style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin: 0 0 12px; font-weight: 600;">Add to your calendar</p>
      <div style="margin-bottom: 8px;">
        <a href="${googleUrl}" target="_blank" rel="noopener noreferrer"
           style="display: inline-block; background: #ffffff; border: 2px solid #4285f4; color: #4285f4; padding: 12px 20px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-right: 8px; margin-bottom: 8px;">
          📆 Google Calendar
        </a>
        <a href="data:text/calendar;base64,${icsBase64}" download="event.ics"
           style="display: inline-block; background: #ffffff; border: 2px solid #333333; color: #333333; padding: 12px 20px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 8px;">
          🍎 Apple Calendar
        </a>
      </div>
      <p style="font-size: 12px; color: #9ca3af; margin: 4px 0 0;">Download the .ics file to add this event to Apple Calendar, Outlook, or any calendar app.</p>
    </div>

    <!-- Footer -->
    <div style="background: #f3f4f6; padding: 20px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        This notification was sent by MarketPollen because a calendar event was created in your account.
      </p>
    </div>
  </div>
</body>
</html>`;

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
