// Run: npx tsx --test lib/orbit.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bearingDeg,
  classifyFlightPhase,
  detectOrbits,
  headingDelta,
  normalizeDeg,
  resolveHeadings,
} from "./orbit";
import { haversineNm } from "./geo";
import { circle, leg, racetrack, straight } from "./geo-fixtures.test-helpers";
import type { TrackPoint } from "./tracks";

const SR512_SUMMIT = { lat: 47.157, lon: -122.385 };
const I5_FIFE = { lat: 47.24, lon: -122.36 };
const SR512_PARKLAND = { lat: 47.1562, lon: -122.43 };
const KOLM = { lat: 46.9694, lon: -122.9025 };

// ---- angle helpers ------------------------------------------------------

test("headingDelta wraps across north", () => {
  assert.equal(headingDelta(350, 10), 20);
  assert.equal(headingDelta(10, 350), -20);
  assert.equal(headingDelta(359, 1), 2);
  assert.equal(headingDelta(0, 180), 180);
  assert.equal(headingDelta(180, 0), 180);
  assert.equal(headingDelta(90, 90), 0);
  assert.equal(headingDelta(-10, 370), 20);
  assert.equal(headingDelta(720, 45), 45);
});

test("normalizeDeg and bearingDeg", () => {
  assert.equal(normalizeDeg(-90), 270);
  assert.equal(normalizeDeg(450), 90);
  assert.equal(normalizeDeg(360), 0);
  assert.ok(Math.abs(bearingDeg(47, -122, 47.1, -122) - 0) < 0.01);
  assert.ok(Math.abs(bearingDeg(47, -122, 47, -121.9) - 90) < 0.1);
  assert.ok(Math.abs(bearingDeg(47.1, -122, 47, -122) - 180) < 0.01);
  assert.ok(Math.abs(bearingDeg(47, -121.9, 47, -122) - 270) < 0.1);
});

test("resolveHeadings prefers trk, derives bearing when missing, carries forward when stationary", () => {
  const pts: TrackPoint[] = [
    { lat: 47.0, lon: -122.0, alt: 1000, spd: 100, trk: null, ts: 0 },
    { lat: 47.1, lon: -122.0, alt: 1000, spd: 100, trk: null, ts: 30 },
    { lat: 47.1, lon: -122.0, alt: 1000, spd: 0, trk: null, ts: 60 },
    { lat: 47.1, lon: -121.9, alt: 1000, spd: 100, trk: 123, ts: 90 },
    { lat: 47.1, lon: -121.9, alt: 1000, spd: 0, trk: null, ts: 120 },
  ];
  const h = resolveHeadings(pts);
  assert.ok(Math.abs((h[0] as number) - 0) < 0.01, "first point looks ahead");
  assert.ok(Math.abs((h[1] as number) - 0) < 0.01);
  assert.ok(Math.abs((h[2] as number) - 90) < 0.1, "no movement since prev: looks ahead");
  assert.equal(h[3], 123);
  assert.equal(h[4], 123, "stationary at the end carries forward");
  assert.deepEqual(resolveHeadings([{ lat: 47, lon: -122, alt: null, spd: null, trk: null, ts: 0 }]), [null]);
});

// ---- detectOrbits -------------------------------------------------------

test("racetrack orbit over SR-512 is one segment labelled SR-512", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 22 * 60, { axisDeg: 90 });
  const segs = detectOrbits(pts);
  assert.equal(segs.length, 1);
  const s = segs[0]!;
  // Edges may trim a straight leg at either end, never more.
  assert.ok(s.startTs - pts[0]!.ts <= 120, `start trimmed ${s.startTs - pts[0]!.ts}s`);
  assert.ok(pts[pts.length - 1]!.ts - s.endTs <= 120, `end trimmed ${pts[pts.length - 1]!.ts - s.endTs}s`);
  assert.equal(s.durationS, s.endTs - s.startTs);
  assert.ok(s.durationS >= 20 * 60);
  // 100 kt for 22 min on an 8.4 nm circuit is ~4.4 laps.
  assert.ok(s.turns >= 3.8 && s.turns <= 5, `turns ${s.turns}`);
  assert.ok(haversineNm(s.centroid.lat, s.centroid.lon, SR512_SUMMIT.lat, SR512_SUMMIT.lon) < 0.5);
  assert.ok(s.radiusNm > 0.3 && s.radiusNm < 2, `radius ${s.radiusNm}`);
  assert.ok(s.corridor?.startsWith("SR-512"), `corridor ${s.corridor}`);
});

