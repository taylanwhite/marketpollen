import { randomBytes } from 'crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { canAccessStore, canViewStore, rejectIfStoreLocked } from '../../lib/store-access.js';

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function feedUrl(req: VercelRequest, token: string): string {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || 'https';
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const origin = host ? `${proto}://${host}` : '';
  return `${origin}/api/calendar-feed/${token}.ics`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const id = (req.query?.id as string)?.trim();
  if (!id) return res.status(400).json({ error: 'Store id required' });

  if (req.method === 'GET') {
    if (!(await canViewStore(uid, id))) return res.status(404).json({ error: 'Store not found' });
  } else if (!(await canAccessStore(uid, id))) {
    return res.status(404).json({ error: 'Store not found' });
  } else if (await rejectIfStoreLocked(res, id)) {
    return;
  }

  const store = await prisma.store.findUnique({
    where: { id },
    select: { id: true, name: true, calendar_feed_token: true },
  });
  if (!store) return res.status(404).json({ error: 'Store not found' });

  if (req.method === 'GET') {
    let token = store.calendar_feed_token;
    if (!token) {
      token = newToken();
      await prisma.store.update({ where: { id }, data: { calendar_feed_token: token } });
    }
    return res.status(200).json({ url: feedUrl(req, token), storeName: store.name });
  }

  if (req.method === 'POST') {
    const token = newToken();
    await prisma.store.update({ where: { id }, data: { calendar_feed_token: token } });
    return res.status(200).json({ url: feedUrl(req, token), storeName: store.name });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
