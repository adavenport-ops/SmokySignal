"use client";

// Flight-path polyline overlay. Threads each tail-day's track samples
// as a thin amber line beneath the hot-zone heatmap layer — corridors
// (I-5 transit, lake-patrol orbits) read as actual lines instead of
// blob density. Pairs with HotZoneLayer.tsx; visibility tracks its own
// `ss_flight_paths_visible` localStorage key so riders can dim the
// heat while keeping live paths or vice versa. Both layers also listen
// for the LAYER_VISIBILITY_CHANGE_EVENT broadcast from each toggle so
// in-panel + bottom-left controls stay in sync.
//
// Source: /api/flight-paths returns one GeoJSON LineString per tail-day
// with ≥ 5 points across the whole tracking envelope (WA plus the OR /
// ID border areas), filtered only by the operator/role allow-list. The
// region picker is camera-only, so routes never refetch on a region
// change. Edge-cached for 5 min so flipping filters is cheap.
//
// Paint is zoom-adaptive (lib/radar-zoom.ts): hairline, low-opacity
// threads at state zoom so the "where they fly" pattern reads at a
// glance, the original corridor detail from z12 up.

import { useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap, GeoJSONSource } from "maplibre-gl";
import { SS_TOKENS } from "@/lib/tokens";
import {
  DEFAULT_RADAR_FILTER,
  RADAR_FILTER_CHANGE_EVENT,
  bucketsToRoles,
  readRadarFilter,
  type RadarFilter as Filter,
} from "@/lib/radar-filter";
import {
  ROUTE_OPACITY_STOPS,
  ROUTE_WIDTH_STOPS,
  zoomInterpolate,
  ROUTE_COLOR,
} from "@/lib/radar-zoom";
import { extentOfPoints } from "@/lib/radar-view";
import {
  FLIGHT_PATHS_VISIBLE_KEY,
  LAYER_VISIBILITY_CHANGE_EVENT,
  RADAR_DATA_EXTENT_EVENT,
} from "./HotZoneLayer";

const VISIBLE_KEY = FLIGHT_PATHS_VISIBLE_KEY;
const SOURCE_ID = "flight-paths";
const LAYER_ID = "flight-paths-line";
const HEATMAP_LAYER_ID = "hotzones-heat";
const AIRCRAFT_LAYER_ID = "aircraft";

function buildQueryString(f: Filter): string {
  const p = new URLSearchParams();
  if (f.buckets.length > 0) {
    p.set("roles", bucketsToRoles(f.buckets).join(","));
  }
  if (f.operatorSet.length > 0) {
    p.set("operator", f.operatorSet.join(","));
  }
  if (f.tailSet.length > 0) {
    p.set("tails", f.tailSet.join(","));
  }
  return p.toString();
}

type Props = {
  map: MaplibreMap | null;
};

