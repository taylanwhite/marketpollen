import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { canAccessStore, canViewStore, rejectIfStoreLocked } from './lib/store-access.js';
import { isOrgAdmin } from './lib/org-access.js';
import {
  MAX_STOPS_PER_DAY,
  dateKey,
  findOverlaps,
  loadPlan,
  optimizePlan,
  parseDateKey,
  planStopJson,
} from './lib/plan-stops.js';

/** Organization admins supervise everyone's plans in their stores. Everyone else sees only their own. */
async function canSeeTeamPlans(uid: string, storeId: string): Promise<boolean> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { organization_id: true } });
  return !!store?.organization_id && await isOrgAdmin(uid, store.organization_id);
}

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
  };
  const storeId = ((req.query?.storeId as string) || body.storeId || '').trim();
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  if (req.method === 'GET') {
    if (!(await canViewStore(uid, storeId))) return res.status(404).json({ error: 'Store not found' });
    const requestedUser = ((req.query?.userId as string) || '').trim();
    const teamView = await canSeeTeamPlans(uid, storeId);
    const viewingUserId = requestedUser && teamView ? requestedUser : uid;

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

    let people: Array<{ id: string; name: string }> = [];
    if (teamView) {
      const members = await prisma.storePermission.findMany({
        where: { store_id: storeId },
        include: { user: { select: { id: true, display_name: true, email: true } } },
      });
      people = members
        .map((member) => ({ id: member.user.id, name: member.user.display_name || member.user.email }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return res.status(200).json({ stops, viewingUserId, editable: viewingUserId === uid, people });
  }

  // Every change is to your own plan.
  if (!(await canAccessStore(uid, storeId))) return res.status(404).json({ error: 'Store not found' });
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
      where: { store_id: storeId, user_id: uid, plan_date: date },
      select: { id: true, position: true, opportunity_id: true, business_id: true, place_id: true },
    });
    const already = existing.find((stop) =>
      (source!.opportunity_id && stop.opportunity_id === source!.opportunity_id) ||
      (source!.business_id && stop.business_id === source!.business_id) ||
      (source!.place_id && stop.place_id === source!.place_id),
    );
    if (already) return res.status(409).json({ error: `${source.name} is already on this day's plan` });
    if (existing.length >= MAX_STOPS_PER_DAY) {
      return res.status(400).json({ error: `A day can have up to ${MAX_STOPS_PER_DAY} stops` });
    }

    const row = await prisma.planStop.create({
      data: {
        ...source,
        store_id: storeId,
        user_id: uid,
        plan_date: date,
        position: existing.reduce((max, stop) => Math.max(max, stop.position + 1), 0),
      },
    });
    const overlaps = await findOverlaps(storeId, uid, [row]);
    return res.status(201).json(planStopJson(row, overlaps.get(row.id) || []));
  }

  if (req.method === 'PUT') {
    if (body.optimize) {
      const done = await optimizePlan(storeId, uid, date);
      if (!done) return res.status(400).json({ error: 'Add the store address to sort stops by distance' });
    } else if (Array.isArray(body.orderedIds)) {
      const mine = await prisma.planStop.findMany({
        where: { store_id: storeId, user_id: uid, plan_date: date },
        select: { id: true },
      });
      const mineIds = new Set(mine.map((stop) => stop.id));
      const ordered = body.orderedIds.filter((id) => mineIds.has(id));
      await prisma.$transaction(ordered.map((id, index) =>
        prisma.planStop.update({ where: { id }, data: { position: index } }),
      ));
    }
    return res.status(200).json({ stops: await loadPlan(storeId, uid, date) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
