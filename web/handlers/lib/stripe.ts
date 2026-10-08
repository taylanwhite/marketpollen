import Stripe from 'stripe';

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_STORE_PRICE_ID);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY.');
  }
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

export function storePriceId(): string {
  const priceId = process.env.STRIPE_STORE_PRICE_ID;
  if (!priceId) {
    throw new Error('Stripe is not configured. Set STRIPE_STORE_PRICE_ID.');
  }
  return priceId;
}

export function integrationIdentifier(prefix: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${suffix}`;
}
