"use client";

// Live /radar in 3D (`?view=3d`): every airborne aircraft as a marker at its
// reported altitude with a drop line to the ground, and the last
// LIVE_TRAIL_MINUTES of its trail as a ribbon. Police in alert orange,
// everything else in the neutral glyph grey (lib/history-3d.ts).
//
// Data rides the polls /radar already runs: aircraft from useAircraft (via
// RadarShell's `airborne`), trails from /api/trails (alt=1 adds altitude).
// Each poll only swaps deck.gl layers inside Flight3D; the map, terrain and
// camera stay put. Tap a marker or its trail for the plane card.
//
// RadarShell loads this file through next/dynamic, and it loads Flight3D
// the same way, so none of it is in /radar's first-load JS.

import { useCallback, useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { SS_TOKENS } from "@/lib/tokens";
import {
  LIVE_TRAIL_MINUTES,
  liveMarkers,
  liveTrailPaths,
  type LiveTrailPoint,
} from "@/lib/history-3d";
import type { Aircraft } from "@/lib/types";
import type { Flight3DPick } from "./Flight3D";

const Flight3D = nextDynamic(() => import("./Flight3D"), {
  ssr: false,
  loading: () => <div style={{ position: "absolute", inset: 0, background: SS_TOKENS.bg0 }} />,
});

const POLL_MS = 10_000;

/** Why the HOT ZONES / FLIGHT PATHS pills are gone in live 3D. */
const LIVE_3D_NOTE = "3D shows live aircraft. Switch to 2D for hot zones.";

type Props = {
  airborne: Aircraft[];
  /** The radar's own plane card, shown for a tapped marker. */
  renderCard: (a: Aircraft) => React.ReactNode;
  /** RESET VIEW position, px from the top-right corner. */
  resetInset: { top: number; right: number };
  /** CSS bottom for the tapped-plane card. */
  cardBottom: string;
  /** Screen the radar's overlays cover, kept clear when framing. */
  framePadding: { top: number; bottom: number; left: number; right: number };
  onUnavailable: (reason: string) => void;
};

export default function RadarLive3D({
  airborne,
  renderCard,
  resetInset,
  cardBottom,
  framePadding,
  onUnavailable,
}: Props) {
  const [trails, setTrails] = useState<Record<string, LiveTrailPoint[]>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const tailsKey = useMemo(
    () =>
      airborne
        .map((a) => a.tail)
        .filter(Boolean)
        .sort()
        .join(","),
    [airborne],
  );

  // Trails: on every change of the airborne set, then every poll. Paused
  // while the tab is hidden, like useAircraft.
  useEffect(() => {
    if (!tailsKey) {
      setTrails({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(
          `/api/trails?tails=${encodeURIComponent(tailsKey)}&minutes=${LIVE_TRAIL_MINUTES}&alt=1`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const body = (await r.json()) as { trails?: Record<string, LiveTrailPoint[]> };
        if (!cancelled) setTrails(body.trails ?? {});
      } catch {
        /* transient: next poll retries */
      }
    };
    void load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tailsKey]);

  const markers = useMemo(() => liveMarkers(airborne), [airborne]);
  const paths = useMemo(
    () => liveTrailPaths(trails, airborne, Math.floor(Date.now() / 1000)),
    [trails, airborne],
  );

  const onPick = useCallback((p: Flight3DPick | null) => {
    if (!p) return setSelected(null);
    setSelected(p.kind === "marker" ? p.id : p.id.replace(/^live\//, ""));
  }, []);

  const selectedAc = selected ? airborne.find((a) => a.tail === selected) ?? null : null;
  // A tapped plane that lands or drops off the feed takes its card with it.
  useEffect(() => {
    if (selected && !selectedAc) setSelected(null);
  }, [selected, selectedAc]);

  return (
    <>
      <div
        data-testid="radar-live-3d"
        style={{ position: "absolute", inset: 0, zIndex: 5, background: SS_TOKENS.bg0 }}
      >
        <Flight3D
          paths={paths}
          markers={markers}
          fill
          scene="radar-live"
          // Gentler than the share page: a spread of aircraft reads better
          // from higher up, and far markers stay big enough to tap.
          pitch={45}
          replay={false}
          annotate={false}
          onPick={onPick}
          // Frame once, when the first aircraft shows up; after that the
          // camera is the rider's.
          frameKey={markers.length > 0 ? "live" : null}
          resetInset={resetInset}
          framePadding={framePadding}
          onUnavailable={onUnavailable}
        />
      </div>
      {!selectedAc && (
        // Hot zones and 30-day paths stay on the flat map; say so, or
        // their pills just vanish when 3D comes on. Sits where a tapped
        // plane card goes, left of the SPOTTED button, and never takes
        // a tap.
        <div
          role="note"
          data-testid="radar-live-3d-note"
          style={{
            position: "absolute",
            left: 12,
            right: 84,
            bottom: cardBottom,
            zIndex: 11,
            display: "flex",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              maxWidth: 420,
              padding: "6px 10px",
              borderRadius: 8,
              background: "rgba(11,13,16,0.82)",
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              color: SS_TOKENS.fg1,
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {LIVE_3D_NOTE}
          </span>
        </div>
      )}
      {selectedAc && (
        <div
          data-testid="radar-live-3d-card"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: cardBottom,
            zIndex: 14,
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            maxWidth: 420,
          }}
        >
          <div style={{ flex: "0 1 auto", minWidth: 0, display: "flex" }}>{renderCard(selectedAc)}</div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Close plane card"
            style={{
              width: 44,
              minHeight: 44,
              flex: "0 0 44px",
              borderRadius: 12,
              background: SS_TOKENS.bg1,
              border: `.5px solid ${SS_TOKENS.hairline}`,
              color: SS_TOKENS.fg0,
              fontSize: 20,
              lineHeight: 1,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
