import {
  calculateMouths,
  getCurrentQuarterLabel,
  getFiscalQuarter,
  getQuarterDateRange,
} from './donationCalculations';
import {
  CalendarEvent,
  CampaignProduct,
  Contact,
  Opportunity,
  Reachout,
  SLUG_TO_FIELD,
} from '../types';

export type DateRangeKey = '30d' | 'quarter' | 'year' | 'all';

export interface DateRange {
  start: Date | null;
  end: Date;
  label: string;
}

export interface PeriodBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
  mouths: number;
  count: number;
}

export interface NamedCount {
  key: string;
  label: string;
  count: number;
  color: string;
}

export interface ReachoutRow {
  contact: Contact;
  reachout: Reachout;
  mouths: number;
  businessName: string;
}

export interface BusinessMouths {
  businessId: string;
  name: string;
  mouths: number;
  visits: number;
}

export interface ProductMixRow {
  productId: string;
  slug: string;
  name: string;
  quantity: number;
  mouths: number;
}

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  active: 'Active',
  converted: 'Converted',
  inactive: 'Inactive',
};

export const CONTACT_STATUS_COLORS: Record<string, string> = {
  new: '#5dade2',
  contacted: '#f5c842',
  active: '#58d68d',
  converted: '#d4a017',
  inactive: '#95a5a6',
};

export const REACHOUT_TYPE_LABELS: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  text: 'Text',
  other: 'Other',
};

export const REACHOUT_TYPE_COLORS: Record<string, string> = {
  call: '#58d68d',
  email: '#e67e22',
  meeting: '#af7ac5',
  text: '#3498db',
  other: '#95a5a6',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  reachout: 'Visit',
  followup: 'Follow-up',
  meeting: 'Meeting',
  call: 'Call',
  email: 'Email',
  text: 'Text',
  other: 'Other',
};

export const EVENT_TYPE_COLORS: Record<string, string> = {
  reachout: '#f5c842',
  followup: '#5dade2',
  meeting: '#af7ac5',
  call: '#58d68d',
  email: '#e67e22',
  text: '#3498db',
  other: '#95a5a6',
};

export const EVENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const EVENT_STATUS_COLORS: Record<string, string> = {
  scheduled: '#5dade2',
  completed: '#58d68d',
  cancelled: '#e74c3c',
};

export const OPPORTUNITY_STATUS_LABELS: Record<string, string> = {
  new: 'Open',
  converted: 'Converted',
  dismissed: 'Dismissed',
};

export const OPPORTUNITY_STATUS_COLORS: Record<string, string> = {
  new: '#f5c842',
  converted: '#58d68d',
  dismissed: '#95a5a6',
};

export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function contactDisplayName(contact: Contact): string {
  const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
  return name || contact.email || contact.phone || 'Unnamed contact';
}

export function formatShortDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function getDateRange(key: DateRangeKey, now = new Date()): DateRange {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (key === 'all') {
    return { start: null, end, label: 'All time' };
  }

  if (key === '30d') {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return { start, end, label: 'Last 30 days' };
  }

  if (key === 'year') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end: yearEnd, label: String(now.getFullYear()) };
  }

  const quarter = getQuarterDateRange(now);
  return { start: quarter.start, end: quarter.end, label: getCurrentQuarterLabel(now) };
}

export function inRange(date: Date | null, start: Date | null, end: Date): boolean {
  if (!date) return false;
  if (start && date < start) return false;
  return date <= end;
}

export function normalizeContact(contact: Contact): Contact {
  return {
    ...contact,
    reachouts: (contact.reachouts || []).map((r) => ({
      ...r,
      date: toDate(r.date) ?? new Date(r.date),
    })),
    createdAt: toDate(contact.createdAt) ?? contact.createdAt,
    lastReachoutDate: toDate(contact.lastReachoutDate),
    suggestedFollowUpDate: toDate(contact.suggestedFollowUpDate),
  };
}

