// MapLibre plumbing for history mode: one GeoJSON source for the lines,
// one for the heat, layers added once per map and updated with setData.
// Toggling history off hides the layers and empties the sources instead
// of removing them, so flipping history on and off never re-adds a
// layer (and never trips MapLibre's "layer already exists").
//
// Client-only by use (it is handed a live map) but imports MapLibre
// types only, so it adds nothing to the server bundle.

import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import {
  HEAT_INTENSITY_STOPS,
  HEAT_OPACITY_STOPS,
  HEAT_RADIUS_STOPS,
  heatColorExpression,
  zoomInterpolate,
  type ZoomStops,
} from "./radar-zoom";

export const HISTORY_LINE_SOURCE = "history-lines";
export const HISTORY_HEAT_SOURCE = "history-heat";
export const HISTORY_HEAT_LAYER = "history-heat";
export const HISTORY_LINE_LAYER = "history-lines";
/** Wide, near-transparent copy of the lines: a finger-sized tap target. */
export const HISTORY_HIT_LAYER = "history-lines-hit";
export const HISTORY_SELECTED_LAYER = "history-lines-selected";

const LAYERS = [HISTORY_HEAT_LAYER, HISTORY_LINE_LAYER, HISTORY_HIT_LAYER, HISTORY_SELECTED_LAYER] as const;
const AIRCRAFT_LAYER_ID = "aircraft";

/** History lines are the subject in this mode, so a touch heavier than
 *  the 30-day threads (lib/radar-zoom.ts ROUTE_WIDTH_STOPS). */
export const HISTORY_LINE_WIDTH_STOPS: ZoomStops = [
  [4, 0.9],
  [8, 1.3],
  [12, 2],
  [15, 2.8],
  [18, 3.6],
];
export const HISTORY_LINE_OPACITY = 0.72;
/** The radar heat opacity (lib/radar-zoom.ts) at 60%. */
export const HISTORY_HEAT_OPACITY_STOPS: ZoomStops = HEAT_OPACITY_STOPS.map(
  ([z, v]) => [z, Math.round(v * 0.6 * 100) / 100] as const,
);
export const HISTORY_LINE_OPACITY_DIMMED = 0.28;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Add the sources and layers if they are missing. Idempotent; returns
 * false while the style is not ready (the caller retries on the next
 * `data` / `styledata` event, the pattern HotZoneLayer uses).
 */
export function ensureHistoryLayers(map: MaplibreMap, opts: { heat: boolean }): boolean {
  if (map.getSource(HISTORY_LINE_SOURCE) && map.getLayer(HISTORY_SELECTED_LAYER)) return true;
  try {
    const before = map.getLayer(AIRCRAFT_LAYER_ID) ? AIRCRAFT_LAYER_ID : undefined;
    if (opts.heat && !map.getSource(HISTORY_HEAT_SOURCE)) {
      map.addSource(HISTORY_HEAT_SOURCE, { type: "geojson", data: EMPTY });
    }
    if (!map.getSource(HISTORY_LINE_SOURCE)) {
      map.addSource(HISTORY_LINE_SOURCE, { type: "geojson", data: EMPTY, tolerance: 0.5 });
    }
    if (opts.heat && !map.getLayer(HISTORY_HEAT_LAYER)) {
      map.addLayer(
        {
          id: HISTORY_HEAT_LAYER,
          type: "heatmap",
          source: HISTORY_HEAT_SOURCE,
          layout: { visibility: "none" },
          paint: {
            // Same weighting and cool ramp as the 30-day heat
            // (HotZoneLayer.tsx), so the two read as one system.
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["log10", ["max", ["get", "count"], 1]],
              0,
              0.2,
              2,
              1,
            ],
            "heatmap-intensity": zoomInterpolate(HEAT_INTENSITY_STOPS),
            "heatmap-radius": zoomInterpolate(HEAT_RADIUS_STOPS),
            "heatmap-color": heatColorExpression(),
            // Dimmer than the 30-day heat: here the lines are the subject.
            "heatmap-opacity": zoomInterpolate(HISTORY_HEAT_OPACITY_STOPS),
          },
        },
        before,
      );
    }
    if (!map.getLayer(HISTORY_LINE_LAYER)) {
      map.addLayer(
        {
          id: HISTORY_LINE_LAYER,
          type: "line",
          source: HISTORY_LINE_SOURCE,
          layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": zoomInterpolate(HISTORY_LINE_WIDTH_STOPS),
            "line-opacity": HISTORY_LINE_OPACITY,
          },
        },
        before,
      );
    }
    if (!map.getLayer(HISTORY_HIT_LAYER)) {
      map.addLayer(
        {
          id: HISTORY_HIT_LAYER,
          type: "line",
          source: HISTORY_LINE_SOURCE,
          layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#000000", "line-width": 18, "line-opacity": 0.01 },
        },
        before,
      );
    }
    if (!map.getLayer(HISTORY_SELECTED_LAYER)) {
      map.addLayer(
        {
          id: HISTORY_SELECTED_LAYER,
          type: "line",
          source: HISTORY_LINE_SOURCE,
          filter: ["==", ["get", "id"], "__none__"],
          layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.6, 12, 4.5, 18, 7],
            "line-opacity": 1,
          },
        },
        before,
      );
    }
    return true;
  } catch {
    return false;
  }
}

