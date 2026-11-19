// "Near me" sorting for /circling. Pure and client-safe. The rider's
// position never leaves the browser: the page computes distances here and
// never puts the coordinates in a request.

import { haversineNm } from "./geo";

export const MI_PER_NM = 1.150779;
/** Radius for the honest "nothing circling within N miles" line. */
export const NEAR_ME_MILES = 15;

export function distanceMi(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  return haversineNm(a.lat, a.lon, b.lat, b.lon) * MI_PER_NM;
}

export type WithDistance<T> = T & { distanceMi: number };

/** Items nearest first, each tagged with its distance in statute miles. */
export function sortByDistance<T extends { lat: number; lon: number }>(
  items: ReadonlyArray<T>,
  me: { lat: number; lon: number },
): WithDistance<T>[] {
  return items
    .map((it) => ({ ...it, distanceMi: distanceMi(me, it) }))
    .sort((a, b) => a.distanceMi - b.distanceMi);
}

/** How many of the (distance-tagged) items sit within `miles`. */
export function countWithin(
  items: ReadonlyArray<{ distanceMi: number }>,
  miles = NEAR_ME_MILES,
): number {
  return items.filter((i) => i.distanceMi <= miles).length;
}

/** "4.2 mi" under 10 miles, whole miles beyond. */
export function fmtMiles(mi: number): string {
  if (!Number.isFinite(mi)) return "—";
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}
