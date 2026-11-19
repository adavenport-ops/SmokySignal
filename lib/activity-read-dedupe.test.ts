// Run: npx tsx --test lib/activity-read-dedupe.test.ts
//
// Read-side dedupe for rows merged from activity:feed and the per-day
// archive. /road/i-5 once listed the same landing three times.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeActivity, type ActivityEntry } from "./activity-diff";

const T0 = Date.UTC(2026, 10, 18, 19, 20, 0);
const row = (tail: string, kind: ActivityEntry["kind"], ts: number): ActivityEntry => ({
  tail,
  kind,
  ts,
  description: `${tail} ${kind}`,
});

test("drops the same tail + kind within 2 min, keeps one row", () => {
  const out = dedupeActivity([
    row("N2446X", "landing", T0),
    row("N2446X", "landing", T0 + 20_000),
    row("N2446X", "landing", T0),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ts, T0);
});

test("feed row in seconds matches archive row in ms", () => {
  const out = dedupeActivity([row("N2446X", "landing", T0), row("N2446X", "landing", T0 / 1000)]);
  assert.equal(out.length, 1);
});

test("keeps genuinely separate events", () => {
  const out = dedupeActivity([
    row("N2446X", "landing", T0),
    row("N2446X", "landing", T0 + 3 * 60_000),
    row("N2446X", "takeoff", T0 + 30_000),
    row("N305DK", "landing", T0 + 10_000),
  ]);
  assert.equal(out.length, 4);
});

test("output is newest first", () => {
  const out = dedupeActivity([row("A", "takeoff", T0), row("B", "takeoff", T0 + 60_000)]);
  assert.deepEqual(
    out.map((r) => r.tail),
    ["B", "A"],
  );
});

test("a chain of close repeats anchors on the kept row", () => {
  // 0s, 90s, 180s: 90 is a repeat of 0; 180 is 180s after the kept row.
  const out = dedupeActivity([
    row("A", "landing", T0),
    row("A", "landing", T0 + 90_000),
    row("A", "landing", T0 + 180_000),
  ]);
  assert.equal(out.length, 2);
});
