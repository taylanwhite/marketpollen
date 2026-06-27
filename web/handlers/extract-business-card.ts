import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { getAuthUid } from './lib/auth.js';

const ALLOWED_IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,/i;
const MAX_IMAGE_DATA_URL_LENGTH = 8_000_000;

export interface ExtractedBusinessCard {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  title?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  website?: string;
  personalDetails?: string;
  reachoutNote: string;
  suggestedFollowUpDays: number;
}

function normalizePhone(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return input.trim() || undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field.trim() : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'number' ? field : undefined;
}

function cleanExtracted(value: unknown): ExtractedBusinessCard {
  const firstName = stringField(value, 'firstName');
  const lastName = stringField(value, 'lastName');
  const businessName = stringField(value, 'businessName');
  const title = stringField(value, 'title');
  const email = stringField(value, 'email');
  const phone = normalizePhone(stringField(value, 'phone'));
  const address = stringField(value, 'address');
  const city = stringField(value, 'city');
  const state = stringField(value, 'state')?.toUpperCase();
  const zipCode = stringField(value, 'zipCode');
  const website = stringField(value, 'website');
  const personalDetails = stringField(value, 'personalDetails');
  const followUpDays = numberField(value, 'suggestedFollowUpDays');
  const suggestedFollowUpDays = followUpDays && followUpDays > 0
    ? Math.min(Math.round(followUpDays), 30)
    : 3;

  const contactName = [firstName, lastName].filter(Boolean).join(' ').trim() || email || phone || 'contact';
  const noteParts = [
    `Business card uploaded for ${contactName}.`,
    businessName ? `Business: ${businessName}.` : '',
    title ? `Title: ${title}.` : '',
    website ? `Website: ${website}.` : '',
  ].filter(Boolean);

  return {
    firstName,
    lastName,
    businessName,
    title,
    email,
    phone,
    address,
    city,
    state,
    zipCode,
    website,
    personalDetails,
    reachoutNote: stringField(value, 'reachoutNote') || noteParts.join(' '),
    suggestedFollowUpDays,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OpenAI API key is not configured' });

  const { imageDataUrl } = req.body as { imageDataUrl?: string };
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'imageDataUrl is required' });
  }
  if (!ALLOWED_IMAGE_DATA_URL_RE.test(imageDataUrl)) {
    return res.status(400).json({ error: 'Only PNG, JPG, JPEG, and WEBP images are supported' });
  }
  if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return res.status(413).json({ error: 'Image is too large. Please upload a smaller photo.' });
  }

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content: `Extract structured CRM contact data from a business card image for a marketing app.

Return valid JSON only with these optional fields when visible:
- firstName, lastName
- businessName: company/organization name, not the person's title
- title: job title or role
- email
- phone: main direct phone if present
- address: street address only
- city
- state: 2-letter abbreviation when possible
- zipCode
- website
- personalDetails: short useful sales note only if the card includes something relevant
- reachoutNote: one concise sentence saying the contact was created from a business card and preserving title/website/address context
- suggestedFollowUpDays: usually 3

Do not invent missing fields. If multiple people appear, extract the most prominent named person.`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the contact and business information from this business card.' },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ],
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    return res.status(200).json(cleanExtracted(parsed));
  } catch (err: unknown) {
    console.error('Business card extraction error:', err);
    const message = err instanceof Error ? err.message : 'Business card extraction failed';
    return res.status(500).json({ error: message });
  }
}
