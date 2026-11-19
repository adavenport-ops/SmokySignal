// Run: npx tsx --test lib/corridor.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORRIDORS,
  corridorLabel,
  distanceToPolylineNm,
  nearestCorridor,
  pointToSegmentNm,
} from "./corridor";
import { haversineNm } from "./geo";
import { offsetNm } from "./geo-fixtures.test-helpers";

const REQUIRED_IDS = [
  "i-5",
  "i-405",
  "sr-167",
  "sr-512",
  "sr-16",
  "i-90",
  "sr-410",
  "us-2",
  "sr-18",
  "us-101-hood-canal",
];

test("every required corridor is present with a unique id", () => {
  const ids = CORRIDORS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of REQUIRED_IDS) assert.ok(ids.includes(id), `missing ${id}`);
});

test("corridor geometry is sane: 10–40 vertices, inside WA, no long jumps", () => {
  for (const c of CORRIDORS) {
    assert.ok(c.path.length >= 10 && c.path.length <= 40, `${c.id} has ${c.path.length} vertices`);
    for (const [lat, lon] of c.path) {
      assert.ok(lat > 45.5 && lat < 49 && lon > -124.8 && lon < -116.9, `${c.id} vertex out of WA`);
    }
    for (let i = 1; i < c.path.length; i++) {
      const d = haversineNm(c.path[i - 1]![0], c.path[i - 1]![1], c.path[i]![0], c.path[i]![1]);
      assert.ok(d < 10, `${c.id} segment ${i} is ${d.toFixed(1)} nm`);
      assert.ok(d > 0, `${c.id} duplicate vertex at ${i}`);
    }
  }
});

test("every named place sits on (within 1.5 nm of) its own corridor", () => {
  for (const c of CORRIDORS) {
    assert.ok(c.places.length >= 3, `${c.id} needs a few places`);
    for (const p of c.places) {
      const d = distanceToPolylineNm(p.lat, p.lon, c.path);
      assert.ok(d <= 1.5, `${c.id} place ${p.name} is ${d.toFixed(2)} nm off`);
    }
  }
});

test("pointToSegmentNm: perpendicular, clamped endpoints, degenerate segment", () => {
  // Segment running due east along 47.2N; point 1 nm north of its middle.
  const a = { lat: 47.2, lon: -122.5 };
  const b = offsetNm(47.2, -122.5, 4, 0);
  const mid = offsetNm(47.2, -122.5, 2, 1);
  assert.ok(Math.abs(pointToSegmentNm(mid.lat, mid.lon, a.lat, a.lon, b.lat, b.lon) - 1) < 0.01);
  // Beyond the east end: distance is to endpoint B, not the infinite line.
  const past = offsetNm(47.2, -122.5, 7, 0);
  const dPast = pointToSegmentNm(past.lat, past.lon, a.lat, a.lon, b.lat, b.lon);
  assert.ok(Math.abs(dPast - 3) < 0.01, `got ${dPast}`);
  // Before the west end.
  const before = offsetNm(47.2, -122.5, -2, 0);
  assert.ok(Math.abs(pointToSegmentNm(before.lat, before.lon, a.lat, a.lon, b.lat, b.lon) - 2) < 0.01);
  // Zero-length segment collapses to point distance.
  const p = offsetNm(47.2, -122.5, 0, 2);
  assert.ok(Math.abs(pointToSegmentNm(p.lat, p.lon, a.lat, a.lon, a.lat, a.lon) - 2) < 0.01);
  // On the segment.
  assert.ok(pointToSegmentNm(a.lat, a.lon, a.lat, a.lon, b.lat, b.lon) < 1e-9);
});

test("distanceToPolylineNm handles empty and single-vertex paths", () => {
  assert.equal(distanceToPolylineNm(47, -122, []), Infinity);
  assert.ok(Math.abs(distanceToPolylineNm(47, -122, [[47, -122]])) < 1e-9);
});

const KNOWN: Array<[string, number, number, string, string?]> = [
  ["Fife on I-5", 47.2405, -122.3605, "I-5", "Fife"],
  ["Federal Way on I-5", 47.31, -122.3, "I-5", "Federal Way"],
  ["Northgate on I-5", 47.705, -122.325, "I-5", "Northgate"],
  ["Parkland on SR-512", 47.1562, -122.4300, "SR-512", "Parkland"],
  ["South Hill on SR-512", 47.175, -122.315, "SR-512", "South Hill"],
  ["Bellevue on I-405", 47.615, -122.1855, "I-405", "Bellevue"],
  ["Kent valley on SR-167", 47.38, -122.2452, "SR-167", "Kent"],
  ["Narrows on SR-16", 47.269, -122.548, "SR-16", "Narrows"],
  ["Gig Harbor on SR-16", 47.30, -122.59, "SR-16", "Gig Harbor"],
  ["North Bend on I-90", 47.485, -121.775, "I-90", "North Bend"],
  ["Snoqualmie Pass on I-90", 47.4245, -121.416, "I-90", "Snoqualmie Pass"],
  ["Greenwater on SR-410", 47.13, -121.635, "SR-410", "Greenwater"],
  ["Monroe on US-2", 47.86, -121.985, "US-2", "Monroe"],
  ["Stevens Pass on US-2", 47.746, -121.087, "US-2", "Stevens Pass"],
  ["Covington on SR-18", 47.345, -122.12, "SR-18", "Covington"],
  ["Hoodsport on US-101", 47.405, -123.14, "US-101", "Hoodsport"],
  ["Quilcene on US-101", 47.822, -122.875, "US-101", "Quilcene"],
];

for (const [label, lat, lon, name, place] of KNOWN) {
  test(`nearestCorridor: ${label}`, () => {
    const m = nearestCorridor(lat, lon);
    assert.ok(m, "expected a match");
    assert.equal(m.name, name);
    assert.ok(m.distanceNm < 0.6, `distance ${m.distanceNm.toFixed(2)} nm`);
    if (place) assert.equal(m.nearestPlace, place);
  });
}

test("nearestCorridor returns null away from every corridor", () => {
  assert.equal(nearestCorridor(47.6588, -117.426), null); // Spokane
  assert.equal(nearestCorridor(47.75, -122.55), null); // mid-Sound, Kingston area water
  assert.equal(nearestCorridor(Number.NaN, -122.3), null);
});

test("nearestCorridor respects maxNm", () => {
  // 3 nm west of I-5 at Tacoma Mall, well clear of SR-16's first leg.
  const p = offsetNm(47.20, -122.47, -3, 0);
  assert.equal(nearestCorridor(p.lat, p.lon, 1), null);
  const wide = nearestCorridor(p.lat, p.lon, 5);
  assert.ok(wide);
  assert.ok(wide.distanceNm > 1 && wide.distanceNm <= 5);
});

test("corridorLabel formats 'Road · Place', bare road, or null", () => {
  assert.equal(corridorLabel(47.2405, -122.3605), "I-5 · Fife");
  assert.equal(corridorLabel(47.1562, -122.43), "SR-512 · Parkland");
  assert.equal(corridorLabel(47.6588, -117.426), null);
  // Every corridor's midpoint labels as that corridor, in the expected shape.
  for (const c of CORRIDORS) {
    const [lat, lon] = c.path[Math.floor(c.path.length / 2)]!;
    const s = corridorLabel(lat, lon);
    assert.ok(s, `${c.id} midpoint should label`);
    assert.ok(s.startsWith(c.name), `${c.id} midpoint labelled ${s}`);
    assert.match(s, /^[A-Z0-9-]+( · [A-Za-z .'-]+)?$/);
  }
});
