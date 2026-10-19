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
