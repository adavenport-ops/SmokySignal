"use client";

// Renders the most-recent-flight track for a single tail as a polyline
// over the same MapTiler dark base used on /radar. Native MapLibre
// interactions are enabled (pinch, drag, double-tap, +/- buttons) so
// the user can dig into the route on the plane detail page.

import { useEffect, useRef } from "react";
import maplibregl, {
  Map as MaplibreMap,
  GeoJSONSource,
  LngLatBoundsLike,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";

const PUGET_SOUND: [number, number] = [-122.3, 47.6];
const FALLBACK_ZOOM = 9;

type Props = {
  /** Polyline samples, oldest → newest. Must contain ≥2 points. */
  points: TrackPoint[];
  /** Pulse the end dot if the flight is still in progress. */
  inProgress: boolean;
  height?: number;
};

export default function PlaneTrackMap({
  points,
  inProgress,
  height = 280,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const pulseRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key) {
      containerRef.current.innerHTML = `
        <div style="
          position:absolute; inset:0; display:flex; align-items:center;
          justify-content:center; padding:24px; text-align:center;
          color:${SS_TOKENS.fg2}; font-size:13px; line-height:1.5;
        ">
          NEXT_PUBLIC_MAPTILER_KEY missing — map unavailable.
        </div>
      `;
      return;
    }

    const coords = points.map<[number, number]>((p) => [p.lon, p.lat]);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${key}`,
      center: coords[0] ?? PUGET_SOUND,
      zoom: FALLBACK_ZOOM,
      attributionControl: { compact: true },
      // Native interactions explicitly on — this map is meant to be
      // poked at, unlike the live radar which mostly shows you state.
      dragPan: true,
      scrollZoom: true,
      touchZoomRotate: true,
      doubleClickZoom: true,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: true }), "top-right");

    map.on("load", () => {
      if (!mapRef.current) return;

      // Polyline.
      map.addSource("track", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        },
      });
      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": SS_TOKENS.alert,
          "line-width": 3,
        },
      });

      // Endpoint dots.
      const first = coords[0];
      const last = coords[coords.length - 1];
      const endpointFeatures: GeoJSON.Feature<
        GeoJSON.Point,
        { kind: "start" | "end" }
      >[] = [];
      if (first) {
        endpointFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: first },
          properties: { kind: "start" },
        });
      }
      if (last && last !== first) {
        endpointFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: last },
          properties: { kind: "end" },
        });
      }
      map.addSource("endpoints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: endpointFeatures },
      });
      map.addLayer({
        id: "endpoint-dot",
        type: "circle",
        source: "endpoints",
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match",
            ["get", "kind"],
            "start",
            SS_TOKENS.clear,
            SS_TOKENS.alert,
          ],
          "circle-stroke-color": SS_TOKENS.bg0,
          "circle-stroke-width": 2,
        },
      });

      // Pulse the "end" point if the session is in-progress.
      if (inProgress && last) {
        const start = Date.now();
        const tick = () => {
          if (!mapRef.current) return;
          const phase = ((Date.now() - start) % 1600) / 1600;
          const radius = 6 + 4 * Math.sin(phase * Math.PI * 2);
          try {
            map.setPaintProperty("endpoint-dot", "circle-radius", [
              "match",
              ["get", "kind"],
              "end",
              radius,
              6,
            ]);
          } catch {
            /* layer torn down mid-frame */
          }
          pulseRef.current = requestAnimationFrame(tick);
        };
        pulseRef.current = requestAnimationFrame(tick);
      }

      // Auto-fit to the polyline bounds.
      if (coords.length >= 2) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0]!, coords[0]!),
        );
        map.fitBounds(bounds as LngLatBoundsLike, {
          padding: 40,
          duration: 0,
          maxZoom: 14,
        });
      }

    });

    return () => {
      if (pulseRef.current != null) cancelAnimationFrame(pulseRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
        background: SS_TOKENS.bg0,
      }}
    />
  );
}
