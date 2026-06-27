import {
  CampaignProduct,
  Contact,
  DonationData,
  Reachout,
  SLUG_TO_FIELD,
  Business,
} from '../types';
import { calculateMouths } from './donationCalculations';

export type DonationExportRow = {
  contact: Contact;
  reachout: Reachout;
  mouths: number;
  businessName: string;
  businessAddress?: string;
};

type XLSXModule = typeof import('xlsx');

const TRACKER_TITLE = '10,000 BITES OF JOY TRACKING';

const GOAL_TEXT =
  'GOAL: 50 boxes of Bundtinis/week, 1 event/week\n' +
  'NEW BAKERIES: 100 boxes of Bundtinis/week, \n' +
  '1 event/week, 1,000 free Bundtlet cards/week';

const COLUMN_HEADERS = [
  'Date ',
  'Business Name',
  'Contact Last Name',
  'Contact First Name',
  'Business Address',
  'Phone #',
  'Email',
  '# of Employees',
  'FREE Bundtlet Card',
  'Dozen Bundtinis \n(12 mouths)',
  '8" Cake \n(10 mouths)',
  '10" Cake \n(20 mouths)',
  'Sample Tray \n(40 mouths)',
  'Bundtlet or Tower\n(1 mouth per bundtlet)',
  'Cakes Donated Notes',
  'Notes',
  'Ordered from us?',
  'Followed up?',
];

const COLUMN_WIDTHS = [
  12, // Date
  24, // Business Name
  16, // Contact Last Name
  16, // Contact First Name
  34, // Business Address
  16, // Phone #
  30, // Email
  12, // # of Employees
  14, // FREE Bundtlet Card
  14, // Dozen Bundtinis
  14, // 8" Cake
  14, // 10" Cake
  14, // Sample Tray
  16, // Bundtlet or Tower
  32, // Cakes Donated Notes
  48, // Notes
  14, // Ordered from us?
  14, // Followed up?
];

/** Active built-in products in display order — maps to columns I–N in the tracker. */
export function getDonationExportProducts(products: CampaignProduct[]): CampaignProduct[] {
  return products
    .filter((p) => p.isActive && p.reachoutColumn)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

export function formatBusinessAddress(business: Pick<Business, 'address' | 'city' | 'state' | 'zipCode'>): string {
  const street = business.address?.trim() || '';
  const city = business.city?.trim() || '';
  const state = business.state?.trim() || '';
  const zip = business.zipCode?.trim() || '';

  let cityStateZip = city;
  if (state) {
    cityStateZip = cityStateZip ? `${cityStateZip}, ${state}` : state;
  }
  if (zip) {
    cityStateZip = cityStateZip ? `${cityStateZip} ${zip}` : zip;
  }

  return [street, cityStateZip].filter(Boolean).join(', ');
}

/** Excel 1900-date-system serial (matches the corporate tracker). */
export function dateToExcelSerial(date: Date): number {
  const d = date instanceof Date ? date : new Date(date);
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const excelEpoch = Date.UTC(1899, 11, 30);
  return Math.floor((utc - excelEpoch) / (24 * 60 * 60 * 1000));
}

function formatDisplayDate(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function qtyOrBlank(donation: DonationData, product: CampaignProduct): number | string {
  const field = SLUG_TO_FIELD[product.slug];
  const qty = field
    ? (donation[field] as number) || 0
    : donation.customItems?.[product.id] || 0;
  return qty > 0 ? qty : '';
}

function buildDataRow(
  row: DonationExportRow,
  exportProducts: CampaignProduct[],
): (string | number)[] {
  const { contact, reachout } = row;
  const donation = reachout.donation;
  if (!donation) return [];

  const reachoutDate =
    reachout.date instanceof Date ? reachout.date : new Date(reachout.date);

  const productValues = exportProducts.map((p) => qtyOrBlank(donation, p));
  while (productValues.length < 6) {
    productValues.push('');
  }

  return [
    formatDisplayDate(reachoutDate),
    row.businessName,
    contact.lastName || '',
    contact.firstName || '',
    row.businessAddress || '',
    contact.phone || '',
    contact.email || '',
    contact.employeeCount ?? '',
    ...productValues.slice(0, 6),
    donation.cakesDonatedNotes || '',
    reachout.note || '',
    donation.orderedFromUs ? 'yes!' : '',
    donation.followedUp ? 'Yes' : '',
  ];
}

function formatWorksheet(
  XLSX: XLSXModule,
  ws: ReturnType<XLSXModule['utils']['aoa_to_sheet']>,
  rowCount: number,
) {
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }));
  ws['!rows'] = Array.from({ length: rowCount }, (_, index) => {
    if (index === 0) return { hpt: 18 };
    if (index === 3) return { hpt: 48 };
    if (index === 5) return { hpt: 42 };
    return { hpt: 36 };
  });

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:R1');
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[address] as any;
      if (!cell) continue;
      cell.s = {
        ...(cell.s || {}),
        alignment: {
          ...(cell.s?.alignment || {}),
          wrapText: true,
          vertical: 'top',
        },
      };
    }
  }
}

