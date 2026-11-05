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
// Kept in step with MAX_CADENCE_NOTE and MAX_CADENCES_PER_CONTACT in handlers/lib/follow-up.ts.
export const MAX_CADENCE_NOTE = 300;
export const MAX_CADENCES_PER_CONTACT = 10;

export function cadenceText(days?: number | null): string {
  if (!days) return '';
  return FOLLOW_UP_CADENCES.find((option) => option.days === days)?.label || `Every ${days} days`;
}

/** A repeating follow-up as saved on a contact. */
export type FollowUpCadence = { id: string; everyDays: number; note: string | null; assignee: string | null; nextDate: Date | string | null };

/**
 * One row in the schedule editor. New rows get their id here, so saving twice
 * (or an offline save sent again) updates the same schedule instead of adding another.
 */
export type FollowUpCadenceDraft = { id: string; everyDays: number; note: string; assignee: string; nextDate?: Date | string | null };

export function newDraft(): FollowUpCadenceDraft {
  return { id: crypto.randomUUID(), everyDays: 30, note: '', assignee: '' };
}

export function toDrafts(cadences: FollowUpCadence[] | undefined | null): FollowUpCadenceDraft[] {
  return (cadences || []).map((c) => ({ id: c.id, everyDays: c.everyDays, note: c.note || '', assignee: c.assignee || '', nextDate: c.nextDate }));
}

/** What the contact PATCH takes. */
export function toPayload(drafts: FollowUpCadenceDraft[]) {
  return drafts.map((d) => ({ id: d.id, everyDays: d.everyDays, note: d.note.trim() || null, assignee: d.assignee || null }));
}

/** True when the editor rows differ from what is saved. */
export function draftsChanged(drafts: FollowUpCadenceDraft[], saved: FollowUpCadence[] | undefined | null): boolean {
  return JSON.stringify(toPayload(drafts)) !== JSON.stringify(toPayload(toDrafts(saved)));
}