export function FlightPathLayer({ map }: Props) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [filter, setFilter] = useState<Filter>(DEFAULT_RADAR_FILTER);
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Mirror persisted state + cross-component change events same as
  // HotZoneLayer — both layers respond identically to filter and
  // visibility changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(VISIBLE_KEY);
    if (v === "0") setEnabled(false);
    else if (v === "1") setEnabled(true);
    setFilter(readRadarFilter());
    const onFilterChange = (e: Event) => {
      const detail = (e as CustomEvent<Filter>).detail;
      if (detail) setFilter(detail);
    };
    // Same-tab broadcast from HotZoneLayer's toggleFlightPaths — sync
    // visibility instantly when the rider taps the bottom-left pill or
    // the in-panel Layers row.
    const onLayerVisChange = (e: Event) => {
      const detail = (
        e as CustomEvent<{ key: string; enabled: boolean }>
      ).detail;
      if (detail?.key === VISIBLE_KEY) setEnabled(detail.enabled);
    };
    // Cross-tab visibility sync (rider has /radar open in two tabs).
    const onStorage = (e: StorageEvent) => {
      if (e.key === VISIBLE_KEY) {
        setEnabled(e.newValue !== "0");
      }
    };
    window.addEventListener(RADAR_FILTER_CHANGE_EVENT, onFilterChange);
    window.addEventListener(LAYER_VISIBILITY_CHANGE_EVENT, onLayerVisChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RADAR_FILTER_CHANGE_EVENT, onFilterChange);
      window.removeEventListener(
        LAYER_VISIBILITY_CHANGE_EVENT,
        onLayerVisChange,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Fetch the polyline FeatureCollection on filter change.
  useEffect(() => {
    let cancelled = false;
    const qs = buildQueryString(filter);
    (async () => {
      try {
        const r = await fetch(`/api/flight-paths?${qs}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const d = (await r.json()) as { features?: GeoJSON.Feature[] };
        if (cancelled) return;
        const list = Array.isArray(d.features) ? d.features : [];
        setFeatures(list);
        // Let the radar's "Everything" view frame all routes.
        window.dispatchEvent(
          new CustomEvent(RADAR_DATA_EXTENT_EVENT, {
            detail: { source: "flight-paths", bounds: routeExtent(list) },
          }),
        );
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Add the source + layer once the map is ready. Same retry-on-data
  // pattern as HotZoneLayer because MapLibre's isStyleLoaded() is
  // unreliable post-mount under Next.js dynamic-import.
  useEffect(() => {
    if (!map) return;

    const addLayerOnce = () => {
      if (map.getSource(SOURCE_ID)) return;
      try {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          // Per-zoom Douglas-Peucker in the tile worker (default 0.375).
          // A touch more keeps the statewide view cheap to draw; lines
          // are hairlines there, so the loss is invisible.
          tolerance: 0.6,
        });
        // Z-order: insert below the hot-zone heatmap so heat sits on
        // top of the threads. If the heatmap hasn't attached yet
        // (race), fall back to insert-before-aircraft so the polyline
        // still lands beneath the chevrons; when heatmap attaches
        // later it'll auto-insert above the polyline (its own
        // beforeId targets the aircraft layer).
        const beforeId = map.getLayer(HEATMAP_LAYER_ID)
          ? HEATMAP_LAYER_ID
          : map.getLayer(AIRCRAFT_LAYER_ID)
            ? AIRCRAFT_LAYER_ID
            : undefined;
        map.addLayer(
          {
            id: LAYER_ID,
            type: "line",
            source: SOURCE_ID,
            layout: {
              visibility: enabledRef.current ? "visible" : "none",
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              // Cool thread: history, not a live bird (lib/radar-zoom.ts).
              "line-color": ROUTE_COLOR,
              "line-width": zoomInterpolate(ROUTE_WIDTH_STOPS),
              "line-opacity": zoomInterpolate(ROUTE_OPACITY_STOPS),
            },
          },
          beforeId,
        );
      } catch {
        // style not ready; the data event will retry
      }
    };

    let cancelled = false;
    const ensure = () => {
      if (cancelled || !map) return;
      if (map.getSource(SOURCE_ID)) return;
      addLayerOnce();
    };
    ensure();
    map.on("data", ensure);

    return () => {
      cancelled = true;
      try {
        map.off("data", ensure);
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map already torn down */
      }
    };
  }, [map]);

  // Push features into the source whenever they change.
  useEffect(() => {
    if (!map || !features) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) {
      const onSourceReady = () => {
        const s = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        if (s && features) {
          s.setData({ type: "FeatureCollection", features });
          map.off("sourcedata", onSourceReady);
        }
      };
      map.on("sourcedata", onSourceReady);
      return () => {
        map.off("sourcedata", onSourceReady);
      };
    }
    src.setData({ type: "FeatureCollection", features });
  }, [map, features]);

  // Mirror enabled to the layer's visibility.
  useEffect(() => {
    if (!map) return;
    try {
      if (!map.getLayer(LAYER_ID)) return;
      map.setLayoutProperty(
        LAYER_ID,
        "visibility",
        enabled ? "visible" : "none",
      );
    } catch {
      /* layer not yet attached */
    }
  }, [map, enabled]);

  return null;
}

function* routeCoords(
  features: GeoJSON.Feature[],
): Generator<readonly [number, number]> {
  for (const f of features) {
    if (f.geometry?.type !== "LineString") continue;
    for (const c of f.geometry.coordinates) {
      if (c.length >= 2) yield [c[0]!, c[1]!];
    }
  }
}

function routeExtent(features: GeoJSON.Feature[]) {
  return extentOfPoints(routeCoords(features));
}
