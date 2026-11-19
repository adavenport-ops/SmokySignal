// 3D adapters for history (plane page + /radar history mode) and the live
// /radar 3D view. Pure and client-safe: no window, no deck.gl, no MapLibre,
// so the colour rules and point shapes are pinned under node:test
// (lib/history-3d.test.ts) and none of this drags the 3D chunk along.
//
// Colour rules (components/Flight3D.tsx draws whatever colour it is given):
//   - One flight on screen: the ribbon orange, with replay. It is the
//     flight the rider is looking at, same as the /flight share page.
//   - Many flights, one tail: one colour per flight from a cool, low-
//     saturation palette, cycling. Orange only for the flight the rider
//     tapped. No replay.
//   - Two to six tails: one 3D palette colour per tail (tailColors3D).
//     The summary chip's legend shows these while 3D is on. Orange only
//     for the tapped flight.
//
// 3D keeps its own fixed palette rather than the rider's 2D palette
// (lib/radar-palettes.ts): some 2D palettes run warm, and over hillshade
// the stacked ribbons need the soft cool band to stay apart from orange.
//   - More than six tails (2D draws them all in one colour, no legend):
//     back to one colour per flight, so a month of stacked flights still
//     reads as separate ribbons.
//   - Live: police (the Smokey class) in alert orange, every other mission
//     in its neutral glyph grey (lib/brand/aircraft-glyphs.ts).

import type { HistoryPolyline } from "./history-core";
import {
  PER_TAIL_COLOR_MAX,
  historyToFlight3DPaths,
  type Flight3DPath,
  type Flight3DPoint,
} from "./history-view";
import { isPoliceMission } from "./mission";
import { AIRCRAFT_COLORS } from "./brand/aircraft-glyphs";

// ─── view state ──────────────────────────────────────────────────────

export type MapView = "2d" | "3d";

/** History 3D on /plane/[tail] and /radar?h=1: `?hview=3d`. */
export const HISTORY_VIEW_PARAM = "hview";
/** Live 3D on /radar: `?view=3d`, the same key the /flight share page uses. */
export const LIVE_VIEW_PARAM = "view";

export function parseMapView(v: string | null | undefined): MapView {
  return v === "3d" ? "3d" : "2d";
}

/**
 * Write a view into search params: `3d` sets the key, `2d` removes it (2D
 * is the default, so the common link stays short). Other keys are kept.
 */
export function withMapView(base: URLSearchParams | string, key: string, view: MapView): URLSearchParams {
  const p = new URLSearchParams(typeof base === "string" ? base : base.toString());
  if (view === "3d") p.set(key, "3d");
  else p.delete(key);
  return p;
}

// ─── colours ─────────────────────────────────────────────────────────

/** The tapped flight, or the only flight on screen. Alert orange. */
export const SELECTED_FLIGHT_COLOR = "#FF7A1A";

/**
 * Per-flight colours when one tail flew many flights. The six history tail
 * colours plus two more in the same cool band (sage, periwinkle), so eight
 * neighbouring flights read apart before the cycle repeats. None warm.
 */
export const FLIGHT_PALETTE_3D = [
  "#8FA9E0", // slate blue
  "#7FC8C2", // muted teal
  "#B9A3E3", // lavender
  "#8EC5E8", // powder blue
  "#D6A3DA", // orchid
  "#C3CCDA", // steel
  "#9CC2B0", // sage
  "#A7B4EE", // periwinkle
] as const;

/**
 * Tail → 3D colour for two to PER_TAIL_COLOR_MAX tails: sorted, one
 * palette slot each, so a shared link always paints the same way. Empty
 * past the limit (each flight gets its own colour then).
 */
export function tailColors3D(tails: readonly string[]): Record<string, string> {
  const uniq = [...new Set(tails.map((t) => t.toUpperCase()))].sort();
  if (uniq.length > PER_TAIL_COLOR_MAX) return {};
  const out: Record<string, string> = {};
  uniq.forEach((t, i) => {
    out[t] = FLIGHT_PALETTE_3D[i]!;
  });
  return out;
}

/** Live marker + trail colour for police (the Smokey class). */
export const LIVE_POLICE_COLOR = AIRCRAFT_COLORS.ALERT_STROKE;
/** Live marker + trail colour for every other mission: the muted glyph fill. */
export const LIVE_NEUTRAL_COLOR = AIRCRAFT_COLORS.MUTED_FILL;

/** Stable Flight3D path id for a history polyline. Flight ids are minute
 *  stamps, so two tails can share one; the tail keeps them apart. */
export function historyPathKey(p: { tail: string; id: string }): string {
  return `${p.tail}/${p.id}`;
}

/** Inverse of historyPathKey. null when the key is not one of ours. */
export function parseHistoryPathKey(key: string): { tail: string; id: string } | null {
  const i = key.indexOf("/");
  if (i <= 0 || i === key.length - 1) return null;
  return { tail: key.slice(0, i), id: key.slice(i + 1) };
}

/**
 * Path key → colour for a set of history polylines (rules at the top of
 * this file). `selected` is a historyPathKey, or null.
 */
