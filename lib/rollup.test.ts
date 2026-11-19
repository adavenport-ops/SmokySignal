// Run: npx tsx --test lib/rollup.test.ts
//
// Pins the pure arithmetic behind the permanent daily rollup and /stats:
// session folding, Pacific hour/weekday bucketing (DST included), the
// 00:00 UTC stitch, backfill planning and the weekly window.

import { test } from "node:test";
import assert from "node:assert";
import {
  buildRollupDoc,
  distributeMinutes,
  planRollupDates,
  ptParts,
  stitchSessions,
  summarizeRollups,
  weekStartOf,
  type DailyRollup,
} from "./rollup-core";
import type { TrackPoint } from "./tracks";
import type { FleetEntry } from "./types";

const ENTRY: FleetEntry = {
  tail: "N305DK",
  operator: "WSP",
  model: "Cessna 182",
  nickname: "Smokey 5",
  roleDescription: "Speed enforcement",
  base: "KOLM",
  role: "smokey",
  roleConfidence: "confirmed",
};
const OTHER: FleetEntry = { ...ENTRY, tail: "N2446X", nickname: null, operator: "KCSO", role: "patrol" };

/** Samples every `stepS` seconds from start (inclusive) to end (inclusive). */
function run(startMs: number, endMs: number, stepS = 60, alt = 1500): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let t = startMs; t <= endMs; t += stepS * 1000) {
    out.push({ lat: 47.2, lon: -122.4, alt, spd: 100, trk: 90, ts: Math.floor(t / 1000) });
  }
  return out;
}

test("ptParts: 2026-11-18 20:30Z is Wed 12:00 PST", () => {
  assert.deepEqual(ptParts(Date.UTC(2026, 10, 18, 20, 30)), { date: "2026-11-18", dow: 3, hour: 12 });
});

test("ptParts: midnight PT renders as hour 0, never 24", () => {
  // 2026-11-19 08:00Z = 2026-11-19 00:00 PST
  assert.deepEqual(ptParts(Date.UTC(2026, 10, 19, 8, 0)), { date: "2026-11-19", dow: 4, hour: 0 });
});

test("ptParts: summer uses PDT (UTC-7)", () => {
  // 2026-07-04 19:00Z = 12:00 PDT, Saturday
  assert.deepEqual(ptParts(Date.UTC(2026, 6, 4, 19, 0)), { date: "2026-07-04", dow: 6, hour: 12 });
});

test("distributeMinutes splits a session across Pacific hours", () => {
  const got: Array<[number, number]> = [];
  // 20:40Z → 22:10Z = 12:40 → 14:10 PST
  distributeMinutes(Date.UTC(2026, 10, 18, 20, 40), Date.UTC(2026, 10, 18, 22, 10), (pt, m) =>
    got.push([pt.hour, m]),
  );
  assert.deepEqual(got, [
    [12, 20],
    [13, 60],
    [14, 10],
  ]);
});

test("buildRollupDoc: per-tail counts, airborne seconds, max alt, takeoff stamps", () => {
  const day = "20261118";
  const a1 = Date.UTC(2026, 10, 18, 17, 0);
  const a2 = Date.UTC(2026, 10, 18, 20, 0);
  const samples = [
    ...run(a1, a1 + 30 * 60_000, 60, 1200), // 30 min
    ...run(a2, a2 + 60 * 60_000, 60, 2500), // 60 min, 3 h later
  ];
  const doc = buildRollupDoc(day, [
    { entry: ENTRY, samples },
    { entry: OTHER, samples: [] },
  ], 123);

  assert.equal(doc.v, 1);
  assert.equal(doc.date, day);
  assert.equal(doc.registry_size, 2);
  assert.equal(doc.sample_count, samples.length);
  assert.equal(doc.tails.length, 1, "tails that never flew are omitted");
  const t = doc.tails[0]!;
  assert.equal(t.flights, 2);
  assert.equal(t.airborne_s, 90 * 60);
  assert.equal(t.max_alt_ft, 2500);
  assert.equal(t.first_takeoff_ts, a1);
  assert.equal(t.last_takeoff_ts, a2);
  assert.deepEqual(Object.keys(t.sessions[0]!).sort(), ["duration_s", "end_ts", "max_alt_ft", "start_ts"]);
  assert.deepEqual(doc.totals, { flights: 2, airborne_s: 5400, max_alt_ft: 2500, tails_flown: 1 });
  // 17:00Z = 09:00 PST (30 min), 20:00Z = 12:00 PST (60 min)
  assert.equal(doc.pt_hour_minutes[9], 30);
  assert.equal(doc.pt_hour_minutes[12], 60);
  assert.equal(doc.pt_hour_minutes.reduce((a, b) => a + b, 0), 90);
});

test("buildRollupDoc: an empty day is still a valid doc", () => {
  const doc = buildRollupDoc("20261118", [{ entry: ENTRY, samples: [] }], 1);
  assert.equal(doc.tails.length, 0);
  assert.equal(doc.totals.flights, 0);
  assert.equal(doc.pt_hour_minutes.length, 24);
});

