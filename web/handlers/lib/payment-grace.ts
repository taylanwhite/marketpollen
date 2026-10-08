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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const issued = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const subscriptionChanged = (quote.currentMonthlyCents ?? 0) > 0 && quote.newMonthlyCents !== quote.currentMonthlyCents;
  const cardLine = quote.card
    ? `${brandName(quote.card.brand)} ending in ${quote.card.last4}, expires ${quote.card.expMonth}/${quote.card.expYear}`
    : 'No card on file';
  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">${label}</td>
      <td style="padding: 8px 0; font-size: 14px; color: #1a1a1a; text-align: right; font-weight: ${strong ? 700 : 600};">${value}</td>
    </tr>`;
  const text = [
    `MarketPollen invoice`,
    orgName,
    issued,
    ``,
    `${storeName}`,
    `Store subscription: ${unit} / month`,
    subscriptionChanged ? `Current subscription: ${money(quote.currentMonthlyCents)} / month` : '',
    subscriptionChanged ? `Subscription after today: ${money(quote.newMonthlyCents)} / month` : '',
    ``,
    `Due today: ${due}`,
    quote.dueTodayCents === 0 ? 'Nothing was charged.' : '',
    ``,
    `Charged to: ${cardLine}`,
  ].filter((line) => line !== undefined).join('\n');
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f5f7;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f5f7; padding: 40px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e6e8eb; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <tr>
                  <td style="padding: 28px 36px 0 36px;">
                    <span style="font-size: 20px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.2px;">
                      Market<span style="color: #d4a017;">Pollen</span>
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 36px 0 36px;">
                    <p style="margin: 0 0 4px 0; font-size: 12px; letter-spacing: 1.2px; text-transform: uppercase; color: #9096a0; font-weight: 700;">Invoice</p>
                    <h1 style="margin: 0; font-size: 22px; line-height: 1.3; font-weight: 700; color: #1a1a1a;">${escapeHtml(orgName)}</h1>
                    <p style="margin: 6px 0 0 0; font-size: 13px; color: #6b7280;">${issued}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px 36px 0 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e6e8eb; border-radius: 8px;">
                      <tr>
                        <td style="padding: 14px 16px; background-color: #fafafa; border-bottom: 1px solid #e6e8eb; font-size: 11px; letter-spacing: 0.8px; text-transform: uppercase; color: #6b7280; font-weight: 700;">Description</td>
                        <td style="padding: 14px 16px; background-color: #fafafa; border-bottom: 1px solid #e6e8eb; font-size: 11px; letter-spacing: 0.8px; text-transform: uppercase; color: #6b7280; font-weight: 700; text-align: right;">Amount</td>
                      </tr>
                      <tr>
                        <td style="padding: 16px; font-size: 15px; color: #1a1a1a; font-weight: 600;">
                          ${escapeHtml(storeName)}
                          <div style="font-size: 13px; font-weight: 400; color: #6b7280; margin-top: 2px;">Store subscription</div>
                        </td>
                        <td style="padding: 16px; font-size: 15px; color: #1a1a1a; font-weight: 600; text-align: right; white-space: nowrap;">${unit} / month</td>
                      </tr>
                      ${subscriptionChanged ? `
                      <tr>
                        <td colspan="2" style="padding: 0 16px 12px 16px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            ${row('Current subscription', `${money(quote.currentMonthlyCents)} / month`)}
                            ${row('Subscription after today', `${money(quote.newMonthlyCents)} / month`, true)}
                          </table>
                        </td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 36px 0 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #fafafa; border: 1px solid #e6e8eb; border-radius: 8px;">
                      <tr>
                        <td style="padding: 16px 18px; font-size: 15px; font-weight: 700; color: #1a1a1a;">Due today</td>
                        <td style="padding: 16px 18px; font-size: 22px; font-weight: 700; color: #1a1a1a; text-align: right;">${due}</td>
                      </tr>
                    </table>
                    ${quote.dueTodayCents === 0 ? `<p style="margin: 10px 0 0 0; font-size: 13px; color: #6b7280;">Nothing was charged.</p>` : ''}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 36px 0 36px;">
                    <p style="margin: 0 0 4px 0; font-size: 11px; letter-spacing: 0.8px; text-transform: uppercase; color: #9096a0; font-weight: 700;">Charged to</p>
                    <p style="margin: 0; font-size: 15px; font-weight: 600; color: #1a1a1a;">${escapeHtml(cardLine)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 36px 28px 36px;">
                    <div style="border-top: 1px solid #eceef0; padding-top: 16px;">
                      <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #9096a0;">
                        This invoice was sent by MarketPollen for ${escapeHtml(orgName)}.
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: fromEmail(),
    to: emails,
    subject: `Invoice for ${storeName}`,
    html,
    text,
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
