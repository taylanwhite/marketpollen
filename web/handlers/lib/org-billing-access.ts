export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const TRIAL_MS = 30 * 24 * 60 * 60 * 1000;

export type AccessMode = 'open' | 'trial' | 'grace' | 'trial_ended' | 'payment_locked';

export interface BillingAccess {
  mode: AccessMode;
  daysLeft: number | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
}

type AccessOrg = {
  billing_enabled?: boolean;
  subscription_status: string | null;
  trial_ends_at: Date | null;
  payment_failed_at: Date | null;
};

function daysUntil(endMs: number, now = Date.now()): number {
  return Math.ceil((endMs - now) / (24 * 60 * 60 * 1000));
}

export function isPaid(org: { subscription_status: string | null }): boolean {
  return org.subscription_status === 'active';
}

export function isTrialActive(org: AccessOrg, now = Date.now()): boolean {
  return !!org.trial_ends_at && org.trial_ends_at.getTime() > now && !isPaid(org);
}

export function billingAccess(org: AccessOrg, now = Date.now()): BillingAccess {
  const trialEndsAt = org.trial_ends_at ? org.trial_ends_at.toISOString() : null;
  const graceEndsAt = org.payment_failed_at
    ? new Date(org.payment_failed_at.getTime() + GRACE_MS).toISOString()
    : null;

  if (org.payment_failed_at && !isPaid(org)) {
    const graceEnd = org.payment_failed_at.getTime() + GRACE_MS;
    if (now >= graceEnd) {
      return { mode: 'payment_locked', daysLeft: 0, trialEndsAt, graceEndsAt };
    }
    return { mode: 'grace', daysLeft: Math.max(1, daysUntil(graceEnd, now)), trialEndsAt, graceEndsAt };
  }

  if (org.trial_ends_at && !isPaid(org)) {
    if (now >= org.trial_ends_at.getTime()) {
      return { mode: 'trial_ended', daysLeft: 0, trialEndsAt, graceEndsAt };
    }
    return { mode: 'trial', daysLeft: Math.max(1, daysUntil(org.trial_ends_at.getTime(), now)), trialEndsAt, graceEndsAt };
  }

  return { mode: 'open', daysLeft: null, trialEndsAt, graceEndsAt };
}

export function trialEndFromNow(now = new Date()): Date {
  return new Date(now.getTime() + TRIAL_MS);
}