test("stitchSessions rejoins a flight cut at 00:00 UTC", () => {
  const midnight = Date.UTC(2026, 10, 19, 0, 0);
  const s = stitchSessions("N305DK", null, [
    { start_ts: midnight + 60_000, end_ts: midnight + 40 * 60_000, duration_s: 39 * 60, max_alt_ft: 3000 },
    { start_ts: midnight - 50 * 60_000, end_ts: midnight - 60_000, duration_s: 49 * 60, max_alt_ft: 1800 },
    { start_ts: midnight + 3 * 3_600_000, end_ts: midnight + 4 * 3_600_000, duration_s: 3600, max_alt_ft: 900 },
  ]);
  assert.equal(s.length, 2);
  assert.equal(s[0]!.start_ts, midnight - 50 * 60_000);
  assert.equal(s[0]!.duration_s, 90 * 60);
  assert.equal(s[0]!.max_alt_ft, 3000);
});

test("planRollupDates: yesterday always, missing days only, never today", () => {
  const now = Date.UTC(2026, 10, 18, 9, 15);
  const indexed = new Set(["20261117", "20261116"]);
  const plan = planRollupDates(now, indexed, 4);
  assert.deepEqual(plan, ["20261117", "20261115", "20261114"]);
  assert.ok(!plan.includes("20261118"));
});

test("weekStartOf: Monday anchor", () => {
  assert.equal(weekStartOf("2026-11-18", 3), "2026-11-16"); // Wed
  assert.equal(weekStartOf("2026-11-16", 1), "2026-11-16"); // Mon
  assert.equal(weekStartOf("2026-11-22", 0), "2026-11-16"); // Sun
});

function docWith(date: string, entry: FleetEntry, startMs: number, minutes: number): DailyRollup {
  return buildRollupDoc(date, [{ entry, samples: run(startMs, startMs + minutes * 60_000) }], 0);
}

test("summarizeRollups: totals, busiest day, longest sortie, per-tail, grid", () => {
  const now = Date.UTC(2026, 10, 19, 12, 0);
  const d1 = docWith("20261117", ENTRY, Date.UTC(2026, 10, 17, 18, 0), 45); // Tue 10:00 PST
  const d2 = docWith("20261118", ENTRY, Date.UTC(2026, 10, 18, 20, 0), 120); // Wed 12:00 PST
  const d3 = docWith("20261118", OTHER, Date.UTC(2026, 10, 18, 21, 0), 30); // Wed 13:00 PST
  // Merge d3's tail into d2's doc (same UTC day, two tails).
  d2.tails.push(...d3.tails);

  const s = summarizeRollups([d1, d2], ["20261118", "20261117"], now);
  assert.equal(s.days_on_record, 2);
  assert.equal(s.first_date, "2026-11-17");
  assert.equal(s.totals.flights, 3);
  assert.equal(s.totals.airborne_s, (45 + 120 + 30) * 60);
  assert.deepEqual(s.busiest_day, { date: "2026-11-18", airborne_s: 150 * 60, flights: 2 });
  assert.equal(s.longest_sortie?.tail, "N305DK");
  assert.equal(s.longest_sortie?.duration_s, 120 * 60);
  assert.equal(s.per_tail[0]!.tail, "N305DK");
  assert.equal(s.per_tail[0]!.flights, 2);
  assert.equal(s.per_tail[0]!.airborne_s, 165 * 60);
  assert.equal(s.per_tail[1]!.role, "patrol");
  assert.equal(s.week_grid[2]![10], 45); // Tue 10:00
  assert.equal(s.week_grid[3]![12], 60); // Wed 12:00
  assert.equal(s.week_grid[3]![13], 90); // Wed 13:00: 60 from N305DK + 30 from N2446X
});

test("summarizeRollups: last 30 days bucketed by Pacific week, zero weeks kept", () => {
  const now = Date.UTC(2026, 10, 19, 12, 0); // Thu 04:00 PST
  const recent = docWith("20261117", ENTRY, Date.UTC(2026, 10, 17, 18, 0), 60);
  const old = docWith("20260901", ENTRY, Date.UTC(2026, 8, 1, 18, 0), 60); // outside window
  const s = summarizeRollups([recent, old], ["20260901", "20261117"], now);
  assert.deepEqual(
    s.weekly.map((w) => w.week_start),
    ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"],
  );
  assert.equal(s.weekly[4]!.airborne_s, 3600);
  assert.equal(s.weekly.slice(0, 4).reduce((n, w) => n + w.airborne_s, 0), 0);
  assert.equal(s.weekly[0]!.partial, true);
  assert.equal(s.weekly[4]!.partial, true);
  assert.equal(s.weekly[2]!.partial, false);
  // The old flight still counts toward all-time totals.
  assert.equal(s.totals.flights, 2);
});

test("summarizeRollups: no docs → empty summary", () => {
  const s = summarizeRollups([], [], Date.UTC(2026, 10, 19));
  assert.equal(s.days_on_record, 0);
  assert.equal(s.first_date, null);
  assert.equal(s.busiest_day, null);
  assert.equal(s.longest_sortie, null);
  assert.equal(s.per_tail.length, 0);
});
