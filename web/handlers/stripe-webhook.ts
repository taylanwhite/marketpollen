import { VercelRequest, VercelResponse } from '@vercel/node';
import { applyStripeEvent, BillingHttpError, constructStripeEvent } from './lib/billing.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signatureHeader = req.headers['stripe-signature'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!signature || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  try {
    const event = constructStripeEvent(req.body, signature);
    await applyStripeEvent(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    if (err instanceof BillingHttpError) {
      return res.status(err.status).json(err.body);
    }
    const message = err instanceof Error ? err.message : 'Webhook failed';
    console.error('Stripe webhook failed:', message);
    return res.status(400).json({ error: message });
  }
}
