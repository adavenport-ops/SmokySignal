// Payload trimming for /api/flight-paths. Routes are statewide-plus now
// (no region clip), so each tail-day line is cleaned before it ships:
//   1. points outside TRACKING_ENVELOPE are dropped (data-quality noise)
//   2. coordinates are rounded to ROUTE_COORD_DECIMALS (~1 m)
//   3. points closer than minStepDeg to the last kept point are dropped
//      (radial-distance decimation; first and last points always kept)
//
// MapLibre's GeoJSON source then simplifies further per zoom on the
// client (its `tolerance` option), so zoomed-out views stay cheap to
// draw without a second fetch.

import { inTrackingEnvelope } from "./regions";

export const ROUTE_COORD_DECIMALS = 5;
/** ~110 m of latitude. Well under the spacing of an orbit's turn. */
export const ROUTE_MIN_STEP_DEG = 0.001;

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Clean one route. Input and output are [lon, lat] pairs in order.
 * Distance uses an equirectangular approximation (longitude scaled by
 * cos(lat)), which is exact enough at this step size.
 */
export function decimateRoute(
  coords: ReadonlyArray<readonly [number, number]>,
  minStepDeg: number = ROUTE_MIN_STEP_DEG,
): [number, number][] {
  const kept: [number, number][] = [];
  let pending: [number, number] | null = null;
  const min2 = minStepDeg * minStepDeg;
  for (const [rawLon, rawLat] of coords) {
    if (!inTrackingEnvelope(rawLat, rawLon)) continue;
    const pt: [number, number] = [
      round(rawLon, ROUTE_COORD_DECIMALS),
      round(rawLat, ROUTE_COORD_DECIMALS),
    ];
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(pt);
      continue;
    }
    const k = Math.cos((last[1] * Math.PI) / 180);
    const dx = (pt[0] - last[0]) * k;
    const dy = pt[1] - last[1];
    if (dx * dx + dy * dy >= min2) {
      kept.push(pt);
      pending = null;
    } else {
      pending = pt;
    }
  }
  // Keep the true end of the route so a line never stops short.
  if (pending) {
    const last = kept[kept.length - 1]!;
    if (last[0] !== pending[0] || last[1] !== pending[1]) kept.push(pending);
  }
  return kept;
}
