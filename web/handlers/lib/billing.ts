import Stripe from 'stripe';
import { prisma } from './db.js';
import { appUrl } from './app-url.js';
import { getStripe, integrationIdentifier, storePriceId, stripeConfigured } from './stripe.js';
import {
  STORE_UNIT_CENTS,
  addStoreMessage,
  deleteStoreMessage,
  keepOpenMessage,
  money,
  pauseStoreMessage,
  resumeStoreMessage,
} from './billing-copy.js';

export class BillingHttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = { error: message, ...extra };
  }
}

export type BillingQuote = {
  intent: 'add_store' | 'resume_store' | 'pause_store' | 'keep_open' | 'delete_store';
  needsCharge: boolean;
  needsCheckout: boolean;
  message: string;
  dueTodayCents: number;
  currentMonthlyCents: number;
  newMonthlyCents: number;
  periodEnd: string | null;
};

type OrgRecord = NonNullable<Awaited<ReturnType<typeof loadOrg>>>;

async function loadOrg(orgId: string) {
  return prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      stores: {
        select: { id: true, name: true, billing_status: true, pause_on: true },
        orderBy: { name: 'asc' },
      },
    },
  });
}

export async function settleDuePauses(orgId: string): Promise<void> {
  await prisma.store.updateMany({
    where: {
      organization_id: orgId,
      billing_status: 'pause_scheduled',
      pause_on: { lte: new Date() },
    },
    data: { billing_status: 'paused' },
  });
}

function seatCounts(stores: Array<{ billing_status: string }>) {
  const active = stores.filter((store) => store.billing_status === 'active').length;
  const scheduled = stores.filter((store) => store.billing_status === 'pause_scheduled').length;
  return {
    active,
    scheduled,
    seatsInUse: active + scheduled,
    renewSeats: active,
  };
}

function priceOf(item: Stripe.SubscriptionItem): string | null {
  const price = item.price;
  return price?.id ?? null;
}

function periodEndOf(sub: Stripe.Subscription): Date | null {
  const itemEnd = sub.items.data[0]?.current_period_end;
  const legacyEnd = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  const end = itemEnd || legacyEnd;
  return end ? new Date(end * 1000) : null;
}

function scheduledRenewal(org: { paid_quantity: number; renewal_quantity: number | null }): number {
  return org.renewal_quantity ?? org.paid_quantity;
}

async function setRenewal(orgId: string, paid: number, next: number): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { renewal_quantity: next >= paid ? null : Math.max(0, next) },
  });
}

export async function persistSubscription(orgId: string, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id ?? null;
  const paid = item?.quantity ?? 0;
  const existing = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { renewal_quantity: true },
  });
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_subscription_item_id: item?.id ?? null,
      stripe_price_id: item ? priceOf(item) : null,
      stripe_schedule_id: scheduleId,
      subscription_status: sub.status,
      paid_quantity: paid,
      current_period_end: periodEndOf(sub),
      ...(existing?.renewal_quantity != null && existing.renewal_quantity >= paid
        ? { renewal_quantity: null }
        : {}),
    },
  });
  if (sub.status === 'active') await settleDuePauses(orgId);
}

async function findOrgForSubscription(sub: Stripe.Subscription) {
  const bySub = await prisma.organization.findFirst({ where: { stripe_subscription_id: sub.id } });
  if (bySub) return bySub;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const byCustomer = await prisma.organization.findFirst({ where: { stripe_customer_id: customerId } });
  if (byCustomer) return byCustomer;
  const orgId = sub.metadata?.organizationId;
  if (!orgId) return null;
  return prisma.organization.findUnique({ where: { id: orgId } });
}

function prorationDue(invoice: Stripe.Invoice): number {
  let sum = 0;
  let found = false;
  for (const line of invoice.lines.data) {
    if (line.parent?.subscription_item_details?.proration) {
      found = true;
      sum += line.amount;
    }
  }
  if (found) return Math.max(0, sum);
  return Math.max(0, invoice.amount_due);
}

