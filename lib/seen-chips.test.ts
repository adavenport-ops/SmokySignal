// Run: npx tsx --test lib/seen-chips.test.ts
//
// /seen quick chips: Today / Yesterday and the part-of-day windows, all
// Pacific, across both 2026-27 DST changes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERIOD_WINDOW_MIN,
  activePeriod,
  addDaysToDate,
  dayChipDate,
  futurePickMessage,
  parseSeenPageParams,
  periodChipState,
  periodHours,
  PERIODS,
  ptLocalToMs,
  searchPlaces,
  seenApiHref,
  seenStateWindowMs,
} from "./seen-view";
import { parseSeenQuery } from "./seen-core";

test("addDaysToDate crosses month and year ends", () => {
  assert.equal(addDaysToDate("2026-11-01", -1), "2026-10-31");
  assert.equal(addDaysToDate("2027-01-01", -1), "2026-12-31");
  assert.equal(addDaysToDate("2028-02-28", 1), "2028-02-29");
});

test("dayChipDate: today and yesterday are Pacific calendar days", () => {
  // 2026-11-19 05:30 UTC is 2026-11-18 21:30 PST.
  const now = Date.UTC(2026, 10, 19, 5, 30);
  assert.equal(dayChipDate("today", now), "2026-11-18");
  assert.equal(dayChipDate("yesterday", now), "2026-11-17");
});

test("dayChipDate: the day after fall-back (25-hour day) still steps one date", () => {
  // DST ended 2026-11-01 02:00 PDT. 2026-11-02 00:30 PST = 08:30 UTC.
  const now = Date.UTC(2026, 10, 2, 8, 30);
  assert.equal(dayChipDate("today", now), "2026-11-02");
  assert.equal(dayChipDate("yesterday", now), "2026-11-01");
  // now - 24 h would read 2026-11-01 00:30 PDT, the same answer only by luck;
  // 23:30 on the long day itself must still say yesterday is Oct 31.
  const late = Date.UTC(2026, 10, 2, 7, 30); // 2026-11-01 23:30 PST
  assert.equal(dayChipDate("today", late), "2026-11-01");
  assert.equal(dayChipDate("yesterday", late), "2026-10-31");
});

test("dayChipDate: just after spring-forward (23-hour day)", () => {
  // DST starts 2027-03-14 02:00 PST. 2027-03-15 00:15 PDT = 07:15 UTC.
  const now = Date.UTC(2027, 2, 15, 7, 15);
  assert.equal(dayChipDate("today", now), "2027-03-15");
  assert.equal(dayChipDate("yesterday", now), "2027-03-14");
});

test("period chips: middle of the six hours, ±3 h", () => {
  assert.deepEqual(periodChipState("morning"), { time: "09:00", w: PERIOD_WINDOW_MIN });
  assert.deepEqual(periodChipState("afternoon"), { time: "15:00", w: 180 });
  assert.deepEqual(periodChipState("evening"), { time: "21:00", w: 180 });
  assert.deepEqual(
    PERIODS.map(periodHours),
    ["06–12", "12–18", "18–24"],
  );
});

test("period windows cover exactly 06:00 to 12:00 PT on a DST change day", () => {
  for (const date of ["2026-11-01", "2027-03-14", "2026-07-04"]) {
    for (const p of PERIODS) {
      const st = { date, ...periodChipState(p.id) };
      const win = seenStateWindowMs(st)!;
      const start = ptLocalToMs(date, `${String(p.startHour).padStart(2, "0")}:00`)!;
      assert.equal(win.fromMs, start, `${date} ${p.id} start`);
      assert.equal(win.toMs - win.fromMs, 6 * 3_600_000, `${date} ${p.id} is six hours`);
    }
  }
});

test("activePeriod matches only the chip states", () => {
  assert.equal(activePeriod({ time: "09:00", w: 180 }), "morning");
  assert.equal(activePeriod({ time: "21:00", w: 180 }), "evening");
  assert.equal(activePeriod({ time: "09:00", w: 30 }), null);
  assert.equal(activePeriod({ time: "10:00", w: 180 }), null);
});

test("the API accepts the period window and the page keeps it in the URL", () => {
  const st = parseSeenPageParams({ place: "Fife", date: "2026-11-17", time: "21:00", w: "180" }, Date.UTC(2026, 10, 19));
  assert.equal(st.w, 180);
  const href = seenApiHref(st)!;
  const r = parseSeenQuery(new URLSearchParams(href.split("?")[1]), Date.UTC(2026, 10, 19));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.query.windowMin, 180);
});

test("futurePickMessage: a future date and a time not yet come", () => {
  const now = Date.UTC(2026, 10, 19, 18, 0); // 2026-11-19 10:00 PST
  assert.match(futurePickMessage({ date: "2026-11-20", time: "09:00", w: 30 }, now)!, /still ahead\. Pick 2026-11-19 or earlier/);
  assert.match(futurePickMessage({ date: "2026-11-19", time: "15:00", w: 30 }, now)!, /has not come yet/);
  // The window reaches back to now: allowed.
  assert.equal(futurePickMessage({ date: "2026-11-19", time: "10:20", w: 30 }, now), null);
  assert.equal(futurePickMessage({ date: "2026-11-18", time: "23:00", w: 30 }, now), null);
  // Afternoon chip at 10:00: starts 12:00, not yet.
  assert.notEqual(futurePickMessage({ date: "2026-11-19", ...periodChipState("afternoon") }, now), null);
});

test("popular places include Olympia", () => {
  const names = searchPlaces("").map((p) => p.name);
  assert.ok(names.includes("Olympia"), names.join(","));
  assert.equal(names[0], "Puyallup");
});
