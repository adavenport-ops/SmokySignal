// Orbit / loiter detection over a tail's TrackPoint history.
//
// Pure: no I/O. The enforcement pattern we care about is a fixed-wing
// circling or flying a racetrack over a stretch of highway, which shows up
// in ADS-B as a run of samples whose heading keeps turning the same way
// while the position stays put.
//
// Detection: slide a window of at most `windowS` (default 10 min) over the
// points. A window qualifies when the cumulative *signed* heading change
// reaches `minTurnDeg` (default 360°) and every point in it stays within
// `maxRadiusNm` (default 3 nm) of the window centroid. Overlapping
// qualifying windows whose centroids stay within `maxRadiusNm` of each
// other merge into one OrbitSegment.
//
// Signed (not absolute) turning is deliberate: heading jitter on a straight
// line and S-turns cancel out, while a circle or racetrack accumulates.
//
// Heading per point comes from `trk` when present; otherwise it is derived
// from the bearing between consecutive positions. Deltas are wrapped into
// (-180°, 180°], so 350° → 10° is +20°, not -340°.

import { haversineNm } from "./geo";
import { corridorLabel } from "./corridor";
import type { TrackPoint } from "./tracks";

export type OrbitSegment = {
  /** Unix seconds of the first point in the segment. */
  startTs: number;
  /** Unix seconds of the last point in the segment. */
  endTs: number;
  centroid: { lat: number; lon: number };
  /** Mean distance of the segment's points from the centroid, nm. */
  radiusNm: number;
  /** Full circuits flown (|signed heading change| / 360), one decimal. */
  turns: number;
  durationS: number;
  /** Corridor label for the centroid, e.g. "I-5 · Fife". */
  corridor?: string;
};

export type OrbitOptions = {
  /** Max window span, seconds. Default 600. */
  windowS?: number;
  /** Cumulative signed heading change that counts as an orbit, degrees. Default 360. */
  minTurnDeg?: number;
  /** Max distance of any window point from the window centroid, nm. Default 3. */
  maxRadiusNm?: number;
  /** A sample gap longer than this breaks the track into separate runs, seconds. Default 180. */
  maxGapS?: number;
};

export type FlightPhase = "working a pattern" | "in transit" | "unknown";

const DEFAULTS = {
  windowS: 600,
  minTurnDeg: 360,
  maxRadiusNm: 3,
  maxGapS: 180,
} as const;

/**
 * Straight-flight samples at a segment's edges (turning less than this per
 * step) belong to the transit in or out, not the pattern; they are trimmed.
 */
const EDGE_TRIM_DEG = 5;

/** Positions closer than this are too noisy to derive a bearing from. */
const MIN_BEARING_NM = 0.01;

/** Normalize any angle into [0, 360). */
export function normalizeDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed shortest turn from heading a to heading b, in (-180, 180]. */
export function headingDelta(a: number, b: number): number {
  let d = normalizeDeg(b) - normalizeDeg(a);
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Initial great-circle bearing from point 1 to point 2, degrees [0, 360). */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
}

/** Sort by ts, drop non-finite positions and duplicate timestamps. */
function clean(points: ReadonlyArray<TrackPoint>): TrackPoint[] {
  const valid = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ts),
  );
  valid.sort((a, b) => a.ts - b.ts);
  const out: TrackPoint[] = [];
  for (const p of valid) {
    if (out.length > 0 && out[out.length - 1]!.ts === p.ts) continue;
    out.push(p);
  }
  return out;
}

/**
 * Heading for each point: reported `trk` when finite, else the bearing
 * from the previous point (or to the next one, for the first point), else
 * the last known heading. Null only when nothing can be inferred.
 */
