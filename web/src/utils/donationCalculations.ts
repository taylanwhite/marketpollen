import { DonationData, MOUTH_VALUES, QUARTERLY_GOAL, Reachout, Contact, CampaignProduct, SLUG_TO_FIELD } from '../types';

/**
 * Calculate total mouths for a single donation using dynamic product config.
 * Falls back to hardcoded MOUTH_VALUES when no products are provided.
 */
export function calculateMouths(donation: DonationData, products?: CampaignProduct[]): number {
  if (!products || products.length === 0) {
    return (
      (donation.freeBundletCard || 0) * MOUTH_VALUES.freeBundletCard +
      (donation.dozenBundtinis || 0) * MOUTH_VALUES.dozenBundtinis +
      (donation.cake8inch || 0) * MOUTH_VALUES.cake8inch +
      (donation.cake10inch || 0) * MOUTH_VALUES.cake10inch +
      (donation.sampleTray || 0) * MOUTH_VALUES.sampleTray +
      (donation.bundtletTower || 0) * MOUTH_VALUES.bundtletTower
    );
  }

  let total = 0;
  for (const product of products) {
    if (!product.isActive) continue;

    let qty = 0;
    const field = SLUG_TO_FIELD[product.slug];
    if (field) {
      qty = (donation[field] as number) || 0;
    } else if (donation.customItems) {
      qty = donation.customItems[product.id] || 0;
    }

    total += qty * product.mouthValue;
  }
  return total;
}

export function getQuarterDateRange(date: Date = new Date()): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const quarter = Math.floor(month / 3);
  
  const startMonth = quarter * 3;
  const endMonth = startMonth + 2;
  
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, endMonth + 1, 0, 23, 59, 59, 999);
  
  return { start, end };
}

export function getCurrentQuarterLabel(date: Date = new Date()): string {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `Q${quarter} ${date.getFullYear()}`;
}

export function isInCurrentQuarter(date: Date, referenceDate: Date = new Date()): boolean {
  const { start, end } = getQuarterDateRange(referenceDate);
  return date >= start && date <= end;
}

export function getReachoutsWithDonations(
  contacts: Contact[],
  options?: {
    quarterDate?: Date;
  },
  products?: CampaignProduct[]
): Array<{ contact: Contact; reachout: Reachout; mouths: number }> {
  const results: Array<{ contact: Contact; reachout: Reachout; mouths: number }> = [];
  const { start, end } = options?.quarterDate 
    ? getQuarterDateRange(options.quarterDate) 
    : { start: null, end: null };

  for (const contact of contacts) {
    for (const reachout of contact.reachouts) {
      if (!reachout.donation) continue;

      if (start && end) {
        const reachoutDate = reachout.date instanceof Date ? reachout.date : new Date(reachout.date);
        if (reachoutDate < start || reachoutDate > end) continue;
      }

      results.push({
        contact,
        reachout,
        mouths: calculateMouths(reachout.donation, products),
      });
    }
  }

  results.sort((a, b) => {
    const dateA = a.reachout.date instanceof Date ? a.reachout.date : new Date(a.reachout.date);
    const dateB = b.reachout.date instanceof Date ? b.reachout.date : new Date(b.reachout.date);
    return dateB.getTime() - dateA.getTime();
  });

  return results;
}

/**
 * Calculate progress for a store in the current quarter.
 * Uses dynamic storeGoal and products when provided.
 */
export function getQuarterProgress(
  contacts: Contact[],
  quarterDate: Date = new Date(),
  products?: CampaignProduct[],
  storeGoal?: number
): { totalMouths: number; goal: number; percentage: number } {
  const donations = getReachoutsWithDonations(contacts, { quarterDate }, products);
  const totalMouths = donations.reduce((sum, d) => sum + d.mouths, 0);
  const goal = storeGoal ?? QUARTERLY_GOAL;
  
  return {
    totalMouths,
    goal,
    percentage: goal > 0 ? (totalMouths / goal) * 100 : 0,
  };
}

export function getProgressColor(percentage: number, quarterDate: Date = new Date()): 'success' | 'warning' | 'error' {
  const { start, end } = getQuarterDateRange(quarterDate);
  const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  const daysPassed = (quarterDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  const expectedPercentage = (daysPassed / totalDays) * 100;

  const paceRatio = percentage / expectedPercentage;

  if (paceRatio >= 0.75) return 'success';
  if (paceRatio >= 0.5) return 'warning';
  return 'error';
}

/**
 * Create an empty donation data object. Uses dynamic products to include
 * empty customItems for custom products.
 */
export function createEmptyDonation(products?: CampaignProduct[]): DonationData {
  const base: DonationData = {
    freeBundletCard: 0,
    dozenBundtinis: 0,
    cake8inch: 0,
    cake10inch: 0,
    sampleTray: 0,
    bundtletTower: 0,
    cakesDonatedNotes: '',
    orderedFromUs: false,
    followedUp: false,
  };

  if (products) {
    const customProducts = products.filter(p => p.isActive && !p.reachoutColumn);
    if (customProducts.length > 0) {
      base.customItems = {};
      for (const p of customProducts) {
        base.customItems[p.id] = 0;
      }
    }
  }

  return base;
}
