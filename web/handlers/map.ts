import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { readableStoreScope, storeIdWhere } from './lib/store-access.js';
import { personName } from './lib/contact-json.js';
import { geocodeKey, locationKey, runLimited } from './lib/map-geocode.js';

/** Visit types in the order the map's `visits` tuples refer to them. */
const VISIT_TYPES = ['meeting', 'call', 'email', 'text', 'other'] as const;

/**
 * Pins without coordinates are looked up a batch at a time, so the first
 * map load for an organization fills in gradually instead of timing out.
 * The response says how many are still waiting and the page asks again.
 */
const MAX_LOOKUPS_PER_REQUEST = 150;
const LOOKUP_CONCURRENCY = 10;

type GeoRow = {
  id: string;
  lat: number | null;
  lng: number | null;
  geocoded_address: string | null;
};

type Lookup = { table: 'store' | 'business' | 'opportunity'; row: GeoRow; key: string };

function needsLookup(row: GeoRow, key: string | null): key is string {
  return key != null && row.geocoded_address !== key;
}

function placed(row: GeoRow, key: string | null): boolean {
  return key != null && row.geocoded_address === key && row.lat != null && row.lng != null;
}

function notPlaceable(row: GeoRow, key: string | null): boolean {
  return key == null || (row.geocoded_address === key && (row.lat == null || row.lng == null));
}

