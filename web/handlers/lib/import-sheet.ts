import * as XLSX from 'xlsx';

// Rows the import reads in one pass. Kept in step with ROW_CAP in ImportCustomersDialog.
export const MAX_IMPORT_ROWS = 1000;

export interface SheetRow {
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
}

export function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function stateCode(value: unknown): string {
  const clipped = clip(value, 40);
  return clipped.length === 2 ? clipped.toUpperCase() : clipped;
}

// Excel drops the leading zero from zips like 02134; put it back.
export function cleanZip(value: unknown): string {
  const clipped = clip(value, 20);
  return /^\d{4}$/.test(clipped) ? `0${clipped}` : clipped;
}

export function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function cleanRow(raw: Record<string, unknown>): SheetRow | null {
  const businessName = clip(raw.businessName, 200);
  if (!businessName) return null;
  return {
    businessName,
    address: clip(raw.address, 300),
    city: clip(raw.city, 100),
    state: stateCode(raw.state),
    zipCode: cleanZip(raw.zipCode),
    firstName: clip(raw.firstName, 100),
    lastName: clip(raw.lastName, 100),
    email: clip(raw.email, 200),
    phone: clip(raw.phone, 40),
    notes: clip(raw.notes, 2000),
  };
}

// ---------- Reading the sheet ----------