test("racetrack with no trk at all is still detected from positions", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 22 * 60, { noTrk: true });
  const segs = detectOrbits(pts);
  assert.equal(segs.length, 1);
  assert.ok(segs[0]!.turns >= 3.5, `turns ${segs[0]!.turns}`);
});

test("racetrack with every other trk missing is detected", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 15 * 60).map((p, i) =>
    i % 2 ? { ...p, trk: null } : p,
  );
  assert.equal(detectOrbits(pts).length, 1);
});

test("coarser 45 s sampling still detects the racetrack", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 22 * 60, { stepS: 45 });
  assert.equal(detectOrbits(pts).length, 1);
});

test("straight transit produces no orbit, even with heading jitter", () => {
  const pts = straight(KOLM.lat, KOLM.lon, 30, 15 * 60, { jitterDeg: 4 });
  assert.deepEqual(detectOrbits(pts), []);
});

test("clockwise circle crossing 360→0 counts turns correctly", () => {
  const pts = circle(I5_FIFE.lat, I5_FIFE.lon, 8 * 60, { radiusNm: 1, stepS: 15 });
  // Sanity: fixture headings really do wrap from ~350s to ~0s.
  assert.ok(
    pts.some((p, i) => i > 0 && (pts[i - 1]!.trk as number) > 300 && (p.trk as number) < 60),
    "fixture should cross north",
  );
  const segs = detectOrbits(pts);
  assert.equal(segs.length, 1);
  // 100 kt on a 6.28 nm circle for 8 min ≈ 2.1 laps.
  assert.ok(Math.abs(segs[0]!.turns - 2.1) <= 0.2, `turns ${segs[0]!.turns}`);
  assert.equal(segs[0]!.corridor, "I-5 · Fife");
});

test("counter-clockwise circle is detected with positive turns", () => {
  const cw = circle(I5_FIFE.lat, I5_FIFE.lon, 8 * 60, { radiusNm: 1 });
  const ccw = cw.map((p) => ({
    ...p,
    lon: 2 * I5_FIFE.lon - p.lon,
    trk: (360 - (p.trk as number)) % 360,
  }));
  const segs = detectOrbits(ccw);
  assert.equal(segs.length, 1);
  assert.ok(segs[0]!.turns > 1.8);
});

test("three-quarter turn is not an orbit", () => {
  // 1 nm radius at 100 kt: one lap ≈ 226 s; 170 s ≈ 270°.
  const pts = circle(I5_FIFE.lat, I5_FIFE.lon, 170, { radiusNm: 1, stepS: 10 });
  assert.deepEqual(detectOrbits(pts), []);
});

test("a wide sweeping circle (radius > 3 nm) is not a pattern", () => {
  // 3.5 nm radius at 200 kt: lap ≈ 6.6 min, inside the window but too big.
  const pts = circle(I5_FIFE.lat, I5_FIFE.lon, 9 * 60, { radiusNm: 3.5, speedKt: 200 });
  assert.deepEqual(detectOrbits(pts), []);
  // Same circle passes when the radius limit is relaxed.
  assert.equal(detectOrbits(pts, { maxRadiusNm: 5 }).length, 1);
});

test("a lap slower than the 10 min window is not counted", () => {
  // 1.2 nm radius at 40 kt: lap ≈ 11.3 min.
  const pts = circle(I5_FIFE.lat, I5_FIFE.lon, 14 * 60, { radiusNm: 1.2, speedKt: 40 });
  assert.deepEqual(detectOrbits(pts), []);
  assert.equal(detectOrbits(pts, { windowS: 15 * 60 }).length, 1);
});

test("a long sample gap breaks the turn accumulation", () => {
  const pts = circle(I5_FIFE.lat, I5_FIFE.lon, 300, { radiusNm: 1, stepS: 15 });
  assert.equal(detectOrbits(pts).length, 1, "contiguous lap detects");
  const gapped = pts.map((p) => (p.ts - pts[0]!.ts > 150 ? { ...p, ts: p.ts + 400 } : p));
  assert.deepEqual(detectOrbits(gapped), []);
});