/**
 * GET /api/map?storeId=… | orgId=…
 *
 * Everything the Map page draws: the stores, every business with its visits
 * (as compact [timeMs, typeIndex, personIndex] tuples so the page can filter
 * by date, type, and person without asking again), and open opportunities.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const storeId = (req.query?.storeId as string)?.trim();
  const orgId = (req.query?.orgId as string)?.trim();
  // A map of every store on the platform is never wanted; require a store or org.
  if (!storeId && !orgId) return res.status(400).json({ error: 'storeId or orgId required' });
  const scope = await readableStoreScope(uid, { storeId, orgId });
  if (!scope) return res.status(404).json({ error: 'Store not found' });
  const where = storeIdWhere(scope);
  const storeWhere = 'unrestricted' in scope ? {} : { id: { in: scope.storeIds } };

  const [stores, businesses, opportunities, reachouts] = await Promise.all([
    prisma.store.findMany({
      where: { ...storeWhere, archived_at: null },
      select: { id: true, name: true, address: true, city: true, state: true, zip_code: true, lat: true, lng: true, geocoded_address: true },
    }),
    prisma.business.findMany({
      where,
      select: {
        id: true, store_id: true, name: true, address: true, city: true, state: true, zip_code: true, place_id: true,
        lat: true, lng: true, geocoded_address: true,
        _count: { select: { contacts: true } },
      },
    }),
    prisma.opportunity.findMany({
      where: { ...where, status: { in: ['new', 'hold'] } },
      select: {
        id: true, store_id: true, name: true, address: true, city: true, state: true, zip_code: true, place_id: true,
        status: true, lat: true, lng: true, geocoded_address: true,
      },
    }),
    prisma.reachout.findMany({
      where: { contact: where },
      select: { date: true, type: true, created_by: true, contact: { select: { business_id: true } } },
    }),
  ]);

  // Visits per business, newest first.
  const personIndex = new Map<string, number>();
  const visitsByBusiness = new Map<string, number[][]>();
  for (const r of reachouts) {
    const businessId = r.contact.business_id;
    let typeIdx = VISIT_TYPES.indexOf(r.type as typeof VISIT_TYPES[number]);
    if (typeIdx < 0) typeIdx = VISIT_TYPES.indexOf('other');
    let pIdx = personIndex.get(r.created_by);
    if (pIdx == null) {
      pIdx = personIndex.size;
      personIndex.set(r.created_by, pIdx);
    }
    const list = visitsByBusiness.get(businessId) ?? [];
    list.push([r.date.getTime(), typeIdx, pIdx]);
    visitsByBusiness.set(businessId, list);
  }
  for (const list of visitsByBusiness.values()) list.sort((a, b) => b[0] - a[0]);

  const users = personIndex.size
    ? await prisma.user.findMany({
        where: { id: { in: [...personIndex.keys()] } },
        select: { id: true, display_name: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const people = [...personIndex.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => ({ id, name: personName(userById.get(id)) || 'Someone' }));

  // Look up coordinates that are missing or out of date. Stores first, then
  // businesses that have been visited, then the rest, then opportunities.
  const storeKeys = new Map(stores.map((s) => [s.id, locationKey(s)]));
  const businessKeys = new Map(businesses.map((b) => [b.id, locationKey(b)]));
  const opportunityKeys = new Map(opportunities.map((o) => [o.id, locationKey(o, true)]));

  const lookups: Lookup[] = [];
  for (const s of stores) {
    const key = storeKeys.get(s.id) ?? null;
    if (needsLookup(s, key)) lookups.push({ table: 'store', row: s, key });
  }
  const visitedFirst = [...businesses].sort(
    (a, b) => Number(visitsByBusiness.has(b.id)) - Number(visitsByBusiness.has(a.id)),
  );
  for (const b of visitedFirst) {
    const key = businessKeys.get(b.id) ?? null;
    if (needsLookup(b, key)) lookups.push({ table: 'business', row: b, key });
  }
  for (const o of opportunities) {
    const key = opportunityKeys.get(o.id) ?? null;
    if (needsLookup(o, key)) lookups.push({ table: 'opportunity', row: o, key });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const batch = apiKey ? lookups.slice(0, MAX_LOOKUPS_PER_REQUEST) : [];
  let retryLater = 0;
  await runLimited(batch, LOOKUP_CONCURRENCY, async ({ table, row, key }) => {
    const coords = await geocodeKey(key, apiKey!);
    if (coords === 'retry') {
      retryLater += 1;
      return;
    }
    const data = { lat: coords?.lat ?? null, lng: coords?.lng ?? null, geocoded_address: key };
    try {
      if (table === 'store') await prisma.store.update({ where: { id: row.id }, data });
      else if (table === 'business') await prisma.business.update({ where: { id: row.id }, data });
      else await prisma.opportunity.update({ where: { id: row.id }, data });
      Object.assign(row, data);
    } catch (err) {
      // The row may have been deleted while we looked it up.
      console.error('Map coordinate save failed:', table, row.id, (err as Error)?.message);
    }
  });
  const pending = lookups.length - batch.length + retryLater;

  const placedBusinesses = businesses.filter((b) => placed(b, businessKeys.get(b.id) ?? null));
  const placedOpportunities = opportunities.filter((o) => placed(o, opportunityKeys.get(o.id) ?? null));

  const address = (row: { address: string | null; city: string | null; state: string | null; zip_code: string | null }) =>
    [row.address, row.city, row.state, row.zip_code].filter(Boolean).join(', ') || undefined;

  return res.status(200).json({
    types: VISIT_TYPES,
    people,
    stores: stores
      .filter((s) => placed(s, storeKeys.get(s.id) ?? null))
      .map((s) => ({ id: s.id, name: s.name, address: address(s), lat: s.lat, lng: s.lng })),
    businesses: placedBusinesses.map((b) => ({
      id: b.id,
      storeId: b.store_id,
      name: b.name,
      address: address(b),
      lat: b.lat,
      lng: b.lng,
      contacts: b._count.contacts,
      visits: visitsByBusiness.get(b.id) ?? [],
    })),
    opportunities: placedOpportunities.map((o) => ({
      id: o.id,
      storeId: o.store_id,
      name: o.name,
      address: address(o),
      lat: o.lat,
      lng: o.lng,
      status: o.status,
    })),
    // Pins we can't draw: no address on file, or Google couldn't find it.
    unplaced: {
      businesses: businesses.filter((b) => notPlaceable(b, businessKeys.get(b.id) ?? null)).length,
      opportunities: opportunities.filter((o) => notPlaceable(o, opportunityKeys.get(o.id) ?? null)).length,
    },
    pending,
  });
}
