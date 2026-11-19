// Synthetic track generators shared by corridor / orbit / airports tests.
// Not imported by app code.

import type { TrackPoint } from "./tracks";

const NM_PER_DEG_LAT = 60;

/** Offset a lat/lon by (east, north) nautical miles. */
export function offsetNm(lat: number, lon: number, eastNm: number, northNm: number) {
  return {
    lat: lat + northNm / NM_PER_DEG_LAT,
    lon: lon + eastNm / (NM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
  };
}

function compass(dxEast: number, dyNorth: number): number {
  const d = (Math.atan2(dxEast, dyNorth) * 180) / Math.PI;
  return d < 0 ? d + 360 : d;
}

export type GenOpts = {
  startTs?: number;
  stepS?: number;
  speedKt?: number;
  alt?: number | null;
  /** Drop trk from every point (forces bearing derivation). */
  noTrk?: boolean;
};

/**
 * Racetrack: two straight legs of `legNm` joined by semicircles of
 * `turnRadiusNm`, flown clockwise, long axis along `axisDeg` (0 = N-S).
 * Centred on (lat, lon).
 */
export function racetrack(
  lat: number,
  lon: number,
  durationS: number,
  opts: GenOpts & { legNm?: number; turnRadiusNm?: number; axisDeg?: number } = {},
): TrackPoint[] {
  const startTs = opts.startTs ?? 1_763_400_000;
  const stepS = opts.stepS ?? 30;
  const speed = (opts.speedKt ?? 100) / 3600; // nm per second
  const L = opts.legNm ?? 2;
  const r = opts.turnRadiusNm ?? 0.7;
  const axis = ((opts.axisDeg ?? 90) * Math.PI) / 180;
  const perim = 2 * L + 2 * Math.PI * r;

  // Position along the track in a local frame where the long axis is +u
  // and the short axis is +v; clockwise when viewed from above.
  function at(s: number): { u: number; v: number; du: number; dv: number } {
    const t = ((s % perim) + perim) % perim;
    if (t < L) return { u: -L / 2 + t, v: r, du: 1, dv: 0 }; // top leg, heading +u
    if (t < L + Math.PI * r) {
      const a = (t - L) / r; // 0..π around the +u end
      return { u: L / 2 + r * Math.sin(a), v: r * Math.cos(a), du: Math.cos(a), dv: -Math.sin(a) };
    }
    if (t < 2 * L + Math.PI * r) {
      const k = t - L - Math.PI * r;
      return { u: L / 2 - k, v: -r, du: -1, dv: 0 };
    }
    const a = (t - 2 * L - Math.PI * r) / r;
    return { u: -L / 2 - r * Math.sin(a), v: -r * Math.cos(a), du: -Math.cos(a), dv: Math.sin(a) };
  }

  // Rotate local (u along axis bearing, v 90° clockwise of it) into east/north.
  // u unit vector = (sin axis, cos axis); v unit (clockwise) = (-cos axis, sin axis)
  // so that +u then turning toward -v is a right (clockwise) turn.
  const ue = Math.sin(axis);
  const un = Math.cos(axis);
  const ve = -Math.cos(axis);
  const vn = Math.sin(axis);

  const out: TrackPoint[] = [];
  for (let t = 0; t <= durationS; t += stepS) {
    const p = at(t * speed);
    const east = p.u * ue + p.v * ve;
    const north = p.u * un + p.v * vn;
    const dE = p.du * ue + p.dv * ve;
    const dN = p.du * un + p.dv * vn;
    const pos = offsetNm(lat, lon, east, north);
    out.push({
      lat: pos.lat,
      lon: pos.lon,
      alt: opts.alt === undefined ? 2500 : opts.alt,
      spd: opts.speedKt ?? 100,
      trk: opts.noTrk ? null : Math.round(compass(dE, dN) * 10) / 10,
      ts: startTs + t,
    });
  }
  return out;
}

/** Circle of `radiusNm` around (lat, lon), clockwise from due north of centre. */
export function circle(
  lat: number,
  lon: number,
  durationS: number,
  opts: GenOpts & { radiusNm?: number } = {},
): TrackPoint[] {
  const startTs = opts.startTs ?? 1_763_400_000;
  const stepS = opts.stepS ?? 30;
  const r = opts.radiusNm ?? 1;
  const omega = (opts.speedKt ?? 100) / 3600 / r; // rad/s
  const out: TrackPoint[] = [];
  for (let t = 0; t <= durationS; t += stepS) {
    const a = omega * t; // angle clockwise from north, measured at centre
    const pos = offsetNm(lat, lon, r * Math.sin(a), r * Math.cos(a));
    const hdg = (((a * 180) / Math.PI + 90) % 360 + 360) % 360; // tangent, clockwise
    out.push({
      lat: pos.lat,
      lon: pos.lon,
      alt: opts.alt === undefined ? 2500 : opts.alt,
      spd: opts.speedKt ?? 100,
      trk: opts.noTrk ? null : Math.round(hdg * 10) / 10,
      ts: startTs + t,
    });
  }
  return out;
}

/** Straight line from (lat, lon) along `bearingDeg`. */
export function straight(
  lat: number,
  lon: number,
  bearingDeg: number,
  durationS: number,
  opts: GenOpts & { jitterDeg?: number } = {},
): TrackPoint[] {
  const startTs = opts.startTs ?? 1_763_400_000;
  const stepS = opts.stepS ?? 30;
  const speed = (opts.speedKt ?? 120) / 3600;
  const b = (bearingDeg * Math.PI) / 180;
  const out: TrackPoint[] = [];
  for (let t = 0, k = 0; t <= durationS; t += stepS, k++) {
    const d = speed * t;
    const pos = offsetNm(lat, lon, d * Math.sin(b), d * Math.cos(b));
    // Deterministic ±jitter so heading noise is exercised without randomness.
    const jitter = (opts.jitterDeg ?? 0) * (k % 2 === 0 ? 1 : -1);
    out.push({
      lat: pos.lat,
      lon: pos.lon,
      alt: opts.alt === undefined ? 3500 : opts.alt,
      spd: opts.speedKt ?? 120,
      trk: opts.noTrk ? null : (((bearingDeg + jitter) % 360) + 360) % 360,
      ts: startTs + t,
    });
  }
  return out;
}

/** Straight line from A to B over `durationS`, altitude ramped linearly. */
export function leg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  durationS: number,
  opts: { startTs: number; stepS?: number; altFrom: number; altTo: number; includeStart?: boolean },
): TrackPoint[] {
  const stepS = opts.stepS ?? 30;
  const out: TrackPoint[] = [];
  const dE = (b.lon - a.lon) * 60 * Math.cos((a.lat * Math.PI) / 180);
  const dN = (b.lat - a.lat) * 60;
  const hdg = compass(dE, dN);
  for (let t = opts.includeStart === false ? stepS : 0; t <= durationS; t += stepS) {
    const f = t / durationS;
    out.push({
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      alt: Math.round(opts.altFrom + (opts.altTo - opts.altFrom) * f),
      spd: 110,
      trk: Math.round(hdg * 10) / 10,
      ts: opts.startTs + t,
    });
  }
  return out;
}
