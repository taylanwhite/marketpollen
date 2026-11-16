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

/** Separates the place ID from the typed address in a business's checked key. */
const CHECKED_KEY_SEPARATOR = ' | ';

/**
 * Map key for a saved business. A business can carry both a Google place link
 * and a typed address, and they can disagree (someone linked the wrong branch,
 * or fixed the address later). With both, the key holds both, so the pin is
 * checked against the address, and editing either one looks it up again.
 */
export function businessLocationKey(row: AddressParts & { place_id?: string | null }): string | null {
  const addressKey = locationKey({ ...row, place_id: null });
  if (row.place_id && addressKey) return `place:${row.place_id}${CHECKED_KEY_SEPARATOR}${addressKey}`;
  return locationKey(row, true);
}

/** The typed-address part of a key (the whole key unless it is a checked place + address key). */
export function addressPart(key: string): string | null {
  if (!key.startsWith('place:')) return key;
  const at = key.indexOf(CHECKED_KEY_SEPARATOR);
  return at >= 0 ? key.slice(at + CHECKED_KEY_SEPARATOR.length) : null;
}

/**
 * Whether a typed street line already names its town, e.g. "1600 S Eastern
 * Ave, Moore" or "1600 S Eastern Ave Moore OK 73160". Adding the store's town
 * to one of those can move it to the wrong town.
 */
export function streetNamesTown(street: string): boolean {
  const s = street.trim();
  if (s.includes(',') || /\b\d{5}(-\d{4})?\b/.test(s)) return true;
  // Ends in a state: "… Moore OK" or "… Moore Oklahoma". The code must be
  // upper case so street endings like "St", "Dr", "Ct" aren't mistaken for one.
  const last = s.split(/\s+/).pop() || '';
  return US_STATE_CODES.has(last) || US_STATE_NAMES.some((name) => s.toLowerCase().endsWith(` ${name}`));
}

const US_STATE_CODES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '),
);
const US_STATE_NAMES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia',
  'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
  'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming',
];

/** A place link more than this far from its typed address is treated as the wrong place. */
export const PLACE_MISMATCH_M = 1_500;

export type CheckedCoords = Coords & { placeMismatch?: boolean };

/**
 * Coordinates for a location key. Returns null when Google has no match
 * (save that, so it isn't retried) and 'retry' when the lookup itself failed.
 *
 * For a checked key (place ID + typed address) both are looked up. When the
 * place is far from the address, the address wins and `placeMismatch` is set:
 * the popup shows the typed address, so the pin has to match it.
 */
export async function geocodeKey(
  key: string,
  apiKey: string,
  options: { query?: string; near?: Coords } = {},
): Promise<CheckedCoords | null | 'retry'> {
  const sep = key.startsWith('place:') ? key.indexOf(CHECKED_KEY_SEPARATOR) : -1;
  if (sep < 0) {
    const found = await geocodeOne(key, apiKey, options);
    return found && found !== 'retry' ? { lat: found.lat, lng: found.lng } : found;
  }
  const [place, address] = await Promise.all([
    geocodeOne(key.slice(0, sep), apiKey, {}),
    geocodeOne(key.slice(sep + CHECKED_KEY_SEPARATOR.length), apiKey, options),
  ]);
  if (place === 'retry' || address === 'retry') return 'retry';
  const placeCoords = place ? { lat: place.lat, lng: place.lng } : null;
  if (!address) return placeCoords;
  const addressCoords = { lat: address.lat, lng: address.lng };
  if (!placeCoords) return addressCoords;
  // The typed address overrides the place only when Google found that exact
  // address (not a loose or partial match) near the store; otherwise the
  // place link, which points at the exact business, is kept.
  const trustAddress = address.precise && (!options.near || metersBetween(addressCoords, options.near) <= ADDRESS_NEAR_STORE_M);
  if (trustAddress && metersBetween(placeCoords, addressCoords) > PLACE_MISMATCH_M) return { ...addressCoords, placeMismatch: true };
  return placeCoords;
}

/** A typed address farther than this from the store is a bad match (same limit the map uses). */
const ADDRESS_NEAR_STORE_M = 120_000;

async function geocodeOne(
  key: string,
  apiKey: string,
  options: { query?: string; near?: Coords },
): Promise<(Coords & { precise: boolean }) | null | 'retry'> {
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
    const result = res.data?.results?.[0];
    const geometry = result?.geometry;
    // "APPROXIMATE" means Google only matched a town or area, not the address.
    if (!key.startsWith('place:') && geometry?.location_type === 'APPROXIMATE') return null;
    const loc = geometry?.location;
    // The exact building or a point along the right block, matching every part typed.
    const precise = (geometry?.location_type === 'ROOFTOP' || geometry?.location_type === 'RANGE_INTERPOLATED') && !result?.partial_match;
    return loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' ? { lat: loc.lat, lng: loc.lng, precise } : null;
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
