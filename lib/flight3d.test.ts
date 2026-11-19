// Run: npx tsx --test lib/flight3d.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FT_TO_M,
  MAX_VERTICES,
  MIN_RING_NM,
  TERRAIN_EXAGGERATION,
  advanceProgress,
  altitudeZ,
  boundsOf,
  decimate,
  decimateAll,
  fillAltitudes,
  fmtMinutes,
  foldBearing,
  principalBearing,
  smoothTrack,
  smoothingFactor,
  hexToRgba,
  orbitAltitudeFt,
  orbitLabel,
  padBounds,
  progressToTs,
  relativeTs,
  replayClock,
  resolveTrack,
  ringPositions,
  sampleAt,
  toPosition,
  tsToProgress,
  type ResolvedPoint,
} from "./flight3d";
import { haversineNm } from "./geo";
import type { OrbitSegment } from "./orbit";
import type { TrackPoint } from "./tracks";

const T0 = 1_763_000_000;

function tp(i: number, alt: number | null, extra: Partial<TrackPoint> = {}): TrackPoint {
  return { lat: 47.2 + i * 0.001, lon: -122.4 + i * 0.001, alt, spd: 100, trk: 45, ts: T0 + i * 30, ...extra };
}

// --- coordinate conversion -------------------------------------------------

test("altitudeZ converts feet to meters with the shared exaggeration", () => {
  assert.equal(altitudeZ(1000, 1), 304.8);
  assert.ok(Math.abs(altitudeZ(1000) - 1000 * FT_TO_M * TERRAIN_EXAGGERATION) < 1e-9);
  assert.equal(altitudeZ(0), 0);
});

test("toPosition emits [lon, lat, z] in deck.gl LNGLAT order", () => {
  const p: ResolvedPoint = { lat: 47.25, lon: -122.36, altFt: 2000, spd: null, trk: null, ts: T0 };
  const [lon, lat, z] = toPosition(p, 1);
  assert.equal(lon, -122.36);
  assert.equal(lat, 47.25);
  assert.ok(Math.abs(z - 609.6) < 1e-9);
});

test("fillAltitudes interpolates interior gaps by time and holds edges", () => {
  const pts = [tp(0, null), tp(1, 1000), tp(2, null), tp(3, null), tp(4, 1600), tp(5, null)];
  assert.deepEqual(fillAltitudes(pts), [1000, 1000, 1200, 1400, 1600, 1600]);
});

test("fillAltitudes uses timestamps, not indices, for uneven spacing", () => {
  const pts = [tp(0, 0), { ...tp(1, null), ts: T0 + 90 }, { ...tp(2, 1200), ts: T0 + 120 }];
  assert.deepEqual(fillAltitudes(pts), [0, 900, 1200]);
});

test("fillAltitudes puts an all-null track at 0", () => {
  assert.deepEqual(fillAltitudes([tp(0, null), tp(1, null)]), [0, 0]);
  assert.deepEqual(fillAltitudes([]), []);
});

test("resolveTrack sorts, drops bad and duplicate samples", () => {
  const pts = [tp(2, 300), tp(0, 100), { ...tp(1, 200), lat: NaN }, tp(0, 999)];
  const r = resolveTrack(pts);
  assert.deepEqual(r.map((p) => p.ts), [T0, T0 + 60]);
  assert.deepEqual(r.map((p) => p.altFt), [100, 300]);
});

// --- decimation --------------------------------------------------------------

function longTrack(n: number): ResolvedPoint[] {
  // A circling track (lots of curvature) so RDP has to keep real detail.
  return Array.from({ length: n }, (_, i) => {
    const th = (i / 40) * Math.PI * 2;
    return {
      lat: 47.2 + 0.02 * Math.cos(th),
      lon: -122.4 + 0.03 * Math.sin(th),
      altFt: 1500 + 200 * Math.sin(i / 17),
      spd: 100,
      trk: null,
      ts: T0 + i * 5,
    };
  });
}

test("decimate leaves short tracks untouched", () => {
  const t = longTrack(50);
  assert.deepEqual(decimate(t, 100), t);
});