async function previewIncrease(org: OrgRecord, newQuantity: number): Promise<number> {
  if (newQuantity <= org.paid_quantity) return 0;
  if (!org.stripe_customer_id || !org.stripe_subscription_id || !org.stripe_subscription_item_id) {
    throw new BillingHttpError(500, 'The monthly bill is missing a payment record. Start it again from organization settings.');
  }
  const stripe = getStripe();
  const invoice = await stripe.invoices.createPreview({
    customer: org.stripe_customer_id,
    subscription: org.stripe_subscription_id,
    subscription_details: {
      items: [{ id: org.stripe_subscription_item_id, quantity: newQuantity }],
      proration_behavior: 'always_invoice',
    },
  });
  return prorationDue(invoice);
}

async function alignRenewal(orgId: string): Promise<void> {
  const org = await loadOrg(orgId);
  if (!org?.stripe_subscription_id || org.subscription_status !== 'active') return;
  if (!stripeConfigured()) return;

  const stripe = getStripe();
  const price = org.stripe_price_id || storePriceId();
  const renewSeats = scheduledRenewal(org);
  const paid = org.paid_quantity;

  const releaseSchedule = async () => {
    if (!org.stripe_schedule_id) return;
    try {
      await stripe.subscriptionSchedules.release(org.stripe_schedule_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (!/released|no such subscription schedule/i.test(message)) throw err;
    }
    await prisma.organization.update({ where: { id: orgId }, data: { stripe_schedule_id: null } });
    org.stripe_schedule_id = null;
  };

  if (renewSeats <= 0) {
    await releaseSchedule();
    await stripe.subscriptions.update(org.stripe_subscription_id, {
      cancel_at_period_end: true,
      proration_behavior: 'none',
    });
    return;
  }

  const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  if (sub.cancel_at_period_end) {
    await releaseSchedule();
    await stripe.subscriptions.update(org.stripe_subscription_id, {
      cancel_at_period_end: false,
      proration_behavior: 'none',
    });
  }

  if (renewSeats >= paid) {
    await releaseSchedule();
    return;
  }

  let scheduleId = org.stripe_schedule_id;
  if (!scheduleId) {
    const created = await stripe.subscriptionSchedules.create({
      from_subscription: org.stripe_subscription_id,
    });
    scheduleId = created.id;
    await prisma.organization.update({ where: { id: orgId }, data: { stripe_schedule_id: scheduleId } });
  }

  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const now = Math.floor(Date.now() / 1000);
  const current = schedule.phases.find((phase) => phase.start_date <= now && phase.end_date > now) ?? schedule.phases[0];
  if (!current?.end_date) return;

  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: 'release',
    proration_behavior: 'none',
    phases: [
      {
        items: [{ price, quantity: paid }],
        start_date: current.start_date,
        end_date: current.end_date,
        proration_behavior: 'none',
      },
      {
        items: [{ price, quantity: renewSeats }],
        proration_behavior: 'none',
      },
    ],
  });
}

