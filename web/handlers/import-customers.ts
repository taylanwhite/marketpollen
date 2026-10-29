import { randomUUID } from 'crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore, rejectIfStoreLocked } from './lib/store-access.js';
import {
  BusinessIndex,
  MAX_IMPORT_ROWS,
  cleanRow,
  isKnownContact,
  parseGrid,
  readKnownColumns,
  rememberContact,
  type IndexedBusiness,
  type SheetRow,
} from './lib/import-sheet.js';

// Sheets without known column names are read by the AI this many rows at a time.
const AI_BATCH_ROWS = 80;
const AI_PARALLEL = 6;

export interface ImportRow extends SheetRow {
  businessAlreadyOnFile: boolean;
  /** Name of the business on file this row was matched to, when it is spelled differently. */
  matchedBusinessName: string;
  contactAlreadyOnFile: boolean;
}

async function loadIndex(storeId: string): Promise<BusinessIndex> {
  const businesses = await prisma.business.findMany({
    where: { store_id: storeId },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      zip_code: true,
      contacts: { select: { first_name: true, last_name: true, email: true, phone: true } },
    },
  });
  const index = new BusinessIndex();
  for (const b of businesses) {
    const entry: IndexedBusiness = {
      id: b.id,
      name: b.name,
      address: b.address,
      city: b.city,
      state: b.state,
      zipCode: b.zip_code,
      emails: new Set(),
      names: new Set(),
      phones: new Set(),
    };
    for (const c of b.contacts) {
      rememberContact(entry, { firstName: c.first_name, lastName: c.last_name, email: c.email, phone: c.phone });
    }
    index.add(entry);
  }
  return index;
}

function aiRowsFrom(raw: unknown): SheetRow[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { customers?: unknown }).customers)
    ? (raw as { customers: unknown[] }).customers
    : [];
  const rows: SheetRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const customer = item as Record<string, unknown>;
    const contacts = Array.isArray(customer.contacts) ? customer.contacts : [];
    const people = contacts.filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'));
    for (const person of people.length ? people : [{}]) {
      const row = cleanRow({ ...customer, ...person });
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function readBatchWithAi(openai: OpenAI, csv: string): Promise<SheetRow[]> {
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
          '- The first line may be the header row; use it to understand the columns.',
          '- Group rows for the same business into one customer with multiple contacts.',
          '- Split a full name into firstName and lastName.',
          '- state should be a 2-letter US code when the sheet makes that obvious.',
          '- Copy only values that are in the sheet. Do not invent emails, phones, addresses, or people.',
          '- notes is only for extra facts already in the row, such as a title or a comment.',
        ].join('\n'),
      },
      { role: 'user', content: csv },
    ],
  });
  const content = response.choices[0]?.message?.content || '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Could not read that spreadsheet');
  return aiRowsFrom(JSON.parse(content.slice(start, end + 1)));
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\n');
}

async function readWithAi(grid: string[][]): Promise<SheetRow[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is not configured');
  const openai = new OpenAI({ apiKey });

  // Every batch gets the first line too, since it is usually the header row.
  const [first, ...rest] = grid.slice(0, MAX_IMPORT_ROWS + 1);
  const batches: string[] = [];
  for (let i = 0; i < Math.max(rest.length, 1); i += AI_BATCH_ROWS) {
    batches.push(toCsv([first, ...rest.slice(i, i + AI_BATCH_ROWS)]));
  }

  const results: SheetRow[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next;
      next += 1;
      results[i] = await readBatchWithAi(openai, batches[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AI_PARALLEL, batches.length) }, worker));
  return results.flat().slice(0, MAX_IMPORT_ROWS);
}

