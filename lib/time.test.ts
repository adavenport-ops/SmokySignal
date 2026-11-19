// Run: npx tsx --test lib/time.test.ts
//
// Pins the contract for fmtAgoTs against the regression that shipped on
// /dash: a forked formatter treated millisecond timestamps as seconds and
// collapsed every Recent activity row into "just now". The activity feed
// (lib/activity.ts) emits ms-since-epoch, so callers must read ms here too.

import { test } from "node:test";
import assert from "node:assert";
import { fmtAgo, fmtAgoTs, formatTs } from "./time";

test("fmtAgoTs: 5h-old ms timestamp renders as '5h ago' (regression — must not be 'just now')", () => {
  const fiveHoursAgoMs = Date.now() - 5 * 60 * 60 * 1000;
  assert.equal(fmtAgoTs(fiveHoursAgoMs), "5h ago");
});

test("fmtAgoTs: 30s-old ms timestamp renders as 'just now'", () => {
  const thirtySecAgoMs = Date.now() - 30 * 1000;
  assert.equal(fmtAgoTs(thirtySecAgoMs), "just now");
});

test("fmtAgo: 0 minutes is 'just now', not 'a while'", () => {
  assert.equal(fmtAgo(0), "just now");
});

test("fmtAgo: sub-minute and small negative (clock skew) are 'just now'", () => {
  assert.equal(fmtAgo(0.5), "just now");
  assert.equal(fmtAgo(-1), "just now");
});

test("fmtAgo: null / undefined / NaN are 'a while'", () => {
  assert.equal(fmtAgo(null), "a while");
  assert.equal(fmtAgo(undefined), "a while");
  assert.equal(fmtAgo(Number.NaN), "a while");
});

test("fmtAgo: fractional minutes are floored", () => {
  assert.equal(fmtAgo(5.7), "5m ago");
  assert.equal(fmtAgo(59.9), "59m ago");
  assert.equal(fmtAgo(1.2), "1m ago");
});

test("fmtAgo: minute / hour / day buckets", () => {
  assert.equal(fmtAgo(1), "1m ago");
  assert.equal(fmtAgo(59), "59m ago");
  assert.equal(fmtAgo(60), "1h ago");
  assert.equal(fmtAgo(1439), "23h ago");
  assert.equal(fmtAgo(1440), "1d ago");
});

test("formatTs: 24-hour clock renders midnight PT as 00, never 24", () => {
  // 2026-11-18 00:05:09 PST = 08:05:09 UTC
  const ts = Date.UTC(2026, 10, 18, 8, 5, 9);
  assert.equal(formatTs(ts, "time"), "00:05 PT");
  assert.equal(formatTs(ts, "time-sec"), "00:05:09 PT");
  assert.equal(formatTs(ts, "datetime"), "2026-11-18 00:05 PT");
});

test("formatTs: date styles are pinned to en-US", () => {
  const ts = Date.UTC(2026, 10, 18, 20, 0, 0);
  assert.equal(formatTs(ts, "date-short"), "Nov 18");
  assert.equal(formatTs(ts, "date-weekday"), "Wednesday");
});