export function normalizeEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    date: toDate(event.date) ?? event.date,
    createdAt: toDate(event.createdAt) ?? event.createdAt,
    completedAt: toDate(event.completedAt),
    cancelledAt: toDate(event.cancelledAt),
  };
}

export function flattenReachouts(
  contacts: Contact[],
  businesses: Map<string, string>,
  products?: CampaignProduct[],
): ReachoutRow[] {
  const rows: ReachoutRow[] = [];
  for (const contact of contacts) {
    for (const reachout of contact.reachouts || []) {
      rows.push({
        contact,
        reachout,
        mouths: reachout.donation ? calculateMouths(reachout.donation, products) : 0,
        businessName: businesses.get(contact.businessId) || 'Unknown business',
      });
    }
  }
  rows.sort((a, b) => {
    const da = toDate(a.reachout.date)?.getTime() ?? 0;
    const db = toDate(b.reachout.date)?.getTime() ?? 0;
    return db - da;
  });
  return rows;
}

export function filterReachoutsByRange(rows: ReachoutRow[], range: DateRange): ReachoutRow[] {
  return rows.filter((row) => inRange(toDate(row.reachout.date), range.start, range.end));
}

export function filterEventsByRange(events: CalendarEvent[], range: DateRange): CalendarEvent[] {
  return events.filter((event) => inRange(toDate(event.date), range.start, range.end));
}

export function filterOpportunitiesByRange(opps: Opportunity[], range: DateRange): Opportunity[] {
  return opps.filter((opp) => inRange(toDate(opp.createdAt), range.start, range.end));
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const daysFromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysFromMonday);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function startOfQuarter(date: Date): Date {
  return getFiscalQuarter(date).start;
}

function monthSpan(start: Date, end: Date): number {
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function earliestDate(dates: Array<Date | string | null | undefined>): Date | null {
  let earliest: Date | null = null;
  for (const value of dates) {
    const date = toDate(value);
    if (date && (!earliest || date < earliest)) earliest = date;
  }
  return earliest;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildPeriodBuckets(
  range: DateRange,
  rangeKey: DateRangeKey,
  now = new Date(),
  earliest?: Date | null,
): PeriodBucket[] {
  const end = range.end > now && rangeKey !== 'year' && rangeKey !== 'quarter' ? now : range.end;
  const start = range.start ?? (earliest ? startOfMonth(earliest) : startOfMonth(end));
  const buckets: PeriodBucket[] = [];

  if (rangeKey === '30d') {
    let cursor = startOfDay(start);
    const last = startOfDay(end);
    while (cursor <= last) {
      const next = addDays(cursor, 1);
      buckets.push({
        key: isoDay(cursor),
        label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        start: new Date(cursor),
        end: new Date(next.getTime() - 1),
        mouths: 0,
        count: 0,
      });
      cursor = next;
    }
    return buckets;
  }

  if (rangeKey === 'quarter') {
    let cursor = startOfWeek(start);
    while (cursor <= end) {
      const next = addDays(cursor, 7);
      buckets.push({
        key: isoDay(cursor),
        label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        start: new Date(cursor),
        end: new Date(next.getTime() - 1),
        mouths: 0,
        count: 0,
      });
      cursor = next;
    }
    return buckets;
  }

  if (rangeKey === 'all' && monthSpan(start, end) > 24) {
    let cursor = startOfQuarter(start);
    while (cursor <= end) {
      const quarter = getFiscalQuarter(cursor);
      buckets.push({
        key: `${quarter.year}-Q${quarter.quarter}`,
        label: `Q${quarter.quarter} ${String(quarter.year).slice(2)}`,
        start: quarter.start,
        end: quarter.end,
        mouths: 0,
        count: 0,
      });
      cursor = new Date(quarter.end.getTime() + 1);
    }
    return buckets;
  }

  let cursor = startOfMonth(start);
  while (cursor <= end) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    buckets.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      label: cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      start: new Date(cursor),
      end: new Date(next.getTime() - 1),
      mouths: 0,
      count: 0,
    });
    cursor = next;
  }
  return buckets;
}