async function raisePaidQuantity(org: OrgRecord, idempotencyKey?: string): Promise<void> {
  if (!org.stripe_subscription_id || !org.stripe_subscription_item_id) {
    throw new BillingHttpError(500, 'The monthly bill is missing a payment record. Start it again from organization settings.');
  }
  const stripe = getStripe();
  const nextPaid = org.paid_quantity + 1;
  await setRenewal(org.id, nextPaid, scheduledRenewal(org) + 1);
  if (org.stripe_schedule_id) {
    try {
      await stripe.subscriptionSchedules.release(org.stripe_schedule_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (!/released|no such subscription schedule/i.test(message)) throw err;
    }
    await prisma.organization.update({ where: { id: org.id }, data: { stripe_schedule_id: null } });
  }
  try {
    const updated = await stripe.subscriptions.update(
      org.stripe_subscription_id,
      {
        items: [{ id: org.stripe_subscription_item_id, quantity: nextPaid }],
        proration_behavior: 'always_invoice',
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    await persistSubscription(org.id, updated);
  } catch (err) {
    await alignRenewal(org.id);
    throw err;
  }
}

function quoteBase(org: OrgRecord, dueTodayCents: number, newMonthlyCents: number): Omit<BillingQuote, 'intent' | 'message' | 'needsCharge' | 'needsCheckout'> {
  return {
    dueTodayCents,
    currentMonthlyCents: org.paid_quantity * STORE_UNIT_CENTS,
    newMonthlyCents,
    periodEnd: org.current_period_end ? org.current_period_end.toISOString() : null,
  };
}

function checkoutQuote(storeName: string): BillingQuote {
  return {
    intent: 'add_store',
    needsCharge: false,
    needsCheckout: true,
    message: `${storeName} can't be added until this organization starts a monthly bill. Each store is $65 a month. You can start that from organization settings.`,
    dueTodayCents: 0,
    currentMonthlyCents: 0,
    newMonthlyCents: STORE_UNIT_CENTS,
    periodEnd: null,
  };
}

function requireActiveBill(org: OrgRecord, storeName = 'This store'): BillingQuote | null {
  if (!org.billing_enabled) return null;
  if (!stripeConfigured()) {
    throw new BillingHttpError(500, 'Monthly billing is not configured yet. Add the Stripe key and the store price.');
  }
  if (org.subscription_status !== 'active') return checkoutQuote(storeName);
  return null;
}

export async function quoteAddStore(orgId: string, storeName: string): Promise<BillingQuote | null> {
  await settleDuePauses(orgId);
  const org = await loadOrg(orgId);
  if (!org) throw new BillingHttpError(404, 'Organization not found');
  if (!org.billing_enabled) return null;
  const name = storeName.trim() || 'this store';
  const blocked = requireActiveBill(org, name);
  if (blocked) return blocked;
  const { seatsInUse } = seatCounts(org.stores);
  const periodEnd = org.current_period_end;
  if (seatsInUse + 1 <= org.paid_quantity) {
    const current = org.paid_quantity * STORE_UNIT_CENTS;
    return {
      intent: 'add_store',
      needsCharge: false,
      needsCheckout: false,
      message: addStoreMessage({
        storeName: name,
        currentMonthlyCents: current,
        newMonthlyCents: current,
        dueTodayCents: 0,
        periodEnd,
      }),
      ...quoteBase(org, 0, current),
    };
  }
  const due = await previewIncrease(org, org.paid_quantity + 1);
  const next = (org.paid_quantity + 1) * STORE_UNIT_CENTS;
  return {
    intent: 'add_store',
    needsCharge: true,
    needsCheckout: false,
    message: addStoreMessage({
      storeName: name,
      currentMonthlyCents: org.paid_quantity * STORE_UNIT_CENTS,
      newMonthlyCents: next,
      dueTodayCents: due,
      periodEnd,
    }),
    ...quoteBase(org, due, next),
  };
}

export async function commitAddStoreCharge(input: {
  orgId: string;
  storeName: string;
  confirmCharge: boolean;
  expectedDueCents?: number;
  idempotencyKey?: string;
}): Promise<{ charged: boolean }> {
  const quote = await quoteAddStore(input.orgId, input.storeName);
  if (quote?.needsCheckout) {
    throw new BillingHttpError(402, quote.message, { needsCheckout: true, quote });
  }
  if (!quote || !quote.needsCharge) return { charged: false };
  if (!input.confirmCharge) {
    throw new BillingHttpError(409, quote.message, { quote });
  }
  if (input.expectedDueCents !== undefined && Math.abs(input.expectedDueCents - quote.dueTodayCents) > 50) {
    throw new BillingHttpError(409, `The amount due today is now ${money(quote.dueTodayCents)}. Please confirm that amount.`, { quote });
  }
  const org = await loadOrg(input.orgId);
  if (!org) throw new BillingHttpError(404, 'Organization not found');
  await raisePaidQuantity(org, input.idempotencyKey);
  await alignRenewal(input.orgId);
  return { charged: true };
}

export async function noteStoreAdded(orgId: string | null, charged: boolean): Promise<void> {
  if (!orgId) return;
  if (!charged) {
    const org = await loadOrg(orgId);
    if (org?.subscription_status === 'active' && org.renewal_quantity != null && org.renewal_quantity < org.paid_quantity) {
      const seatsBefore = seatCounts(org.stores).seatsInUse - 1;
      if (seatsBefore >= org.renewal_quantity) {
        await setRenewal(org.id, org.paid_quantity, org.renewal_quantity + 1);
      }
    }
  }
  await alignRenewal(orgId);
}

export async function afterStoreDeleted(orgId: string | null, previousStatus: string): Promise<void> {
  if (!orgId) return;
  const org = await loadOrg(orgId);
  if (org?.billing_enabled && org.subscription_status === 'active' && previousStatus === 'active') {
    await setRenewal(org.id, org.paid_quantity, scheduledRenewal(org) - 1);
  }
  await alignRenewal(orgId);
}

export async function quotePauseStore(storeId: string): Promise<BillingQuote> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.organization_id) {
    throw new BillingHttpError(400, 'Pause is available once this organization is on a monthly bill.');
  }
  await settleDuePauses(store.organization_id);
  const org = await loadOrg(store.organization_id);
  if (!org?.billing_enabled || org.subscription_status !== 'active' || !org.current_period_end) {
    throw new BillingHttpError(400, 'Pause is available once this organization is on a monthly bill.');
  }
  const fresh = org.stores.find((row) => row.id === storeId);
  if (!fresh || fresh.billing_status === 'paused') {
    throw new BillingHttpError(400, `${store.name} is already paused.`);
  }
  const alreadyScheduled = fresh.billing_status === 'pause_scheduled';
  const nextCount = alreadyScheduled ? scheduledRenewal(org) : Math.max(0, scheduledRenewal(org) - 1);
  const current = org.paid_quantity * STORE_UNIT_CENTS;
  const next = nextCount * STORE_UNIT_CENTS;
  return {
    intent: 'pause_store',
    needsCharge: false,
    needsCheckout: false,
    message: pauseStoreMessage({
      storeName: store.name,
      currentMonthlyCents: current,
      newMonthlyCents: next,
      dueTodayCents: 0,
      periodEnd: org.current_period_end,
    }),
    ...quoteBase(org, 0, next),
  };
}

export async function pauseStore(storeId: string): Promise<BillingQuote> {
  const quote = await quotePauseStore(storeId);
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.organization_id) throw new BillingHttpError(404, 'Store not found');
  const org = await loadOrg(store.organization_id);
  if (!org?.current_period_end) throw new BillingHttpError(400, 'Pause is available once this organization is on a monthly bill.');
  if (store.billing_status !== 'pause_scheduled') {
    await setRenewal(org.id, org.paid_quantity, scheduledRenewal(org) - 1);
    await prisma.store.update({
      where: { id: storeId },
      data: { billing_status: 'pause_scheduled', pause_on: org.current_period_end },
    });
    await alignRenewal(org.id);
  }
  return quote;
}

