// Run: npx tsx --test lib/circling.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  circlingFromTrack,
  describePattern,
  fmtPatternMinutes,
  parseBase,
  plainAirframe,
  sortByPattern,
  splitSessions,
  type CirclingItem,
} from "./circling";
import { countWithin, fmtMiles, sortByDistance } from "./near-me";
import { leg, racetrack, straight } from "./geo-fixtures.test-helpers";
import type { TrackPoint } from "./tracks";

const KOLM = { lat: 46.9694, lon: -122.9025 };
const SR512_SUMMIT = { lat: 47.157, lon: -122.385 };
const T0 = 1_763_400_000;

const SMOKEY_3 = {
  tail: "N2446X",
  nickname: "Smokey 3",
  model: "Cessna 206H Stationair (FLIR)",
  operator: "Washington State Patrol",
  role: "police" as const,
  base: "KOLM Olympia",
};

/** Takeoff from KOLM, 16 min transit, then a racetrack over SR-512 at Summit. */
function sortieOverSr512(patternS: number): TrackPoint[] {
  const out = leg(KOLM, SR512_SUMMIT, 16 * 60, { startTs: T0, altFrom: 200, altTo: 1800 });
  const end = out[out.length - 1]!;
  const work = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, patternS, {
    startTs: end.ts + 30,
    alt: 1800,
  });
  return [...out, ...work];
}

test("circling: racetrack over SR-512 after a KOLM takeoff reads in plain language", () => {
  const pts = sortieOverSr512(22 * 60);
  const last = pts[pts.length - 1]!;
  const item = circlingFromTrack(SMOKEY_3, pts, last.ts + 20);
  assert.ok(item, "expected a pattern");
  assert.equal(item.name, "Smokey 3");
  assert.equal(item.airframe, "Cessna 206H Stationair with a FLIR camera");
  assert.equal(item.road, "SR-512");
  assert.equal(item.roadId, "sr-512");
  assert.equal(item.near, "Summit");
  assert.equal(item.mission, "police");
  assert.equal(item.missionLabel, "Smokey");
  assert.equal(item.missionBadge, "SMOKEY");
  assert.equal(item.smokey, true);
  assert.deepEqual(item.airport, { id: "KOLM", city: "Olympia", fromTakeoff: true });
  assert.ok(item.patternMin >= 19 && item.patternMin <= 23, `patternMin ${item.patternMin}`);
  assert.equal(item.altFt, 1800);
  assert.match(
    item.sentence,
    /^Working a pattern over SR-512 near Summit for (19|2[0-3]) min · out of Olympia \(KOLM\)\.$/,
  );
  // Input order does not matter.
  const shuffled = [...pts].reverse();
  assert.equal(circlingFromTrack(SMOKEY_3, shuffled, last.ts + 20)?.patternMin, item.patternMin);
});

test("circling: straight transit is not a pattern", () => {
  const pts = straight(KOLM.lat, KOLM.lon, 30, 15 * 60, { startTs: T0, jitterDeg: 3 });
  const last = pts[pts.length - 1]!;
  assert.equal(circlingFromTrack(SMOKEY_3, pts, last.ts + 10), null);
});

test("circling: only the last ~15 min count; a pattern that ended is not circling now", () => {
  const orbit = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 20 * 60, { startTs: T0 });
  const end = orbit[orbit.length - 1]!;
  const out = straight(end.lat, end.lon, 0, 16 * 60, { startTs: end.ts + 30 });
  const last = out[out.length - 1]!;
  assert.equal(circlingFromTrack(SMOKEY_3, [...orbit, ...out], last.ts + 10), null);
});

test("circling: a stale track is not circling now", () => {
  const pts = sortieOverSr512(20 * 60);
  const last = pts[pts.length - 1]!;
  assert.ok(circlingFromTrack(SMOKEY_3, pts, last.ts + 60));
  assert.equal(circlingFromTrack(SMOKEY_3, pts, last.ts + 6 * 60), null);
  assert.equal(circlingFromTrack(SMOKEY_3, [], T0), null);
});

test("circling: with no takeoff in the data it names the registry base", () => {
  const pts = racetrack(SR512_SUMMIT.lat, SR512_SUMMIT.lon, 18 * 60, { startTs: T0 });
  const last = pts[pts.length - 1]!;
  const item = circlingFromTrack(SMOKEY_3, pts, last.ts);
  assert.ok(item);
  assert.deepEqual(item.airport, { id: "KOLM", city: "Olympia", fromTakeoff: false });
  assert.match(item.sentence, /· based at Olympia \(KOLM\)\.$/);
});

