const WORK_LAT = 39.995623;
const WORK_LON = 66.232659;
const MAX_DISTANCE_METERS = 50;

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceFromWork(lat: number, lon: number): number {
  return Math.round(haversineDistance(WORK_LAT, WORK_LON, lat, lon));
}

export function isAtWork(lat: number, lon: number): boolean {
  return distanceFromWork(lat, lon) <= MAX_DISTANCE_METERS;
}

export function googleMapsLink(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat},${lon}`;
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=uz`;
    const res = await fetch(url, {
      headers: { "User-Agent": "TelegramBot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("Geocode failed");
    const json = (await res.json()) as { display_name?: string };
    return json.display_name || `${lat}, ${lon}`;
  } catch {
    return `${lat}, ${lon}`;
  }
}