test("decimate caps the vertex count, keeps endpoints and order", () => {
  const t = longTrack(10_000);
  const d = decimate(t, MAX_VERTICES);
  assert.ok(d.length <= MAX_VERTICES, `got ${d.length}`);
  assert.ok(d.length > MAX_VERTICES / 4, "should not throw away most of the budget");
  assert.equal(d[0], t[0]);
  assert.equal(d[d.length - 1], t[t.length - 1]);
  for (let i = 1; i < d.length; i++) assert.ok(d[i]!.ts > d[i - 1]!.ts);
});

test("decimate collapses a straight line to its endpoints", () => {
  const t: ResolvedPoint[] = Array.from({ length: 500 }, (_, i) => ({
    lat: 47 + i * 1e-4, lon: -122, altFt: 1000, spd: null, trk: null, ts: T0 + i,
  }));
  const d = decimate(t, 100);
  assert.equal(d.length, 2);
});

test("decimateAll splits the budget across tracks", () => {
  const a = longTrack(6000);
  const b = longTrack(3000);
  const out = decimateAll([a, b], 3000);
  const total = out.reduce((s, t) => s + t.length, 0);
  assert.ok(total <= 3000, `got ${total}`);
  assert.ok(out[0]!.length >= 2 && out[1]!.length >= 2);
});

// --- smoothing + framing -----------------------------------------------------

test("smoothTrack keeps every sample and adds curve points in time order", () => {
  const t = longTrack(41).filter((_, i) => i % 4 === 0); // coarse circle
  const s = smoothTrack(t, 4);
  assert.equal(s.length, (t.length - 1) * 4 + 1);
  for (const p of t) assert.ok(s.includes(p), "original sample kept");
  for (let i = 1; i < s.length; i++) assert.ok(s[i]!.ts > s[i - 1]!.ts);
  // A mid-segment point on a circle bows outward from the chord.
  const c = { lat: 47.2, lon: -122.4 };
  const r = (p: { lat: number; lon: number }) => haversineNm(c.lat, c.lon, p.lat, p.lon);
  const chordMid = { lat: (t[1]!.lat + t[2]!.lat) / 2, lon: (t[1]!.lon + t[2]!.lon) / 2 };
  assert.ok(r(s[4 + 2]!) > r(chordMid), "spline point sits outside the chord");
});

test("smoothTrack leaves gaps straight and short tracks alone", () => {
  const t = longTrack(4).map((p, i) => ({ ...p, ts: T0 + i * 1000 }));
  assert.equal(smoothTrack(t, 4).length, 4);
  assert.equal(smoothTrack(longTrack(2), 4).length, 2);
  assert.equal(smoothTrack(longTrack(10), 1).length, 10);
});

test("smoothingFactor respects the vertex budget", () => {
  assert.equal(smoothingFactor(100), 4);
  assert.equal(smoothingFactor(1500, 3000), 2);
  assert.equal(smoothingFactor(3000, 3000), 1);
  assert.equal(smoothingFactor(1), 1);
});

test("principalBearing finds the long axis; foldBearing keeps it near north-up", () => {
  const ew = Array.from({ length: 10 }, (_, i) => ({ lat: 47, lon: -122 + i * 0.01 }));
  const ns = Array.from({ length: 10 }, (_, i) => ({ lat: 47 + i * 0.01, lon: -122 }));
  assert.ok(Math.abs(principalBearing(ew) - 90) < 1e-6);
  assert.ok(Math.abs(principalBearing(ns) - 0) < 1e-6 || Math.abs(principalBearing(ns) - 180) < 1e-6);
  assert.equal(foldBearing(135), -45);
  assert.equal(foldBearing(-100), 80);
  assert.equal(foldBearing(90), 90);
});

// --- replay time mapping -----------------------------------------------------

test("replayClock plays at 120x, clamped to 15-60 s", () => {
  assert.equal(replayClock(T0, T0 + 3600).playMs, 30_000); // 1 h → 30 s
  assert.equal(replayClock(T0, T0 + 600).playMs, 15_000); // short → floor
  assert.equal(replayClock(T0, T0 + 6 * 3600).playMs, 60_000); // long → ceiling
  const c = replayClock(T0 + 100, T0); // reversed args still ordered
  assert.equal(c.t0, T0);
  assert.equal(c.t1, T0 + 100);
});