test("circling: mission label follows the registry, so wildfire and federal read correctly", () => {
  const pts = sortieOverSr512(15 * 60);
  const last = pts[pts.length - 1]!;
  const fire = circlingFromTrack(
    { ...SMOKEY_3, tail: "N123WF", nickname: null, role: "wildfire", base: "KELN Ellensburg" },
    pts,
    last.ts,
  );
  assert.ok(fire);
  assert.equal(fire.name, "N123WF");
  assert.equal(fire.missionLabel, "Wildfire");
  assert.equal(fire.missionBadge, "WILDFIRE");
  assert.equal(fire.smokey, false);
  // Took off from KOLM, which is not its listed base: the field name is used.
  assert.deepEqual(fire.airport, { id: "KOLM", city: "Olympia Regional", fromTakeoff: true });

  const cbp = circlingFromTrack({ ...SMOKEY_3, role: "federal_le" }, pts, last.ts);
  assert.equal(cbp?.missionBadge, "FEDERAL");
  assert.equal(cbp?.smokey, false);

  // Legacy stored role values still map.
  const legacy = circlingFromTrack({ ...SMOKEY_3, role: "smokey" as never }, pts, last.ts);
  assert.equal(legacy?.mission, "police");
});

test("circling: plain-language helpers", () => {
  assert.equal(plainAirframe("Cessna T206H Stationair (Textron, 2026)"), "Cessna T206H Stationair");
  assert.equal(plainAirframe("Bell 407GXi"), "Bell 407GXi");
  assert.equal(plainAirframe(""), "Unlisted airframe");
  assert.equal(fmtPatternMinutes(0.2), "1 min");
  assert.equal(fmtPatternMinutes(22), "22 min");
  assert.equal(fmtPatternMinutes(65), "1 h 05 min");
  assert.deepEqual(parseBase("KRNT Renton"), { id: "KRNT", city: "Renton" });
  assert.deepEqual(parseBase("KPLU"), { id: "KPLU", city: "Thun Field" });
  assert.equal(parseBase("Taylor's Landing"), null);
  assert.equal(
    describePattern({ road: null, near: "Gig Harbor", patternMin: 9, airport: null }),
    "Working a pattern near Gig Harbor for 9 min.",
  );
  assert.equal(
    describePattern({ road: null, near: null, patternMin: 9, airport: null }),
    "Working a pattern away from any named road for 9 min.",
  );
});

test("circling: splitSessions breaks on gaps over 5 min", () => {
  const a = straight(KOLM.lat, KOLM.lon, 0, 120, { startTs: T0 });
  const b = straight(KOLM.lat, KOLM.lon, 0, 120, { startTs: T0 + 120 + 301 });
  assert.equal(splitSessions([...a, ...b]).length, 2);
  assert.equal(splitSessions(a).length, 1);
  assert.deepEqual(splitSessions([]), []);
});

test("near me: sorts by distance and counts within 15 miles", () => {
  const base = { patternMin: 10, name: "x" } as unknown as CirclingItem;
  const items = [
    { ...base, tail: "FAR", lat: 47.6, lon: -122.33 }, // Seattle
    { ...base, tail: "NEAR", lat: 47.26, lon: -122.45 }, // Tacoma
  ];
  const me = { lat: 47.2529, lon: -122.4443 }; // Tacoma
  const sorted = sortByDistance(items, me);
  assert.deepEqual(sorted.map((s) => s.tail), ["NEAR", "FAR"]);
  assert.ok(sorted[0]!.distanceMi < 1);
  assert.ok(sorted[1]!.distanceMi > 20);
  assert.equal(countWithin(sorted), 1);
  assert.equal(countWithin(sorted, 0.1), 0);
  assert.equal(fmtMiles(4.24), "4.2 mi");
  assert.equal(fmtMiles(24.6), "25 mi");
  assert.deepEqual(
    sortByPattern([
      { ...base, tail: "A", name: "B", patternMin: 5 },
      { ...base, tail: "C", name: "A", patternMin: 30 },
    ]).map((i) => i.tail),
    ["C", "A"],
  );
});