export function setHistoryData(
  map: MaplibreMap,
  lines: GeoJSON.FeatureCollection | null,
  heat: GeoJSON.FeatureCollection | null,
): boolean {
  const l = map.getSource(HISTORY_LINE_SOURCE) as GeoJSONSource | undefined;
  if (!l) return false;
  l.setData(lines ?? EMPTY);
  const h = map.getSource(HISTORY_HEAT_SOURCE) as GeoJSONSource | undefined;
  if (h) h.setData(heat ?? EMPTY);
  return true;
}

export function setHistoryVisible(map: MaplibreMap, visible: boolean): void {
  for (const id of LAYERS) {
    try {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    } catch {
      /* torn down */
    }
  }
}

/** A flight on the map. Ids come from the start time, so two tails can
 *  share one; the pair is unique. */
export type HistoryLineKey = { tail: string; id: string };

/** Highlight one flight (or none) and dim the rest while one is picked. */
export function setHistorySelected(map: MaplibreMap, sel: HistoryLineKey | null): void {
  try {
    if (map.getLayer(HISTORY_SELECTED_LAYER)) {
      map.setFilter(
        HISTORY_SELECTED_LAYER,
        sel
          ? ["all", ["==", ["get", "id"], sel.id], ["==", ["get", "tail"], sel.tail]]
          : ["==", ["get", "id"], "__none__"],
      );
    }
    if (map.getLayer(HISTORY_LINE_LAYER)) {
      map.setPaintProperty(
        HISTORY_LINE_LAYER,
        "line-opacity",
        sel ? HISTORY_LINE_OPACITY_DIMMED : HISTORY_LINE_OPACITY,
      );
    }
  } catch {
    /* torn down */
  }
}

/** The history line under a tap, if any. */
export function historyLineAt(
  map: MaplibreMap,
  point: { x: number; y: number },
): HistoryLineKey | null {
  try {
    if (!map.getLayer(HISTORY_HIT_LAYER)) return null;
    const f = map.queryRenderedFeatures([point.x, point.y], { layers: [HISTORY_HIT_LAYER] })[0];
    const id = f?.properties?.id;
    const tail = f?.properties?.tail;
    return typeof id === "string" && typeof tail === "string" ? { id, tail } : null;
  } catch {
    return null;
  }
}

export function removeHistoryLayers(map: MaplibreMap): void {
  try {
    for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
    for (const s of [HISTORY_LINE_SOURCE, HISTORY_HEAT_SOURCE]) if (map.getSource(s)) map.removeSource(s);
  } catch {
    /* map already torn down */
  }
}
