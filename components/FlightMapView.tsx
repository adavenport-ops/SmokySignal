"use client";

// 2D | 3D switch for the public flight share page. 2D is the default and
// stays light: the 3D chunk (deck.gl + terrain) is fetched only once a
// rider picks 3D, or lands on a `?view=3d` link. The choice lives in the
// URL so a 3D link shares as 3D.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";
import type { Flight3DPath } from "./Flight3D";
import { ShareLinkButton } from "./ShareLinkButton";

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
  /** "Share this flight" once a 3D replay plays to the end. */
  share?: { path: string; text: string };
};

/**
 * Watches the 3D view's own replay controls from outside (the play
 * button's aria-pressed and the scrubber's value), so the 3D component
 * stays untouched: playing, then paused with the scrubber at the end,
 * means the replay finished.
 */
function useReplayEnded(root: React.RefObject<HTMLElement>, active: boolean): boolean {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!active || !el) return;
    let wasPlaying = false;
    const check = () => {
      const btn = el.querySelector<HTMLButtonElement>('button[aria-label$="replay"][aria-pressed]');
      const range = el.querySelector<HTMLInputElement>('input[type="range"][aria-label="Replay position"]');
      if (!btn || !range) return;
      const playing = btn.getAttribute("aria-pressed") === "true";
      if (wasPlaying && !playing && Number(range.value) >= Number(range.max || 1000) - 1) setEnded(true);
      wasPlaying = playing;
    };
    const mo = new MutationObserver(check);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed"] });
    check();
    return () => mo.disconnect();
  }, [root, active]);
  return ended;
}

export default function FlightMapView({ tail, points, initialView, hour12 = false, share }: Props) {
  const [view, setView] = useState<FlightView>(initialView);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
  const replayEnded = useReplayEnded(wrapRef, show3d && Boolean(share));

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
        <div ref={wrapRef}>
          <Flight3D paths={paths} hour12={hour12} onUnavailable={setUnavailable} />
        </div>
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

      {share && show3d && replayEnded ? (
        <div
          role="status"
          data-testid="flight-replay-share"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: SS_TOKENS.bg1,
            border: `.5px solid ${SS_TOKENS.hairline}`,
            borderRadius: 12,
            padding: "12px 14px",
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1.45, color: SS_TOKENS.fg0 }}>
            Replay done. {share.text.replace(/ Replay it:$/, "")}
          </span>
          <ShareLinkButton
            path={share.path}
            label="Share this flight"
            ariaLabel={`Share this flight: ${share.text}`}
            text={share.text}
            variant="primary"
            testId="flight-share"
          />
        </div>
      ) : null}
    </div>
  );
}