export function resolveHeadings(points: ReadonlyArray<TrackPoint>): (number | null)[] {
  const out: (number | null)[] = new Array(points.length).fill(null);
  let last: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    let h: number | null = null;
    if (p.trk != null && Number.isFinite(p.trk)) {
      h = normalizeDeg(p.trk);
    } else {
      const prev = points[i - 1];
      const next = points[i + 1];
      if (prev && haversineNm(prev.lat, prev.lon, p.lat, p.lon) >= MIN_BEARING_NM) {
        h = bearingDeg(prev.lat, prev.lon, p.lat, p.lon);
      } else if (next && haversineNm(p.lat, p.lon, next.lat, next.lon) >= MIN_BEARING_NM) {
        h = bearingDeg(p.lat, p.lon, next.lat, next.lon);
      } else {
        h = last;
      }
    }
    out[i] = h;
    if (h != null) last = h;
  }
  return out;
}

function centroidOf(points: ReadonlyArray<TrackPoint>, from: number, to: number) {
  let lat = 0;
  let lon = 0;
  const n = to - from + 1;
  for (let k = from; k <= to; k++) {
    lat += points[k]!.lat;
    lon += points[k]!.lon;
  }
  return { lat: lat / n, lon: lon / n };
}

function maxDistFrom(
  points: ReadonlyArray<TrackPoint>,
  from: number,
  to: number,
  c: { lat: number; lon: number },
): number {
  let m = 0;
  for (let k = from; k <= to; k++) {
    const d = haversineNm(c.lat, c.lon, points[k]!.lat, points[k]!.lon);
    if (d > m) m = d;
  }
  return m;
}

function meanDistFrom(
  points: ReadonlyArray<TrackPoint>,
  from: number,
  to: number,
  c: { lat: number; lon: number },
): number {
  let s = 0;
  for (let k = from; k <= to; k++) s += haversineNm(c.lat, c.lon, points[k]!.lat, points[k]!.lon);
  return s / (to - from + 1);
}

/**
 * Detect orbit / loiter segments in a track. Points need not be sorted.
 * Returns segments in chronological order; empty when nothing qualifies.
 */
export function detectOrbits(
  input: ReadonlyArray<TrackPoint>,
  opts: OrbitOptions = {},
): OrbitSegment[] {
  const windowS = opts.windowS ?? DEFAULTS.windowS;
  const minTurn = opts.minTurnDeg ?? DEFAULTS.minTurnDeg;
  const maxR = opts.maxRadiusNm ?? DEFAULTS.maxRadiusNm;
  const maxGapS = opts.maxGapS ?? DEFAULTS.maxGapS;

  const pts = clean(input);
  const n = pts.length;
  if (n < 3) return [];

  const heads = resolveHeadings(pts);
  // turn[k] = signed heading change from point k-1 to k; run[k] = run id
  // (a new run starts after any gap > maxGapS). prefix[k] = sum turn[1..k].
  const turn = new Array<number>(n).fill(0);
  const run = new Array<number>(n).fill(0);
  for (let k = 1; k < n; k++) {
    const gap = pts[k]!.ts - pts[k - 1]!.ts;
    run[k] = gap > maxGapS ? run[k - 1]! + 1 : run[k - 1]!;
    const a = heads[k - 1] ?? null;
    const b = heads[k] ?? null;
    turn[k] = run[k]! === run[k - 1]! && a != null && b != null ? headingDelta(a, b) : 0;
  }
  const prefix = new Array<number>(n).fill(0);
  for (let k = 1; k < n; k++) prefix[k] = prefix[k - 1]! + turn[k]!;

  // Qualifying windows [i, j]: the shortest window from each i that hits
  // the turn threshold within windowS, same run, and stays compact.
  type Win = { i: number; j: number; c: { lat: number; lon: number } };
  const wins: Win[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (run[j]! !== run[i]!) break;
      if (pts[j]!.ts - pts[i]!.ts > windowS) break;
      const sum = prefix[j]! - prefix[i]!;
      if (Math.abs(sum) < minTurn) continue;
      const c = centroidOf(pts, i, j);
      if (maxDistFrom(pts, i, j, c) <= maxR) wins.push({ i, j, c });
      break;
    }
  }
  if (wins.length === 0) return [];

  // Merge overlapping / touching windows into segments while the merged
  // centroid stays within maxR of where the loiter started.
  const spans: { i: number; j: number }[] = [];
  let cur = { i: wins[0]!.i, j: wins[0]!.j, anchor: wins[0]!.c };
  for (let w = 1; w < wins.length; w++) {
    const win = wins[w]!;
    const touches = win.i <= cur.j && run[win.i]! === run[cur.j]!;
    const near = haversineNm(cur.anchor.lat, cur.anchor.lon, win.c.lat, win.c.lon) <= maxR;
    if (touches && near) {
      if (win.j > cur.j) cur.j = win.j;
    } else {
      spans.push({ i: cur.i, j: cur.j });
      cur = { i: win.i, j: win.j, anchor: win.c };
    }
  }
  spans.push({ i: cur.i, j: cur.j });

  return spans.map((span) => {
    let { i, j } = span;
    while (j - i > 2 && Math.abs(turn[i + 1]!) < EDGE_TRIM_DEG) i++;
    while (j - i > 2 && Math.abs(turn[j]!) < EDGE_TRIM_DEG) j--;
    const centroid = centroidOf(pts, i, j);
    const total = Math.abs(prefix[j]! - prefix[i]!);
    const seg: OrbitSegment = {
      startTs: pts[i]!.ts,
      endTs: pts[j]!.ts,
      centroid,
      radiusNm: meanDistFrom(pts, i, j, centroid),
      turns: Math.round((total / 360) * 10) / 10,
      durationS: pts[j]!.ts - pts[i]!.ts,
    };
    const label = corridorLabel(centroid.lat, centroid.lon);
    if (label) seg.corridor = label;
    return seg;
  });
}

