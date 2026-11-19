// Pure geometry + timing helpers for the 3D flight view (components/Flight3D.tsx).
//
// No DOM, no deck.gl, no MapLibre: everything here is plain math so it can be
// unit-tested under node:test and reused by the later /radar and date-range
// 3D overlays.
//
// Conventions:
//   - Positions are deck.gl LNGLAT triples [lon, lat, z], z in meters.
//   - Vertical scale: terrain is drawn exaggerated (TERRAIN_EXAGGERATION) and
//     aircraft altitudes are scaled by the same factor, so a plane 300 m above
//     a ridge still reads as 300 m (times the factor) above that ridge. HUD
//     readouts always show the true altitude in feet.
//   - Replay time is seconds relative to a clock origin t0, not unix seconds.
//     TripsLayer packs timestamps into float32 attributes; unix seconds
//     (~1.8e9) lose precision there, offsets from t0 do not.

import { haversineNm } from "./geo";
import type { OrbitSegment } from "./orbit";
import type { TrackPoint } from "./tracks";

export const FT_TO_M = 0.3048;
export const NM_TO_M = 1852;
export const TERRAIN_EXAGGERATION = 1.3;
/** Vertex budget across all rendered paths. */
export const MAX_VERTICES = 3000;

export type Position3 = [number, number, number];

/** Feet → meters, then the shared vertical exaggeration. */
export function altitudeZ(altFt: number, exaggeration = TERRAIN_EXAGGERATION): number {
  return altFt * FT_TO_M * exaggeration;
}

/**
 * One altitude (ft) per point with gaps filled. ADS-B drops altitude near the
 * ground and on bad samples; a null in the middle of a track is linearly
 * interpolated by time between its neighbours, nulls at either edge take the
 * nearest known value, and an all-null track sits at 0.
 */
export function fillAltitudes(points: ReadonlyArray<TrackPoint>): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(0);
  const known: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i]!.alt;
    if (a != null && Number.isFinite(a)) known.push(i);
  }
  if (known.length === 0) return out;
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < known.length - 1 && known[k + 1]! <= i) k++;
    const lo = known[k]!;
    if (i <= known[0]!) {
      out[i] = points[known[0]!]!.alt as number;
    } else if (i >= known[known.length - 1]!) {
      out[i] = points[known[known.length - 1]!]!.alt as number;
    } else if (lo === i) {
      out[i] = points[i]!.alt as number;
    } else {
      const hi = known[k + 1]!;
      const a0 = points[lo]!.alt as number;
      const a1 = points[hi]!.alt as number;
      const t0 = points[lo]!.ts;
      const t1 = points[hi]!.ts;
      const f = t1 > t0 ? (points[i]!.ts - t0) / (t1 - t0) : (i - lo) / (hi - lo);
      out[i] = a0 + (a1 - a0) * f;
    }
  }
  return out;
}

/** A track point with its altitude resolved (never null). */
export type ResolvedPoint = {
  lat: number;
  lon: number;
  altFt: number;
  spd: number | null;
  trk: number | null;
  ts: number;
};

/** Sort by ts, drop non-finite positions and duplicate timestamps, fill altitudes. */
export function resolveTrack(points: ReadonlyArray<TrackPoint>): ResolvedPoint[] {
  const valid = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ts))
    .slice()
    .sort((a, b) => a.ts - b.ts);
  const dedup: TrackPoint[] = [];
  for (const p of valid) {
    if (dedup.length > 0 && dedup[dedup.length - 1]!.ts === p.ts) continue;
    dedup.push(p);
  }
  const alts = fillAltitudes(dedup);
  return dedup.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    altFt: alts[i]!,
    spd: p.spd,
    trk: p.trk,
    ts: p.ts,
  }));
}

/** [lon, lat, z] for a resolved point. */
export function toPosition(p: ResolvedPoint, exaggeration = TERRAIN_EXAGGERATION): Position3 {
  return [p.lon, p.lat, altitudeZ(p.altFt, exaggeration)];
}

// ---------------------------------------------------------------------------
// Decimation
// ---------------------------------------------------------------------------

const M_PER_DEG_LAT = 111_320;

/** Local equirectangular projection to meters around a reference latitude. */
function toXYZ(p: ResolvedPoint, cosLat: number): [number, number, number] {
  return [p.lon * M_PER_DEG_LAT * cosLat, p.lat * M_PER_DEG_LAT, p.altFt * FT_TO_M];
}