test("progress and timestamps round-trip and clamp", () => {
  const c = replayClock(T0, T0 + 1000);
  assert.equal(progressToTs(c, 0), T0);
  assert.equal(progressToTs(c, 0.5), T0 + 500);
  assert.equal(progressToTs(c, 2), T0 + 1000);
  assert.equal(tsToProgress(c, T0 + 250), 0.25);
  assert.equal(tsToProgress(c, T0 - 50), 0);
  assert.equal(tsToProgress(replayClock(T0, T0), T0), 1);
  assert.equal(relativeTs(c, T0 + 42), 42);
});

test("advanceProgress moves by frame time and stops at 1", () => {
  const c = replayClock(T0, T0 + 3600); // 30 s replay
  assert.ok(Math.abs(advanceProgress(c, 0, 3000) - 0.1) < 1e-12);
  assert.equal(advanceProgress(c, 0.99, 10_000), 1);
  assert.equal(advanceProgress(c, 0.5, -20), 0.5);
});

test("sampleAt interpolates position, altitude, speed and wraps heading", () => {
  const pts: ResolvedPoint[] = [
    { lat: 47, lon: -122, altFt: 1000, spd: 100, trk: 350, ts: T0 },
    { lat: 47.1, lon: -122.2, altFt: 2000, spd: 120, trk: 10, ts: T0 + 60 },
  ];
  const s = sampleAt(pts, T0 + 30)!;
  assert.ok(Math.abs(s.lat - 47.05) < 1e-9);
  assert.ok(Math.abs(s.lon + 122.1) < 1e-9);
  assert.equal(s.altFt, 1500);
  assert.equal(s.spd, 110);
  assert.ok(Math.abs(s.trk! - 0) < 1e-9 || Math.abs(s.trk! - 360) < 1e-9, `trk ${s.trk}`);
  assert.equal(sampleAt(pts, T0 - 100)!.lat, 47);
  assert.equal(sampleAt(pts, T0 + 9999)!.altFt, 2000);
  assert.equal(sampleAt([], T0), null);
});

// --- orbit ring geometry -----------------------------------------------------

const ORBIT: OrbitSegment = {
  startTs: T0 + 60,
  endTs: T0 + 60 + 22 * 60,
  centroid: { lat: 47.24, lon: -122.36 },
  radiusNm: 1.2,
  turns: 3,
  durationS: 22 * 60,
  corridor: "I-5 · Fife",
};

test("ringPositions draws a closed circle at the given radius and height", () => {
  const ring = ringPositions(ORBIT.centroid, 1.2, 600, 48);
  assert.equal(ring.length, 49);
  assert.deepEqual(ring[0], ring[48]);
  for (const [lon, lat, z] of ring) {
    assert.equal(z, 600);
    const d = haversineNm(ORBIT.centroid.lat, ORBIT.centroid.lon, lat, lon);
    assert.ok(Math.abs(d - 1.2) < 0.01, `radius ${d}`);
  }
});

test("ringPositions enforces a minimum visible radius", () => {
  const ring = ringPositions(ORBIT.centroid, 0.01, 0, 16);
  const [lon, lat] = ring[4]!;
  const d = haversineNm(ORBIT.centroid.lat, ORBIT.centroid.lon, lat, lon);
  assert.ok(Math.abs(d - MIN_RING_NM) < 0.005, `radius ${d}`);
});

test("orbitAltitudeFt is the median altitude inside the orbit window", () => {
  const pts: ResolvedPoint[] = [0, 1, 2, 3, 4, 5].map((i) => ({
    lat: 47, lon: -122, altFt: [500, 1500, 1700, 1600, 9000, 400][i]!, spd: null, trk: null, ts: T0 + i * 300,
  }));
  // Window [T0+300, T0+1200] covers 1500, 1700, 1600, 9000 → median 1650.
  assert.equal(orbitAltitudeFt(pts, { ...ORBIT, startTs: T0 + 300, endTs: T0 + 1200 }), 1650);
});

test("orbitLabel reads like the brand", () => {
  assert.equal(orbitLabel(ORBIT), "Worked a pattern · I-5 · Fife · 22 min");
  assert.equal(orbitLabel({ ...ORBIT, corridor: undefined, durationS: 65 * 60 }), "Worked a pattern · 1 h 05 min");
  assert.equal(fmtMinutes(10), "1 min");
});