export function mouthsByPeriod(rows: ReachoutRow[], range: DateRange, rangeKey: DateRangeKey): PeriodBucket[] {
  const donations = rows.filter((row) => row.mouths > 0);
  const earliest = earliestDate(donations.map((row) => row.reachout.date));
  const buckets = buildPeriodBuckets(range, rangeKey, new Date(), earliest);
  for (const row of donations) {
    const date = toDate(row.reachout.date);
    if (!date) continue;
    const bucket = buckets.find((b) => date >= b.start && date <= b.end);
    if (bucket) {
      bucket.mouths += row.mouths;
      bucket.count += 1;
    }
  }
  return buckets;
}

function countByKey<T>(
  items: T[],
  getKey: (item: T) => string,
  labels: Record<string, string>,
  colors: Record<string, string>,
  fallback = 'other',
): NamedCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item) || fallback;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const keys = Object.keys(labels);
  const ordered = keys.filter((key) => (counts.get(key) || 0) > 0);
  for (const key of counts.keys()) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered.map((key) => ({
    key,
    label: labels[key] || key,
    count: counts.get(key) || 0,
    color: colors[key] || '#95a5a6',
  }));
}

export function contactsByStatus(contacts: Contact[]): NamedCount[] {
  return countByKey(contacts, (c) => c.status || 'new', CONTACT_STATUS_LABELS, CONTACT_STATUS_COLORS, 'new');
}

export function reachoutsByType(rows: ReachoutRow[]): NamedCount[] {
  return countByKey(rows, (r) => r.reachout.type || 'other', REACHOUT_TYPE_LABELS, REACHOUT_TYPE_COLORS);
}

export function eventsByType(events: CalendarEvent[]): NamedCount[] {
  return countByKey(events, (e) => e.type || 'other', EVENT_TYPE_LABELS, EVENT_TYPE_COLORS);
}

export function eventsByStatus(events: CalendarEvent[]): NamedCount[] {
  return countByKey(events, (e) => e.status || 'scheduled', EVENT_STATUS_LABELS, EVENT_STATUS_COLORS, 'scheduled');
}

export function opportunitiesByStatus(opps: Opportunity[]): NamedCount[] {
  return countByKey(opps, (o) => o.status || 'new', OPPORTUNITY_STATUS_LABELS, OPPORTUNITY_STATUS_COLORS, 'new');
}

export function productMix(rows: ReachoutRow[], products: CampaignProduct[]): ProductMixRow[] {
  const map = new Map<string, ProductMixRow>();
  for (const product of products) {
    if (!product.isActive) continue;
    map.set(product.id, {
      productId: product.id,
      slug: product.slug,
      name: product.name,
      quantity: 0,
      mouths: 0,
    });
  }

  for (const row of rows) {
    const donation = row.reachout.donation;
    if (!donation) continue;
    for (const product of products) {
      if (!product.isActive) continue;
      const field = SLUG_TO_FIELD[product.slug];
      const qty = field
        ? ((donation[field] as number) || 0)
        : donation.customItems?.[product.id] || 0;
      if (qty <= 0) continue;
      const entry = map.get(product.id);
      if (!entry) continue;
      entry.quantity += qty;
      entry.mouths += qty * product.mouthValue;
    }
  }

  return [...map.values()].filter((row) => row.quantity > 0);
}

