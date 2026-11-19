// Flat stand-ins for the WebGL maps (components/MapBoundary.tsx).
//
// TrackSvgFallback draws tracks as a static SVG, north up, using the same
// projection as the flight card (lib/flight-card.ts). MapListFallback is
// the plain version for maps with no track to draw (heat, live radar):
// a one-line note and a short list.
//
// No hooks and no browser APIs, so both render on the server too.

import type { ReactNode } from "react";
import { decimate, projectTrack, MAX_CARD_POINTS } from "@/lib/flight-card";
import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";

export const NO_WEBGL_NOTE = "Map needs WebGL.";

type LatLonTs = Pick<TrackPoint, "lat" | "lon" | "ts">;

export type FallbackTrack = { id: string; points: ReadonlyArray<LatLonTs>; color?: string };

const VIEW_W = 600;

type Projected = { id: string; d: string; color: string; start: { x: number; y: number } | null; end: { x: number; y: number } | null };

/** Several tracks in one shared frame (one track uses projectTrack as is). */
function projectAll(tracks: ReadonlyArray<FallbackTrack>, w: number, h: number, pad: number): Projected[] {
  const usable = tracks
    .map((t) => ({
      ...t,
      pts: t.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).slice().sort((a, b) => a.ts - b.ts),
    }))
    .filter((t) => t.pts.length > 0);
  if (usable.length === 1) {
    const t = usable[0]!;
    const g = projectTrack(t.pts as TrackPoint[], { width: w, height: h, pad });
    return [{ id: t.id, d: g.d, color: t.color ?? SS_TOKENS.alert, start: g.start, end: g.end }];
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const t of usable)
    for (const p of t.pts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
  if (!Number.isFinite(minLat)) return [];
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLon - minLon) * k;
  const spanY = maxLat - minLat;
  const iw = w - 2 * pad;
  const ih = h - 2 * pad;
  const scale = spanX === 0 && spanY === 0 ? 0 : Math.min(spanX > 0 ? iw / spanX : Infinity, spanY > 0 ? ih / spanY : Infinity);
  const offX = pad + (iw - spanX * scale) / 2;
  const offY = pad + (ih - spanY * scale) / 2;
  const per = Math.max(20, Math.floor(MAX_CARD_POINTS * 4 / usable.length));
  return usable.map((t) => {
    const xy = decimate(t.pts, per).map((p) => ({
      x: Math.round((offX + (p.lon - minLon) * k * scale) * 10) / 10,
      y: Math.round((offY + (maxLat - p.lat) * scale) * 10) / 10,
    }));
    return {
      id: t.id,
      d: xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" "),
      color: t.color ?? SS_TOKENS.alert,
      start: xy[0] ?? null,
      end: xy.length > 1 ? xy[xy.length - 1]! : null,
    };
  });
}

function Shell({
  height,
  children,
  testId,
  minHeight = 0,
}: {
  height: number | string;
  children: ReactNode;
  testId: string;
  minHeight?: number;
}) {
  return (
    <div
      data-testid={testId}
      data-map-fallback="true"
      style={{
        position: "relative",
        width: "100%",
        height,
        minHeight,
        borderRadius: 12,
        overflow: "hidden",
        background: SS_TOKENS.bg0,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{ padding: "10px 12px", fontSize: 13, lineHeight: 1.45, color: SS_TOKENS.fg1, borderBottom: `.5px solid ${SS_TOKENS.hairline}` }}
    >
      {children}
    </div>
  );
}

/** Static SVG of one or more tracks. Falls back to the plain note with nothing to draw. */
export function TrackSvgFallback({
  tracks,
  height = 280,
  note,
}: {
  tracks: ReadonlyArray<FallbackTrack>;
  height?: number | string;
  note?: string;
}) {
  const H = 360;
  const drawn = projectAll(tracks, VIEW_W, H, 24).filter((t) => t.d);
  if (drawn.length === 0) {
    return (
      <Shell height="auto" testId="map-fallback">
        <Note>{note ?? NO_WEBGL_NOTE} No track on file for this view.</Note>
      </Shell>
    );
  }
  const many = drawn.length > 1;
  return (
    <Shell height={height} minHeight={160} testId="map-fallback">
      <Note>
        {note ?? `${NO_WEBGL_NOTE} Here ${many ? "are the tracks" : "is the track"} drawn flat, north up.`}
      </Note>
      <svg
        viewBox={`0 0 ${VIEW_W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={many ? `${drawn.length} flight tracks, drawn flat` : "Flight track, drawn flat"}
        style={{ flex: 1, width: "100%", minHeight: 0, display: "block" }}
      >
        {drawn.map((t) => (
          <path key={t.id} d={t.d} fill="none" stroke={t.color} strokeWidth={many ? 2 : 3} strokeLinecap="round" strokeLinejoin="round" opacity={many ? 0.85 : 1} />
        ))}
        {!many && drawn[0]!.start && (
          <circle cx={drawn[0]!.start.x} cy={drawn[0]!.start.y} r={6} fill={SS_TOKENS.clear} stroke={SS_TOKENS.bg0} strokeWidth={2} />
        )}
        {!many && drawn[0]!.end && (
          <circle cx={drawn[0]!.end.x} cy={drawn[0]!.end.y} r={6} fill={SS_TOKENS.alert} stroke={SS_TOKENS.bg0} strokeWidth={2} />
        )}
        <text x={VIEW_W - 14} y={24} textAnchor="end" fill={SS_TOKENS.fg1} fontSize={16} fontFamily="var(--font-mono, monospace)">
          N ↑
        </text>
      </svg>
    </Shell>
  );
}

/** Plain note plus up to `max` rows. For maps with no single track to draw. */
export function MapListFallback({
  note = NO_WEBGL_NOTE,
  rows,
  empty,
  max = 12,
  height = "auto",
}: {
  note?: string;
  rows: ReadonlyArray<{ key: string; label: ReactNode; detail?: ReactNode }>;
  empty?: string;
  max?: number;
  height?: number | string;
}) {
  return (
    <Shell height={height} testId="map-fallback">
      <Note>{note}</Note>
      {rows.length === 0 ? (
        empty ? <div style={{ padding: "10px 12px", fontSize: 13, color: SS_TOKENS.fg2 }}>{empty}</div> : null
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: "4px 0", overflowY: "auto" }}>
          {rows.slice(0, max).map((r) => (
            <li
              key={r.key}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 12px", fontSize: 13, color: SS_TOKENS.fg0 }}
            >
              <span>{r.label}</span>
              {r.detail != null && (
                <span className="ss-mono" style={{ color: SS_TOKENS.fg1, fontSize: 12, whiteSpace: "nowrap" }}>
                  {r.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
