import type Stripe from 'stripe';

/**
 * How a saved payment method is shown on quotes, invoices and settings.
 * A card has brand, last 4 and expiry. Link (Stripe's saved-checkout
 * wallet, which people pick at Checkout) has only an email, so those
 * fields are blank and `kind` says which one it is.
 */
export type PaymentMethodSummary = {
  kind: 'card' | 'link';
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  email?: string | null;
};

/** Payment method types the app can charge and show. */
export const SUPPORTED_PAYMENT_METHOD_TYPES = ['card', 'link'] as const;

export function summarizePaymentMethod(method: Stripe.PaymentMethod | null | undefined): (PaymentMethodSummary & { id: string }) | null {
  if (!method) return null;
  if (method.card?.last4) {
    return {
      id: method.id,
      kind: 'card',
      brand: method.card.brand || 'card',
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
    };
  }
  if (method.type === 'link') {
    return { id: method.id, kind: 'link', brand: 'link', last4: '', expMonth: 0, expYear: 0, email: method.link?.email ?? null };
  }
  return null;
}

const BRAND_NAMES: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

export function brandName(brand: string): string {
  return BRAND_NAMES[brand] || brand.replace(/^\w/, (letter) => letter.toUpperCase());
}

/** "Visa ending in 4242, expires 4/2028" or "Link (name@example.com)". */
export function paymentMethodLabel(method: PaymentMethodSummary | null | undefined): string {
  if (!method) return 'No card on file';
  if (method.kind === 'link') return method.email ? `Link (${method.email})` : 'Link';
  return `${brandName(method.brand)} ending in ${method.last4}, expires ${method.expMonth}/${method.expYear}`;
}
