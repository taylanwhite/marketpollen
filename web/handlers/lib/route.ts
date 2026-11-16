import axios from 'axios';

/** Haversine distance in meters */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function geocode(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  if (!address.trim()) return null;
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: address.trim(), key: apiKey },
      timeout: 5000,
    });
    if (res.data?.status !== 'OK' && res.data?.status !== 'ZERO_RESULTS') return null;
    const loc = res.data?.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null;
  }
}

/** Nearest-neighbor route: start at the store, then keep going to the closest stop not yet visited. */
export function orderByNearest<T extends { lat: number; lng: number }>(
  storeLat: number,
  storeLng: number,
  opportunities: T[],
): T[] {
  if (opportunities.length === 0) return [];
  const withCoords = opportunities.map((o) => ({ ...o, lat: o.lat, lng: o.lng }));
  const ordered: typeof withCoords = [];
  let currentLat = storeLat;
  let currentLng = storeLng;
  let remaining = [...withCoords];
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = distanceMeters(currentLat, currentLng, remaining[0].lat, remaining[0].lng);
    for (let i = 1; i < remaining.length; i++) {
      const d = distanceMeters(currentLat, currentLng, remaining[i].lat, remaining[i].lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const next = remaining[nearestIdx];
    ordered.push(next);
    currentLat = next.lat;
    currentLng = next.lng;
    remaining = remaining.filter((_, i) => i !== nearestIdx);
  }
  return ordered;
}

export type LatLng = { lat: number; lng: number };

const meters = (a: LatLng, b: LatLng) => distanceMeters(a.lat, a.lng, b.lat, b.lng);

/** Straight-line length of store → stops in this order → store. */
function loopLength(start: LatLng, stops: LatLng[]): number {
  let total = 0;
  let at = start;
  for (const stop of stops) {
    total += meters(at, stop);
    at = stop;
  }
  return total + meters(at, start);
}

/**
 * Where to put a new stop in a store → stops → store loop so it adds the
 * least distance. Returns the index to insert at (0 = first stop).
 */
export function cheapestInsertion(start: LatLng, stops: LatLng[], added: LatLng): number {
  let best = stops.length;
  let bestCost = Infinity;
  for (let i = 0; i <= stops.length; i++) {
    const before = i === 0 ? start : stops[i - 1];
    const after = i === stops.length ? start : stops[i];
    const cost = meters(before, added) + meters(added, after) - meters(before, after);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}

/**
 * A short store → stops → store loop by straight-line distance: nearest
 * neighbor to start, then 2-opt (reverse any stretch that makes it shorter).
 * Returns the stop indexes in driving order.
 */
export function roundTripByDistance(start: LatLng, stops: LatLng[]): number[] {
  const order = orderByNearest(start.lat, start.lng, stops.map((s, index) => ({ ...s, index }))).map((s) => s.index);
  const at = (o: number[]) => o.map((i) => stops[i]);
  let improved = true;
  for (let pass = 0; improved && pass < 50; pass++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (loopLength(start, at(next)) + 1 < loopLength(start, at(order))) {
          order.splice(0, order.length, ...next);
          improved = true;
        }
      }
    }
  }
  return order;
}
