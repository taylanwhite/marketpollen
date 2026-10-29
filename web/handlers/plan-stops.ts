import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore, canViewStore, rejectIfStoreLocked } from './lib/store-access.js';
import {
  MAX_STOPS_PER_DAY,
  canSeeTeamPlans,
  dateKey,
  findOverlaps,
  loadPlan,
  optimizePlan,
  parseDateKey,
  planOwnerFor,
  planPeople,
  planStopJson,
  userNames,
} from './lib/plan-stops.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const body = (req.body || {}) as {
    storeId?: string;
    date?: string;
    opportunityId?: string;
    businessId?: string;
    orderedIds?: string[];
    optimize?: boolean;
    /** Whose plan to change. Organization admins can name a teammate. */
    userId?: string;
  };
  const storeId = ((req.query?.storeId as string) || body.storeId || '').trim();
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  if (req.method === 'GET') {
    if (!(await canViewStore(uid, storeId))) return res.status(404).json({ error: 'Store not found' });
    const requestedUser = ((req.query?.userId as string) || '').trim();
    const teamView = await canSeeTeamPlans(uid, storeId);
    const viewingUserId = requestedUser && teamView ? requestedUser : uid;

    // Who can be assigned stops, for the "Add to plan" picker.
    if (req.query?.people === '1') {
      return res.status(200).json({ canAssign: teamView, people: teamView ? await planPeople(storeId) : [] });
    }

    // Month summary: how many stops each day has, for the calendar dots.
    const from = parseDateKey(req.query?.from as string);
    const to = parseDateKey(req.query?.to as string);
    if (from && to) {
      const rows = await prisma.planStop.groupBy({
        by: ['plan_date'],
        where: { store_id: storeId, user_id: viewingUserId, plan_date: { gte: from, lte: to } },
        _count: { _all: true },
      });
      return res.status(200).json({
        days: Object.fromEntries(rows.map((row) => [dateKey(row.plan_date), row._count._all])),
      });
    }

    const date = parseDateKey(req.query?.date as string);
    if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const stops = await loadPlan(storeId, viewingUserId, date);

    const people = teamView ? await planPeople(storeId) : [];
    // Admins can change a teammate's plan, so they can assign and rearrange stops.
    const editable = viewingUserId === uid ? await canAccessStore(uid, storeId) : teamView;
    return res.status(200).json({ stops, viewingUserId, editable, people });
  }

  // Changes go to your own plan, or a teammate's when an admin assigns work.
  const owner = await planOwnerFor(uid, storeId, body.userId);
  if (!owner) return res.status(403).json({ error: 'Only organization admins can plan stops for someone else' });
  if (owner === uid && !(await canAccessStore(uid, storeId))) return res.status(404).json({ error: 'Store not found' });
  if (await rejectIfStoreLocked(res, storeId, uid)) return;
  const date = parseDateKey(body.date);
  if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  if (req.method === 'POST') {
    let source: {
      opportunity_id: string | null;
      business_id: string | null;
      place_id: string | null;
      name: string;
      address: string | null;
      city: string | null;
      state: string | null;
      zip_code: string | null;
    } | null = null;
    if (body.opportunityId) {
      const opp = await prisma.opportunity.findFirst({ where: { id: body.opportunityId, store_id: storeId } });
      if (opp) {
        source = {
          opportunity_id: opp.id,
          business_id: opp.business_id,
          place_id: opp.place_id,
          name: opp.name,
          address: opp.address,
          city: opp.city,
          state: opp.state,
          zip_code: opp.zip_code,
        };
      }
    } else if (body.businessId) {
      const biz = await prisma.business.findFirst({ where: { id: body.businessId, store_id: storeId } });
      if (biz) {
        source = {
          opportunity_id: null,
          business_id: biz.id,
          place_id: biz.place_id,
          name: biz.name,
          address: biz.address,
          city: biz.city,
          state: biz.state,
          zip_code: biz.zip_code,
        };
      }
    }
    if (!source) return res.status(404).json({ error: 'That place is no longer in this store' });

    const existing = await prisma.planStop.findMany({
      where: { store_id: storeId, user_id: owner, plan_date: date },
      select: { id: true, position: true, opportunity_id: true, business_id: true, place_id: true },
    });
    const already = existing.find((stop) =>
      (source!.opportunity_id && stop.opportunity_id === source!.opportunity_id) ||
      (source!.business_id && stop.business_id === source!.business_id) ||
      (source!.place_id && stop.place_id === source!.place_id),
    );
    if (already) return res.status(409).json({ error: `${source.name} is already on that day's plan` });
    if (existing.length >= MAX_STOPS_PER_DAY) {
      return res.status(400).json({ error: `A day can have up to ${MAX_STOPS_PER_DAY} stops` });
    }

    const row = await prisma.planStop.create({
      data: {
        ...source,
        store_id: storeId,
        user_id: owner,
        plan_date: date,
        position: existing.reduce((max, stop) => Math.max(max, stop.position + 1), 0),
        assigned_by: owner === uid ? null : uid,
      },
    });
    const overlaps = await findOverlaps(storeId, owner, [row]);
    const names = await userNames([row.assigned_by]);
    return res.status(201).json(planStopJson(row, overlaps.get(row.id) || [], (row.assigned_by && names.get(row.assigned_by)) || null));
  }

  if (req.method === 'PUT') {
    if (body.optimize) {
      const done = await optimizePlan(storeId, owner, date);
      if (!done) return res.status(400).json({ error: 'Add the store address to sort stops by distance' });
    } else if (Array.isArray(body.orderedIds)) {
      const mine = await prisma.planStop.findMany({
        where: { store_id: storeId, user_id: owner, plan_date: date },
        select: { id: true },
      });
      const mineIds = new Set(mine.map((stop) => stop.id));
      const ordered = body.orderedIds.filter((id) => mineIds.has(id));
      await prisma.$transaction(ordered.map((id, index) =>
        prisma.planStop.update({ where: { id }, data: { position: index } }),
      ));
    }
    return res.status(200).json({ stops: await loadPlan(storeId, owner, date) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