// --- bounds + color ----------------------------------------------------------

test("boundsOf and padBounds", () => {
  const b = boundsOf([[{ lat: 47, lon: -122 }], [{ lat: 47.5, lon: -122.5 }]])!;
  assert.deepEqual(b, { minLon: -122.5, minLat: 47, maxLon: -122, maxLat: 47.5 });
  assert.equal(boundsOf([[]]), null);
  const p = padBounds({ minLon: -122, minLat: 47, maxLon: -122, maxLat: 47 }, 2);
  const h = haversineNm(p.minLat, p.minLon, p.maxLat, p.minLon);
  assert.ok(Math.abs(h - 2) < 0.01, `height ${h}`);
});

test("hexToRgba", () => {
  assert.deepEqual(hexToRgba("#FF7A1A"), [255, 122, 26, 255]);
  assert.deepEqual(hexToRgba("5bb6ff", 80), [91, 182, 255, 80]);
});

// ─── Initial framing ─────────────────────────────────────────────────

import {
  CONTROLS_COLUMN_W,
  MIN_REGIONAL_ZOOM,
  clampFrameZoom,
  framePadding,
  spanKm,
} from "./flight3d";

test("framePadding keeps the controls column clear on desktop and phone", () => {
  for (const [w, h] of [
    [1100, 640],
    [390, 560],
  ] as const) {
    const p = framePadding({ width: w, height: h, replay: false, controlsRight: 10 });
    assert.ok(p.right >= CONTROLS_COLUMN_W + 10 + 12, `right ${p.right} at ${w}px`);
    assert.ok(p.bottom >= 52, "gesture hint band");
  }
});

test("framePadding reserves the readout and scrubber when replaying", () => {
  const p = framePadding({ width: 800, height: 600, replay: true, controlsRight: 10 });
  assert.ok(p.top >= 70);
  assert.ok(p.bottom >= 64);
});

test("framePadding adds the parent's overlays and shrinks on a tiny frame", () => {
  const p = framePadding({
    width: 800,
    height: 600,
    replay: false,
    controlsRight: 12,
    parent: { top: 100, bottom: 50, left: 0, right: 60 },
  });
  assert.ok(p.top >= 100 + 12);
  assert.ok(p.right >= 60);
  const tiny = framePadding({
    width: 200,
    height: 150,
    replay: true,
    controlsRight: 10,
    parent: { top: 80, bottom: 80, left: 40, right: 40 },
  });
  assert.ok(tiny.left + tiny.right <= 200 * 0.6 + 1);
  assert.ok(tiny.top + tiny.bottom <= 150 * 0.6 + 1);
});

// Everett to Olympia: a month of I-5 patrols.
const MONTH = { minLat: 47.04, maxLat: 47.98, minLon: -122.95, maxLon: -122.2 };

test("spanKm measures the widest side", () => {
  const km = spanKm(MONTH);
  assert.ok(km > 100 && km < 110, `got ${km}`);
});

test("clampFrameZoom pulls a far-out regional fit back in", () => {
  // The bug: a 105 km track opening at zoom ~6.8 (~300 km across a 420 px column).
  const z = clampFrameZoom(6.8, { bounds: MONTH, frameW: 330, frameH: 420 });
  assert.ok(z >= MIN_REGIONAL_ZOOM);
  assert.ok(z > 7.5, `got ${z}`);
  // ...but never zooms past the frame: at the floor the track spans 60 %
  // of the short side, so a fit that already shows it closer is kept.
  assert.equal(clampFrameZoom(8.4, { bounds: MONTH, frameW: 330, frameH: 420 }), 8.4);
});

test("clampFrameZoom leaves statewide extents and maxZoom alone", () => {
  const wide = { minLat: 45.6, maxLat: 49.0, minLon: -124.5, maxLon: -117.0 };
  assert.equal(clampFrameZoom(5.5, { bounds: wide, frameW: 800, frameH: 500 }), 5.5);
  const dot = { minLat: 47.2, maxLat: 47.2001, minLon: -122.3, maxLon: -122.3001 };
  assert.equal(clampFrameZoom(16, { bounds: dot, frameW: 400, frameH: 400 }), 14);
});
