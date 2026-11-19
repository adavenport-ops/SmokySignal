// Geographic helpers — kept tiny and focused.

const EARTH_RADIUS_NM = 3440.065; // nautical miles

/** Haversine distance between two lat/lon points, in nautical miles. */
export function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_NM * c;
}

/** Initial great-circle bearing from point 1 to point 2, degrees 0..360 (0 = north). */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dLam = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const COMPASS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** 8-point compass label for a bearing in degrees. */
export function compass8(deg: number): (typeof COMPASS_8)[number] {
  const norm = ((deg % 360) + 360) % 360;
  return COMPASS_8[Math.round(norm / 45) % 8]!;
}

/** Default fallback speed limit when we don't have road geocoding yet. */
export const DEFAULT_SPEED_LIMIT_MPH = 60;
