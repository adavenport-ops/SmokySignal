// Run: npx tsx --test lib/geo.test.ts
//
// Distance + bearing used by the home "Also up" rows ("12 nm NE").

import { test } from "node:test";
import assert from "node:assert";
import { bearingDeg, compass8, haversineNm } from "./geo";

const SEATTLE = { lat: 47.6062, lon: -122.3321 };
const TACOMA = { lat: 47.2529, lon: -122.4443 };

test("bearingDeg: cardinal directions", () => {
  assert.ok(Math.abs(bearingDeg(47, -122, 48, -122) - 0) < 0.01);
  assert.ok(Math.abs(bearingDeg(47, -122, 46, -122) - 180) < 0.01);
  assert.ok(Math.abs(bearingDeg(0, 0, 0, 1) - 90) < 0.01);
  assert.ok(Math.abs(bearingDeg(0, 0, 0, -1) - 270) < 0.01);
});

test("Seattle is roughly north of Tacoma, about 22 nm out", () => {
  const b = bearingDeg(TACOMA.lat, TACOMA.lon, SEATTLE.lat, SEATTLE.lon);
  assert.equal(compass8(b), "N");
  const d = haversineNm(TACOMA.lat, TACOMA.lon, SEATTLE.lat, SEATTLE.lon);
  assert.ok(d > 20 && d < 23, `distance ${d}`);
});

test("compass8: boundaries and wrap", () => {
  assert.equal(compass8(0), "N");
  assert.equal(compass8(22), "N");
  assert.equal(compass8(23), "NE");
  assert.equal(compass8(359), "N");
  assert.equal(compass8(-45), "NW");
  assert.equal(compass8(225), "SW");
});