/**
 * Build a worksheet matching the Q1–Q4 tabs in the corporate
 * "10,000 Bites of Joy" tracker so rows paste cleanly into that sheet.
 */
export function buildDonationExportSheet(
  XLSX: XLSXModule,
  rows: DonationExportRow[],
  exportProducts: CampaignProduct[],
) {
  const sorted = [...rows].sort((a, b) => {
    const dateA = a.reachout.date instanceof Date ? a.reachout.date : new Date(a.reachout.date);
    const dateB = b.reachout.date instanceof Date ? b.reachout.date : new Date(b.reachout.date);
    return dateA.getTime() - dateB.getTime();
  });

  const totalMouths = sorted.reduce((sum, r) => sum + r.mouths, 0);
  const totalFreeCards = sorted.reduce((sum, r) => {
    const d = r.reachout.donation;
    return sum + (d?.freeBundletCard || 0);
  }, 0);

  const aoa: (string | number)[][] = [
    [TRACKER_TITLE],
    [],
    [],
    ['', 'Mouths Sampled', totalMouths, '', GOAL_TEXT],
    ['', 'Free Bundtlet Cards ', totalFreeCards],
    COLUMN_HEADERS,
    ...sorted.map((row) => buildDataRow(row, exportProducts)),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  formatWorksheet(XLSX, ws, aoa.length);
  return ws;
}

export function getDonationExportSheetName(quarterLabel: string): string {
  return quarterLabel.split(' ')[0] || 'Donations';
}

function formatFilenameDate(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatFilenameScope(scope: string): string {
  return scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'store';
}

export function getDonationExportFilename(rows: DonationExportRow[], scope: string): string {
  const safeScope = formatFilenameScope(scope);
  if (rows.length === 0) return `donations_${safeScope}.xlsx`;

  const dates = rows.map((row) =>
    row.reachout.date instanceof Date ? row.reachout.date : new Date(row.reachout.date),
  );
  const startDate = new Date(Math.min(...dates.map((date) => date.getTime())));
  const endDate = new Date(Math.max(...dates.map((date) => date.getTime())));

  return `donations_${safeScope}_${formatFilenameDate(startDate)}_${formatFilenameDate(endDate)}.xlsx`;
}

export function getOrgDonationExportFilename(rows: DonationExportRow[]): string {
  return getDonationExportFilename(rows, 'all_stores');
}

/** Sum mouths for a set of export rows (used when validating totals). */
export function sumExportMouths(rows: DonationExportRow[], products: CampaignProduct[]): number {
  return rows.reduce((sum, r) => {
    if (!r.reachout.donation) return sum;
    return sum + calculateMouths(r.reachout.donation, products);
  }, 0);
}