test("two separate patterns become two labelled segments", () => {
  const t0 = 1_763_400_000;
  const a = circle(I5_FIFE.lat, I5_FIFE.lon, 12 * 60, { radiusNm: 0.8, startTs: t0 });
  const aEnd = a[a.length - 1]!;
  const transit = leg(aEnd, SR512_PARKLAND, 6 * 60, {
    startTs: aEnd.ts,
    altFrom: 2500,
    altTo: 2500,
    includeStart: false,
  });
  const tEnd = transit[transit.length - 1]!;
  const b = circle(SR512_PARKLAND.lat, SR512_PARKLAND.lon, 10 * 60, {
    radiusNm: 0.8,
    startTs: tEnd.ts + 30,
  });
  const segs = detectOrbits([...a, ...transit, ...b]);
  assert.equal(segs.length, 2);
  assert.equal(segs[0]!.corridor, "I-5 · Fife");
  assert.equal(segs[1]!.corridor, "SR-512 · Parkland");
  assert.ok(segs[0]!.endTs < segs[1]!.startTs);
  assert.ok(Math.abs(segs[0]!.durationS - 12 * 60) <= 60);
});

test("orbit away from any corridor has no corridor label", () => {
  const pts = circle(47.75, -122.55, 8 * 60, { radiusNm: 1 }); // over the Sound
  const segs = detectOrbits(pts);
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.corridor, undefined);
});

test("unsorted input with duplicate timestamps gives the same result", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 15 * 60);
  const messy = [...pts].reverse();
  messy.splice(5, 0, { ...pts[10]! });
  assert.deepEqual(detectOrbits(messy), detectOrbits(pts));
});

test("degenerate inputs return no segments", () => {
  assert.deepEqual(detectOrbits([]), []);
  const two = straight(KOLM.lat, KOLM.lon, 0, 30);
  assert.deepEqual(detectOrbits(two), []);
  const bad = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 600).map((p) => ({ ...p, lat: Number.NaN }));
  assert.deepEqual(detectOrbits(bad), []);
});

// ---- classifyFlightPhase ------------------------------------------------

test("phase: racetrack is working a pattern", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 15 * 60);
  assert.equal(classifyFlightPhase(pts), "working a pattern");
});

test("phase: straight line is in transit", () => {
  assert.equal(classifyFlightPhase(straight(KOLM.lat, KOLM.lon, 30, 10 * 60, { jitterDeg: 3 })), "in transit");
});

test("phase: most of a lap inside the window still reads as a pattern", () => {
  // ≈300° of a 1 nm circle.
  const pts = circle(I5_FIFE.lat, I5_FIFE.lon, 190, { radiusNm: 1, stepS: 10 });
  assert.deepEqual(detectOrbits(pts), []);
  assert.equal(classifyFlightPhase(pts), "working a pattern");
});

test("phase: only the latest ~10 min matter", () => {
  const t0 = 1_763_400_000;
  const orbit = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 20 * 60, { startTs: t0 });
  const end = orbit[orbit.length - 1]!;
  const out = straight(end.lat, end.lon, 0, 12 * 60, { startTs: end.ts + 30 });
  assert.equal(classifyFlightPhase([...orbit, ...out]), "in transit");

  const inbound = straight(47.0, -122.6, 45, 12 * 60, { startTs: t0 });
  const last = inbound[inbound.length - 1]!;
  const work = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 10 * 60, { startTs: last.ts + 30 });
  assert.equal(classifyFlightPhase([...inbound, ...work]), "working a pattern");
});

test("phase: too little data, or not moving, is unknown", () => {
  assert.equal(classifyFlightPhase([]), "unknown");
  assert.equal(classifyFlightPhase(straight(KOLM.lat, KOLM.lon, 0, 60)), "unknown");
  const parked: TrackPoint[] = Array.from({ length: 20 }, (_, i) => ({
    lat: KOLM.lat,
    lon: KOLM.lon,
    alt: null,
    spd: 0,
    trk: null,
    ts: 1_763_400_000 + i * 30,
  }));
  assert.equal(classifyFlightPhase(parked), "unknown");
});

test("phase: trailing run after a long gap is judged on its own", () => {
  const t0 = 1_763_400_000;
  const orbit = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 8 * 60, { startTs: t0 });
  // 5 min gap, then only 60 s of data: not enough to call.
  const tail = straight(KOLM.lat, KOLM.lon, 0, 60, { startTs: orbit[orbit.length - 1]!.ts + 300 });
  assert.equal(classifyFlightPhase([...orbit, ...tail]), "unknown");
});