export async function quoteKeepOpen(storeId: string): Promise<BillingQuote> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.organization_id) throw new BillingHttpError(404, 'Store not found');
  await settleDuePauses(store.organization_id);
  const org = await loadOrg(store.organization_id);
  if (!org) throw new BillingHttpError(404, 'Organization not found');
  const fresh = org.stores.find((row) => row.id === storeId);
  if (!fresh || fresh.billing_status !== 'pause_scheduled') {
    throw new BillingHttpError(400, `${store.name} is not set to pause.`);
  }
  const nextCount = Math.min(org.paid_quantity, scheduledRenewal(org) + 1);
  const otherReductions = nextCount < org.paid_quantity;
  const current = org.paid_quantity * STORE_UNIT_CENTS;
  const next = nextCount * STORE_UNIT_CENTS;
  return {
    intent: 'keep_open',
    needsCharge: false,
    needsCheckout: false,
    message: keepOpenMessage({
      storeName: store.name,
      currentMonthlyCents: current,
      newMonthlyCents: otherReductions ? next : current,
      dueTodayCents: 0,
      periodEnd: org.current_period_end,
      otherPausesRemain: otherReductions,
    }),
    ...quoteBase(org, 0, otherReductions ? next : current),
  };
}

export async function keepStoreOpen(storeId: string): Promise<BillingQuote> {
  const quote = await quoteKeepOpen(storeId);
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.organization_id) throw new BillingHttpError(404, 'Store not found');
  const org = await loadOrg(store.organization_id);
  if (!org) throw new BillingHttpError(404, 'Organization not found');
  await setRenewal(org.id, org.paid_quantity, scheduledRenewal(org) + 1);
  await prisma.store.update({
    where: { id: storeId },
    data: { billing_status: 'active', pause_on: null },
  });
  await alignRenewal(store.organization_id);
  return quote;
}

