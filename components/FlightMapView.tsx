"use client";

// 2D | 3D switch for the public flight share page. 2D is the default and
// stays light: the 3D chunk (deck.gl + terrain) is fetched only once a
// rider picks 3D, or lands on a `?view=3d` link. The choice lives in the
// URL so a 3D link shares as 3D.

import { useCallback, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";
import type { Flight3DPath } from "./Flight3D";

const PlaneTrackMap = nextDynamic(() => import("./PlaneTrackMap"), {
  ssr: false,
  loading: () => <MapPlaceholder height={320} />,
});

const Flight3D = nextDynamic(() => import("./Flight3D"), {
  ssr: false,
  loading: () => <MapPlaceholder height="clamp(420px, 66vh, 640px)" label="LOADING 3D" />,
});

export type FlightView = "2d" | "3d";

function MapPlaceholder({ height, label }: { height: number | string; label?: string }) {
  return (
    <div
      className="ss-mono"
      style={{
        height,
        background: SS_TOKENS.bg0,
        borderRadius: 12,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: SS_TOKENS.fg1,
        fontSize: 12,
        letterSpacing: ".08em",
      }}
    >
      {label ?? ""}
    </div>
  );
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

type Props = {
  tail: string;
  points: TrackPoint[];
  initialView: FlightView;
  hour12?: boolean;
};

export default function FlightMapView({ tail, points, initialView, hour12 = false }: Props) {
  const [view, setView] = useState<FlightView>(initialView);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const paths = useMemo<Flight3DPath[]>(() => [{ id: tail, points }], [tail, points]);

  const choose = useCallback((next: FlightView) => {
    setView(next);
    setUnavailable(next === "3d" && !hasWebGL2() ? "webgl2" : null);
    const url = new URL(window.location.href);
    if (next === "3d") url.searchParams.set("view", "3d");
    else url.searchParams.delete("view");
    // Next 14 syncs history.replaceState with its router; no server round trip.
    window.history.replaceState(null, "", url.toString());
  }, []);

  const show3d = view === "3d" && unavailable == null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        role="radiogroup"
        aria-label="Map view"
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          padding: 3,
          gap: 3,
          borderRadius: 10,
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
        }}
      >
        {(["2d", "3d"] as const).map((v) => {
          const on = view === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              data-view={v}
              onClick={() => choose(v)}
              className="ss-mono"
              style={{
                minWidth: 64,
                height: 44,
                padding: "0 16px",
                borderRadius: 8,
                border: "none",
                background: on ? SS_TOKENS.bg2 : "transparent",
                boxShadow: on ? `inset 0 0 0 .5px ${SS_TOKENS.hairline2}` : "none",
                color: on ? SS_TOKENS.fg0 : SS_TOKENS.fg1,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: ".06em",
                cursor: "pointer",
              }}
            >
              {v.toUpperCase()}
            </button>
          );
        })}
      </div>

      {show3d ? (
        <Flight3D paths={paths} hour12={hour12} onUnavailable={setUnavailable} />
      ) : (
        <>
          {view === "3d" && unavailable && (
            <div
              role="status"
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: SS_TOKENS.fg1,
                background: SS_TOKENS.bg1,
                border: `.5px solid ${SS_TOKENS.hairline}`,
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              {unavailable === "webgl2"
                ? "3D needs WebGL2, and this browser does not offer it. Here is the flat map."
                : "3D view dropped out on this device. Here is the flat map."}
            </div>
          )}
          <PlaneTrackMap tail={tail} points={points} inProgress={false} height={320} />
        </>
      )}
    </div>
  );
}