export function topBusinesses(rows: ReachoutRow[], limit = 8): BusinessMouths[] {
  const map = new Map<string, BusinessMouths>();
  for (const row of rows) {
    if (row.mouths <= 0) continue;
    const existing = map.get(row.contact.businessId);
    if (existing) {
      existing.mouths += row.mouths;
      existing.visits += 1;
    } else {
      map.set(row.contact.businessId, {
        businessId: row.contact.businessId,
        name: row.businessName,
        mouths: row.mouths,
        visits: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.mouths - a.mouths).slice(0, limit);
}

export function rowsForProduct(rows: ReachoutRow[], product: ProductMixRow): ReachoutRow[] {
  return rows.filter((row) => {
    const donation = row.reachout.donation;
    if (!donation) return false;
    const field = SLUG_TO_FIELD[product.slug];
    const qty = field
      ? ((donation[field] as number) || 0)
      : donation.customItems?.[product.productId] || 0;
    return qty > 0;
  });
}

export function rowsForPeriod(rows: ReachoutRow[], bucket: PeriodBucket): ReachoutRow[] {
  return rows.filter((row) => {
    const date = toDate(row.reachout.date);
    return !!date && date >= bucket.start && date <= bucket.end;
  });
}

export function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function upcomingEvents(events: CalendarEvent[], now = new Date()): CalendarEvent[] {
  const start = startOfToday(now);
  return events
    .filter((event) => {
      if (event.status === 'cancelled') return false;
      const date = toDate(event.date);
      return !!date && date >= start;
    })
    .sort((a, b) => {
      const da = toDate(a.date)?.getTime() ?? 0;
      const db = toDate(b.date)?.getTime() ?? 0;
      if (da !== db) return da - db;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });
}

export function eventsInNextDays(events: CalendarEvent[], days: number, now = new Date()): CalendarEvent[] {
  const start = startOfToday(now);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return upcomingEvents(events, now).filter((event) => {
    const date = toDate(event.date);
    return !!date && date < end;
  });
}

export function formatUpcomingDate(value: Date | string | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const today = startOfToday(now);
  const eventDay = new Date(date);
  eventDay.setHours(0, 0, 0, 0);
  const diff = Math.round((eventDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function opportunityLocation(opp: Opportunity): string {
  return [opp.address, opp.city, opp.state].filter(Boolean).join(', ') || 'No address';
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function unscheduledFollowUps(
  contacts: Contact[],
  events: CalendarEvent[],
  now = new Date(),
): Contact[] {
  const today = startOfToday(now);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);

  const scheduledDays = new Map<string, Date[]>();
  for (const event of events) {
    if (event.status === 'cancelled' || !event.contactId) continue;
    const date = toDate(event.date);
    if (!date) continue;
    const list = scheduledDays.get(event.contactId) || [];
    list.push(date);
    scheduledDays.set(event.contactId, list);
  }

  return contacts
    .filter((contact) => {
      const due = toDate(contact.suggestedFollowUpDate);
      if (!due) return false;
      const dueDay = startOfToday(due);
      if (dueDay > horizon) return false;
      const dates = scheduledDays.get(contact.id) || [];
      return !dates.some((date) => sameCalendarDay(date, dueDay));
    })
    .sort((a, b) => {
      const da = toDate(a.suggestedFollowUpDate)?.getTime() ?? 0;
      const db = toDate(b.suggestedFollowUpDate)?.getTime() ?? 0;
      return da - db;
    });
}

export function overdueEvents(events: CalendarEvent[], now = new Date()): CalendarEvent[] {
  const today = startOfToday(now);
  return events
    .filter((event) => {
      if (event.status === 'completed' || event.status === 'cancelled') return false;
      const date = toDate(event.date);
      return !!date && date < today;
    })
    .sort((a, b) => {
      const da = toDate(a.date)?.getTime() ?? 0;
      const db = toDate(b.date)?.getTime() ?? 0;
      return da - db;
    });
}

export function formatFollowUpDue(value: Date | string | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const today = startOfToday(now);
  const dueDay = startOfToday(date);
  const diff = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return diff === -1 ? '1 day overdue' : `${-diff} days overdue`;
  return formatUpcomingDate(date, now);
}
