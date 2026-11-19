/**
 * A saved payment method as the server sends it. Link (Stripe's saved
 * checkout wallet) has only an email; `kind` is missing on older replies,
 * which were always cards.
 */
export type PaymentMethodSummary = {
  kind?: 'card' | 'link';
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  email?: string | null;
};

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

/** Main line, e.g. "Visa ending in 4242" or "Link". */
export function paymentMethodTitle(method: PaymentMethodSummary): string {
  if (method.kind === 'link') return 'Link';
  return `${brandName(method.brand)} ending in ${method.last4}`;
}

/** Second line, e.g. "expires 4/2028" or the Link email. */
export function paymentMethodDetail(method: PaymentMethodSummary): string {
  if (method.kind === 'link') return method.email || '';
  return `expires ${method.expMonth}/${method.expYear}`;
}
