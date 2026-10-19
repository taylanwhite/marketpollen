import { prisma } from './db.js';
import { geocode, orderByNearest } from './route.js';

export const MAX_STOPS_PER_DAY = 25;

/** "2026-10-21" -> a Date at UTC midnight, which is how Postgres DATE columns round-trip. */
export function parseDateKey(key: string | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((key || '').trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type PlanStopRow = {
  id: string;
  store_id: string;
  user_id: string;
  plan_date: Date;
  position: number;
  opportunity_id: string | null;
  business_id: string | null;
  place_id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  status: string;
};

export type PlanOverlap = { userName: string; date: string };

export function planStopJson(row: PlanStopRow, overlaps: PlanOverlap[] = []) {
  return {
    id: row.id,
    storeId: row.store_id,
    userId: row.user_id,
    date: dateKey(row.plan_date),
    position: row.position,
    opportunityId: row.opportunity_id,
    businessId: row.business_id,
    placeId: row.place_id,
    name: row.name,
    address: row.address,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    status: row.status === 'done' || row.status === 'skipped' ? row.status : 'planned',
    overlaps,
  };
}

function placeKeys(row: { opportunity_id: string | null; business_id: string | null; place_id: string | null }): string[] {
  return [
    row.place_id && `place:${row.place_id}`,
    row.opportunity_id && `opp:${row.opportunity_id}`,
    row.business_id && `biz:${row.business_id}`,
  ].filter((key): key is string => !!key);
}

/**
 * For each stop, the teammates in the same store who also have that place on
 * a plan from yesterday onward. Yesterday covers time zones where "today" on
 * the server is still the marketer's yesterday.
 */
export async function findOverlaps(storeId: string, userId: string, stops: PlanStopRow[]): Promise<Map<string, PlanOverlap[]>> {
  const result = new Map<string, PlanOverlap[]>();
  if (stops.length === 0) return result;
  const placeIds = stops.map((s) => s.place_id).filter((v): v is string => !!v);
  const oppIds = stops.map((s) => s.opportunity_id).filter((v): v is string => !!v);
  const bizIds = stops.map((s) => s.business_id).filter((v): v is string => !!v);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 1);
  const others = await prisma.planStop.findMany({
    where: {
      store_id: storeId,
      user_id: { not: userId },
      status: 'planned',
      plan_date: { gte: since },
      OR: [
        ...(placeIds.length ? [{ place_id: { in: placeIds } }] : []),
        ...(oppIds.length ? [{ opportunity_id: { in: oppIds } }] : []),
        ...(bizIds.length ? [{ business_id: { in: bizIds } }] : []),
      ],
    },
    include: { user: { select: { display_name: true, email: true } } },
    orderBy: { plan_date: 'asc' },
  });
  if (others.length === 0) return result;
  for (const stop of stops) {
    const keys = new Set(placeKeys(stop));
    const seen = new Set<string>();
    const matches: PlanOverlap[] = [];
    for (const other of others) {
      if (!placeKeys(other).some((key) => keys.has(key))) continue;
      const entry = { userName: other.user.display_name || other.user.email, date: dateKey(other.plan_date) };
      const id = `${entry.userName}|${entry.date}`;
      if (seen.has(id)) continue;
      seen.add(id);
      matches.push(entry);
    }
    if (matches.length) result.set(stop.id, matches);
  }
  return result;
}

export async function loadPlan(storeId: string, userId: string, date: Date) {
  const rows = await prisma.planStop.findMany({
    where: { store_id: storeId, user_id: userId, plan_date: date },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
  });
  const overlaps = await findOverlaps(storeId, userId, rows);
  return rows.map((row) => planStopJson(row, overlaps.get(row.id) || []));
}

/** Put the day's planned stops in nearest-first driving order from the store. Done or skipped stops keep their place at the top. */
export async function optimizePlan(storeId: string, userId: string, date: Date) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  const rows = await prisma.planStop.findMany({
    where: { store_id: storeId, user_id: userId, plan_date: date },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
  });
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const storeAddress = [store?.address, store?.city, store?.state, store?.zip_code].filter(Boolean).join(', ');
  if (!apiKey || !storeAddress) return false;
  const start = await geocode(storeAddress, apiKey);
  if (!start) return false;
  const finished = rows.filter((row) => row.status !== 'planned');
  const planned = rows.filter((row) => row.status === 'planned');
  const located = await Promise.all(planned.map(async (row) => {
    const coords = await geocode([row.address, row.city, row.state, row.zip_code].filter(Boolean).join(', '), apiKey);
    return coords ? { row, ...coords } : null;
  }));
  const withCoords = located.filter((item): item is { row: typeof rows[number]; lat: number; lng: number } => item !== null);
  const lost = planned.filter((row) => !withCoords.some((item) => item.row.id === row.id));
  const ordered = [
    ...finished,
    ...orderByNearest(start.lat, start.lng, withCoords).map((item) => item.row),
    ...lost,
  ];
  await prisma.$transaction(ordered.map((row, index) =>
    prisma.planStop.update({ where: { id: row.id }, data: { position: index } }),
  ));
  return true;
}