/** Marks which rows are already on file, including rows that repeat earlier rows in the same sheet. */
function markOnFile(rows: SheetRow[], index: BusinessIndex): ImportRow[] {
  const sheetIndex = new BusinessIndex();
  return rows.map((row) => {
    const onFile = index.find(row);
    const hasPerson = Boolean(row.firstName || row.lastName || row.email || row.phone);
    let contactAlreadyOnFile = Boolean(onFile && hasPerson && isKnownContact(onFile, row));

    // Same person twice in the sheet: only the first one is checked by default.
    let seen = sheetIndex.find(row);
    if (!seen) {
      seen = { id: '', name: row.businessName, address: row.address, city: row.city, state: row.state, zipCode: row.zipCode, emails: new Set(), names: new Set(), phones: new Set() };
      sheetIndex.add(seen);
    }
    if (hasPerson) {
      if (isKnownContact(seen, row)) contactAlreadyOnFile = true;
      rememberContact(seen, row);
    }

    return {
      ...row,
      businessAlreadyOnFile: Boolean(onFile),
      matchedBusinessName: onFile && onFile.name !== row.businessName ? onFile.name : '',
      contactAlreadyOnFile,
    };
  });
}

function rowsFromBody(body: unknown): SheetRow[] {
  const list = body && typeof body === 'object' && Array.isArray((body as { rows?: unknown }).rows)
    ? (body as { rows: unknown[] }).rows
    : [];
  const rows: SheetRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = cleanRow(item as Record<string, unknown>);
    if (row) rows.push(row);
    if (rows.length >= MAX_IMPORT_ROWS) break;
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
      const grid = parseGrid(text);
      const known = readKnownColumns(grid);
      const sheetRows = known ? known.rows : await readWithAi(grid);
      if (sheetRows.length === 0) {
        return res.status(200).json({ rows: [], message: 'Nothing in that file looked like a customer.' });
      }
      const rows = markOnFile(sheetRows, await loadIndex(storeId));
      return res.status(200).json({ rows, readBy: known ? 'columns' : 'ai' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not read that spreadsheet';
      return res.status(500).json({ error: message });
    }
  }

  if (action === 'commit') {
    const incoming = rowsFromBody(req.body);
    if (incoming.length === 0) return res.status(400).json({ error: 'Nothing selected to create' });

    let skipped = 0;
    try {
      const index = await loadIndex(storeId);
      const newBusinesses: IndexedBusiness[] = [];
      const filledIn = new Map<string, IndexedBusiness>();
      const newContacts: { business: IndexedBusiness; row: SheetRow }[] = [];

      for (const row of incoming) {
        let business = index.find(row);
        const alreadyOnFile = Boolean(business);
        if (!business) {
          business = {
            id: randomUUID(),
            name: row.businessName,
            address: row.address || null,
            city: row.city || null,
            state: row.state || null,
            zipCode: row.zipCode || null,
            emails: new Set(),
            names: new Set(),
            phones: new Set(),
          };
          newBusinesses.push(business);
          index.add(business);
        } else if (!business.address && row.address) {
          // A business on file with no address picks it up from the sheet.
          business.address = row.address;
          business.city = business.city || row.city || null;
          business.state = business.state || row.state || null;
          business.zipCode = business.zipCode || row.zipCode || null;
          if (!newBusinesses.includes(business)) filledIn.set(business.id, business);
          index.add(business);
        }

        const hasPerson = Boolean(row.firstName || row.lastName || row.email || row.phone);
        if (!hasPerson) {
          if (alreadyOnFile) skipped += 1;
          continue;
        }
        if (isKnownContact(business, row)) {
          skipped += 1;
          continue;
        }
        rememberContact(business, row);
        newContacts.push({ business, row });
      }

      await prisma.$transaction([
        prisma.business.createMany({
          data: newBusinesses.map((b) => ({
            id: b.id,
            store_id: storeId,
            name: b.name,
            address: b.address,
            city: b.city,
            state: b.state,
            zip_code: b.zipCode,
            created_by: uid,
          })),
        }),
        ...[...filledIn.values()].map((b) => prisma.business.updateMany({
          where: { id: b.id, store_id: storeId, address: null },
          data: { address: b.address, city: b.city, state: b.state, zip_code: b.zipCode },
        })),
        prisma.contact.createMany({
          data: newContacts.map(({ business, row }) => ({
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
          })),
        }),
      ]);

      return res.status(200).json({
        createdBusinesses: newBusinesses.length,
        createdContacts: newContacts.length,
        updatedBusinesses: filledIn.size,
        skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save these customers';
      return res.status(500).json({ error: message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