export async function quoteResumeStore(storeId: string): Promise<BillingQuote> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.organization_id) throw new BillingHttpError(404, 'Store not found');
  await settleDuePauses(store.organization_id);
  const org = await loadOrg(store.organization_id);
  if (!org) throw new BillingHttpError(404, 'Organization not found');
  const blocked = requireActiveBill(org, store.name);
  if (blocked) return { ...blocked, intent: 'resume_store' };
  const fresh = org.stores.find((row) => row.id === storeId);
  if (!fresh || fresh.billing_status !== 'paused') {
    throw new BillingHttpError(400, `${store.name} is not paused.`);
  }
  const { seatsInUse } = seatCounts(org.stores);
  const periodEnd = org.current_period_end;
  if (seatsInUse + 1 <= org.paid_quantity) {
    const current = org.paid_quantity * STORE_UNIT_CENTS;
    return {
      intent: 'resume_store',
      needsCharge: false,
      needsCheckout: false,
      message: resumeStoreMessage({
        storeName: store.name,
        currentMonthlyCents: current,
        newMonthlyCents: current,
        dueTodayCents: 0,
        periodEnd,
      }),
      ...quoteBase(org, 0, current),
    };
  }
  const due = await previewIncrease(org, org.paid_quantity + 1);
  const next = (org.paid_quantity + 1) * STORE_UNIT_CENTS;
  return {
    intent: 'resume_store',
    needsCharge: true,
    needsCheckout: false,
    message: resumeStoreMessage({
      storeName: store.name,
      currentMonthlyCents: org.paid_quantity * STORE_UNIT_CENTS,
      newMonthlyCents: next,
      dueTodayCents: due,
      periodEnd,
    }),
    ...quoteBase(org, due, next),
  };
}

export async function resumeStore(input: {
  storeId: string;
  confirmCharge: boolean;
  expectedDueCents?: number;
  idempotencyKey?: string;
}): Promise<BillingQuote> {
  const quote = await quoteResumeStore(input.storeId);
  if (quote.needsCheckout) throw new BillingHttpError(402, quote.message, { needsCheckout: true, quote });
  if (quote.needsCharge) {
    if (!input.confirmCharge) throw new BillingHttpError(409, quote.message, { quote });
    if (input.expectedDueCents !== undefined && Math.abs(input.expectedDueCents - quote.dueTodayCents) > 50) {
      throw new BillingHttpError(409, `The amount due today is now ${money(quote.dueTodayCents)}. Please confirm that amount.`, { quote });
    }
    const store = await prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store?.organization_id) throw new BillingHttpError(404, 'Store not found');
    const org = await loadOrg(store.organization_id);
    if (!org) throw new BillingHttpError(404, 'Organization not found');
    await raisePaidQuantity(org, input.idempotencyKey);
  }
  const store = await prisma.store.findUnique({ where: { id: input.storeId } });
  if (!store?.organization_id) throw new BillingHttpError(404, 'Store not found');
  if (!quote.needsCharge) {
    const org = await loadOrg(store.organization_id);
    if (org?.subscription_status === 'active' && org.renewal_quantity != null && org.renewal_quantity < org.paid_quantity) {
      const seatsBefore = seatCounts(org.stores).seatsInUse;
      if (seatsBefore >= org.renewal_quantity) {
        await setRenewal(org.id, org.paid_quantity, org.renewal_quantity + 1);
      }
    }
  }
  await prisma.store.update({
    where: { id: input.storeId },
    data: { billing_status: 'active', pause_on: null },
  });
  await alignRenewal(store.organization_id);
  return quote;
}

