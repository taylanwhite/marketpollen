import axios from 'axios';

export type Coords = { lat: number; lng: number };

type AddressParts = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
};

/**
 * What a row's map pin is looked up from. Stored next to the coordinates as
 * `geocoded_address`, so a row whose address was edited no longer matches
 * and gets looked up again. Returns null when there is nothing to look up.
 */
export function locationKey(row: AddressParts & { place_id?: string | null }, preferPlaceId = false): string | null {
  const address = [row.address, row.city, row.state, row.zip_code]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
  const placeKey = row.place_id ? `place:${row.place_id}` : null;
  if (preferPlaceId && placeKey) return placeKey;
  return address || placeKey;
}

/**
 * Coordinates for a location key. Returns null when Google has no match
 * (save that, so it isn't retried) and 'retry' when the lookup itself failed.
 */
export async function geocodeKey(key: string, apiKey: string): Promise<Coords | null | 'retry'> {
  const params: Record<string, string> = { key: apiKey };
  if (key.startsWith('place:')) params.place_id = key.slice('place:'.length);
  else params.address = key;
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', { params, timeout: 5000 });
    const status = res.data?.status;
    if (status === 'ZERO_RESULTS' || status === 'NOT_FOUND' || status === 'INVALID_REQUEST') return null;
    if (status !== 'OK') {
      console.error('Map geocode failed:', status, res.data?.error_message);
      return 'retry';
    }
    const loc = res.data?.results?.[0]?.geometry?.location;
    return loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' ? { lat: loc.lat, lng: loc.lng } : null;
  } catch (err) {
    console.error('Map geocode error:', (err as Error)?.message);
    return 'retry';
  }
}

/** Run `work` over `items` with at most `limit` running at once. */
export async function runLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(workers);
}
