// Run: npx tsx --test lib/road.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  corridorById,
  eventsNearRoad,
  isOverRoad,
  passesForTrack,
  roadCardHeadline,
  stretchFor,
  summarizeRoad,
  type RoadPass,
} from "./road";
import { offsetNm, racetrack, straight } from "./geo-fixtures.test-helpers";

const SR512_SUMMIT = { lat: 47.157, lon: -122.385 };
const I5_FIFE = { lat: 47.24, lon: -122.36 };
const T0 = 1_763_400_000; // 2025-11-17 17:20 UTC
const DAY_MS = 86_400_000;

const sr512 = corridorById("sr-512")!;
const i5 = corridorById("I-5")!;

test("road: corridor lookup is case-insensitive and rejects unknown ids", () => {
  assert.equal(sr512.name, "SR-512");
  assert.equal(i5.id, "i-5");
  assert.equal(corridorById("sr-999"), null);
});

test("road: the ~2 nm buffer around the polyline", () => {
  const in1 = offsetNm(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 0, 1.8);
  const out1 = offsetNm(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 0, 2.4);
  assert.equal(isOverRoad(SR512_SUMMIT.lat, SR512_SUMMIT.lon, sr512), true);
  assert.equal(isOverRoad(in1.lat, in1.lon, sr512), true);
  assert.equal(isOverRoad(out1.lat, out1.lon, sr512), false);
  // Spokane is nowhere near SR-512 (bbox reject path).
  assert.equal(isOverRoad(47.66, -117.42, sr512), false);
  assert.equal(stretchFor(SR512_SUMMIT.lat, SR512_SUMMIT.lon, sr512), "Summit");
});

test("road pass filter: a racetrack over SR-512 is one pass at Summit, flagged as a pattern", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 20 * 60, { startTs: T0 });
  const passes = passesForTrack({ tail: "N2446X", nickname: "Smokey 3", role: "police" }, pts, sr512);
  assert.equal(passes.length, 1);
  const p = passes[0]!;
  assert.equal(p.name, "Smokey 3");
  assert.equal(p.mission, "police");
  assert.equal(p.place, "Summit");
  assert.equal(p.pattern, true);
  assert.ok(p.minutes >= 19 && p.minutes <= 21, `minutes ${p.minutes}`);
  assert.equal(p.startTs, T0 * 1000);
});

test("road pass filter: a straight crossing is a short pass with no pattern; far tracks are ignored", () => {
  // Fly due north across I-5 at Fife: ~4 nm inside the 2 nm buffer.
  const start = offsetNm(I5_FIFE.lat, I5_FIFE.lon, 0, -6);
  const pts = straight(start.lat, start.lon, 0, 6 * 60, { startTs: T0 });
  const passes = passesForTrack({ tail: "N1", role: "transport" }, pts, i5);
  assert.equal(passes.length, 1);
  assert.equal(passes[0]!.pattern, false);
  assert.ok(passes[0]!.minutes > 1 && passes[0]!.minutes < 3.5, `minutes ${passes[0]!.minutes}`);
  assert.equal(passes[0]!.mission, "transport");

  const far = straight(46.0, -118.5, 90, 20 * 60, { startTs: T0 });
  assert.deepEqual(passesForTrack({ tail: "N1", role: "police" }, far, i5), []);
});

test("road pass filter: two sessions split by a gap are two passes; sinceS trims old points", () => {
  const a = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 10 * 60, { startTs: T0 });
  const b = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 10 * 60, { startTs: T0 + 3600 });
  const entry = { tail: "N2446X", role: "police" };
  assert.equal(passesForTrack(entry, [...a, ...b], sr512).length, 2);
  assert.equal(passesForTrack(entry, [...a, ...b], sr512, { sinceS: T0 + 3000 }).length, 1);
  // A single stray sample is not a pass.
  assert.deepEqual(passesForTrack(entry, [a[0]!], sr512), []);
});

