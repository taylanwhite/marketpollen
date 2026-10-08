import { randomUUID } from 'crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore, rejectIfStoreLocked } from './lib/store-access.js';

const MAX_ROWS = 200;
const MAX_TEXT = 80_000;

interface ImportContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
}

interface ImportCustomer {
  businessName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  contacts: ImportContact[];
}

export interface ImportRow {
  businessName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  businessAlreadyOnFile: boolean;
  contactAlreadyOnFile: boolean;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function stateCode(value: unknown): string {
  const clipped = clip(value, 40);
  return clipped.length === 2 ? clipped.toUpperCase() : clipped;
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function asCustomers(raw: unknown): ImportCustomer[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { customers?: unknown }).customers)
    ? (raw as { customers: unknown[] }).customers
    : [];
  const customers: ImportCustomer[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const businessName = clip(row.businessName, 200);
    if (!businessName) continue;
    const contactsIn = Array.isArray(row.contacts) ? row.contacts : [];
    const contacts: ImportContact[] = [];
    for (const contact of contactsIn) {
      if (!contact || typeof contact !== 'object') continue;
      const c = contact as Record<string, unknown>;
      const parsed: ImportContact = {
        firstName: clip(c.firstName, 100),
        lastName: clip(c.lastName, 100),
        email: clip(c.email, 200),
        phone: clip(c.phone, 40),
        notes: clip(c.notes, 2000),
      };
      if (parsed.firstName || parsed.lastName || parsed.email || parsed.phone) contacts.push(parsed);
    }
    customers.push({
      businessName,
      address: clip(row.address, 300),
      city: clip(row.city, 100),
      state: stateCode(row.state),
      zipCode: clip(row.zipCode, 20),
      contacts,
    });
    if (customers.length >= MAX_ROWS) break;
  }
  return customers;
}

function flatten(customers: ImportCustomer[], existing: Map<string, { emails: Set<string>; names: Set<string>; phones: Set<string> }>): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const customer of customers) {
    const key = norm(customer.businessName);
    const onFile = existing.get(key);
    const contacts = customer.contacts.length > 0 ? customer.contacts : [null];
    for (const contact of contacts) {
      const emailKey = contact?.email ? norm(contact.email) : '';
      const nameKey = contact ? norm(`${contact.firstName} ${contact.lastName}`) : '';
      const phoneKey = contact?.phone ? norm(contact.phone) : '';
      const contactAlready = Boolean(
        onFile && (
          (emailKey && onFile.emails.has(emailKey))
          || (phoneKey && onFile.phones.has(phoneKey))
          || (nameKey && onFile.names.has(nameKey))
        ),
      );
      rows.push({
        businessName: customer.businessName,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        zipCode: customer.zipCode,
        firstName: contact?.firstName || '',
        lastName: contact?.lastName || '',
        email: contact?.email || '',
        phone: contact?.phone || '',
        notes: contact?.notes || '',
        businessAlreadyOnFile: Boolean(onFile),
        contactAlreadyOnFile: contactAlready,
      });
    }
  }
  return rows;
}

async function existingIndex(storeId: string) {
  const businesses = await prisma.business.findMany({
    where: { store_id: storeId },
    select: {
      name: true,
      contacts: { select: { first_name: true, last_name: true, email: true, phone: true } },
    },
  });
  const map = new Map<string, { emails: Set<string>; names: Set<string>; phones: Set<string> }>();
  for (const business of businesses) {
    const emails = new Set<string>();
    const names = new Set<string>();
    const phones = new Set<string>();
    for (const contact of business.contacts) {
      if (contact.email) emails.add(norm(contact.email));
      if (contact.phone) phones.add(norm(contact.phone));
      const name = norm(`${contact.first_name || ''} ${contact.last_name || ''}`);
      if (name) names.add(name);
    }
    map.set(norm(business.name), { emails, names, phones });
  }
  return map;
}

async function readSpreadsheet(text: string): Promise<ImportCustomer[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is not configured');
  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    max_tokens: 12000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You turn a messy customer spreadsheet into JSON for a bakery marketing app.',
          'Return JSON with this shape: {"customers":[{"businessName":"","address":"","city":"","state":"","zipCode":"","contacts":[{"firstName":"","lastName":"","email":"","phone":"","notes":""}]}]}',
          'Rules:',
          '- businessName is required. Skip blank rows, totals, and header rows.',
          '- Group rows for the same business into one customer with multiple contacts.',
          '- Split a full name into firstName and lastName.',
          '- state should be a 2-letter US code when the sheet makes that obvious.',
          '- Copy only values that are in the sheet. Do not invent emails, phones, addresses, or people.',
          '- notes is only for extra facts already in the row, such as a title or a comment.',
          `- Return at most ${MAX_ROWS} customers.`,
        ].join('\n'),
      },
      { role: 'user', content: text.slice(0, MAX_TEXT) },
    ],
  });
  const content = response.choices[0]?.message?.content || '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Could not read that spreadsheet');
  return asCustomers(JSON.parse(content.slice(start, end + 1)));
}

