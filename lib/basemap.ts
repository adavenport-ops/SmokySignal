// Shared basemap for every MapLibre map in the app (radar, home mini-map,
// plane track, plane history, tracks, spots, per-plane heat, Flight3D).
//
// MapTiler `dataviz-dark` is a neutral charcoal style: grey land, darker
// grey water, no blue anywhere, so the heat ramp and flight paths are the
// only colour on the map. Its road network ships at 20% lightness on 16%
// land, which disappears on a phone in daylight, so applyNeutralBasemap()
// lifts the roads a step and pins land / water to the greys the palette
// contrast tests (lib/radar-palettes.test.ts) measure against.
//
// Same host as before (api.maptiler.com), so the CSP in next.config.mjs
// is unchanged.

import type { Map as MaplibreMap } from "maplibre-gl";

export const BASEMAP_STYLE_ID = "dataviz-dark";

export function basemapStyleUrl(key: string): string {
  return `https://api.maptiler.com/maps/${BASEMAP_STYLE_ID}/style.json?key=${key}`;
}

/** The greys the basemap paints, after applyNeutralBasemap(). The
 *  palette tests check route and heat colours against these. */
export const BASEMAP = {
  land: "#232323",
  water: "#131313",
  road: "#3a3a3a",
  roadOutline: "#272727",
  label: "#7d7d7d",
} as const;

/** Paint overrides by MapTiler layer id. Missing layers are skipped, so a
 *  style revision that renames one degrades to the stock paint. */
export const BASEMAP_PAINT: ReadonlyArray<readonly [string, string, string]> = [
  ["Background", "background-color", BASEMAP.land],
  ["Landcover", "fill-color", BASEMAP.land],
  ["Water", "fill-color", BASEMAP.water],
  ["River", "line-color", BASEMAP.water],
  ["Road network", "line-color", BASEMAP.road],
  ["Road network outline", "line-color", BASEMAP.roadOutline],
];

/** Apply BASEMAP_PAINT. Call from the map's `load` (or `style.load`)
 *  handler; safe to call more than once. */
export function applyNeutralBasemap(map: MaplibreMap): void {
  for (const [id, prop, value] of BASEMAP_PAINT) {
    try {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, prop as never, value);
      }
    } catch {
      /* layer shape differs in this style revision; keep stock paint */
    }
  }
}
