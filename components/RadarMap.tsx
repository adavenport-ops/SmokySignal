"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SS_TOKENS } from "@/lib/tokens";

const PUGET_SOUND: [number, number] = [-122.3, 47.6];
const DEFAULT_ZOOM = 9;

export default function RadarMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    const styleUrl = key
      ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${key}`
      : null;

    if (!styleUrl) {
      // Fail soft: surface the missing-key reason in the DOM rather than
      // silently rendering nothing.
      containerRef.current.innerHTML = `
        <div style="
          position:absolute; inset:0; display:flex; align-items:center;
          justify-content:center; padding:24px; text-align:center;
          color:${SS_TOKENS.fg2}; font-size:13px; line-height:1.5;
        ">
          NEXT_PUBLIC_MAPTILER_KEY missing in this build.<br/>
          Map tiles unavailable.
        </div>
      `;
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: PUGET_SOUND,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
