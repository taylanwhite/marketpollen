import { VercelRequest, VercelResponse } from '@vercel/node';
import { runPaymentGraceCheck } from './lib/payment-grace.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await runPaymentGraceCheck();
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Billing check failed';
    return res.status(500).json({ error: message });
  }
}
