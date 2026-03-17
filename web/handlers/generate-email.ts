import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OpenAI API key is not configured' });

  const { contactId, customPrompt } = req.body as { contactId: string; customPrompt?: string };
  if (!contactId) return res.status(400).json({ error: 'contactId is required' });

  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        business: true,
        reachouts: { orderBy: { date: 'desc' }, take: 10 },
        calendar_events: { orderBy: { date: 'desc' }, take: 5 },
      },
    });

    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || 'there';
    const businessName = contact.business?.name || 'their organization';

    const donationFields = ['free_bundlet_card', 'dozen_bundtinis', 'cake_8inch', 'cake_10inch', 'sample_tray', 'bundtlet_tower'] as const;
    const donationLabels: Record<string, string> = {
      free_bundlet_card: 'Free Bundtlet Card',
      dozen_bundtinis: 'Dozen Bundtinis',
      cake_8inch: '8" Cake',
      cake_10inch: '10" Cake',
      sample_tray: 'Sample Tray',
      bundtlet_tower: 'Bundtlet/Tower',
    };

    const reachoutHistory = contact.reachouts.map(r => {
      const donations = donationFields
        .filter(f => (r as any)[f] > 0)
        .map(f => `${(r as any)[f]}x ${donationLabels[f]}`);
      const customDonations = r.custom_donations as Record<string, number> | null;
      if (customDonations) {
        for (const [name, qty] of Object.entries(customDonations)) {
          if (qty > 0) donations.push(`${qty}x ${name}`);
        }
      }
      return [
        `- ${r.date.toLocaleDateString()} (${r.type})`,
        r.note ? `  Notes: ${r.note}` : null,
        donations.length > 0 ? `  Donated: ${donations.join(', ')}` : null,
        r.ordered_from_us ? '  Ordered from us: Yes' : null,
      ].filter(Boolean).join('\n');
    }).join('\n');

    const upcomingEvents = contact.calendar_events
      .filter(e => e.date >= new Date())
      .map(e => `- ${e.date.toLocaleDateString()}: ${e.title} (${e.type})${e.description ? ' — ' + e.description : ''}`)
      .join('\n');

    const prompt = `You are writing an email on behalf of a marketing representative at Nothing Bundt Cakes bakery.

CONTACT INFORMATION:
- Name: ${contactName}
- Email: ${contact.email || 'Unknown'}
- Phone: ${contact.phone || 'Unknown'}
- Business: ${businessName}
- Status: ${contact.status || 'Unknown'}
${contact.personal_details ? `- Personal details: ${contact.personal_details}` : ''}

${reachoutHistory ? `INTERACTION HISTORY (most recent first):\n${reachoutHistory}` : 'No prior interactions on record.'}

${contact.suggested_follow_up_note ? `SUGGESTED FOLLOW-UP:\n- Method: ${contact.suggested_follow_up_method || 'email'}\n- Note: ${contact.suggested_follow_up_note}\n- Priority: ${contact.suggested_follow_up_priority || 'normal'}` : ''}

${upcomingEvents ? `UPCOMING EVENTS:\n${upcomingEvents}` : ''}

${customPrompt ? `SPECIAL INSTRUCTIONS FROM USER:\n${customPrompt}` : ''}

Write a professional but warm email. Include a subject line on the first line prefixed with "Subject: ". Then a blank line, then the email body. The body should:
- Be 3-6 sentences
- Reference relevant context from the interaction history if available
- Feel personal, not templated
- Include a clear call-to-action or next step
- Sign off as the Nothing Bundt Cakes team (do not invent a specific person's name)

Do NOT include "Dear" or "To whom it may concern". Start with "Hi ${contactName}," or similar.`;

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '';

    let subject = '';
    let body = raw;
    const subjectMatch = raw.match(/^Subject:\s*(.+)/i);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      body = raw.slice(subjectMatch[0].length).trim();
    }

    return res.status(200).json({ subject, body, contactName, businessName });
  } catch (err: any) {
    console.error('generate-email error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate email' });
  }
}
