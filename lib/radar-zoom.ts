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

/** Heat ramp over heatmap-density, [density, rgba] with density strictly
 *  ascending from 0. Cool on purpose: indigo at low density through blue
 *  and teal to ice at peak. Orange (--alert) is reserved for live
 *  aircraft, so 30 days of history must never read as "Smokey is up".
 *  Kept clear of the rider's sky-blue dot by staying indigo/teal and
 *  topping out near-white rather than at #5BB6FF. */
export const HEAT_COLOR_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, "rgba(0,0,0,0)"],
  [0.05, "rgba(72,74,170,0.16)"],
  [0.35, "rgba(70,110,215,0.38)"],
  [0.7, "rgba(64,190,210,0.52)"],
  [1.0, "rgba(205,240,255,0.65)"],
];

/** Historical flight-path threads. Cool slate-blue, not alert orange. */
export const ROUTE_COLOR = "#8FA9E0";

/** Swatch for UI that labels the heat layer (the HOT ZONES pill). */
export const HEAT_SWATCH = "rgb(64,190,210)";

/** MapLibre `["interpolate", ["linear"], ["heatmap-density"], d0, c0, ...]`. */
export function heatColorExpression(): ExpressionSpecification {
  const out: unknown[] = ["interpolate", ["linear"], ["heatmap-density"]];
  for (const [d, c] of HEAT_COLOR_STOPS) out.push(d, c);
  return out as ExpressionSpecification;
}

/** True when a colour string is a warm hue (red..yellow, 0-70 degrees or
 *  >= 330). Used by tests to keep the heat ramp off the alert palette. */
export function isWarmRgba(color: string): boolean {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) return false;
  const [r, g, b] = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return false; // grey/black/white has no hue
  let h: number;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  return h <= 70 || h >= 330;
}

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