export type PhaseOptions = OrbitOptions & {
  /** Look-back from the latest point, seconds. Default 600. */
  lookbackS?: number;
};

/**
 * What the tail has been doing over roughly the last 10 minutes of the
 * track: "working a pattern" (orbiting / loitering), "in transit"
 * (mostly straight, covering ground) or "unknown" (too little data, on
 * the ground, or neither).
 */
export function classifyFlightPhase(
  input: ReadonlyArray<TrackPoint>,
  opts: PhaseOptions = {},
): FlightPhase {
  const lookbackS = opts.lookbackS ?? 600;
  const maxR = opts.maxRadiusNm ?? DEFAULTS.maxRadiusNm;
  const maxGapS = opts.maxGapS ?? DEFAULTS.maxGapS;
  const all = clean(input);
  if (all.length < 3) return "unknown";
  const latestTs = all[all.length - 1]!.ts;
  // Only the trailing contiguous run within the look-back.
  let start = all.length - 1;
  while (
    start > 0 &&
    latestTs - all[start - 1]!.ts <= lookbackS &&
    all[start]!.ts - all[start - 1]!.ts <= maxGapS
  ) {
    start--;
  }
  const pts = all.slice(start);
  if (pts.length < 3) return "unknown";
  const spanS = pts[pts.length - 1]!.ts - pts[0]!.ts;
  if (spanS < 120) return "unknown";

  // A full orbit anywhere in the look-back wins outright.
  if (detectOrbits(pts, { ...opts, windowS: lookbackS }).length > 0) {
    return "working a pattern";
  }

  let pathNm = 0;
  for (let k = 1; k < pts.length; k++) {
    pathNm += haversineNm(pts[k - 1]!.lat, pts[k - 1]!.lon, pts[k]!.lat, pts[k]!.lon);
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const dispNm = haversineNm(first.lat, first.lon, last.lat, last.lon);
  const c = centroidOf(pts, 0, pts.length - 1);
  const spread = maxDistFrom(pts, 0, pts.length - 1, c);

  // Barely moving: on the ground or hovering with no turning signal.
  if (pathNm < 0.5) return "unknown";

  const straightness = dispNm / pathNm;
  const heads = resolveHeadings(pts);
  let turn = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = heads[k - 1] ?? null;
    const b = heads[k] ?? null;
    if (a != null && b != null) turn += headingDelta(a, b);
  }

  // Most of a circle, or lots of flying that ends up near where it began.
  if (spread <= maxR && (Math.abs(turn) >= 270 || (straightness < 0.35 && pathNm >= 2))) {
    return "working a pattern";
  }
  if (straightness >= 0.7 && dispNm >= 2) return "in transit";
  return "unknown";
}
