function formatWhen(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Jordan Lee · Oct 8, 2026, 2:14 PM" for the contact's connected-by field. */
export function connectionValue(name?: string | null, at?: Date | string | null): string | null {
  const who = name?.trim();
  const when = at ? formatWhen(at) : null;
  if (who && when) return `${who} · ${when}`;
  return who || when;
}

type VisitLike = { date: Date | string; createdByName?: string | null };

/** The most recent visit on a contact, or null when nobody has visited yet. */
export function lastVisit<T extends VisitLike>(reachouts: T[] | undefined | null): T | null {
  let latest: T | null = null;
  let latestTime = -Infinity;
  for (const r of reachouts || []) {
    const time = new Date(r.date).getTime();
    if (!Number.isNaN(time) && time > latestTime) {
      latest = r;
      latestTime = time;
    }
  }
  return latest;
}

/** Everyone who has logged a visit on a contact. */
export function visitorNames(reachouts: VisitLike[] | undefined | null): string[] {
  return [...new Set((reachouts || []).map((r) => r.createdByName?.trim()).filter((n): n is string => !!n))];
}