export async function quoteDeleteStore(storeId: string): Promise<BillingQuote> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new BillingHttpError(404, 'Store not found');
  if (!store.organization_id) {
    return {
      intent: 'delete_store',
      needsCharge: false,
      needsCheckout: false,
      message: deleteStoreMessage({
        storeName: store.name,
        currentMonthlyCents: 0,
        newMonthlyCents: 0,
        dueTodayCents: 0,
        periodEnd: null,
      }),
      dueTodayCents: 0,
      currentMonthlyCents: 0,
      newMonthlyCents: 0,
      periodEnd: null,
    };
  }
  await settleDuePauses(store.organization_id);
  const org = await loadOrg(store.organization_id);
  if (!org?.billing_enabled || org.subscription_status !== 'active') {
    return {
      intent: 'delete_store',
      needsCharge: false,
      needsCheckout: false,
      message: deleteStoreMessage({
        storeName: store.name,
        currentMonthlyCents: 0,
        newMonthlyCents: 0,
        dueTodayCents: 0,
        periodEnd: null,
      }),
      dueTodayCents: 0,
      currentMonthlyCents: 0,
      newMonthlyCents: 0,
      periodEnd: null,
    };
  }
  const fresh = org.stores.find((row) => row.id === storeId);
  const dropping = fresh?.billing_status === 'active';
  const nextCount = dropping ? Math.max(0, scheduledRenewal(org) - 1) : scheduledRenewal(org);
  const current = org.paid_quantity * STORE_UNIT_CENTS;
  const next = nextCount * STORE_UNIT_CENTS;
  return {
    intent: 'delete_store',
    needsCharge: false,
    needsCheckout: false,
    message: deleteStoreMessage({
      storeName: store.name,
      currentMonthlyCents: current,
      newMonthlyCents: next,
      dueTodayCents: 0,
      periodEnd: org.current_period_end,
    }),
    ...quoteBase(org, 0, next),
  };
}

export async function billingView(orgId: string) {
  await settleDuePauses(orgId);
  const org = await loadOrg(orgId);
  if (!org) return null;
  const monthlyCents = org.paid_quantity * STORE_UNIT_CENTS;
  const nextMonthlyCents = (org.subscription_status === 'active' ? scheduledRenewal(org) : 0) * STORE_UNIT_CENTS;
  return {
    enabled: org.billing_enabled,
    status: org.subscription_status,
    paidQuantity: org.paid_quantity,
    storeCount: org.stores.length,
    monthlyCents,
    monthlyLabel: money(monthlyCents),
    nextMonthlyCents,
    nextMonthlyLabel: money(nextMonthlyCents),
    currentPeriodEnd: org.current_period_end,
    alert: org.billing_alert,
    needsCheckout: org.billing_enabled && org.subscription_status !== 'active',
    minimumQuantity: Math.max(1, org.stores.length),
    configured: stripeConfigured(),
    unitLabel: money(STORE_UNIT_CENTS),
  };
}

export async function createCheckout(orgId: string, quantity: number): Promise<string> {
  if (!stripeConfigured()) {
    throw new BillingHttpError(500, 'Monthly billing is not configured yet. Add the Stripe key and the store price.');
  }
  const org = await loadOrg(orgId);
  if (!org) throw new BillingHttpError(404, 'Organization not found');
  if (!org.billing_enabled) {
    throw new BillingHttpError(400, 'Turn on monthly billing for this organization before starting the bill.');
  }
  if (org.subscription_status === 'active') {
    throw new BillingHttpError(400, 'This organization already has a monthly bill.');
  }
  const minimum = Math.max(1, org.stores.length);
  if (!Number.isInteger(quantity) || quantity < minimum) {
    throw new BillingHttpError(400, `Start with at least ${minimum} ${minimum === 1 ? 'store' : 'stores'}. Each one is $65 a month.`);
  }

  const stripe = getStripe();
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { organizationId: org.id },
    });
    customerId = customer.id;
    await prisma.organization.update({ where: { id: org.id }, data: { stripe_customer_id: customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: org.id,
    line_items: [{ price: storePriceId(), quantity }],
    success_url: `${appUrl()}/org-settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/org-settings?billing=cancel`,
    metadata: { organizationId: org.id },
    subscription_data: { metadata: { organizationId: org.id } },
    integration_identifier: integrationIdentifier('org-subscribe'),
  });
  if (!session.url) throw new BillingHttpError(500, 'Stripe did not return a checkout link.');
  return session.url;
}

