import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../lib/db.js';
import { getAuthUid } from '../lib/auth.js';
import { rejectIfStoreLocked } from '../lib/store-access.js';
import { MAX_STOPS_PER_DAY, findOverlaps, parseDateKey, planStopJson } from '../lib/plan-stops.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Stop id required' });

  // Only the person whose plan it is can change it.
  const stop = await prisma.planStop.findUnique({ where: { id } });
  if (!stop || stop.user_id !== uid) return res.status(404).json({ error: 'Stop not found' });
  if (await rejectIfStoreLocked(res, stop.store_id, uid)) return;

  if (req.method === 'DELETE') {
    await prisma.planStop.delete({ where: { id } });
    return res.status(204).end();
  }

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as { status?: string; date?: string };
    const data: { status?: string; plan_date?: Date; position?: number } = {};
    if (body.status !== undefined) {
      if (!['planned', 'done', 'skipped'].includes(body.status)) {
        return res.status(400).json({ error: 'status must be planned, done, or skipped' });
      }
      data.status = body.status;
    }
    if (body.date !== undefined) {
      const date = parseDateKey(body.date);
      if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      if (date.getTime() !== stop.plan_date.getTime()) {
        // Moving to another day puts the stop at the end of that day.
        const there = await prisma.planStop.findMany({
          where: { store_id: stop.store_id, user_id: uid, plan_date: date },
          select: { position: true, opportunity_id: true, business_id: true, place_id: true },
        });
        const duplicate = there.some((other) =>
          (stop.opportunity_id && other.opportunity_id === stop.opportunity_id) ||
          (stop.business_id && other.business_id === stop.business_id) ||
          (stop.place_id && other.place_id === stop.place_id),
        );
        if (duplicate) return res.status(409).json({ error: `${stop.name} is already on that day's plan` });
        if (there.length >= MAX_STOPS_PER_DAY) {
          return res.status(400).json({ error: `A day can have up to ${MAX_STOPS_PER_DAY} stops` });
        }
        data.plan_date = date;
        data.position = there.reduce((max, other) => Math.max(max, other.position + 1), 0);
        data.status = data.status ?? 'planned';
      }
    }
    const row = await prisma.planStop.update({ where: { id }, data });
    const overlaps = await findOverlaps(row.store_id, uid, [row]);
    return res.status(200).json(planStopJson(row, overlaps.get(row.id) || []));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