function segDist(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (len2 > 0) {
    t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = p[0] - (a[0] + abx * t);
  const dy = p[1] - (a[1] + aby * t);
  const dz = p[2] - (a[2] + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Ramer–Douglas–Peucker keep-mask at tolerance `eps` meters (iterative). */
function rdpMask(xyz: [number, number, number][], eps: number): boolean[] {
  const n = xyz.length;
  const keep = new Array<boolean>(n).fill(false);
  if (n === 0) return keep;
  keep[0] = true;
  keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(xyz[i]!, xyz[s]!, xyz[e]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return keep;
}

/** Evenly spaced indices, first and last always kept. */
function strideSample<T>(items: ReadonlyArray<T>, max: number): T[] {
  const n = items.length;
  if (n <= max) return items.slice();
  if (max <= 1) return [items[0]!];
  const out: T[] = [];
  for (let k = 0; k < max; k++) out.push(items[Math.round((k * (n - 1)) / (max - 1))]!);
  return out;
}

/**
 * Reduce a track to at most `max` points while keeping its shape. Runs
 * Douglas–Peucker in local meters (altitude included) with a growing
 * tolerance, then falls back to even striding if that still overshoots.
 * Endpoints are always kept; order is preserved.
 */
export function decimate(points: ReadonlyArray<ResolvedPoint>, max: number): ResolvedPoint[] {
  const n = points.length;
  if (n <= max) return points.slice();
  if (max < 2) return points.slice(0, Math.max(0, max));
  const cosLat = Math.cos(((points[0]!.lat ?? 0) * Math.PI) / 180);
  const xyz = points.map((p) => toXYZ(p, cosLat));
  let eps = 2; // meters
  for (let iter = 0; iter < 24; iter++) {
    const mask = rdpMask(xyz, eps);
    let count = 0;
    for (const m of mask) if (m) count++;
    if (count <= max) return points.filter((_, i) => mask[i]);
    eps *= 1.6;
  }
  return strideSample(points, max);
}

/**
 * Split a shared vertex budget across several tracks in proportion to their
 * length (each keeps at least 2 points when it has them).
 */
export function decimateAll(
  tracks: ReadonlyArray<ReadonlyArray<ResolvedPoint>>,
  maxTotal = MAX_VERTICES,
): ResolvedPoint[][] {
  const total = tracks.reduce((s, t) => s + t.length, 0);
  if (total <= maxTotal) return tracks.map((t) => t.slice());
  return tracks.map((t) => {
    const share = Math.max(Math.min(2, t.length), Math.floor((t.length / total) * maxTotal));
    return decimate(t, share);
  });
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Densify a track with a centripetal Catmull-Rom spline so 30 s ADS-B
 * samples draw as curves instead of polygons. Each segment gets `subdiv`
 * pieces (1 returns a copy). The spline runs in local meters with altitude
 * included; timestamps and speed are interpolated linearly per segment, so
 * replay timing and HUD numbers stay faithful to the samples. Original
 * samples are kept exactly. Segments that span a gap longer than `maxGapS`
 * are left straight.
 */
export function smoothTrack(
  points: ReadonlyArray<ResolvedPoint>,
  subdiv: number,
  maxGapS = 180,
): ResolvedPoint[] {
  const n = points.length;
  const k = Math.max(1, Math.floor(subdiv));
  if (n < 3 || k === 1) return points.slice();
  const cosLat = Math.cos(((points[0]!.lat ?? 0) * Math.PI) / 180) || 1e-9;
  const xyz = points.map((p) => toXYZ(p, cosLat));
  const out: ResolvedPoint[] = [];
  const knot = (a: [number, number, number], b: [number, number, number]) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    return Math.max(1e-6, Math.sqrt(d)); // centripetal: alpha = 0.5
  };
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push(a);
    if (b.ts - a.ts > maxGapS) continue;
    const P1 = xyz[i]!;
    const P2 = xyz[i + 1]!;
    // Mirror the end points so the first / last segments still curve.
    const P0 = i > 0 ? xyz[i - 1]! : ([2 * P1[0] - P2[0], 2 * P1[1] - P2[1], 2 * P1[2] - P2[2]] as [number, number, number]);
    const P3 =
      i + 2 < n ? xyz[i + 2]! : ([2 * P2[0] - P1[0], 2 * P2[1] - P1[1], 2 * P2[2] - P1[2]] as [number, number, number]);
    const t0 = 0;
    const t1 = t0 + knot(P0, P1);
    const t2 = t1 + knot(P1, P2);
    const t3 = t2 + knot(P2, P3);
    for (let s = 1; s < k; s++) {
      const f = s / k;
      const t = t1 + (t2 - t1) * f;
      const pt: number[] = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const A1 = ((t1 - t) / (t1 - t0)) * P0[c]! + ((t - t0) / (t1 - t0)) * P1[c]!;
        const A2 = ((t2 - t) / (t2 - t1)) * P1[c]! + ((t - t1) / (t2 - t1)) * P2[c]!;
        const A3 = ((t3 - t) / (t3 - t2)) * P2[c]! + ((t - t2) / (t3 - t2)) * P3[c]!;
        const B1 = ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
        const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
        pt[c] = ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
      }
      out.push({
        lon: pt[0]! / (M_PER_DEG_LAT * cosLat),
        lat: pt[1]! / M_PER_DEG_LAT,
        altFt: pt[2]! / FT_TO_M,
        spd: a.spd == null ? b.spd : b.spd == null ? a.spd : a.spd + (b.spd - a.spd) * f,
        trk: null,
        ts: a.ts + (b.ts - a.ts) * f,
      });
    }
  }
  out.push(points[n - 1]!);
  return out;
}

/** Subdivisions per segment that keep `count` points under `budget`, capped at `max`. */
export function smoothingFactor(count: number, budget = MAX_VERTICES, max = 4): number {
  if (count < 2) return 1;
  return Math.max(1, Math.min(max, Math.floor((budget - 1) / (count - 1))));
}

/**
 * Principal-axis direction of a track as a compass bearing in [0, 180):
 * the way the flight mostly runs, ignoring which end is which.
 */
export function principalBearing(points: ReadonlyArray<{ lat: number; lon: number }>): number {
  if (points.length < 2) return 0;
  const cosLat = Math.cos((points[0]!.lat * Math.PI) / 180) || 1e-9;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.lon * cosLat;
    my += p.lat;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const x = p.lon * cosLat - mx;
    const y = p.lat - my;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  // Angle of the major axis from +x (east), counterclockwise.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // Compass bearing: clockwise from north.
  const bearing = 90 - (theta * 180) / Math.PI;
  return ((bearing % 180) + 180) % 180;
}

/** Fold any bearing into (-90, 90] so the camera stays roughly north-up. */
export function foldBearing(b: number): number {
  let x = ((b % 180) + 180) % 180; // [0, 180)
  if (x > 90) x -= 180;
  return x;
}

// ---------------------------------------------------------------------------
// Replay clock
// ---------------------------------------------------------------------------

export type ReplayClock = {
  /** Unix seconds at progress 0. */
  t0: number;
  /** Unix seconds at progress 1. */
  t1: number;
  /** Wall-clock length of a full replay, ms. */
  playMs: number;
};

export type ReplayOptions = {
  /** Flight seconds per wall-clock second. Default 120. */
  speed?: number;
  /** Shortest full replay, ms. Default 15000. */
  minMs?: number;
  /** Longest full replay, ms. Default 60000. */
  maxMs?: number;
};

/** Build the replay clock for a flight spanning [startTs, endTs] (unix s). */
export function replayClock(startTs: number, endTs: number, opts: ReplayOptions = {}): ReplayClock {
  const speed = opts.speed ?? 120;
  const minMs = opts.minMs ?? 15_000;
  const maxMs = opts.maxMs ?? 60_000;
  const t0 = Math.min(startTs, endTs);
  const t1 = Math.max(startTs, endTs);
  const raw = ((t1 - t0) / speed) * 1000;
  return { t0, t1, playMs: Math.min(maxMs, Math.max(minMs, raw)) };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Progress [0, 1] → unix seconds. */
export function progressToTs(clock: ReplayClock, progress: number): number {
  return clock.t0 + clamp01(progress) * (clock.t1 - clock.t0);
}

/** Unix seconds → progress [0, 1]. A zero-length flight is always at 1. */
export function tsToProgress(clock: ReplayClock, ts: number): number {
  const span = clock.t1 - clock.t0;
  if (span <= 0) return 1;
  return clamp01((ts - clock.t0) / span);
}

/** Advance progress by a wall-clock frame delta, clamped at 1. */
export function advanceProgress(clock: ReplayClock, progress: number, dtMs: number): number {
  if (clock.playMs <= 0) return 1;
  return clamp01(progress + Math.max(0, dtMs) / clock.playMs);
}

/** Seconds from the clock origin: what TripsLayer timestamps and currentTime use. */
export function relativeTs(clock: ReplayClock, ts: number): number {
  return ts - clock.t0;
}

function lerpHeading(a: number, b: number, f: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d === -180) d = 180;
  return (((a + d * f) % 360) + 360) % 360;
}

/**
 * Interpolated aircraft state at unix second `ts`. Clamps to the first/last
 * point outside the track's span. Null for an empty track.
 */
export function sampleAt(points: ReadonlyArray<ResolvedPoint>, ts: number): ResolvedPoint | null {
  const n = points.length;
  if (n === 0) return null;
  if (ts <= points[0]!.ts) return { ...points[0]! };
  if (ts >= points[n - 1]!.ts) return { ...points[n - 1]! };
  // Binary search for the segment [lo, lo + 1] containing ts.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.ts <= ts) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const f = b.ts > a.ts ? (ts - a.ts) / (b.ts - a.ts) : 0;
  const mix = (x: number | null, y: number | null) =>
    x == null ? y : y == null ? x : x + (y - x) * f;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    altFt: a.altFt + (b.altFt - a.altFt) * f,
    spd: mix(a.spd, b.spd),
    trk: a.trk == null ? b.trk : b.trk == null ? a.trk : lerpHeading(a.trk, b.trk, f),
    ts,
  };
}

// ---------------------------------------------------------------------------
// Orbit rings
// ---------------------------------------------------------------------------

/** Smallest ring drawn, nm. Tight hovers still read as a ring. */
export const MIN_RING_NM = 0.25;

/** Median altitude (ft) of the points inside an orbit's time window. */
export function orbitAltitudeFt(points: ReadonlyArray<ResolvedPoint>, orbit: OrbitSegment): number {
  const alts = points
    .filter((p) => p.ts >= orbit.startTs && p.ts <= orbit.endTs)
    .map((p) => p.altFt)
    .sort((a, b) => a - b);
  if (alts.length === 0) {
    const s = sampleAt(points, (orbit.startTs + orbit.endTs) / 2);
    return s?.altFt ?? 0;
  }
  const mid = alts.length >> 1;
  return alts.length % 2 ? alts[mid]! : (alts[mid - 1]! + alts[mid]!) / 2;
}

/**
 * Closed ring of `segments` + 1 positions (first === last) of radius
 * `radiusNm` around `center`, at height `z` meters.
 */
export function ringPositions(
  center: { lat: number; lon: number },
  radiusNm: number,
  z: number,
  segments = 64,
): Position3[] {
  const r = Math.max(MIN_RING_NM, radiusNm) * NM_TO_M;
  const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1e-9;
  const out: Position3[] = [];
  for (let k = 0; k <= segments; k++) {
    const th = ((k % segments) / segments) * Math.PI * 2;
    const dLat = (r * Math.cos(th)) / M_PER_DEG_LAT;
    const dLon = (r * Math.sin(th)) / (M_PER_DEG_LAT * cosLat);
    out.push([center.lon + dLon, center.lat + dLat, z]);
  }
  return out;
}

/** "22 min" / "1 h 05 min". */
export function fmtMinutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "Worked a pattern · I-5 · Fife · 22 min" (corridor omitted when unknown). */
export function orbitLabel(orbit: OrbitSegment): string {
  const parts = ["Worked a pattern"];
  if (orbit.corridor) parts.push(orbit.corridor);
  parts.push(fmtMinutes(orbit.durationS));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export type Bounds = { minLon: number; minLat: number; maxLon: number; maxLat: number };

/** Lon/lat bounds over every point, or null when there are none. */
export function boundsOf(tracks: ReadonlyArray<ReadonlyArray<{ lat: number; lon: number }>>): Bounds | null {
  let b: Bounds | null = null;
  for (const t of tracks) {
    for (const p of t) {
      if (!b) b = { minLon: p.lon, minLat: p.lat, maxLon: p.lon, maxLat: p.lat };
      else {
        if (p.lon < b.minLon) b.minLon = p.lon;
        if (p.lon > b.maxLon) b.maxLon = p.lon;
        if (p.lat < b.minLat) b.minLat = p.lat;
        if (p.lat > b.maxLat) b.maxLat = p.lat;
      }
    }
  }
  return b;
}

/** Pad tiny bounds (a hover, a single point) out to at least `minNm` across. */
export function padBounds(b: Bounds, minNm = 2): Bounds {
  const midLat = (b.minLat + b.maxLat) / 2;
  const widthNm = haversineNm(midLat, b.minLon, midLat, b.maxLon);
  const heightNm = haversineNm(b.minLat, b.minLon, b.maxLat, b.minLon);
  const out = { ...b };
  if (heightNm < minNm) {
    const half = (minNm * NM_TO_M) / M_PER_DEG_LAT / 2;
    const mid = (b.minLat + b.maxLat) / 2;
    out.minLat = mid - half;
    out.maxLat = mid + half;
  }
  if (widthNm < minNm) {
    const cosLat = Math.cos((midLat * Math.PI) / 180) || 1e-9;
    const half = (minNm * NM_TO_M) / (M_PER_DEG_LAT * cosLat) / 2;
    const mid = (b.minLon + b.maxLon) / 2;
    out.minLon = mid - half;
    out.maxLon = mid + half;
  }
  return out;
}

/** Hex "#RRGGBB" → [r, g, b, a]. */
export function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 122, 26, alpha];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha];
}
