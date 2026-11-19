"use client";

// Compact, read-only live map for the desktop home console (>= 1280px).
// Reuses RadarMap as-is (no edits to the radar files) via a client-only
// dynamic import, then switches off every interaction handler once the
// map is ready so it reads as a status display, not a second radar.
// Only mounted when the viewport is wide enough, so phones never pay
// for the MapLibre bundle on the home screen.

import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { Aircraft } from "@/lib/types";
import { SS_TOKENS, TAP_MIN } from "@/lib/tokens";

const RadarMap = nextDynamic(() => import("./RadarMap"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "absolute", inset: 0, background: SS_TOKENS.bg0 }} />
  ),
});

const WIDE_QUERY = "(min-width: 1280px)";

function useIsWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return wide;
}

export function HomeMiniMap({ airborne }: { airborne: Aircraft[] }) {
  const wide = useIsWide();
  const onMapReady = useCallback((map: MaplibreMap | null) => {
    if (!map) return;
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.dragPan.disable();
    map.keyboard.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
  }, []);

  if (!wide) return null;

  const upCount = airborne.length;
  return (
    <section className="ss-home-minimap" aria-label="Live map">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 4px 8px",
        }}
      >
        <span className="ss-eyebrow">Live map</span>
        <Link
          href="/radar"
          className="ss-mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: TAP_MIN,
            margin: "-12px 0",
            fontSize: 13,
            color: SS_TOKENS.fg0,
            textDecoration: "none",
          }}
        >
          Open radar →
        </Link>
      </div>
      <div
        style={{
          position: "relative",
          height: 360,
          borderRadius: 14,
          overflow: "hidden",
          border: `.5px solid ${SS_TOKENS.hairline}`,
          background: SS_TOKENS.bg0,
        }}
      >
        <RadarMap aircraft={airborne} rider={null} onMapReady={onMapReady} />
        <div
          className="ss-mono"
          aria-hidden
          style={{
            position: "absolute",
            left: 10,
            bottom: 10,
            padding: "4px 8px",
            borderRadius: 6,
            background: "rgba(11,13,16,.78)",
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            fontSize: 12,
            color: upCount > 0 ? SS_TOKENS.alert : SS_TOKENS.clear,
            pointerEvents: "none",
          }}
        >
          {upCount > 0 ? `${upCount} UP` : "ALL CLEAR"}
        </div>
      </div>
    </section>
  );
}
