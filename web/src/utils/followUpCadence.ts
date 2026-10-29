export const FOLLOW_UP_CADENCES: Array<{ days: number; label: string }> = [
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Every month' },
  { days: 60, label: 'Every 2 months' },
  { days: 90, label: 'Every 3 months' },
  { days: 180, label: 'Every 6 months' },
  { days: 365, label: 'Every year' },
];

export const MAX_FOLLOW_UP_DAYS = 730;

export function cadenceText(days?: number | null): string {
  if (!days) return '';
  return FOLLOW_UP_CADENCES.find((option) => option.days === days)?.label || `Every ${days} days`;
}

export type FollowUpSchedule = { everyDays: number | null; assignee: string };
