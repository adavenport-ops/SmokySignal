// Run: npx tsx --test lib/town-stats.test.ts
//
// The town fold: passes within ~8 nm, minutes, the Pacific weekday and
// hour, mission and agency mix, roads, the 30-day window, flight links
// that resolve the way /flight/[tail]/[flightId] cuts sessions, and the
// intro sentence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flightIdFromTs, sessionsFromDay } from "./flights";
import { townBySlug } from "./towns";
import {
  emptyTownSummary,
  groupByUtcDay,
  passesForTown,
  summarizeTown,
  townIntro,
  type TownPass,
} from "./town-stats";
import type { TrackPoint } from "./tracks";
import type { FleetEntry } from "./types";

const NOW = Date.parse("2026-11-19T08:00:00Z");
const FIFE = townBySlug("fife")!;

const SMOKEY3 = { tail: "N2446X", nickname: "Smokey 3", operator: "WSP", role: "police" } as const;
const GUARDIAN = { tail: "N790PC", nickname: "Guardian One", operator: "KCSO", role: "police" } as const;

/** `n` samples, 30 s apart, from (lat, lon0) to (lat, lon1). */
function leg(startIso: string, n: number, lat: number, lon0: number, lon1: number, alt = 1500): TrackPoint[] {
  const t0 = Date.parse(startIso) / 1000;
  return Array.from({ length: n }, (_, i) => ({
    lat,
    lon: lon0 + ((lon1 - lon0) * i) / Math.max(1, n - 1),
    alt,
    spd: 100,
    trk: 90,
    ts: t0 + i * 30,
  }));
}

// Wednesday 18 Nov, 14:00 PST: 20 samples (10 min) along I-5 at Fife.
const A = leg("2026-11-18T22:00:00Z", 20, 47.24, -122.4, -122.32);
// Same day, 15:30 PST, over Seattle: 22 nm from Fife, not a pass.
const B = leg("2026-11-18T23:30:00Z", 20, 47.61, -122.34, -122.3);
// 1 Oct: near Fife, outside the 30-day window.
const C = leg("2026-10-01T20:00:00Z", 10, 47.24, -122.38, -122.34);
// Saturday 14 Nov, 10:00 PST: 8 samples (4 min) near Fife.
const D = leg("2026-11-14T18:00:00Z", 8, 47.25, -122.37, -122.35);
// One stray sample near Fife: needs two to count.
const STRAY = leg("2026-11-17T20:00:00Z", 1, 47.24, -122.36, -122.36);

test("passes: one per session with two or more samples inside the radius", () => {
  const pts = [...A, ...B, ...C, ...STRAY];
  const passes = passesForTown(SMOKEY3, pts, FIFE, { dayPoints: groupByUtcDay(pts) });
  assert.equal(passes.length, 2, "A and C; B is far, the stray is one sample");
  const a = passes.find((p) => p.startTs === A[0]!.ts * 1000)!;
  assert.equal(a.minutes, 10);
  assert.equal(a.name, "Smokey 3");
  assert.equal(a.mission, "police");
  assert.ok(a.closestNm < 1, String(a.closestNm));
  assert.match(a.road ?? "", /^(I-5|SR-167) · /);
  assert.ok(Object.keys(a.roads).includes("i-5"), JSON.stringify(a.roads));
});

test("flight links resolve the way the flight page cuts the UTC day", () => {
  const pts = [...A, ...B];
  const passes = passesForTown(SMOKEY3, pts, FIFE, { dayPoints: groupByUtcDay(pts) });
  const id = flightIdFromTs(A[0]!.ts * 1000);
  assert.equal(id, "20261118T2200");
  assert.deepEqual(passes[0]!.flight, { id, href: `/flight/N2446X/${id}` });
  // The page's own cut finds a session starting in that minute.
  const day = sessionsFromDay(SMOKEY3 as unknown as FleetEntry, "20261118", pts);
  assert.ok(day.some((s) => flightIdFromTs(s.start_ts) === id));
  // Without day points there is no link, never a guessed one.
  assert.equal(passesForTown(SMOKEY3, pts, FIFE)[0]!.flight, null);
});

test("summary: window, totals, Pacific weekday and hour, missions, agencies, roads", () => {
  const passes: TownPass[] = [
    ...passesForTown(SMOKEY3, [...A, ...B, ...C], FIFE),
    ...passesForTown(GUARDIAN, D, FIFE),
  ];
  const s = summarizeTown(FIFE, passes, NOW);
  assert.equal(s.flights30d, 2, "the 1 Oct pass is outside the window");
  assert.equal(s.flights7d, 2);
  assert.equal(s.tails, 2);
  assert.equal(s.minutes30d, 14);
  assert.equal(s.busiestWeekday?.label, "Wednesday");
  assert.equal(s.busiestHour?.hour, 14);
  assert.equal(Math.round(s.hourMinutes.reduce((a, b) => a + b, 0)), 14, "hour bins sum to the total");
  assert.equal(Math.round(s.weekdayMinutes.reduce((a, b) => a + b, 0)), 14);
  assert.ok(s.weekdayMinutes[6]! > 0, "Saturday has the Guardian pass");
  assert.deepEqual(s.missions.map((m) => [m.mission, m.flights]), [["police", 2]]);
  assert.deepEqual(
    s.agencies.map((a) => [a.code, a.name, a.flights]),
    [
      ["KCSO", "King County Sheriff's Office", 1],
      ["WSP", "Washington State Patrol", 1],
    ],
  );
  assert.ok(s.roadIds.includes("i-5"));
  assert.ok(s.roads.length > 0 && s.roads.every((r) => r.id !== "" && r.share >= 0));
  assert.equal(s.roads.reduce((a, r) => a + r.share, 0) >= 99, true);
  assert.equal(s.recent[0]!.tail, "N2446X", "newest first");
});

test("empty summary: zeros, no busiest, nothing invented", () => {
  const s = emptyTownSummary(FIFE);
  assert.equal(s.flights30d, 0);
  assert.equal(s.busiestHour, null);
  assert.equal(s.busiestWeekday, null);
  assert.deepEqual(s.agencies, []);
  assert.equal(s.hourMinutes.length, 24);
  assert.equal(s.weekdayMinutes.length, 7);
});

test("intro names only agencies that flew here, with registry counts", () => {
  const passes = [...passesForTown(SMOKEY3, A, FIFE), ...passesForTown(SMOKEY3, D, FIFE), ...passesForTown(GUARDIAN, D, FIFE)];
  const s = summarizeTown(FIFE, passes, NOW);
  const text = townIntro(s, new Map([["WSP", 2], ["KCSO", 1], ["Pierce SO", 1]]), 9);
  assert.equal(
    text,
    "In the last 30 days, 3 tracked flights by 2 aircraft came within about 9 mi of Fife. Who flew: Washington State Patrol (2 flights, 2 aircraft on our list), King County Sheriff's Office (1 flight, 1 aircraft on our list).",
  );
  assert.ok(!/Pierce/.test(text));
  assert.ok(!/police|cop\b|!/i.test(text));
  const one = townIntro(summarizeTown(FIFE, passesForTown(SMOKEY3, A, FIFE), NOW), new Map(), 9);
  assert.match(one, /All of them were Washington State Patrol \(1 flight\)\.$/);
  assert.match(townIntro(emptyTownSummary(FIFE), new Map(), 9), /^No tracked flight came within about 9 mi of Fife/);
});