export async function createPortal(orgId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org?.stripe_customer_id) {
    throw new BillingHttpError(400, 'Start the monthly bill before updating the card.');
  }
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${appUrl()}/org-settings`,
  });
  return session.url;
}

export async function setBillingEnabled(orgId: string, enabled: boolean): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new BillingHttpError(404, 'Organization not found');
  if (!enabled && org.subscription_status === 'active') {
    throw new BillingHttpError(400, 'This organization is already on a monthly bill.');
  }
  await prisma.organization.update({ where: { id: orgId }, data: { billing_enabled: enabled } });
}

export async function syncCheckoutSession(orgId: string, sessionId: string): Promise<void> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const referenced = session.client_reference_id || session.metadata?.organizationId;
  if (referenced && referenced !== orgId) {
    throw new BillingHttpError(400, 'That payment belongs to a different organization.');
  }
  if (session.mode !== 'subscription' || session.status !== 'complete') return;
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return;
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subId) return;
  const sub = await stripe.subscriptions.retrieve(subId);
  await persistSubscription(orgId, sub);
}

async function subscriptionIdFromCharge(chargeId: string): Promise<string | null> {
  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(chargeId);
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return null;
  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    limit: 1,
  });
  const invoiceRef = payments.data[0]?.invoice;
  if (!invoiceRef || (typeof invoiceRef !== 'string' && 'deleted' in invoiceRef && invoiceRef.deleted)) return null;
  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef.id;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}

async function setAlertForSubscription(subscriptionId: string, alert: string): Promise<void> {
  await prisma.organization.updateMany({
    where: { stripe_subscription_id: subscriptionId },
    data: { billing_alert: alert },
  });
}

export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== 'subscription') return;
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return;
    const orgId = session.client_reference_id || session.metadata?.organizationId;
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!orgId || !subId) return;
    const sub = await stripe.subscriptions.retrieve(subId);
    await persistSubscription(orgId, sub);
    return;
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const org = await findOrgForSubscription(sub);
    if (!org) return;
    await persistSubscription(org.id, sub);
    return;
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subRef = invoice.parent?.subscription_details?.subscription;
    const subId = !subRef ? null : typeof subRef === 'string' ? subRef : subRef.id;
    if (!subId) return;
    const sub = await stripe.subscriptions.retrieve(subId);
    const org = await findOrgForSubscription(sub);
    if (!org) return;
    await persistSubscription(org.id, sub);
    if (event.type === 'invoice.payment_failed') {
      await prisma.organization.update({
        where: { id: org.id },
        data: { billing_alert: "The last payment didn't go through. Update the card so new stores can be added. Stores you already have stay open." },
      });
    } else if (org.billing_alert?.includes("didn't go through")) {
      await prisma.organization.update({ where: { id: org.id }, data: { billing_alert: null } });
    }
    return;
  }

  if (event.type === 'charge.dispute.created' || event.type === 'charge.refunded' || event.type === 'radar.early_fraud_warning.created') {
    let chargeId: string | null = null;
    if (event.type === 'charge.dispute.created') {
      const dispute = event.data.object as Stripe.Dispute;
      chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null;
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      chargeId = charge.id;
    } else {
      const warning = event.data.object as Stripe.Radar.EarlyFraudWarning;
      chargeId = typeof warning.charge === 'string' ? warning.charge : warning.charge?.id ?? null;
    }
    if (!chargeId) return;
    const subId = await subscriptionIdFromCharge(chargeId);
    if (!subId) return;
    const alert = event.type === 'charge.dispute.created'
      ? 'A bank disputed a recent payment. Stores stay open. Update the card from organization settings if the payment needs to be made again.'
      : event.type === 'charge.refunded'
        ? 'A recent payment was refunded.'
        : 'The card on file was flagged. Update the card before the next bill so new stores can keep being added.';
    await setAlertForSubscription(subId, alert);
  }
}

export function constructStripeEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new BillingHttpError(500, 'Stripe webhook secret is not configured.');
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}
