export interface PlanOverlap {
  userName: string;
  date: string;
}

export interface PlanStop {
  id: string;
  storeId: string;
  userId: string;
  date: string;
  position: number;
  opportunityId: string | null;
  businessId: string | null;
  placeId: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  status: 'planned' | 'done' | 'skipped';
  overlaps: PlanOverlap[];
}

/** Google Maps cuts a directions link off past about ten places, and sooner on phones. */
export const STOPS_PER_MAPS_LEG = 9;

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shortDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = localDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === today) return 'today';
  if (key === localDateKey(tomorrow)) return 'tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Sam has this tomorrow" / "Sam and Ana have this on their plans". */
export function overlapText(overlaps: PlanOverlap[]): string {
  if (overlaps.length === 0) return '';
  if (overlaps.length === 1) return `${overlaps[0].userName} also has this ${shortDate(overlaps[0].date)}`;
  const names = Array.from(new Set(overlaps.map((o) => o.userName)));
  return `${names.join(', ')} also ${names.length === 1 ? 'has' : 'have'} this planned`;
}

export function stopAddress(stop: { address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null }): string {
  // Google places often come with the whole address in the street line already.
  const street = stop.address || '';
  const rest = [stop.city, stop.state, stop.zipCode].filter((part) => part && !street.includes(part));
  return [street, ...rest].filter(Boolean).join(', ');
}

/** One Google Maps link per leg. Each leg starts where the previous one ended. */
export function mapsLegs(origin: string, stops: string[]): string[] {
  const legs: string[] = [];
  let from = origin;
  for (let i = 0; i < stops.length; i += STOPS_PER_MAPS_LEG) {
    const leg = stops.slice(i, i + STOPS_PER_MAPS_LEG);
    const points = [from, ...leg].filter(Boolean).map(encodeURIComponent);
    legs.push(`https://www.google.com/maps/dir/${points.join('/')}`);
    from = leg[leg.length - 1];
  }
  return legs;
}