/** Parses CSV text into a grid of trimmed strings, dropping blank rows. */
export function parseGrid(text: string): string[][] {
  const workbook = XLSX.read(text, { type: 'string', raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  return rows
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
    .filter((row) => row.some(Boolean));
}

type Field = keyof SheetRow | 'fullName';

const HEADER_ALIASES: Record<string, Field> = {
  'business name': 'businessName',
  business: 'businessName',
  company: 'businessName',
  'company name': 'businessName',
  organization: 'businessName',
  'organization name': 'businessName',
  account: 'businessName',
  'account name': 'businessName',
  address: 'address',
  'street address': 'address',
  street: 'address',
  'address 1': 'address',
  'address line 1': 'address',
  city: 'city',
  town: 'city',
  state: 'state',
  st: 'state',
  province: 'state',
  zip: 'zipCode',
  'zip code': 'zipCode',
  zipcode: 'zipCode',
  'postal code': 'zipCode',
  postcode: 'zipCode',
  'first name': 'firstName',
  first: 'firstName',
  'last name': 'lastName',
  last: 'lastName',
  surname: 'lastName',
  name: 'fullName',
  'full name': 'fullName',
  contact: 'fullName',
  'contact name': 'fullName',
  email: 'email',
  'email address': 'email',
  'e mail': 'email',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  cell: 'phone',
  telephone: 'phone',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
};

function headerKey(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Reads a sheet whose header row uses names we know (like the example sheet)
 * without the AI. Returns null when no such header row is found, so the
 * caller can fall back to the AI reader.
 */
export function readKnownColumns(grid: string[][]): { rows: SheetRow[]; truncated: boolean } | null {
  for (let h = 0; h < Math.min(grid.length, 10); h += 1) {
    const fields = grid[h].map((cell) => HEADER_ALIASES[headerKey(cell)]);
    if (!fields.includes('businessName')) continue;
    const known = fields.filter(Boolean).length;
    if (known < 2) continue;

    const rows: SheetRow[] = [];
    const body = grid.slice(h + 1);
    for (const cells of body) {
      const raw: Record<string, string> = {};
      const extra: string[] = [];
      cells.forEach((value, i) => {
        if (!value) return;
        const field = fields[i];
        if (!field) {
          const label = grid[h][i];
          extra.push(label ? `${label}: ${value}` : value);
        } else if (field === 'fullName') {
          const parts = value.split(/\s+/);
          raw.firstName = raw.firstName || parts[0] || '';
          raw.lastName = raw.lastName || parts.slice(1).join(' ');
        } else if (field === 'notes') {
          raw.notes = raw.notes ? `${raw.notes}; ${value}` : value;
        } else if (!raw[field]) {
          raw[field] = value;
        }
      });
      if (extra.length) raw.notes = [raw.notes, ...extra].filter(Boolean).join('; ');
      const row = cleanRow(raw);
      if (row) rows.push(row);
      if (rows.length >= MAX_IMPORT_ROWS) break;
    }
    return { rows, truncated: body.length > rows.length && rows.length >= MAX_IMPORT_ROWS };
  }
  return null;
}

// ---------- Matching rows to businesses ----------

const NAME_SUFFIXES = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'pllc', 'pc', 'lp', 'llp', 'incorporated']);
const NAME_STOPWORDS = new Set(['the', 'and', 'of', 'at', 'for']);

/** "The Joe's Pizza, Inc." and "joes pizza" both become "joes pizza". */
export function nameKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (tokens[0] === 'the' && tokens.length > 1) tokens.shift();
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

/** First distinctive word: "Dr. Smith Orthodontics" gives "smith". */
function leadToken(name: string): string {
  return nameKey(name).split(' ').find((t) => t.length >= 3 && !NAME_STOPWORDS.has(t)) || '';
}

const STREET_WORDS: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln',
  court: 'ct', place: 'pl', parkway: 'pkwy', highway: 'hwy', circle: 'cir', terrace: 'ter',
  suite: 'ste', apartment: 'apt', unit: 'ste', building: 'bldg', floor: 'fl',
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

/** "123 North Main Street, Suite 4" becomes "123 n main st ste 4". Empty without a house number. */
export function streetKey(address: string): string {
  const street = address.split(',')[0]
    .toLowerCase()
    .replace(/#/g, ' ste ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => STREET_WORDS[word] || word)
    .join(' ');
  return /^\d/.test(street) ? street : '';
}

function zip5(zip: string | null | undefined, address: string | null | undefined): string {
  const fromZip = (zip || '').match(/\d{5}/)?.[0];
  if (fromZip) return fromZip;
  // Only look past the street part, so a house number like 12345 is not read as a zip.
  const rest = (address || '').split(',').slice(1).join(',');
  return rest.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1] || '';
}

function addressKeys(b: { address?: string | null; city?: string | null; zipCode?: string | null }): string[] {
  const street = streetKey(b.address || '');
  if (!street) return [];
  const keys: string[] = [];
  const zip = zip5(b.zipCode, b.address);
  if (zip) keys.push(`${street}|${zip}`);
  if (b.city) keys.push(`${street}|${norm(b.city)}`);
  return keys;
}

export interface IndexedBusiness {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  emails: Set<string>;
  names: Set<string>;
  phones: Set<string>;
}

/**
 * Finds the business a row belongs to: same name (ignoring case, punctuation,
 * "The" and "Inc"/"LLC"), or same street address and zip/city when the names
 * start with the same word. Two different shops in one building stay separate.
 */
export class BusinessIndex {
  private byName = new Map<string, IndexedBusiness>();
  private byAddress = new Map<string, IndexedBusiness[]>();

  add(business: IndexedBusiness) {
    const key = nameKey(business.name);
    if (key && !this.byName.has(key)) this.byName.set(key, business);
    for (const addr of addressKeys(business)) {
      const list = this.byAddress.get(addr) || [];
      if (!list.includes(business)) list.push(business);
      this.byAddress.set(addr, list);
    }
  }

  find(row: { businessName: string; address: string; city: string; zipCode: string }): IndexedBusiness | undefined {
    const byName = this.byName.get(nameKey(row.businessName));
    if (byName) return byName;
    // At the same address, the names must start alike, so "Acme Dental" and
    // "Smile Dental" in one building stay apart but "Smith Ortho" finds "Dr. Smith Orthodontics".
    const rowKey = nameKey(row.businessName);
    const rowLead = leadToken(row.businessName);
    for (const addr of addressKeys(row)) {
      for (const candidate of this.byAddress.get(addr) || []) {
        const otherKey = nameKey(candidate.name);
        if (otherKey.includes(rowKey) || rowKey.includes(otherKey)) return candidate;
        if (rowLead && rowLead === leadToken(candidate.name)) return candidate;
      }
    }
    return undefined;
  }
}

export function contactKeys(c: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null }) {
  return {
    email: c.email ? norm(c.email) : '',
    phone: c.phone ? c.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : '',
    name: norm(`${c.firstName || ''} ${c.lastName || ''}`),
  };
}

export function isKnownContact(business: IndexedBusiness, c: Parameters<typeof contactKeys>[0]): boolean {
  const keys = contactKeys(c);
  return Boolean(
    (keys.email && business.emails.has(keys.email))
    || (keys.phone && business.phones.has(keys.phone))
    || (keys.name && business.names.has(keys.name)),
  );
}

export function rememberContact(business: IndexedBusiness, c: Parameters<typeof contactKeys>[0]) {
  const keys = contactKeys(c);
  if (keys.email) business.emails.add(keys.email);
  if (keys.phone) business.phones.add(keys.phone);
  if (keys.name) business.names.add(keys.name);
}
