export const STORE_UNIT_CENTS = 6500;

export const STORE_PAUSED_MESSAGE =
  'This store is paused. You can look through what is already here, but nothing can be added or changed until the store is turned back on.';

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
  const from = money(input.currentMonthlyCents);
  const to = money(input.newMonthlyCents);
  if (input.dueTodayCents > 0) {
    return `Adding ${name} raises the monthly total from ${from} to ${to}. You'll be charged ${money(input.dueTodayCents)} today for the days left in this month.`;
  }
  if (input.periodEnd) {
    return `Adding ${name} doesn't change what you pay today. This organization is already paying for this store through ${longDate(input.periodEnd)}. The monthly total stays ${from}.`;
  }
  return `Adding ${name} doesn't change the monthly total. It stays ${from}.`;
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
  return `${name} stays open through ${date}, which is the end of the month already paid for. Nothing is charged today. On ${date} it locks, and it comes off the next bill. The monthly total goes from ${from} to ${to}. You can keep it open any time before ${date} and the bill stays the same.`;
}

export function keepOpenMessage(input: QuoteInput & { otherPausesRemain: boolean }): string {
  const name = input.storeName;
  const current = money(input.currentMonthlyCents);
  if (input.otherPausesRemain && input.periodEnd) {
    return `${name} stays open. Nothing is charged today. The monthly total stays ${current} until ${longDate(input.periodEnd)}. The next bill will be ${money(input.newMonthlyCents)}.`;
  }
  return `${name} stays open. Nothing is charged today, and the monthly total stays ${current}.`;
}

export function deleteStoreMessage(input: QuoteInput): string {
  const name = input.storeName;
  const from = money(input.currentMonthlyCents);
  const to = money(input.newMonthlyCents);
  const date = input.periodEnd ? longDate(input.periodEnd) : 'the next bill';
  if (!input.periodEnd) {
    return `Remove ${name}? The store and everything in it are deleted now. This cannot be undone.`;
  }
  return `Remove ${name}? The store and everything in it are deleted now. You've already paid through ${date}, so nothing is refunded. ${name} comes off the next bill, and the monthly total goes from ${from} to ${to}.`;
}

export function scheduledPauseBanner(storeName: string, pauseOn: Date, currentMonthlyCents: number, nextMonthlyCents: number): string {
  return `${storeName} stays open through ${longDate(pauseOn)}. After that it locks, and it comes off the next bill. The monthly total goes from ${money(currentMonthlyCents)} to ${money(nextMonthlyCents)}.`;
}

export function pausedBanner(storeName: string): string {
  return `${storeName} is paused. The last paid month has ended, so this store is locked and it isn't on the bill. You can look through contacts and past visits. Turning it back on adds ${money(STORE_UNIT_CENTS)} a month.`;
}
