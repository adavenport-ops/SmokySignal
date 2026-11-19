// Radar camera presets. The region picker on /radar is a camera
// control only: picking a view fits the map to a box, it never filters
// the heat grid or flight paths (those are statewide-plus, see
// TRACKING_ENVELOPE in lib/regions.ts).
//
// Pure and client-safe: no window, no MapLibre import. RadarMap turns
// the Bounds below into a fitBounds call.

import {
  DEFAULT_REGION,
  REGIONS,
  WA_STATE_BBOX,
  type RegionBbox,
  type RegionId,
} from "./regions";

/** Every preset the picker offers. "everything" fits all loaded data. */
export type RadarViewId = RegionId | "everything";

/** Plain lon/lat box. west < east, south < north. */
export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export const DEFAULT_RADAR_VIEW: RadarViewId = DEFAULT_REGION;

/** Picker order: the three presets riders asked for first, then the
 *  finer regions, then the fit-all option. */
export const RADAR_VIEW_ORDER: readonly RadarViewId[] = [
  "puget_sound",
  "all_wa",
  "east_wa",
  "north_sound",
  "olympic",
  "sw_wa",
  "central_wa",
  "everything",
];

export const RADAR_VIEW_LABEL: Record<RadarViewId, string> = {
  puget_sound: "Puget Sound",
  all_wa: "All of Washington",
  east_wa: "Eastern Washington",
  north_sound: REGIONS.north_sound.label,
  olympic: REGIONS.olympic.label,
  sw_wa: REGIONS.sw_wa.label,
  central_wa: REGIONS.central_wa.label,
  everything: "Everything",
};

/** Label shown when the rider has panned or zoomed off the last pick. */
export const CUSTOM_VIEW_LABEL = "Custom";

export function isRadarViewId(v: unknown): v is RadarViewId {
  return (
    typeof v === "string" &&
    (v === "everything" || Object.prototype.hasOwnProperty.call(REGIONS, v))
  );
}

export function bboxToBounds(b: NonNullable<RegionBbox>): Bounds {
  return { west: b.lonMin, south: b.latMin, east: b.lonMax, north: b.latMax };
}

const WA_BOUNDS = bboxToBounds(WA_STATE_BBOX);

/**
 * Camera boxes that differ from the region's data bbox. Puget Sound's
 * bbox (lib/regions.ts, also /board's filter) runs from Victoria's
 * latitude to south of Olympia; fitted on a 390 px phone that lands at
 * z6.8. The camera box keeps the Olympia-Tacoma-Seattle-Everett core,
 * which opens around z7.8 on a phone and z8.4 on a laptop.
 */
const CAMERA_OVERRIDE: Partial<Record<RadarViewId, Bounds>> = {
  puget_sound: { west: -122.95, south: 46.98, east: -121.9, north: 48.05 },
};

export function unionBounds(
  a: Bounds | null | undefined,
  b: Bounds | null | undefined,
): Bounds | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return {
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  };
}

/** Extent of [lon, lat] pairs. Skips non-finite values. null if empty. */
export function extentOfPoints(
  points: Iterable<readonly [number, number]>,
): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (west === Infinity) return null;
  return { west, south, east, north };
}

/**
 * The box a view fits to.
 *   - a region: its bbox (or a tighter camera box, see CAMERA_OVERRIDE)
 *   - all_wa: the state outline (its REGIONS bbox is null = unfiltered)
 *   - everything: the data extent, never smaller than the state, so a
 *     quiet month or a slow fetch still frames something sensible
 */
export function boundsForView(
  id: RadarViewId,
  dataExtent: Bounds | null = null,
): Bounds {
  if (id === "everything") return unionBounds(WA_BOUNDS, dataExtent)!;
  if (id === "all_wa") return WA_BOUNDS;
  const override = CAMERA_OVERRIDE[id];
  if (override) return override;
  const b = REGIONS[id]?.bbox;
  return b ? bboxToBounds(b) : WA_BOUNDS;
}

/** MapLibre LngLatBoundsLike: [[west, south], [east, north]]. */
export function toLngLatBounds(
  b: Bounds,
): [[number, number], [number, number]] {
  return [
    [b.west, b.south],
    [b.east, b.north],
  ];
}

export type Padding = { top: number; bottom: number; left: number; right: number };

/**
 * Fit padding that keeps the box clear of the header and the bottom
 * pill row, scaled down when the overlays would eat most of a short
 * viewport. MapLibre warns and skips the fit when padding leaves no
 * room, so we always leave at least 40% of each axis for the box.
 */
export function fitPadding(
  width: number,
  height: number,
  insets: Padding,
): Padding {
  const scale = (a: number, b: number, size: number) => {
    const budget = Math.max(0, size * 0.6);
    const total = a + b;
    return total > budget && total > 0 ? budget / total : 1;
  };
  const sy = scale(insets.top, insets.bottom, height);
  const sx = scale(insets.left, insets.right, width);
  return {
    top: Math.round(insets.top * sy),
    bottom: Math.round(insets.bottom * sy),
    left: Math.round(insets.left * sx),
    right: Math.round(insets.right * sx),
  };
}
