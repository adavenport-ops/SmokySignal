// Run: npx tsx --test lib/route-decimate.test.ts
//
// Pins the statewide flight-path payload trimming.

import { test } from "node:test";
import assert from "node:assert";
import { decimateRoute, ROUTE_MIN_STEP_DEG } from "./route-decimate";

test("drops points outside the tracking envelope", () => {
  const out = decimateRoute([
    [-122.3, 47.6],
    [-74.0, 40.7], // New York: hex collision noise
    [-122.68, 45.52], // Portland: kept (OR border area)
    [-116.2, 43.62], // Boise: kept
  ]);
  assert.deepStrictEqual(out, [
    [-122.3, 47.6],
    [-122.68, 45.52],
    [-116.2, 43.62],
  ]);
});

test("rounds coordinates to 5 decimals", () => {
  const out = decimateRoute([
    [-122.3000049, 47.6000051],
    [-122.2, 47.7],
  ]);
  assert.deepStrictEqual(out[0], [-122.3, 47.60001]);
});

test("thins points closer than the min step, keeps first and last", () => {
  const coords: [number, number][] = [];
  // 101 points 0.0001 deg apart along a meridian: 0.01 deg total.
  for (let i = 0; i <= 100; i++) coords.push([-122.3, 47.6 + i * 0.0001]);
  const out = decimateRoute(coords);
  assert.deepStrictEqual(out[0], [-122.3, 47.6]);
  assert.deepStrictEqual(out[out.length - 1], [-122.3, 47.61]);
  assert.ok(out.length <= 12 && out.length >= 10, `len ${out.length}`);
  for (let i = 1; i < out.length - 1; i++) {
    assert.ok(out[i]![1] - out[i - 1]![1] >= ROUTE_MIN_STEP_DEG - 1e-9);
  }
});

test("keeps already-sparse routes intact", () => {
  const coords: [number, number][] = [
    [-122.3, 47.6],
    [-122.2, 47.5],
    [-122.1, 47.4],
  ];
  assert.deepStrictEqual(decimateRoute(coords), coords);
});

test("empty and all-noise input yields an empty route", () => {
  assert.deepStrictEqual(decimateRoute([]), []);
  assert.deepStrictEqual(decimateRoute([[0, 0]]), []);
});

test("a stationary aircraft collapses to one point", () => {
  const out = decimateRoute([
    [-122.3, 47.6],
    [-122.3, 47.6],
    [-122.3, 47.6],
  ]);
  assert.deepStrictEqual(out, [[-122.3, 47.6]]);
});