function pass(over: Partial<RoadPass>): RoadPass {
  return {
    tail: "N2446X",
    name: "Smokey 3",
    mission: "police",
    startTs: 0,
    endTs: 0,
    minutes: 10,
    place: "Summit",
    places: { Summit: 10 },
    pattern: false,
    ...over,
  };
}

test("road summary: week vs month counts, missions, busiest stretch, hour histogram", () => {
  const now = Date.UTC(2026, 10, 18, 20, 0); // 12:00 PT
  const hour = 3_600_000;
  const passes: RoadPass[] = [
    // 2 days ago, 10:00-10:30 PT (18:00 UTC), Smokey, Summit.
    pass({ startTs: now - 2 * DAY_MS - 2 * hour, endTs: now - 2 * DAY_MS - 1.5 * hour, minutes: 30, places: { Summit: 30 } }),
    // 10 days ago, wildfire, South Hill.
    pass({
      tail: "N9",
      name: "N9",
      mission: "wildfire",
      startTs: now - 10 * DAY_MS,
      endTs: now - 10 * DAY_MS + 0.25 * hour,
      minutes: 15,
      place: "South Hill",
      places: { "South Hill": 15 },
    }),
    // 3 days ago, Smokey, split across stretches.
    pass({ startTs: now - 3 * DAY_MS, endTs: now - 3 * DAY_MS + hour / 6, minutes: 10, places: { Summit: 4, Parkland: 6 } }),
    // 40 days ago: outside the window.
    pass({ startTs: now - 40 * DAY_MS, endTs: now - 40 * DAY_MS + hour, minutes: 60 }),
  ];
  const s = summarizeRoad(sr512, passes, [], now);
  assert.equal(s.id, "sr-512");
  assert.equal(s.flights30d, 3);
  assert.equal(s.flights7d, 2);
  assert.equal(s.minutes30d, 55);
  assert.deepEqual(
    s.missions.map((m) => [m.mission, m.label, m.flights, m.minutes]),
    [
      ["police", "Smokey", 2, 40],
      ["wildfire", "Wildfire", 1, 15],
    ],
  );
  assert.equal(s.stretches[0]!.place, "Summit");
  assert.equal(s.stretches[0]!.minutes, 34);
  assert.equal(s.stretches[0]!.share, 62);
  const hourSum = s.hourMinutes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(hourSum - 55) < 0.5, `hour sum ${hourSum}`);
  // The 2-days-ago pass ran 10:00-10:30 PT.
  assert.ok(s.hourMinutes[10]! >= 30, `10:00 bin ${s.hourMinutes[10]}`);
  assert.equal(s.recent[0]!.startTs, passes[0]!.startTs, "newest first");
  assert.equal(roadCardHeadline("SR-512", s.flights7d), "Planes over SR-512 this week: 2 flights");
  assert.equal(roadCardHeadline("I-5", 1), "Planes over I-5 this week: 1 flight");
});

test("road events: only activity near the corridor inside the window", () => {
  const now = Date.UTC(2026, 10, 18, 20, 0);
  const events = [
    { ts: now - DAY_MS, tail: "A", kind: "takeoff", description: "up", lat: SR512_SUMMIT.lat, lon: SR512_SUMMIT.lon },
    { ts: now - DAY_MS, tail: "B", kind: "takeoff", description: "up", lat: 47.66, lon: -117.42 },
    { ts: now - 40 * DAY_MS, tail: "C", kind: "landing", description: "down", lat: SR512_SUMMIT.lat, lon: SR512_SUMMIT.lon },
    { ts: now - 2 * DAY_MS, tail: "D", kind: "landing", description: "down", lat: null, lon: null },
  ];
  const near = eventsNearRoad(events, sr512, now - 30 * DAY_MS);
  assert.deepEqual(near.map((e) => [e.tail, e.place]), [["A", "Summit"]]);
});
