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
 * and gets looked up again.
 *
 * Returns null when there is nothing precise to look up: a row with only a
 * city (no street address and no Google place ID) gets no pin, since the best
 * anyone could do is the middle of a town.
 */
export function locationKey(row: AddressParts & { place_id?: string | null }, preferPlaceId = false): string | null {
  const placeKey = row.place_id ? `place:${row.place_id}` : null;
  if (preferPlaceId && placeKey) return placeKey;
  if (!row.address?.trim()) return placeKey;
  return [row.address, row.city, row.state, row.zip_code]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Coordinates for a location key. Returns null when Google has no match
 * (save that, so it isn't retried) and 'retry' when the lookup itself failed.
 */
export async function geocodeKey(
  key: string,
  apiKey: string,
  options: { query?: string; near?: Coords } = {},
): Promise<Coords | null | 'retry'> {
  const params: Record<string, string> = { key: apiKey };
  if (key.startsWith('place:')) {
    params.place_id = key.slice('place:'.length);
  } else {
    params.address = options.query || key;
    params.region = 'us';
    // Prefer matches around the store (about 35 miles each way).
    if (options.near) {
      const d = 0.5;
      params.bounds = `${options.near.lat - d},${options.near.lng - d}|${options.near.lat + d},${options.near.lng + d}`;
    }
  }
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', { params, timeout: 5000 });
    const status = res.data?.status;
    if (status === 'ZERO_RESULTS' || status === 'NOT_FOUND' || status === 'INVALID_REQUEST') return null;
    if (status !== 'OK') {
      console.error('Map geocode failed:', status, res.data?.error_message);
      return 'retry';
    }
    const geometry = res.data?.results?.[0]?.geometry;
    // "APPROXIMATE" means Google only matched a town or area, not the address.
    if (!key.startsWith('place:') && geometry?.location_type === 'APPROXIMATE') return null;
    const loc = geometry?.location;
    return loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' ? { lat: loc.lat, lng: loc.lng } : null;
  } catch (err) {
    console.error('Map geocode error:', (err as Error)?.message);
    return 'retry';
  }
}

/** Straight-line distance in meters. */
export function metersBetween(a: Coords, b: Coords): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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
