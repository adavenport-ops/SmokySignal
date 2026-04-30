"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";

export default function TracksMap({ samples }: { samples: TrackPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key) {
      containerRef.current.innerHTML = `
        <div style="
          position:absolute; inset:0; display:flex; align-items:center;
          justify-content:center; padding:24px; text-align:center;
          color:${SS_TOKENS.fg2}; font-size:13px;
        ">
          NEXT_PUBLIC_MAPTILER_KEY missing.
        </div>
      `;
      return;
    }
    if (samples.length < 2) return;

    const coords: [number, number][] = samples.map((s) => [s.lon, s.lat]);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${key}`,
      center: coords[0]!,
      zoom: 11,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      // Polyline of the flight.
      map.addSource("track", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        },
      });
      map.addLayer({
        id: "track",
        type: "line",
        source: "track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": SS_TOKENS.alert,
          "line-width": 3,
        },
      });

      // Endpoint dots.
      map.addSource("endpoints", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: coords[0]! },
              properties: { kind: "start" },
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: coords[coords.length - 1]! },
              properties: { kind: "end" },
            },
          ],
        },
      });
      map.addLayer({
        id: "endpoints",
        type: "circle",
        source: "endpoints",
        paint: {
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
          "circle-color": [
            "match",
            ["get", "kind"],
            "start",
            SS_TOKENS.clear,
            "end",
            SS_TOKENS.danger,
            SS_TOKENS.alert,
          ],
        },
      });

      // Auto-fit bounds.
      let minLon = coords[0]![0];
      let maxLon = coords[0]![0];
      let minLat = coords[0]![1];
      let maxLat = coords[0]![1];
      for (const [lon, lat] of coords) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 60, duration: 0, maxZoom: 13 },
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [samples]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        background: SS_TOKENS.bg0,
      }}
    />
  );
}
