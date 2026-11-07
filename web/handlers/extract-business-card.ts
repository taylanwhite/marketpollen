import { VercelRequest, VercelResponse } from '@vercel/node';
import type OpenAI from 'openai';
import { getAuthUid } from './lib/auth.js';
import { aiErrorMessage, extractJson, getOpenAI } from './lib/ai.js';

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

/** Title-cases a name part guessed from an email, like "smith" -> "Smith". */
function capitalize(part: string): string {
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

/**
 * First and last name from the full name printed on the card. Falls back to
 * the email address (jane.smith@...) when the card only shows a first name.
 */
function splitName(fullName: string | undefined, email: string | undefined): { firstName?: string; lastName?: string } {
  const parts = (fullName || '')
    .replace(/,?\s+(jr|sr|ii|iii|iv|md|dds|dmd|phd|cpa|esq|rn)\.?$/i, '')
    .split(/\s+/)
    .filter(Boolean);
  let firstName = parts[0];
  let lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
  if (!lastName && email) {
    const local = email.split('@')[0].toLowerCase();
    const pieces = local.split(/[._-]/).filter((x) => /^[a-z]{2,}$/.test(x));
    if (pieces.length >= 2 && (!firstName || pieces[0] === firstName.toLowerCase())) {
      firstName = firstName || capitalize(pieces[0]);
      lastName = capitalize(pieces[pieces.length - 1]);
    }
  }
  return { firstName, lastName };
}

function cleanExtracted(value: unknown): ExtractedBusinessCard {
  const { firstName, lastName } = splitName(stringField(value, 'fullName'), stringField(value, 'email'));
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

  const noteParts = [
    'Contact was created via uploaded business card.',
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

/** Reads a business card photo (as a data URL) into contact fields. */
export async function readBusinessCard(openai: OpenAI, imageDataUrl: string): Promise<ExtractedBusinessCard> {
  const parsed = await extractJson<Record<string, unknown>>(openai, {
    name: 'business_card',
    system: `You read a business card photo and fill in a CRM contact for a bakery's marketing team.

- fullName: the person's complete name exactly as printed, including the last name. Look carefully: the last name may be on its own line, in a different font or color, or next to a logo. Leave out credentials like MD or CPA.
- businessName: the company or organization, not the person's title.
- title: their job title or role.
- phone: the person's direct or mobile number if there is one, otherwise the main number.
- address is the street address only; city, state (2-letter), and zipCode go in their own fields.
- personalDetails: only if the card says something useful for sales, otherwise leave it out.
- reachoutNote: "Contact was created via uploaded business card." plus title or website if helpful.
- suggestedFollowUpDays: usually 3.

Only fill in what is on the card. If several people appear, use the most prominent one.`,
    content: [
      { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
      { type: 'text', text: 'Read this business card.' },
    ],
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fullName: { type: 'string' },
        businessName: { type: 'string' },
        title: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },
        zipCode: { type: 'string' },
        website: { type: 'string' },
        personalDetails: { type: 'string' },
        reachoutNote: { type: 'string' },
        suggestedFollowUpDays: { type: 'integer' },
      },
      required: ['reachoutNote', 'suggestedFollowUpDays'],
    },
  });
  return cleanExtracted(parsed);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const openai = getOpenAI();
  if (!openai) return res.status(500).json({ error: 'OpenAI API key is not configured' });

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
    return res.status(200).json(await readBusinessCard(openai, imageDataUrl));
  } catch (err: unknown) {
    console.error('Business card extraction error:', err);
    return res.status(500).json({ error: aiErrorMessage(err) });
  }
}
