// Run: npx tsx --test lib/forecast-month.test.ts
//
// Monthly /forecast view: month list from the rollup index, ?month=
// resolution, and folding UTC-day rollup docs into one Pacific month
// (clipping at the month edges, stitching across 00:00 UTC).

import { test } from "node:test";
import assert from "node:assert";
import {
  LAST_30,
  resolveMonthParam,
  rollupMonths,
  summarizeMonth,
  utcDaysForMonth,
} from "./forecast-month";
import { monthBounds, monthLabel } from "./pt-range";
import type { DailyRollup, RollupSession } from "./rollup-core";

function doc(date: string, sessions: RollupSession[], tail = "N305DK"): DailyRollup {
  return {
    v: 1,
    date,
    built_at: 0,
    registry_size: 1,
    sample_count: sessions.length * 10,
    tails: sessions.length
      ? [
          {
            tail,
            nickname: "Smokey 5",
            operator: "WSP",
            role: "police",
            flights: sessions.length,
            airborne_s: sessions.reduce((n, s) => n + s.duration_s, 0),
            max_alt_ft: 3000,
            first_takeoff_ts: sessions[0]!.start_ts,
            last_takeoff_ts: sessions[sessions.length - 1]!.start_ts,
            sessions,
          },
        ]
      : [],
    totals: { flights: sessions.length, airborne_s: 0, max_alt_ft: 0, tails_flown: sessions.length ? 1 : 0 },
    pt_hour_minutes: new Array(24).fill(0),
  };
}

function sess(startMs: number, minutes: number): RollupSession {
  return {
    start_ts: startMs,
    end_ts: startMs + minutes * 60_000,
    duration_s: minutes * 60,
    max_alt_ft: 3000,
  };
}

test("rollupMonths lists months on record, newest first, with labels", () => {
  const months = rollupMonths(["20261030", "20261031", "20261101", "20261117", "junk"]);
  assert.deepEqual(months, [
    { value: "2026-11", label: "November 2026" },
    { value: "2026-10", label: "October 2026" },
  ]);
});

test("resolveMonthParam falls back to last 30 days for anything not on record", () => {
  const opts = rollupMonths(["20261101"]);
  assert.equal(resolveMonthParam("2026-11", opts), "2026-11");
  assert.equal(resolveMonthParam("2026-10", opts), LAST_30);
  assert.equal(resolveMonthParam("2026-13", opts), LAST_30);
  assert.equal(resolveMonthParam(["2026-11"], opts), LAST_30);
  assert.equal(resolveMonthParam(undefined, opts), LAST_30);
});

test("month helpers", () => {
  assert.equal(monthLabel("2026-02"), "February 2026");
  assert.deepEqual(monthBounds("2028-02"), { first: "2028-02-01", last: "2028-02-29", days: 29 });
  const days = utcDaysForMonth("2026-11");
  assert.equal(days.length, 31);
  assert.equal(days[0], "20261101");
  assert.equal(days[30], "20261201");
});

test("summarizeMonth: grid, totals, busiest day and hour, honest day count", () => {
  // Tue 2026-11-03 10:00 PST = 18:00 UTC, 90 min.
  const a = sess(Date.UTC(2026, 10, 3, 18, 0), 90);
  // Tue 2026-11-10 10:00 PST, 60 min.
  const b = sess(Date.UTC(2026, 10, 10, 18, 0), 60);
  // Sat 2026-11-07 14:00 PST = 22:00 UTC, 30 min.
  const c = sess(Date.UTC(2026, 10, 7, 22, 0), 30);
  const docs = [doc("20261103", [a]), doc("20261107", [c]), doc("20261110", [b])];
  const index = ["20261031", "20261103", "20261107", "20261110"];
  const s = summarizeMonth(docs, "2026-11", index, Date.UTC(2026, 11, 5));
  assert.equal(s.label, "November 2026");
  assert.equal(s.days_in_month, 30);
  assert.equal(s.days_of_data, 3, "October's doc is not counted");
  assert.equal(s.first_data_date, "2026-11-03");
  assert.equal(s.in_progress, false);
  assert.equal(s.totals.flights, 3);
  assert.equal(s.totals.airborne_s, 180 * 60);
  assert.equal(s.week_grid[2]![10], 120); // Tue 10:00: 60 + 60
  assert.equal(s.week_grid[2]![11], 30);
  assert.equal(s.week_grid[6]![14], 30);
  assert.deepEqual(s.busiest_hour, { dow: 2, hour: 10, minutes: 120 });
  assert.deepEqual(s.busiest_day, { date: "2026-11-03", airborne_s: 5400, flights: 1 });
  assert.equal(s.per_tail[0]!.tail, "N305DK");
});

test("summarizeMonth clips at the Pacific month edge and stitches 00:00 UTC", () => {
  // Oct 31 23:00 PDT → Nov 1 00:30 PDT (06:00–07:30 UTC Nov 1).
  // Nov 1 is still PDT (DST ends Nov 1 at 02:00), so the month starts 07:00 UTC.
  const edge = sess(Date.UTC(2026, 10, 1, 6, 0), 90);
  // Split at 00:00 UTC: 23:40–00:00 and 00:00–00:20 UTC, Nov 5 → one flight.
  const p1 = sess(Date.UTC(2026, 10, 5, 23, 40), 20);
  const p2 = sess(Date.UTC(2026, 10, 6, 0, 0), 20);
  const s = summarizeMonth(
    [doc("20261101", [edge]), doc("20261105", [p1]), doc("20261106", [p2])],
    "2026-11",
    ["20261101", "20261105", "20261106"],
    Date.UTC(2026, 10, 18, 20),
  );
  // Edge flight took off in October: its 30 in-month minutes count, the flight does not.
  assert.equal(s.totals.flights, 1);
  assert.equal(s.totals.airborne_s, 30 * 60 + 40 * 60);
  assert.equal(s.in_progress, true);
});

test("summarizeMonth with no docs is an empty, valid month", () => {
  const s = summarizeMonth([], "2026-09", [], 0);
  assert.equal(s.days_of_data, 0);
  assert.equal(s.totals.flights, 0);
  assert.equal(s.busiest_day, null);
  assert.equal(s.busiest_hour, null);
  assert.equal(s.week_grid.length, 7);
});

test("summarizeMonth honours a tail filter (mission chips)", () => {
  const a = sess(Date.UTC(2026, 10, 3, 18, 0), 60);
  const docs = [doc("20261103", [a]), doc("20261104", [sess(Date.UTC(2026, 10, 4, 18, 0), 30)], "N2446X")];
  const all = summarizeMonth(docs, "2026-11", ["20261103", "20261104"], 0);
  assert.equal(all.totals.flights, 2);
  const one = summarizeMonth(docs, "2026-11", ["20261103", "20261104"], 0, new Set(["N2446X"]));
  assert.equal(one.totals.flights, 1);
  assert.equal(one.per_tail[0]!.tail, "N2446X");
  assert.equal(one.days_of_data, 2, "day count is about the log, not the filter");
});
