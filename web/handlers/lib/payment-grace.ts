import { Resend } from 'resend';
import { prisma } from './db.js';
import { appUrl } from './app-url.js';
import { GRACE_MS } from './org-billing-access.js';
import { getStripe } from './stripe.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function fromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || 'MarketPollen <onboarding@resend.dev>';
}

async function billingContactEmail(stripeCustomerId: string | null): Promise<string | null> {
  if (!stripeCustomerId || !process.env.STRIPE_SECRET_KEY) return null;
  try {
    const customer = await getStripe().customers.retrieve(stripeCustomerId);
    if (customer.deleted) return null;
    const email = customer.email?.trim();
    return email || null;
  } catch (err) {
    console.error('Could not load billing contact for payment reminder', err);
    return null;
  }
}

async function recipientEmails(orgId: string, createdBy: string, stripeCustomerId: string | null): Promise<string[]> {
  const billingEmail = await billingContactEmail(stripeCustomerId);
  if (billingEmail) return [billingEmail];

  const members = await prisma.organizationMember.findMany({
    where: { org_id: orgId, is_admin: true },
    select: { user: { select: { email: true, is_global_admin: true } } },
  });
  const owners = members.filter((member) => !member.user.is_global_admin).map((member) => member.user.email);
  if (owners.length > 0) return owners;
  const creator = await prisma.user.findUnique({
    where: { id: createdBy },
    select: { email: true, is_global_admin: true },
  });
  if (creator && !creator.is_global_admin) return [creator.email];
  return members.map((member) => member.user.email);
}

async function sendPaymentEmail(orgId: string, kind: 'start' | 'final'): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, created_by: true, payment_failed_at: true, stripe_customer_id: true },
  });
  if (!org?.payment_failed_at) return false;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured; payment reminder was not sent');
    return false;
  }
  const emails = await recipientEmails(orgId, org.created_by, org.stripe_customer_id);
  if (emails.length === 0) return false;

  const graceEnd = new Date(org.payment_failed_at.getTime() + GRACE_MS);
  const daysLeft = Math.max(1, Math.ceil((graceEnd.getTime() - Date.now()) / DAY_MS));
  const payUrl = `${appUrl()}/org-settings?tab=billing&org=${orgId}`;
  const subject = kind === 'final'
    ? `${org.name} pauses tomorrow`
    : `A payment didn't go through for ${org.name}`;
  const body = kind === 'final'
    ? `The card for ${org.name} still hasn't gone through. Tomorrow the account pauses until it's paid.`
    : `A payment for ${org.name} didn't go through. You have ${daysLeft} day${daysLeft === 1 ? '' : 's'} to update the card. After that, the account pauses until it's paid.`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: fromEmail(),
    to: emails,
    subject,
    text: `${body}\n\nUpdate the card: ${payUrl}\n`,
  });
  if (error) {
    console.error('Payment reminder email failed', error);
    return false;
  }
  return true;
}

/** Start the 7-day clock the first time a payment fails, and send the first reminder. */
function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function brandName(brand: string): string {
  const names: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
  };
  return names[brand] || brand.replace(/^\w/, (letter) => letter.toUpperCase());
}

export async function sendStoreInvoiceEmail(orgId: string, quote: {
  storeName?: string;
  orgName?: string;
  unitCents?: number;
  dueTodayCents: number;
  currentMonthlyCents: number;
  newMonthlyCents: number;
  periodEnd: string | null;
  card?: { brand: string; last4: string; expMonth: number; expYear: number } | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured; store invoice was not sent');
    return;
  }
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, created_by: true, stripe_customer_id: true },
  });
  if (!org) return;
  const emails = await recipientEmails(orgId, org.created_by, org.stripe_customer_id);
  if (emails.length === 0) return;

  const storeName = quote.storeName || 'Store';
  const orgName = quote.orgName || org.name;
  const unit = money(quote.unitCents ?? 0);
  const due = money(quote.dueTodayCents);
  const lines = [
    `Invoice`,
    orgName,
    new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    ``,
    storeName,
    `Store subscription          ${unit} / month`,
  ];
  if ((quote.currentMonthlyCents ?? 0) > 0 && quote.newMonthlyCents !== quote.currentMonthlyCents) {
    lines.push(`Current subscription       ${money(quote.currentMonthlyCents)} / month`);
    lines.push(`Subscription after today   ${money(quote.newMonthlyCents)} / month`);
  }
  lines.push(``, `Due today                  ${due}`);
  if (quote.dueTodayCents === 0) lines.push(`Nothing was charged.`);
  if (quote.card) {
    lines.push(
      ``,
      `Charged to`,
      `${brandName(quote.card.brand)} ending in ${quote.card.last4}, expires ${quote.card.expMonth}/${quote.card.expYear}`,
    );
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: fromEmail(),
    to: emails,
    subject: `Invoice for ${storeName}`,
    text: `${lines.join('\n')}\n`,
  });
  if (error) console.error('Store invoice email failed', error);
}

export async function recordPaymentFailure(orgId: string): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org || org.subscription_status === 'active') return;

  if (!org.payment_failed_at) {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        payment_failed_at: new Date(),
        billing_alert: 'A payment didn’t go through. You have 7 days to update the card before the account pauses.',
      },
    });
  }

  const fresh = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { payment_grace_notice_at: true },
  });
  if (fresh?.payment_grace_notice_at) return;
  const sent = await sendPaymentEmail(orgId, 'start');
  if (sent) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { payment_grace_notice_at: new Date() },
    });
  }
}

export async function clearPaymentFailure(orgId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { billing_alert: true, payment_failed_at: true },
  });
  if (!org?.payment_failed_at && !org?.billing_alert?.includes('didn’t go through') && !org?.billing_alert?.includes("didn't go through")) return;
  const alert = org.billing_alert?.includes('go through') ? null : org.billing_alert;
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      payment_failed_at: null,
      payment_grace_notice_at: null,
      payment_final_notice_at: null,
      billing_alert: alert,
    },
  });
}

export async function runPaymentGraceCheck(): Promise<{ checked: number; reminded: number }> {
  const orgs = await prisma.organization.findMany({
    where: {
      OR: [
        { payment_failed_at: { not: null } },
        { subscription_status: { in: ['past_due', 'unpaid'] } },
      ],
    },
    select: { id: true, subscription_status: true, payment_failed_at: true, payment_final_notice_at: true },
  });

  let reminded = 0;
  for (const org of orgs) {
    if (org.subscription_status === 'active') {
      await clearPaymentFailure(org.id);
      continue;
    }
    if (!org.payment_failed_at) {
      await recordPaymentFailure(org.id);
      reminded += 1;
      continue;
    }
    const graceEnd = org.payment_failed_at.getTime() + GRACE_MS;
    const now = Date.now();
    if (now >= graceEnd - DAY_MS && now < graceEnd && !org.payment_final_notice_at) {
      const sent = await sendPaymentEmail(org.id, 'final');
      if (sent) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { payment_final_notice_at: new Date() },
        });
        reminded += 1;
      }
    }
  }
  return { checked: orgs.length, reminded };
}
