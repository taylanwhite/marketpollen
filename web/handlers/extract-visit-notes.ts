import { VercelRequest, VercelResponse } from '@vercel/node';
import type OpenAI from 'openai';
import { getAuthUid } from './lib/auth.js';
import { aiErrorMessage, extractJson, getOpenAI } from './lib/ai.js';

interface ProductIn {
  slug: string;
  name: string;
  mouthValue: number;
}

const DEFAULT_PRODUCTS: ProductIn[] = [
  { slug: 'freeBundletCard', name: 'Coupon', mouthValue: 1 },
  { slug: 'dozenBundtinis', name: 'Dozen Bundtinis', mouthValue: 12 },
  { slug: 'cake8inch', name: '8" Cake', mouthValue: 10 },
  { slug: 'cake10inch', name: '10" Cake', mouthValue: 20 },
  { slug: 'sampleTray', name: 'Sample Tray', mouthValue: 40 },
  { slug: 'bundtletTower', name: 'Bundtlet/Tower', mouthValue: 1 },
];

// Words marketers say for a product when it differs from its name.
const PRODUCT_ALIASES: Record<string, string> = {
  freeBundletCard: 'also called a "coupon", "free card", or "bundtlet card"',
};

// Visit notes are typed or dictated by hand; this is far more than any real note.
const MAX_NOTES_CHARS = 20_000;

interface ModelOutput {
  reachoutType: 'meeting' | 'call' | 'email' | 'other';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  donationGiven: boolean;
  donationItems: Array<{ product: string; quantity: number }>;
  cakesDonatedNotes?: string;
  orderedFromUs: boolean;
  followedUp: boolean;
  personalDetails?: string;
  suggestedFollowUpDays: number;
  reachoutNote: string;
}

function cleanProducts(value: unknown): ProductIn[] {
  if (!Array.isArray(value)) return DEFAULT_PRODUCTS;
  const out = value
    .filter((p): p is ProductIn =>
      p && typeof p.slug === 'string' && p.slug.trim() !== '' && typeof p.name === 'string' && typeof p.mouthValue === 'number')
    .map((p) => ({ slug: p.slug.trim(), name: p.name.trim(), mouthValue: p.mouthValue }));
  return out.length > 0 ? out : DEFAULT_PRODUCTS;
}

function buildSchema(slugs: string[]) {
  const text = { type: 'string' };
  // Property order is the order the model writes them: the quick decisions
  // come first, and the long rewritten note comes last.
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      reachoutType: { type: 'string', enum: ['meeting', 'call', 'email', 'other'] },
      businessName: text,
      firstName: text,
      lastName: text,
      email: text,
      phone: text,
      address: text,
      city: text,
      state: text,
      zipCode: text,
      donationGiven: { type: 'boolean' },
      donationItems: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            product: { type: 'string', enum: slugs },
            quantity: { type: 'integer' },
          },
          required: ['product', 'quantity'],
        },
      },
      cakesDonatedNotes: text,
      orderedFromUs: { type: 'boolean' },
      followedUp: { type: 'boolean' },
      personalDetails: text,
      suggestedFollowUpDays: { type: 'integer' },
      reachoutNote: text,
    },
    required: ['reachoutType', 'donationGiven', 'donationItems', 'orderedFromUs', 'followedUp', 'suggestedFollowUpDays', 'reachoutNote'],
  };
}

