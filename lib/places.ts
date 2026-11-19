// Plain-language place names for a coordinate. Pure, client-safe.
//
// The gazetteer is every named place on the lib/corridor.ts corridors
// (de-duplicated by name), so "near Puyallup" uses the same spelling as the
// corridor labels. Points far from any of them fall back to the region
// label from lib/regions.ts ("Olympic Peninsula", "Central WA").

import { haversineNm } from "./geo";
import { CORRIDORS, type CorridorPlace } from "./corridor";
import { REGIONS, regionForPoint } from "./regions";

/** Places further than this are not used for "near X". */
export const PLACE_NEAR_NM = 12;

function buildGazetteer(): CorridorPlace[] {
  const seen = new Map<string, CorridorPlace>();
  for (const c of CORRIDORS) {
    for (const p of c.places) {
      if (!seen.has(p.name)) seen.set(p.name, p);
    }
  }
  return [...seen.values()];
}

export const PLACES: ReadonlyArray<CorridorPlace> = buildGazetteer();

/** Closest named place within `maxNm`, or null. */
export function nearestPlaceName(
  lat: number,
  lon: number,
  maxNm = PLACE_NEAR_NM,
  places: ReadonlyArray<CorridorPlace> = PLACES,
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: CorridorPlace | null = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = haversineNm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best && bestD <= maxNm ? best.name : null;
}

/**
 * A name for the area a point sits in: the nearest named place when one
 * is close, else the region label. Null only for non-finite input.
 */
export function areaName(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const place = nearestPlaceName(lat, lon);
  if (place) return place;
  const region = regionForPoint(lat, lon);
  return region ? REGIONS[region].label : null;
}
