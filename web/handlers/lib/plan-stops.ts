import { prisma } from './db.js';
import { businessLocationKey, locationKey } from './map-geocode.js';
import { geocode, cheapestInsertion, roundTripByDistance, type LatLng } from './route.js';
import { isOrgAdmin } from './org-access.js';

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
  assigned_by?: string | null;
};

export type PlanOverlap = { userName: string; date: string };

export function planStopJson(row: PlanStopRow, overlaps: PlanOverlap[] = [], assignedByName: string | null = null) {
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
    // Only set when someone else put this stop on the plan.
    assignedBy: row.assigned_by && row.assigned_by !== row.user_id ? row.assigned_by : null,
    assignedByName: row.assigned_by && row.assigned_by !== row.user_id ? assignedByName : null,
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
  const names = await userNames(rows.map((row) => row.assigned_by));
  return rows.map((row) => planStopJson(row, overlaps.get(row.id) || [], (row.assigned_by && names.get(row.assigned_by)) || null));
}

export async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, display_name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.display_name || user.email]));
}

/**
 * Organization admins supervise everyone's plans in their stores, and a
 * store's managers (edit access plus "Manager") do the same for that store.
 * Everyone else sees only their own.
 */
export async function canSeeTeamPlans(uid: string, storeId: string): Promise<boolean> {
  const manager = await prisma.storePermission.findUnique({
    where: { user_id_store_id: { user_id: uid, store_id: storeId } },
    select: { can_edit: true, can_manage_plans: true },
  });
  if (manager?.can_edit && manager.can_manage_plans) return true;
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { organization_id: true } });
  return !!store?.organization_id && await isOrgAdmin(uid, store.organization_id);
}

