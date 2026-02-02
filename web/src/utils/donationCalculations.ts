import { DonationData, MOUTH_VALUES, QUARTERLY_GOAL, Reachout, Contact } from '../types';

/**
 * Calculate total mouths for a single donation
 */
export function calculateMouths(donation: DonationData): number {
  return (
    (donation.freeBundletCard || 0) * MOUTH_VALUES.freeBundletCard +
    (donation.dozenBundtinis || 0) * MOUTH_VALUES.dozenBundtinis +
    (donation.cake8inch || 0) * MOUTH_VALUES.cake8inch +
    (donation.cake10inch || 0) * MOUTH_VALUES.cake10inch +
    (donation.sampleTray || 0) * MOUTH_VALUES.sampleTray +
    (donation.bundtletTower || 0) * MOUTH_VALUES.bundtletTower
  );
}

/**
 * Get the start and end dates for a quarter
 */
export function getQuarterDateRange(date: Date = new Date()): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const quarter = Math.floor(month / 3);
  
  const startMonth = quarter * 3;
  const endMonth = startMonth + 2;
  
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, endMonth + 1, 0, 23, 59, 59, 999); // Last day of end month
  
  return { start, end };
}

/**
 * Get the current quarter label (e.g., "Q1 2026")
 */
export function getCurrentQuarterLabel(date: Date = new Date()): string {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `Q${quarter} ${date.getFullYear()}`;
}

/**
 * Check if a date falls within the current quarter
 */
export function isInCurrentQuarter(date: Date, referenceDate: Date = new Date()): boolean {
  const { start, end } = getQuarterDateRange(referenceDate);
  return date >= start && date <= end;
}

/**
 * Extract all reachouts with donations from contacts, optionally filtered by store and quarter
 */
export function getReachoutsWithDonations(
  contacts: Contact[],
  options?: {
    storeId?: string;
    quarterDate?: Date;
  }
): Array<{ contact: Contact; reachout: Reachout; mouths: number }> {
  const results: Array<{ contact: Contact; reachout: Reachout; mouths: number }> = [];
  const { start, end } = options?.quarterDate 
    ? getQuarterDateRange(options.quarterDate) 
    : { start: null, end: null };

  for (const contact of contacts) {
    for (const reachout of contact.reachouts) {
      // Skip if no donation
      if (!reachout.donation) continue;

      // Filter by store if specified
      if (options?.storeId && reachout.storeId !== options.storeId) continue;

      // Filter by quarter if specified
      if (start && end) {
        const reachoutDate = reachout.date instanceof Date ? reachout.date : new Date(reachout.date);
        if (reachoutDate < start || reachoutDate > end) continue;
      }

      results.push({
        contact,
        reachout,
        mouths: calculateMouths(reachout.donation),
      });
    }
  }

  // Sort by date descending (most recent first)
  results.sort((a, b) => {
    const dateA = a.reachout.date instanceof Date ? a.reachout.date : new Date(a.reachout.date);
    const dateB = b.reachout.date instanceof Date ? b.reachout.date : new Date(b.reachout.date);
    return dateB.getTime() - dateA.getTime();
  });

  return results;
}

/**
 * Calculate total mouths for a store in the current quarter
 */
export function getQuarterProgress(
  contacts: Contact[],
  storeId: string,
  quarterDate: Date = new Date()
): { totalMouths: number; goal: number; percentage: number } {
  const donations = getReachoutsWithDonations(contacts, { storeId, quarterDate });
  const totalMouths = donations.reduce((sum, d) => sum + d.mouths, 0);
  
  return {
    totalMouths,
    goal: QUARTERLY_GOAL,
    percentage: Math.min((totalMouths / QUARTERLY_GOAL) * 100, 100),
  };
}

/**
 * Get progress color based on how on-track we are for the quarter
 * Gold/success: >= 75% of expected pace (brand yellow)
 * Warning: 50-75% of expected pace
 * Error: < 50% of expected pace
 */
export function getProgressColor(percentage: number, quarterDate: Date = new Date()): 'success' | 'warning' | 'error' {
  // Calculate expected progress based on how far into the quarter we are
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
 * Create an empty donation data object
 */
export function createEmptyDonation(): DonationData {
  return {
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
}