export function historyColors3D(
  polylines: readonly Pick<HistoryPolyline, "id" | "tail" | "points">[],
  selected: string | null = null,
): Record<string, string> {
  const drawn = polylines.filter((p) => p.points.length >= 2);
  const out: Record<string, string> = {};
  if (drawn.length === 1) {
    out[historyPathKey(drawn[0]!)] = SELECTED_FLIGHT_COLOR;
    return out;
  }
  const tails = [...new Set(drawn.map((p) => p.tail))];
  // Up to PER_TAIL_COLOR_MAX tails keep the 2D legend's per-tail colours.
  // Past that, 2D drops to one colour; in 3D that turns 250 stacked
  // flights into one blob, so each flight gets its own instead.
  if (tails.length > 1 && tails.length <= PER_TAIL_COLOR_MAX) {
    const byTail = tailColors3D(tails);
    for (const p of drawn) out[historyPathKey(p)] = byTail[p.tail.toUpperCase()]!;
  } else {
    // Chronological (ids are start-time stamps), so neighbours differ.
    const keys = drawn.map((p) => ({ key: historyPathKey(p), id: p.id })).sort((a, b) => a.id.localeCompare(b.id));
    keys.forEach((k, i) => {
      out[k.key] = FLIGHT_PALETTE_3D[i % FLIGHT_PALETTE_3D.length]!;
    });
  }
  if (selected && selected in out) out[selected] = SELECTED_FLIGHT_COLOR;
  return out;
}

/**
 * History polylines → Flight3D paths, keyed by historyPathKey and coloured
 * by historyColors3D. Points come from historyToFlight3DPaths (TrackPoint
 * shape: speed and track are not in the history payload, so null).
 */
export function historyPaths3D(
  polylines: readonly HistoryPolyline[],
  selected: string | null = null,
): Flight3DPath[] {
  const colors = historyColors3D(polylines, selected);
  const drawn = polylines.filter((p) => p.points.length >= 2);
  const base = historyToFlight3DPaths(drawn, {});
  const out = base.map((path, i) => {
    const key = historyPathKey(drawn[i]!);
    return { ...path, id: key, color: colors[key] };
  });
  // The tapped flight draws last, on top of the stack.
  const at = selected ? out.findIndex((p) => p.id === selected) : -1;
  if (at >= 0) out.push(...out.splice(at, 1));
  return out;
}

/** Replay (scrubber + animated head) only makes sense for one flight. */
export function replayAllowed(paths: readonly unknown[]): boolean {
  return paths.length === 1;
}

// ─── live ────────────────────────────────────────────────────────────

/** Recent trail behind each live marker. */
export const LIVE_TRAIL_MINUTES = 10;

/** /api/trails point; `alt` (ft) only when the server sends it (`alt=1`). */
export type LiveTrailPoint = { lat: number; lon: number; ts: number; alt?: number | null };

export type LiveAircraftLike = {
  tail: string;
  role?: unknown;
  airborne: boolean;
  lat?: number;
  lon?: number;
  altitude_ft?: number;
  nickname?: string | null;
};

export type Live3DMarker = {
  id: string;
  lat: number;
  lon: number;
  altFt: number | null;
  color: string;
  label: string;
};

export function liveColor(a: { role?: unknown }): string {
  return isPoliceMission(a.role) ? LIVE_POLICE_COLOR : LIVE_NEUTRAL_COLOR;
}

function hasPosition(a: LiveAircraftLike): a is LiveAircraftLike & { lat: number; lon: number } {
  return a.airborne && Number.isFinite(a.lat) && Number.isFinite(a.lon);
}

/** Airborne aircraft with a position → markers at their reported altitude. */
export function liveMarkers(aircraft: readonly LiveAircraftLike[]): Live3DMarker[] {
  return aircraft.filter(hasPosition).map((a) => ({
    id: a.tail,
    lat: a.lat,
    lon: a.lon,
    altFt: Number.isFinite(a.altitude_ft) ? (a.altitude_ft as number) : null,
    color: liveColor(a),
    label: a.tail,
  }));
}

/**
 * Trails → Flight3D paths: the last `minutes` of each airborne tail's
 * trail, ending at its live position so the ribbon meets the marker.
 * Trail altitude comes from the trail when the server sends it; gaps
 * (and older servers that send none) are filled by Flight3D from the
 * nearest known value, which is the live altitude.
 */
export function liveTrailPaths(
  trails: Readonly<Record<string, readonly LiveTrailPoint[]>>,
  aircraft: readonly LiveAircraftLike[],
  nowSec: number,
  minutes = LIVE_TRAIL_MINUTES,
): Flight3DPath[] {
  const cutoff = nowSec - minutes * 60;
  const out: Flight3DPath[] = [];
  for (const a of aircraft) {
    if (!hasPosition(a)) continue;
    const raw = trails[a.tail] ?? [];
    const pts: Flight3DPoint[] = raw
      .filter((p) => p.ts >= cutoff && p.ts <= nowSec + 60 && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => ({
        lat: p.lat,
        lon: p.lon,
        alt: p.alt != null && Number.isFinite(p.alt) ? p.alt : null,
        spd: null,
        trk: null,
        ts: p.ts,
      }));
    const lastTs = pts.length > 0 ? pts[pts.length - 1]!.ts : -Infinity;
    const liveAlt = Number.isFinite(a.altitude_ft) ? (a.altitude_ft as number) : null;
    if (nowSec > lastTs) {
      pts.push({ lat: a.lat, lon: a.lon, alt: liveAlt, spd: null, trk: null, ts: nowSec });
    }
    if (pts.length < 2) continue;
    out.push({ id: `live/${a.tail}`, points: pts, color: liveColor(a) });
  }
  return out;
}
