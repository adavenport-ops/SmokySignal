// Run: npx tsx --test lib/glance.test.ts
//
// Pins the /glance model: UP / DOWN / stale, the "never DOWN when stale"
// rule, and the distance + bearing helpers.

import { test } from "node:test";
import assert from "node:assert";
import {
  bearingDeg,
  compassPoint,
  fmtMiles,
  glanceModel,
  nearestSmokey,
} from "./glance";
import type { Aircraft, Snapshot } from "./types";

const NOW = Date.parse("2026-11-18T15:12:00Z");
const SEATTLE = { lat: 47.6062, lon: -122.3321 };

function ac(
  tail: string,
  role: Aircraft["role"],
  airborne: boolean,
  pos?: { lat: number; lon: number },
  nickname: string | null = null,
): Aircraft {
  return {
    tail,
    icao24: "a00000",
    operator: "WSP",
    model: "Cessna 206H",
    nickname,
    roleDescription: "",
    base: "KOLM Olympia",
    role,
    roleConfidence: "confirmed",
    sources: [],
    airborne,
    ...(pos ?? {}),
  } as Aircraft;
}

function snap(aircraft: Aircraft[], fetched_at = NOW - 10_000, extra = {}): Snapshot {
  return {
    fetched_at,
    source: "adsbfi",
    live_seen_count: 5,
    aircraft,
    ...extra,
  } as Snapshot;
}

test("bearingDeg: cardinal directions from Seattle", () => {
  assert.strictEqual(bearingDeg(47, -122, 48, -122), 0);
  assert.strictEqual(bearingDeg(47, -122, 46, -122), 180);
  const east = bearingDeg(47, -122, 47, -121);
  assert.ok(east >= 89 && east <= 91, `east ${east}`);
  const west = bearingDeg(47, -122, 47, -123);
  assert.ok(west >= 269 && west <= 271, `west ${west}`);
});

test("bearingDeg: always 0..359", () => {
  for (const [a, b] of [
    [47, 0],
    [47.0001, -0.0001],
    [-33, 150],
  ] as const) {
    const d = bearingDeg(47, -122, a, b);
    assert.ok(d >= 0 && d < 360, String(d));
  }
});

test("compassPoint: 16 points, wraps at north", () => {
  assert.strictEqual(compassPoint(0), "N");
  assert.strictEqual(compassPoint(359), "N");
  assert.strictEqual(compassPoint(45), "NE");
  assert.strictEqual(compassPoint(90), "E");
  assert.strictEqual(compassPoint(202), "SSW");
  assert.strictEqual(compassPoint(-10), "N");
});

test("fmtMiles: one decimal under ten, whole above", () => {
  assert.strictEqual(fmtMiles(0.44), "0.4 MI");
  assert.strictEqual(fmtMiles(9.96), "10.0 MI");
  assert.strictEqual(fmtMiles(27.4), "27 MI");
  assert.strictEqual(fmtMiles(NaN), "--");
});

test("nearestSmokey: picks the closer bird, reports miles + bearing", () => {
  const s = snap([
    ac("N305DK", "police", true, { lat: 47.9, lon: -122.3 }, "Smokey 4"),
    ac("N422CT", "police", true, { lat: 47.65, lon: -122.33 }, "Guardian One"),
  ]);
  const n = nearestSmokey(s, SEATTLE);
  assert.ok(n);
  assert.strictEqual(n!.tail, "N422CT");
  assert.strictEqual(n!.name, "Guardian One");
  assert.ok(n!.miles > 2.5 && n!.miles < 3.5, `miles ${n!.miles}`);
  assert.strictEqual(n!.compass, "N");
});

test("nearestSmokey: ignores grounded, non-police and position-less birds", () => {
  const s = snap([
    ac("N1", "police", false, { lat: 47.61, lon: -122.33 }),
    ac("N2", "sar", true, { lat: 47.61, lon: -122.33 }),
    ac("N3", "police", true),
  ]);
  assert.strictEqual(nearestSmokey(s, SEATTLE), null);
});

test("glanceModel: fresh read with a Smokey up reads up", () => {
  const m = glanceModel(
    snap([ac("N305DK", "police", true, { lat: 47.7, lon: -122.3 }, "Smokey 4")]),
    NOW,
    SEATTLE,
  );
  assert.strictEqual(m.kind, "up");
  assert.strictEqual(m.count, 1);
  assert.strictEqual(m.leadName, "Smokey 4");
  assert.ok(m.nearest && m.nearest.miles > 5);
});

test("glanceModel: up without a rider position has no nearest", () => {
  const m = glanceModel(
    snap([ac("N305DK", "police", true, { lat: 47.7, lon: -122.3 })]),
    NOW,
    null,
  );
  assert.strictEqual(m.kind, "up");
  assert.strictEqual(m.nearest, null);
});

test("glanceModel: nothing up on a fresh read reads down", () => {
  const m = glanceModel(snap([ac("N305DK", "police", false)]), NOW, SEATTLE);
  assert.strictEqual(m.kind, "down");
  assert.strictEqual(m.count, 0);
  assert.strictEqual(m.nearest, null);
});

test("glanceModel: SAR alone is not Smokey, reads down", () => {
  const m = glanceModel(snap([ac("N815SC", "sar", true, { lat: 47.7, lon: -122.3 })]), NOW, SEATTLE);
  assert.strictEqual(m.kind, "down");
});

test("glanceModel: a read older than two minutes is stale, never down", () => {
  const old = snap([ac("N305DK", "police", false)], NOW - 3 * 60_000);
  const m = glanceModel(old, NOW, SEATTLE);
  assert.strictEqual(m.kind, "stale");
  assert.strictEqual(m.ageS, 180);
  assert.strictEqual(m.readAt, NOW - 3 * 60_000);
});

test("glanceModel: stale beats up too, with no distance shown", () => {
  const old = snap(
    [ac("N305DK", "police", true, { lat: 47.7, lon: -122.3 })],
    NOW - 5 * 60_000,
  );
  const m = glanceModel(old, NOW, SEATTLE);
  assert.strictEqual(m.kind, "stale");
  assert.strictEqual(m.nearest, null);
  assert.strictEqual(m.leadName, null);
});

test("glanceModel: degraded snapshot is stale even when fresh", () => {
  const m = glanceModel(
    snap([ac("N305DK", "police", false)], NOW - 1000, { degraded: true }),
    NOW,
    SEATTLE,
  );
  assert.strictEqual(m.kind, "stale");
});

test("glanceModel: no snapshot at all is stale with an unknown read time", () => {
  for (const s of [null, undefined]) {
    const m = glanceModel(s, NOW, SEATTLE);
    assert.strictEqual(m.kind, "stale");
    assert.strictEqual(m.readAt, null);
    assert.strictEqual(m.ageS, null);
  }
});