/** People who can have a plan in this store: everyone with access to it. */
export async function planPeople(storeId: string): Promise<Array<{ id: string; name: string }>> {
  const members = await prisma.storePermission.findMany({
    where: { store_id: storeId },
    include: { user: { select: { id: true, display_name: true, email: true } } },
  });
  return members
    .map((member) => ({ id: member.user.id, name: member.user.display_name || member.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whose plan a change goes to. Your own by default. An organization admin or
 * store manager may name a teammate who has access to the store. Returns null when not allowed.
 */
export async function planOwnerFor(uid: string, storeId: string, requestedUserId?: string | null): Promise<string | null> {
  const target = (requestedUserId || '').trim();
  if (!target || target === uid) return uid;
  if (!(await canSeeTeamPlans(uid, storeId))) return null;
  const member = await prisma.storePermission.findUnique({
    where: { user_id_store_id: { user_id: target, store_id: storeId } },
    select: { user_id: true },
  });
  return member ? target : null;
}

type StopRow = Awaited<ReturnType<typeof prisma.planStop.findMany>>[number];

/**
 * The store and each stop on the map. A stop's own business or opportunity
 * pin is used when it has one (no extra lookup); otherwise its address is
 * looked up. Stops that can't be found are left out.
 */
async function locateDay(storeId: string, rows: StopRow[]): Promise<{ start: LatLng | null; located: Map<string, LatLng> }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  const storeAddress = [store?.address, store?.city, store?.state, store?.zip_code].filter(Boolean).join(', ');
  // A saved pin counts only if it was looked up from the current address
  // (an edited address waits for the map to look it up again).
  const storePinCurrent = !!store && store.lat != null && store.lng != null && store.geocoded_address === locationKey(store);
  const start = storePinCurrent
    ? { lat: store!.lat!, lng: store!.lng! }
    : apiKey && storeAddress ? await geocode(storeAddress, apiKey) : null;

  const bizIds = rows.map((r) => r.business_id).filter((v): v is string => !!v);
  const oppIds = rows.map((r) => r.opportunity_id).filter((v): v is string => !!v);
  const [bizzes, opps] = await Promise.all([
    bizIds.length
      ? prisma.business.findMany({
          where: { id: { in: bizIds } },
          select: { id: true, lat: true, lng: true, geocoded_address: true, address: true, city: true, state: true, zip_code: true, place_id: true },
        })
      : [],
    oppIds.length
      ? prisma.opportunity.findMany({
          where: { id: { in: oppIds } },
          select: { id: true, lat: true, lng: true, geocoded_address: true, address: true, city: true, state: true, zip_code: true, place_id: true },
        })
      : [],
  ]);
  const pin = new Map<string, LatLng>();
  for (const b of bizzes) {
    if (b.lat != null && b.lng != null && b.geocoded_address === businessLocationKey(b)) pin.set(b.id, { lat: b.lat, lng: b.lng });
  }
  for (const o of opps) {
    if (o.lat != null && o.lng != null && o.geocoded_address === locationKey(o, true)) pin.set(o.id, { lat: o.lat, lng: o.lng });
  }

  const located = new Map<string, LatLng>();
  await Promise.all(rows.map(async (row) => {
    const known = (row.business_id && pin.get(row.business_id)) || (row.opportunity_id && pin.get(row.opportunity_id));
    if (known) {
      located.set(row.id, known);
      return;
    }
    const address = [row.address, row.city, row.state, row.zip_code].filter(Boolean).join(', ');
    const coords = apiKey && address ? await geocode(address, apiKey) : null;
    if (coords) located.set(row.id, coords);
  }));
  return { start, located };
}

/** Done or skipped stops first (where they were), then the route, then stops we couldn't find. */
async function saveOrder(rows: StopRow[], route: StopRow[], extra: Record<string, unknown> = {}) {
  const finished = rows.filter((row) => row.status !== 'planned');
  const inRoute = new Set(route.map((row) => row.id));
  const lost = rows.filter((row) => row.status === 'planned' && !inRoute.has(row.id));
  const ordered = [...finished, ...route, ...lost];
  await prisma.$transaction(ordered.map((row, index) =>
    prisma.planStop.update({ where: { id: row.id }, data: { position: index, ...extra } }),
  ));
}

async function dayRows(storeId: string, userId: string, date: Date) {
  return prisma.planStop.findMany({
    where: { store_id: storeId, user_id: userId, plan_date: date },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
  });
}

/**
 * Fit a newly added stop into the day's route where it adds the least
 * driving (store → stops → back to the store). Days someone rearranged by
 * hand are left alone: the new stop stays at the end.
 */
export async function placeNewStop(storeId: string, userId: string, date: Date, newStopId: string): Promise<void> {
  try {
    const rows = await dayRows(storeId, userId, date);
    if (rows.some((row) => row.manual_order)) return;
    const added = rows.find((row) => row.id === newStopId);
    const planned = rows.filter((row) => row.status === 'planned' && row.id !== newStopId);
    if (!added || planned.length === 0) return;
    const { start, located } = await locateDay(storeId, [...planned, added]);
    const spot = located.get(newStopId);
    if (!start || !spot) return;
    const route = planned.filter((row) => located.has(row.id));
    if (route.length === 0) return;
    const at = cheapestInsertion(start, route.map((row) => located.get(row.id)!), spot);
    // Move only the new stop: put it just before the route stop it goes
    // ahead of (or right after the last one), and leave every other stop
    // where it was.
    const order = rows.filter((row) => row.id !== newStopId);
    const anchor = at < route.length ? order.indexOf(route[at]) : order.indexOf(route[route.length - 1]) + 1;
    order.splice(anchor, 0, added);
    await prisma.$transaction(order.flatMap((row, index) =>
      row.position === index && row.id !== newStopId ? [] : [prisma.planStop.update({ where: { id: row.id }, data: { position: index } })],
    ));
  } catch (err) {
    // The stop is saved either way; it just stays at the end.
    console.error('Could not fit new stop into route:', (err as Error)?.message);
  }
}

/**
 * Put the day's planned stops in a short loop from the store and back, by
 * straight-line distance (no extra Google service). Done or skipped stops keep their place
 * at the top. Clears "rearranged by hand" so later stops are fitted in again.
 */
export async function optimizePlan(storeId: string, userId: string, date: Date) {
  const rows = await dayRows(storeId, userId, date);
  const planned = rows.filter((row) => row.status === 'planned');
  const { start, located } = await locateDay(storeId, planned);
  if (!start) return false;
  const route = planned.filter((row) => located.has(row.id));
  const points = route.map((row) => located.get(row.id)!);
  // Straight-line distance on purpose: Google's route optimization is a
  // separate paid service.
  const order = roundTripByDistance(start, points);
  await saveOrder(rows, order.map((index) => route[index]), { manual_order: false });
  return true;
}