function buildSystemPrompt(products: ProductIn[]): string {
  const productLines = products.map((p) => {
    const alias = PRODUCT_ALIASES[p.slug] && !/coupon/i.test(p.name) ? ` (${PRODUCT_ALIASES[p.slug]})` : '';
    return `- ${p.slug}: "${p.name}"${alias}, counts as ${p.mouthValue} bite${p.mouthValue === 1 ? '' : 's'} each`;
  }).join('\n');

  return `You read a bakery marketer's notes about one visit and fill in a CRM form. The bakery is Nothing Bundt Cakes. Marketers visit local businesses and give away free products to build relationships. "Donation" always means the bakery gave products to the business, never the other way around.

Notes may be long and detailed, and are often dictated by phone. Read all of them before deciding anything.

How they reached them (reachoutType):
- Almost every entry is an in-person visit. Use "meeting" unless the notes clearly say the main contact this time was a phone call ("call") or an email ("email").
- Passing mentions do not change this. "Stopped by and said I'd call next week" is a meeting. "Called ahead, then dropped off a tray" is a meeting.
- Use "other" only for something that is clearly none of these, like a text message or social media message.

Products we give away (use these exact ids in donationItems):
${productLines}

Products given (donationItems):
- Count every product handed over during this visit or call, however it is phrased: gave, dropped off, brought, left, delivered, donated, sampled, treated them to, and so on.
- Products given on an earlier visit ("the cake I dropped off last week", "they loved the bundtinis last time") were already logged then. Do not count them again. If nothing was given this time, leave donationItems empty and set donationGiven to false.
- Product names can contain words like single, double, triple, mini, or a size. Those words are part of the product name, not a quantity. "A double tower" is one of a product named like "Double Tower", not two towers.
- Pick the product whose name matches what was given most specifically. Use a broad catch-all product only when no specific one matches.
- If a product is counted per piece (for example per bundtlet) and the notes give the number of pieces, use that number. If they don't, use your best estimate and spell out exactly what was given in cakesDonatedNotes.
- Dictation mishears "bundtini" as panini, bikini, martini, zucchini, or similar words ending in "-ini". Read those as bundtini.
- Set donationGiven to true whenever anything was given, and write a short plain summary of what and why in cakesDonatedNotes.

Other fields:
- businessName: the business visited. Contact name, email, phone, and address only when stated.
- state: 2-letter abbreviation. phone: (XXX) XXX-XXXX when it has 10 digits.
- orderedFromUs: true only if they placed or committed to an order with us.
- followedUp: true only if this entry is itself a follow-up on an earlier contact.
- personalDetails: personal facts worth remembering (family, hobbies, preferences), as one friendly sentence.
- suggestedFollowUpDays: days until the next touch, usually 2 to 7.
- reachoutNote: the visit notes, cleaned up for clarity. Keep every fact: products and quantities, orders, dates, names, prices, next steps, and how they reacted. Do not shorten or summarize. Write "bundtini" for the misheard words above.

Leave out any field the notes don't mention.`;
}

/** Reads one visit's notes and returns the fields the add-visit form fills in. */
export async function extractVisitNotes(openai: OpenAI, notes: string, rawProducts?: unknown) {
  const products = cleanProducts(rawProducts);
  const out = await extractJson<ModelOutput>(openai, {
    name: 'visit_notes',
    system: buildSystemPrompt(products),
    content: `<visit_notes>\n${notes}\n</visit_notes>`,
    schema: buildSchema(products.map((p) => p.slug)),
  });

  // Same shape the form already reads: product counts keyed by slug.
  let donation: Record<string, number | string | boolean> | undefined;
  const items = (out.donationItems || []).filter((i) => i.quantity > 0);
  if (out.donationGiven || items.length > 0) {
    donation = {};
    for (const item of items) {
      donation[item.product] = ((donation[item.product] as number) || 0) + item.quantity;
    }
    if (out.cakesDonatedNotes) donation.cakesDonatedNotes = out.cakesDonatedNotes;
    donation.orderedFromUs = !!out.orderedFromUs;
    donation.followedUp = !!out.followedUp;
  }

  const days = Number.isFinite(out.suggestedFollowUpDays) && out.suggestedFollowUpDays > 0
    ? Math.min(Math.round(out.suggestedFollowUpDays), 30)
    : 3;

  return {
    firstName: out.firstName,
    lastName: out.lastName,
    businessName: out.businessName,
    email: out.email,
    phone: out.phone,
    address: out.address,
    city: out.city,
    state: out.state?.toUpperCase(),
    zipCode: out.zipCode,
    personalDetails: out.personalDetails,
    reachoutNote: out.reachoutNote,
    reachoutType: out.reachoutType,
    suggestedFollowUpDays: days,
    donation,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const openai = getOpenAI();
  if (!openai) return res.status(500).json({ error: 'OpenAI API key is not configured' });

  const body = req.body as { notes?: unknown; products?: unknown };
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  if (!notes) return res.status(400).json({ error: 'notes are required' });
  if (notes.length > MAX_NOTES_CHARS) return res.status(413).json({ error: 'Notes are too long to read in one go.' });

  try {
    return res.status(200).json(await extractVisitNotes(openai, notes, body.products));
  } catch (err) {
    console.error('Visit notes extraction error:', err);
    return res.status(500).json({ error: aiErrorMessage(err) });
  }
}
