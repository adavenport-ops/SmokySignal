"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SS_TOKENS } from "@/lib/tokens";
import type { StoredSpot } from "@/lib/spots";

export default function SpotsMap({ spots }: { spots: StoredSpot[] }) {
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
    if (spots.length === 0) return;

    const features = spots.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      properties: { id: s.id, ts: s.ts },
    }));

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${key}`,
      center: [spots[0]!.lon, spots[0]!.lat],
      zoom: 9,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("spots", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      map.addLayer({
        id: "spots",
        type: "circle",
        source: "spots",
        paint: {
          "circle-radius": 5,
          "circle-color": SS_TOKENS.alert,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
      });

      // Auto-fit bounds across all spots.
      let minLon = spots[0]!.lon;
      let maxLon = spots[0]!.lon;
      let minLat = spots[0]!.lat;
      let maxLat = spots[0]!.lat;
      for (const s of spots) {
        if (s.lon < minLon) minLon = s.lon;
        if (s.lon > maxLon) maxLon = s.lon;
        if (s.lat < minLat) minLat = s.lat;
        if (s.lat > maxLat) maxLat = s.lat;
      }
      // Pad single-point case so we don't zoom to max.
      if (minLon === maxLon && minLat === maxLat) {
        minLon -= 0.05;
        maxLon += 0.05;
        minLat -= 0.05;
        maxLat += 0.05;
      }
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 40, duration: 0, maxZoom: 12 },
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [spots]);

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
