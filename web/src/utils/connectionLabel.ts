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
