// Geometry for the 1200x1500 flight card (/flight/[tail]/[flightId]/card).
//
// Pure. Turns a session's track points into SVG path strings fitted to a
// box: the ground track as a map silhouette (equirectangular, longitude
// scaled by cos(latitude) so shapes are not stretched, aspect preserved,
// north up) and the altitude profile as a sparkline over time.

import type { TrackPoint } from "./tracks";

export type Box = { width: number; height: number; pad?: number };
export type XY = { x: number; y: number };

export type TrackGeometry = {
  /** SVG path ("M x y L x y ..."), or "" when there is nothing to draw. */
  d: string;
  start: XY | null;
  end: XY | null;
  /** Projected positions with their timestamps, oldest first. */
  xy: (XY & { ts: number })[];
};

/** Cap on vertices drawn. A 4-hour sortie at 30 s is ~480 points. */
export const MAX_CARD_POINTS = 600;

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function cleanPoints(points: ReadonlyArray<TrackPoint>): TrackPoint[] {
  return points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);
}

/** Every k-th point so at most `max` remain, always keeping the last one. */
export function decimate<T>(list: ReadonlyArray<T>, max: number): T[] {
  if (list.length <= max) return [...list];
  const stride = Math.ceil(list.length / max);
  const out: T[] = [];
  for (let i = 0; i < list.length; i += stride) out.push(list[i]!);
  if (out[out.length - 1] !== list[list.length - 1]) out.push(list[list.length - 1]!);
  return out;
}

function pathFrom(xy: ReadonlyArray<XY>): string {
  if (xy.length === 0) return "";
  return xy.map((p, i) => `${i === 0 ? "M" : "L"}${r1(p.x)} ${r1(p.y)}`).join(" ");
}

/**
 * Fit the ground track into the box, centered, aspect preserved. A
 * zero-extent track (one fix, or a tail parked on the ramp) lands in the
 * middle of the box.
 */
export function projectTrack(points: ReadonlyArray<TrackPoint>, box: Box): TrackGeometry {
  const pts = decimate(cleanPoints(points), MAX_CARD_POINTS);
  if (pts.length === 0) return { d: "", start: null, end: null, xy: [] };
  const pad = box.pad ?? 0;
  const w = Math.max(1, box.width - 2 * pad);
  const h = Math.max(1, box.height - 2 * pad);

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLon - minLon) * k;
  const spanY = maxLat - minLat;
  const scale = spanX === 0 && spanY === 0 ? 0 : Math.min(spanX > 0 ? w / spanX : Infinity, spanY > 0 ? h / spanY : Infinity);
  const offX = pad + (w - spanX * scale) / 2;
  const offY = pad + (h - spanY * scale) / 2;

  const xy = pts.map((p) => ({
    x: offX + (p.lon - minLon) * k * scale,
    // North up: larger latitude, smaller y.
    y: offY + (maxLat - p.lat) * scale,
    ts: p.ts,
  }));
  const start = xy[0]!;
  const end = xy[xy.length - 1]!;
  return { d: pathFrom(xy), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, xy };
}

/** Path over the projected fixes between two timestamps (unix s), inclusive. */
export function subPath(geom: TrackGeometry, fromTs: number, toTs: number): string {
  const part = geom.xy.filter((p) => p.ts >= fromTs && p.ts <= toTs);
  return part.length >= 2 ? pathFrom(part) : "";
}

export type Sparkline = {
  /** Line path, or "" with fewer than two altitude readings. */
  d: string;
  /** Same line closed down to the baseline, for a filled area. */
  area: string;
  max_alt_ft: number;
  min_alt_ft: number;
};

/**
 * Altitude over time. X spans first to last fix; Y runs from 0 ft at the
 * baseline to the flight's peak (plus a little headroom) at the top.
 * Fixes without an altitude are skipped rather than drawn as zero.
 */
export function altitudeSparkline(points: ReadonlyArray<TrackPoint>, box: Box): Sparkline {
  const pts = decimate(
    cleanPoints(points).filter((p) => typeof p.alt === "number" && Number.isFinite(p.alt)),
    MAX_CARD_POINTS,
  );
  if (pts.length < 2) return { d: "", area: "", max_alt_ft: pts[0]?.alt ?? 0, min_alt_ft: pts[0]?.alt ?? 0 };
  const pad = box.pad ?? 0;
  const w = Math.max(1, box.width - 2 * pad);
  const h = Math.max(1, box.height - 2 * pad);
  const t0 = pts[0]!.ts;
  const span = Math.max(1, pts[pts.length - 1]!.ts - t0);
  let max = 0;
  let min = Infinity;
  for (const p of pts) {
    const a = Math.max(0, p.alt as number);
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const top = max > 0 ? max * 1.1 : 1;
  const xy = pts.map((p) => ({
    x: pad + ((p.ts - t0) / span) * w,
    y: pad + h - (Math.max(0, p.alt as number) / top) * h,
  }));
  const d = pathFrom(xy);
  const base = r1(pad + h);
  const area = `${d} L${r1(xy[xy.length - 1]!.x)} ${base} L${r1(xy[0]!.x)} ${base} Z`;
  return { d, area, max_alt_ft: max, min_alt_ft: min === Infinity ? 0 : min };
}

export type CardRoute = {
  /** Big mono line: field codes, e.g. "S50 → KOLM" or just "S50". */
  codes: string;
  /** Plain line under it, e.g. "Auburn Municipal (S50) → landed off-field or out of range". */
  names: string;
};

/**
 * Route lines for the flight card. A field we could not place is said
 * in rider terms ("off-field or out of range"), never as a dash or
 * "not resolved".
 */
export function cardRoute(opts: {
  dep: string | null;
  arr: string | null;
  inProgress: boolean;
  nameOf: (id: string) => string | null;
}): CardRoute {
  const { dep, arr, inProgress, nameOf } = opts;
  const field = (id: string) => {
    const name = nameOf(id);
    return name && name !== id ? `${name} (${id})` : id;
  };
  const from = dep ? field(dep) : "Took off off-field or out of range";
  const to = inProgress ? "still up" : arr ? field(arr) : "landed off-field or out of range";
  const codeParts = [dep, inProgress ? "UP" : arr].filter((c): c is string => Boolean(c));
  const codes = dep && (inProgress || arr) ? codeParts.join(" → ") : codeParts.join(" ");
  return { codes: codes || "Off-field", names: `${from} → ${to}` };
}
