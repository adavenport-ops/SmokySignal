"use client";

// Polls /api/trails for the currently-airborne tail set and renders a
// gradient polyline behind each plane on /radar. Sits BELOW the
// "aircraft" symbol layer so the chevron stays visually on top.
//
// Gradient: full-opacity sky-color at the head (most recent point) →
// transparent at the tail end. We achieve this with a "line-gradient"
// paint expression which requires the source's lineMetrics to be true.

import { useEffect, useRef } from "react";
import type { Map as MaplibreMap, GeoJSONSource } from "maplibre-gl";
import { SS_TOKENS } from "@/lib/tokens";
import type { Aircraft } from "@/lib/types";

const SOURCE_ID = "aircraft-trails";
const LAYER_ID = "aircraft-trail";
const POLL_MS = 10_000;
const TRAIL_MINUTES = 30;

type TrailPoint = { lat: number; lon: number; ts: number };
type TrailsResponse = { trails: Record<string, TrailPoint[]> };

function buildFeatureCollection(
  trails: Record<string, TrailPoint[]>,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const [tail, pts] of Object.entries(trails)) {
    if (pts.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: pts.map((p) => [p.lon, p.lat]),
      },
      properties: { tail },
    });
  }
  return { type: "FeatureCollection", features };
}

export function AircraftTrailLayer({
  map,
  airborne,
}: {
  map: MaplibreMap | null;
  airborne: Aircraft[];
}) {
  const tailsKey = airborne
    .map((a) => a.tail)
    .filter(Boolean)
    .sort()
    .join(",");
  const tailsKeyRef = useRef(tailsKey);
  tailsKeyRef.current = tailsKey;

  // Layer attachment — once per map instance.
  useEffect(() => {
    if (!map) return;
    const attach = () => {
      if (!map.isStyleLoaded() || map.getSource(SOURCE_ID)) return;
      const beforeId = map.getLayer("aircraft") ? "aircraft" : undefined;
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        // lineMetrics=true is required for the line-gradient paint
        // expression below to interpolate along the line length.
        lineMetrics: true,
      });
      map.addLayer(
        {
          id: LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": 2,
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              "rgba(74,158,255,0)",
              1,
              SS_TOKENS.sky,
            ],
          },
        },
        beforeId,
      );
    };
    if (map.isStyleLoaded()) attach();
    map.on("load", attach);
    map.on("styledata", attach);
    return () => {
      map.off("load", attach);
      map.off("styledata", attach);
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // map torn down already
      }
    };
  }, [map]);

  // Poll /api/trails whenever the airborne tail set changes, plus every
  // POLL_MS while it's stable. Cancel + restart cleanly if tails change
  // mid-cycle so we never write a stale set to the source.
  useEffect(() => {
    if (!map) return;
    if (!tailsKey) {
      // No airborne tails — clear the layer.
      const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (src) src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const r = await fetch(
          `/api/trails?tails=${tailsKey}&minutes=${TRAIL_MINUTES}`,
          { cache: "no-store" },
        );
        if (!r.ok || cancelled) return;
        const d = (await r.json()) as TrailsResponse;
        if (cancelled) return;
        // Tails may have shifted while the fetch was in flight; bail if so
        // to avoid painting stale data over a fresh-tail snapshot.
        if (tailsKeyRef.current !== tailsKey) return;
        const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        if (src) src.setData(buildFeatureCollection(d.trails ?? {}));
      } catch {
        // transient — try again next tick
      }
    };
    fetchOnce();
    const id = window.setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [map, tailsKey]);

  return null;
}