function rowsFromBody(body: unknown): ImportRow[] {
  const list = body && typeof body === 'object' && Array.isArray((body as { rows?: unknown }).rows)
    ? (body as { rows: unknown[] }).rows
    : [];
  const rows: ImportRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const businessName = clip(row.businessName, 200);
    if (!businessName) continue;
    rows.push({
      businessName,
      address: clip(row.address, 300),
      city: clip(row.city, 100),
      state: stateCode(row.state),
      zipCode: clip(row.zipCode, 20),
      firstName: clip(row.firstName, 100),
      lastName: clip(row.lastName, 100),
      email: clip(row.email, 200),
      phone: clip(row.phone, 40),
      notes: clip(row.notes, 2000),
      businessAlreadyOnFile: false,
      contactAlreadyOnFile: false,
    });
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const storeId = (req.query?.storeId as string)?.trim() || (req.body?.storeId as string)?.trim();
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  const can = await canAccessStore(uid, storeId);
  if (!can) return res.status(404).json({ error: 'Store not found' });
  if (await rejectIfStoreLocked(res, storeId, uid)) return;

  const action = (req.body?.action as string)?.trim();

  if (action === 'preview') {
    const text = typeof req.body?.spreadsheetText === 'string' ? req.body.spreadsheetText.trim() : '';
    if (!text) return res.status(400).json({ error: 'Paste or upload a spreadsheet first' });
    try {
      const customers = await readSpreadsheet(text);
      if (customers.length === 0) {
        return res.status(200).json({ rows: [], message: 'Nothing in that file looked like a customer.' });
      }
      const rows = flatten(customers, await existingIndex(storeId));
      return res.status(200).json({ rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not read that spreadsheet';
      return res.status(500).json({ error: message });
    }
  }

  if (action === 'commit') {
    const incoming = rowsFromBody(req.body);
    if (incoming.length === 0) return res.status(400).json({ error: 'Nothing selected to create' });

    let createdBusinesses = 0;
    let createdContacts = 0;
    let skipped = 0;

    try {
      await prisma.$transaction(async (tx) => {
        const businesses = await tx.business.findMany({
          where: { store_id: storeId },
          select: {
            id: true,
            name: true,
            contacts: { select: { first_name: true, last_name: true, email: true, phone: true } },
          },
        });
        const byName = new Map<string, { id: string; emails: Set<string>; names: Set<string>; phones: Set<string> }>();
        for (const business of businesses) {
          const emails = new Set<string>();
          const names = new Set<string>();
          const phones = new Set<string>();
          for (const contact of business.contacts) {
            if (contact.email) emails.add(norm(contact.email));
            if (contact.phone) phones.add(norm(contact.phone));
            const name = norm(`${contact.first_name || ''} ${contact.last_name || ''}`);
            if (name) names.add(name);
          }
          byName.set(norm(business.name), { id: business.id, emails, names, phones });
        }

        for (const row of incoming) {
          const key = norm(row.businessName);
          let business = byName.get(key);
          const alreadyOnFile = Boolean(business);
          if (!business) {
            const created = await tx.business.create({
              data: {
                store_id: storeId,
                name: row.businessName,
                address: row.address || null,
                city: row.city || null,
                state: row.state || null,
                zip_code: row.zipCode || null,
                created_by: uid,
              },
              select: { id: true },
            });
            business = { id: created.id, emails: new Set(), names: new Set(), phones: new Set() };
            byName.set(key, business);
            createdBusinesses += 1;
          }

          const hasPerson = Boolean(row.firstName || row.lastName || row.email || row.phone);
          if (!hasPerson) {
            if (alreadyOnFile) skipped += 1;
            continue;
          }

          const emailKey = row.email ? norm(row.email) : '';
          const phoneKey = row.phone ? norm(row.phone) : '';
          const nameKey = norm(`${row.firstName} ${row.lastName}`);
          const duplicate = (emailKey && business.emails.has(emailKey)) || (phoneKey && business.phones.has(phoneKey)) || (nameKey && business.names.has(nameKey));
          if (duplicate) {
            skipped += 1;
            continue;
          }

          await tx.contact.create({
            data: {
              business_id: business.id,
              store_id: storeId,
              contact_id: `import-${randomUUID()}`,
              first_name: row.firstName || null,
              last_name: row.lastName || null,
              email: row.email || null,
              phone: row.phone || null,
              personal_details: row.notes || null,
              status: 'new',
              created_by: uid,
            },
          });
          if (emailKey) business.emails.add(emailKey);
          if (phoneKey) business.phones.add(phoneKey);
          if (nameKey) business.names.add(nameKey);
          createdContacts += 1;
        }
      }, { timeout: 60000 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save these customers';
      return res.status(500).json({ error: message });
    }

    return res.status(200).json({ createdBusinesses, createdContacts, skipped });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
