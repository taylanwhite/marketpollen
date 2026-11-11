import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/db.js';
import { getAuthUid } from './lib/auth.js';
import { CURRENT_TERMS_VERSION } from './lib/legal.js';

/**
 * POST /api/legal/accept — records that the signed-in user clicked "I agree"
 * to the current Terms of Service and Privacy Policy. Keeps a row per click
 * (with IP and browser) as proof, and marks the user as accepted.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const body = (req.body || {}) as { version?: string };
  if (body.version !== CURRENT_TERMS_VERSION) {
    return res.status(409).json({ error: 'The terms were updated. Reload the page and accept the latest version.' });
  }

  const user = await prisma.user.findUnique({ where: { id: uid }, select: { email: true } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || null;
  const userAgent = (req.headers['user-agent'] as string | undefined)?.slice(0, 500) ?? null;
  const now = new Date();

  await prisma.$transaction([
    prisma.legalAcceptance.create({
      data: {
        user_id: uid,
        email: user.email,
        version: CURRENT_TERMS_VERSION,
        accepted_at: now,
        ip_address: ip,
        user_agent: userAgent,
      },
    }),
    prisma.user.update({
      where: { id: uid },
      data: { terms_accepted_version: CURRENT_TERMS_VERSION, terms_accepted_at: now },
    }),
  ]);

  return res.status(200).json({ termsVersion: CURRENT_TERMS_VERSION, termsAccepted: true });
}
