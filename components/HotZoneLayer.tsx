"use client";

// Renders a MapLibre heatmap layer on the radar map for our 30-day grid
// aggregate of fleet-aircraft pings (lib/hotzones.ts). Owns:
//   - one fetch of /api/hotzones on mount (refreshed daily by Vercel cron,
//     so per-session is plenty)
//   - the source + heatmap layer lifecycle on the passed-in map
//   - the bottom-left toggle button + localStorage persistence (default ON)
//
// Layer is added BELOW the "aircraft" symbol layer so chevrons stay on top.

import { useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap, GeoJSONSource } from "maplibre-gl";
import { SS_TOKENS } from "@/lib/tokens";
import type { HotZone } from "@/lib/hotzones";

const STORAGE_KEY = "ss_hotzones_visible";
const SOURCE_ID = "hotzones";
const LAYER_ID = "hotzones-heat";
const AIRCRAFT_LAYER_ID = "aircraft";
const TABBAR_HEIGHT = 66;

type Props = {
  map: MaplibreMap | null;
  /** Extra px above the tab bar — pass when the airborne carousel is on. */
  bottomBoost?: number;
};

export function HotZoneLayer({ map, bottomBoost = 0 }: Props) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [zones, setZones] = useState<HotZone[] | null>(null);
  const fetchedRef = useRef(false);

  // Load persisted toggle state once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "0") setEnabled(false);
    else if (v === "1") setEnabled(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  }, [enabled]);

  // One-shot fetch — cron refreshes the aggregate daily, so a per-session
  // load is plenty.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/hotzones", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { zones: HotZone[] };
        if (!cancelled) setZones(Array.isArray(d.zones) ? d.zones : []);
      } catch {
        /* transient — leave zones null, button still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Add or update the source + layer whenever the map, zones, or
  // enabled flag changes. Cleanly removes both on unmount.
  useEffect(() => {
    if (!map || !zones) return;
    if (!map.isStyleLoaded()) {
      // Safe to attach later — wait for the style to be ready.
      const onReady = () => addOrUpdate(map, zones, enabled);
      map.once("idle", onReady);
      return () => {
        map.off("idle", onReady);
      };
    }
    addOrUpdate(map, zones, enabled);
  }, [map, zones, enabled]);

  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map may already be torn down */
      }
    };
  }, [map]);

  return (
    <button
      type="button"
      onClick={() => setEnabled((v) => !v)}
      aria-pressed={enabled}
      className="ss-mono"
      style={{
        position: "absolute",
        left: 12,
        bottom: TABBAR_HEIGHT + 16 + bottomBoost,
        zIndex: 12,
        padding: "8px 12px",
        borderRadius: 999,
        background: "rgba(11,13,16,0.78)",
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        color: enabled ? SS_TOKENS.alert : SS_TOKENS.fg1,
        fontSize: 11,
        letterSpacing: ".06em",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {enabled ? "● HOT ZONES" : "○ HOT ZONES"}
    </button>
  );
}

function addOrUpdate(map: MaplibreMap, zones: HotZone[], enabled: boolean) {
  const fc: GeoJSON.FeatureCollection<GeoJSON.Point, { count: number }> = {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [z.lon, z.lat] },
      properties: { count: z.count },
    })),
  };

  const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
  } else {
    map.addSource(SOURCE_ID, { type: "geojson", data: fc });
    // Insert below the aircraft layer if it's already on the map so
    // chevrons stay visually on top.
    const beforeId = map.getLayer(AIRCRAFT_LAYER_ID)
      ? AIRCRAFT_LAYER_ID
      : undefined;
    map.addLayer(
      {
        id: LAYER_ID,
        type: "heatmap",
        source: SOURCE_ID,
        paint: {
          // Single sparse cells (count=1) used to map to weight=0, which
          // produced no visible heat at all. Floor at 0.2 so any cell
          // contributes something, then ramp to 1 by count=20. The high-
          // density Tri-Cities/Olympia clusters still saturate.
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            1,
            0.2,
            20,
            1,
          ],
          "heatmap-intensity": 1,
          // Wider radius helps single points be visible at zoom 9 where
          // 0.5nm cells are only a few px across.
          "heatmap-radius": 32,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.05,
            "rgba(245,184,64,0.18)",
            0.3,
            "rgba(245,184,64,0.55)",
            0.7,
            "rgba(245,140,40,0.70)",
            1.0,
            "rgba(220,38,38,0.78)",
          ],
          "heatmap-opacity": 0.85,
        },
      },
      beforeId,
    );
  }

  // Toggle visibility instead of tearing down — cheaper and avoids
  // re-uploading the source data on every flip.
  try {
    map.setLayoutProperty(
      LAYER_ID,
      "visibility",
      enabled ? "visible" : "none",
    );
  } catch {
    /* layer may not exist yet on a fresh style swap */
  }
}
