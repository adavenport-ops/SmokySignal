// Zoom-adaptive paint for the /radar heat grid and flight paths.
//
// The data is statewide-plus, so the map has to read at three scales:
//   z5-7   state / Everything: heat as soft regional glow, routes as
//          thin low-opacity threads so "where they fly" shows at a glance
//   z8-10  region (Puget Sound fit lands around z8-9)
//   z11+   corridor detail, unchanged from the pre-statewide tuning
//
// Stops live here as plain data so they can be unit-tested (MapLibre
// throws at render time if interpolate stops are not strictly
// ascending) and evaluated without a map.

import type { ExpressionSpecification } from "maplibre-gl";

/** [zoom, value] pairs, zoom strictly ascending. */
export type ZoomStops = ReadonlyArray<readonly [number, number]>;

/** Heat blob radius in px. Below z9 the cells are under 3 px apart, so a
 *  modest radius already merges them; past z12 the radius has to outrun
 *  cell spacing (~97 px at z14) or the grid pattern shows. */
export const HEAT_RADIUS_STOPS: ZoomStops = [
  [4, 5],
  [6, 8],
  [8, 16],
  [9, 26],
  [12, 70],
  [14, 140],
  [15, 200],
  [18, 400],
];

/** Heat intensity. Zoomed out, thousands of cells stack inside one blob
 *  radius, so intensity drops to keep only true hot spots at the top of
 *  the ramp instead of painting the whole state red. */
export const HEAT_INTENSITY_STOPS: ZoomStops = [
  [4, 0.12],
  [6, 0.2],
  [8, 0.4],
  [9, 0.6],
  [12, 1.0],
  [15, 1.1],
  [18, 1.2],
];

/** Heat layer opacity. Dims at deep zoom so routes show through. */
export const HEAT_OPACITY_STOPS: ZoomStops = [
  [4, 0.8],
  [8, 0.75],
  [12, 0.65],
  [16, 0.5],
];

/** Flight-path line width in px: hairline when zoomed out. */
export const ROUTE_WIDTH_STOPS: ZoomStops = [
  [4, 0.5],
  [8, 0.7],
  [12, 1.2],
  [15, 1.8],
  [18, 2.5],
];

/** Flight-path opacity. Higher when zoomed out, where the lines carry
 *  the "where they fly" pattern; lower up close, where the heat does. */
export const ROUTE_OPACITY_STOPS: ZoomStops = [
  [4, 0.3],
  [7, 0.26],
  [9, 0.18],
  [12, 0.14],
  [15, 0.18],
  [18, 0.2],
];

/** MapLibre `["interpolate", ["linear"], ["zoom"], z0, v0, ...]`. */
export function zoomInterpolate(stops: ZoomStops): ExpressionSpecification {
  const out: unknown[] = ["interpolate", ["linear"], ["zoom"]];
  for (const [z, v] of stops) out.push(z, v);
  return out as ExpressionSpecification;
}

/** Evaluate stops at a zoom the way MapLibre's linear interpolate does:
 *  clamp outside the range, linear between neighbours. */
export function evalZoomStops(stops: ZoomStops, zoom: number): number {
  if (stops.length === 0) return NaN;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (zoom <= first[0]) return first[1];
  if (zoom >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, v1] = stops[i]!;
    if (zoom <= z1) {
      const [z0, v0] = stops[i - 1]!;
      const t = (zoom - z0) / (z1 - z0);
      return v0 + (v1 - v0) * t;
    }
  }
  return last[1];
}

/** True when zooms are strictly ascending and every value is finite. */
export function stopsAreValid(stops: ZoomStops): boolean {
  if (stops.length < 2) return false;
  for (let i = 0; i < stops.length; i++) {
    const [z, v] = stops[i]!;
    if (!Number.isFinite(z) || !Number.isFinite(v)) return false;
    if (i > 0 && z <= stops[i - 1]![0]) return false;
  }
  return true;
}
