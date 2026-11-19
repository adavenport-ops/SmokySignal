// Run: npx tsx --test lib/coverage.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDropouts,
  coverageNoteText,
  detectDropouts,
  dropoutsByArea,
  sampleTimesOf,
  summarizeCoverage,
  type Dropout,
} from "./coverage";
import { GRID_CELL_DEG, zoneIdForPoint } from "./zone-id";
import { leg, straight } from "./geo-fixtures.test-helpers";
import type { TrackPoint } from "./tracks";

const KOLM = { lat: 46.9694, lon: -122.9025 };
// Over I-90 east of North Bend: no listed field within 3 nm.
const I90_EDGEWICK = { lat: 47.465, lon: -121.72 };
const T0 = 1_763_400_000;

/** Fly from KOLM toward I-90 and stop being heard at `endAlt` ft. */
function lostOverI90(endAlt: number, startTs = T0): TrackPoint[] {
  return leg(KOLM, I90_EDGEWICK, 30 * 60, { startTs, altFrom: 300, altTo: endAlt });
}

test("drop-out: a track that ends mid-air away from an airport is lost contact", () => {
  const pts = lostOverI90(2500);
  const last = pts[pts.length - 1]!;
  const d = detectDropouts("N2446X", pts, last.ts + 3600);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.tail, "N2446X");
  assert.equal(d[0]!.ts, last.ts * 1000);
  assert.equal(d[0]!.altFt, 2500);
  assert.ok(Math.abs(d[0]!.lat - I90_EDGEWICK.lat) < 1e-6);
});

test("drop-out: landings are not drop-outs", () => {
  // Ends low, away from a field: below the ~800 ft line, reads as a landing.
  const low = lostOverI90(600);
  assert.deepEqual(detectDropouts("A", low, T0 + 10_000), []);
  // Ends high but over a listed airport: pattern work or a go-around near the field.
  const atField = leg(I90_EDGEWICK, KOLM, 30 * 60, { startTs: T0, altFrom: 3000, altTo: 2000 });
  assert.deepEqual(detectDropouts("A", atField, T0 + 10_000), []);
  // Unknown altitude at the end: ADS-B drops altitude near the ground, so not counted.
  const noAlt = lostOverI90(2500).map((p, i, arr) => (i === arr.length - 1 ? { ...p, alt: null } : p));
  assert.deepEqual(detectDropouts("A", noAlt, T0 + 10_000), []);
});

test("drop-out: the live session is not lost, and a mid-flight gap counts once", () => {
  const pts = lostOverI90(2500);
  const last = pts[pts.length - 1]!;
  // Heard 60 s ago: still live.
  assert.deepEqual(detectDropouts("A", pts, last.ts + 60), []);
  // Lost over I-90, reacquired 20 min later and flown home: one drop-out.
  const back = leg(I90_EDGEWICK, KOLM, 30 * 60, { startTs: last.ts + 1200, altFrom: 3500, altTo: 200 });
  const d = detectDropouts("A", [...pts, ...back], back[back.length - 1]!.ts + 3600);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.ts, last.ts * 1000);
});

test("drop-out: needs the feed to have heard someone else right after", () => {
  const pts = lostOverI90(2500);
  const last = pts[pts.length - 1]!;
  const now = last.ts + 3600;
  const other = straight(47.6, -122.3, 0, 20 * 60, { startTs: last.ts - 600 });
  // Another tail was sampled after the loss: confirmed.
  const heard = sampleTimesOf([pts, other]);
  assert.equal(detectDropouts("A", pts, now, { sampleTimes: heard }).length, 1);
  // Nobody was sampled after the loss: the poller was idle, not the tail.
  const idle = sampleTimesOf([pts]);
  assert.equal(detectDropouts("A", pts, now, { sampleTimes: idle }).length, 0);
  // Heard again only 10 min later: still too late to tell.
  assert.equal(detectDropouts("A", pts, now, { sampleTimes: [...idle, last.ts + 600] }).length, 0);
});

test("coverage aggregation: hot-zone grid cells, counts, tails, newest first on ties", () => {
  const cellLat = Math.floor(47.4651 / GRID_CELL_DEG) * GRID_CELL_DEG;
  const cellLon = Math.floor(-121.7201 / GRID_CELL_DEG) * GRID_CELL_DEG;
  const inCell = { lat: cellLat + GRID_CELL_DEG * 0.3, lon: cellLon + GRID_CELL_DEG * 0.3 };
  const drops: Dropout[] = [
    { tail: "B", ts: 2000, ...inCell, altFt: 2000 },
    { tail: "A", ts: 1000, lat: inCell.lat + GRID_CELL_DEG * 0.2, lon: inCell.lon, altFt: 1500 },
    { tail: "A", ts: 3000, lat: 47.2, lon: -123.1, altFt: 1200 },
  ];
  const cells = aggregateDropouts(drops);
  assert.equal(cells.length, 2);
  const top = cells[0]!;
  assert.equal(top.id, zoneIdForPoint(inCell.lat, inCell.lon));
  assert.equal(top.count, 2);
  assert.deepEqual(top.tails, ["A", "B"]);
  assert.equal(top.lastTs, 2000);
  assert.ok(Math.abs(top.lat - (cellLat + GRID_CELL_DEG / 2)) < 1e-4);
  assert.ok(Math.abs(top.lon - (cellLon + GRID_CELL_DEG / 2)) < 1e-4);
  assert.equal(cells[1]!.count, 1);
  assert.deepEqual(aggregateDropouts([]), []);
});

test("coverage summary names the weakest area from the data", () => {
  const drops: Dropout[] = [
    { tail: "A", ts: 1, lat: 47.47, lon: -121.73, altFt: 2000 }, // North Bend side of I-90
    { tail: "B", ts: 2, lat: 47.48, lon: -121.76, altFt: 2000 },
    { tail: "C", ts: 3, lat: 47.21, lon: -123.1, altFt: 1500 }, // Shelton
  ];
  const s = summarizeCoverage(drops);
  assert.equal(s.dropouts, 3);
  assert.equal(s.windowDays, 30);
  assert.equal(s.weakest?.name, "North Bend");
  assert.equal(s.weakest?.count, 2);
  assert.deepEqual(s.areas.map((a) => a.name), ["North Bend", "Shelton"]);
  // Far from any corridor place: falls back to the region label.
  assert.deepEqual(dropoutsByArea([{ lat: 48.0, lon: -124.5 }]), [{ name: "Olympic Peninsula", count: 1 }]);
  assert.equal(summarizeCoverage([]).weakest, null);
  assert.equal(
    coverageNoteText(s.weakest?.name),
    "Quiet here can mean unseen. Low-level coverage is thin in North Bend.",
  );
  assert.match(coverageNoteText(null), /^Quiet here can mean unseen\./);
});
