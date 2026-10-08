export const STORE_UNIT_CENTS = 6500;

export const STORE_PAUSED_MESSAGE =
  'This store is paused. You can look through what is already here, but nothing can be added or changed until the store is turned back on.';

export const STORE_ARCHIVED_MESSAGE =
  'This store is archived. You can look through contacts, businesses, and past visits, but nothing can be changed.';

export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function longDate(value: Date): string {
  return value.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function monthlyCents(storeCount: number, unitCents = STORE_UNIT_CENTS): number {
  return Math.max(0, storeCount) * unitCents;
}

type QuoteInput = {
  storeName: string;
  currentMonthlyCents: number;
  newMonthlyCents: number;
  dueTodayCents: number;
  periodEnd: Date | null;
};

export function addStoreMessage(input: QuoteInput): string {
  const name = input.storeName;
  const added = input.newMonthlyCents - input.currentMonthlyCents;
  if (added <= 0) return `Add ${name}. No additional cost.`;
  if (input.dueTodayCents > 0 && input.dueTodayCents !== added) {
    return `Add ${name}. Cost ${money(added)} a month. ${money(input.dueTodayCents)} due today.`;
  }
  return `Add ${name}. Cost ${money(added)} a month.`;
}

export function resumeStoreMessage(input: QuoteInput): string {
  const name = input.storeName;
  const from = money(input.currentMonthlyCents);
  const to = money(input.newMonthlyCents);
  if (input.dueTodayCents > 0) {
    return `Turning ${name} back on raises the monthly total from ${from} to ${to}. You'll be charged ${money(input.dueTodayCents)} today for the days left in this month.`;
  }
  if (input.periodEnd) {
    return `Turning ${name} back on doesn't add a charge today. You're already paying for this spot through ${longDate(input.periodEnd)}. The monthly total stays ${from}.`;
  }
  return `Turning ${name} back on doesn't add a charge today. The monthly total stays ${from}.`;
}

export function pauseStoreMessage(input: QuoteInput): string {
  const name = input.storeName;
  const from = money(input.currentMonthlyCents);
  const to = money(input.newMonthlyCents);
  const date = input.periodEnd ? longDate(input.periodEnd) : 'the end of this month';
  return `${name} stays open through ${date}, which is the end of the month already paid for. Nothing is charged today. On ${date} it locks, and it comes off the next subscription. The monthly total goes from ${from} to ${to}. You can keep it open any time before ${date} and the subscription stays the same.`;
}

export function keepOpenMessage(input: QuoteInput & { otherPausesRemain: boolean }): string {
  const name = input.storeName;
  const current = money(input.currentMonthlyCents);
  if (input.otherPausesRemain && input.periodEnd) {
    return `${name} stays open. Nothing is charged today. The monthly total stays ${current} until ${longDate(input.periodEnd)}. The next subscription charge will be ${money(input.newMonthlyCents)}.`;
  }
  return `${name} stays open. Nothing is charged today, and the monthly total stays ${current}.`;
}

export function archiveStoreMessage(input: QuoteInput): string {
  const name = input.storeName;
  if (!input.periodEnd) {
    return `Archive ${name}? It will leave the store list. Contacts, businesses, and past visits stay under Archived, and nothing is erased.`;
  }
  const from = money(input.currentMonthlyCents);
  const to = money(input.newMonthlyCents);
  const date = longDate(input.periodEnd);
  if (from === to) {
    return `Archive ${name}? It will leave the store list now. Contacts, businesses, and past visits stay under Archived. You've already paid through ${date}, and the next subscription charge stays ${to}.`;
  }
  return `Archive ${name}? It will leave the store list now. Contacts, businesses, and past visits stay under Archived. You've already paid through ${date}, so nothing is refunded. It comes off the next subscription, and the monthly total goes from ${from} to ${to}.`;
}

export function deleteStoreMessage(input: QuoteInput): string {
  const name = input.storeName;
  const from = money(input.currentMonthlyCents);
  const to = money(input.newMonthlyCents);
  const date = input.periodEnd ? longDate(input.periodEnd) : 'the next subscription renewal';
  if (!input.periodEnd) {
    return `Remove ${name}? The store and everything in it are deleted now. This cannot be undone.`;
  }
  return `Remove ${name}? The store and everything in it are deleted now. You've already paid through ${date}, so nothing is refunded. ${name} comes off the next subscription, and the monthly total goes from ${from} to ${to}.`;
}

export function scheduledPauseBanner(storeName: string, pauseOn: Date, currentMonthlyCents: number, nextMonthlyCents: number): string {
  return `${storeName} stays open through ${longDate(pauseOn)}. After that it locks, and it comes off the next subscription. The monthly total goes from ${money(currentMonthlyCents)} to ${money(nextMonthlyCents)}.`;
}

export function pausedBanner(storeName: string, unitCents = STORE_UNIT_CENTS): string {
  return `${storeName} is paused. The last paid month has ended, so this store is locked and it isn't on the subscription. You can look through contacts and past visits. Turning it back on adds ${money(unitCents)} a month.`;
}
