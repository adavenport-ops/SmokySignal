// Run: npx tsx --test lib/activity-group.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupActivity,
  groupByDay,
  placeLabel,
  rowTitle,
  nameFromDescription,
} from "./activity-group";
import type { ActivityEntry, ActivityKind } from "./activity-diff";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 17, 20, 0, 0); // 12:00 PT 2026-11-17

function ev(
  tail: string,
  kind: ActivityKind,
  min: number,
  extra: Partial<ActivityEntry> = {},
): ActivityEntry {
  const suffix = kind === "takeoff" ? "up" : kind === "landing" ? "down" : "on watch";
  return { ts: T0 + min * MIN, tail, kind, description: `Pierce One ${suffix}`, ...extra };
}

test("repeats of the same tail + kind fold into one counted row", () => {
  const rows = groupActivity([
    ev("N1", "takeoff", 0),
    ev("N1", "landing", 20),
    ev("N1", "takeoff", 40),
    ev("N1", "landing", 60),
    ev("N1", "takeoff", 80),
  ]);
  const up = rows.find((r) => r.kind === "takeoff")!;
  assert.equal(up.count, 3);
  assert.equal(up.firstTs, T0);
  assert.equal(up.lastTs, T0 + 80 * MIN);
  assert.equal(rowTitle(up), "Pierce One · 3 takeoffs");
  assert.equal(rows.find((r) => r.kind === "landing")!.count, 2);
});

test("a gap beyond the window starts a new row", () => {
  const rows = groupActivity([ev("N1", "takeoff", 0), ev("N1", "takeoff", 3 * 60 + 1)]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.count === 1));
});

test("different tails never merge", () => {
  const rows = groupActivity([ev("N1", "takeoff", 0), ev("N2", "takeoff", 1)]);
  assert.equal(rows.length, 2);
});

test("down then up inside 5 min collapses to one span", () => {
  const rows = groupActivity([
    ev("N1", "takeoff", 0),
    ev("N1", "landing", 30),
    ev("N1", "takeoff", 33),
    ev("N1", "landing", 90),
  ]);
  // flap pair (30, 33) removed: one takeoff at 0, one landing at 90.
  assert.equal(rows.length, 2);
  const land = rows.find((r) => r.kind === "landing")!;
  assert.equal(land.count, 1);
  assert.equal(land.flaps, 1);
  assert.equal(rows.find((r) => r.kind === "takeoff")!.count, 1);
});

test("down then up beyond 5 min is a real second flight", () => {
  const rows = groupActivity([
    ev("N1", "takeoff", 0),
    ev("N1", "landing", 30),
    ev("N1", "takeoff", 36),
  ]);
  assert.equal(rows.find((r) => r.kind === "takeoff")!.count, 2);
});

test("emergencies never collapse", () => {
  const rows = groupActivity([
    ev("N1", "squawk_emergency", 0, { description: "Pierce One squawking emergency" }),
    ev("N1", "squawk_emergency", 1, { description: "Pierce One squawking emergency" }),
  ]);
  assert.equal(rows.length, 2);
});

test("output is newest first and order of input does not matter", () => {
  const rows = groupActivity([ev("N2", "takeoff", 0), ev("N1", "takeoff", 100)]);
  assert.deepEqual(rows.map((r) => r.tail), ["N1", "N2"]);
});

test("groupByDay buckets by Pacific day", () => {
  // 06:30 PT on 11-18 is 14:30 UTC; 23:30 PT on 11-17 is 07:30 UTC 11-18.
  const a = ev("N1", "takeoff", 0, { ts: Date.UTC(2026, 10, 18, 14, 30) });
  const b = ev("N2", "takeoff", 0, { ts: Date.UTC(2026, 10, 18, 7, 30) });
  const days = groupByDay(groupActivity([a, b]));
  assert.deepEqual(days.map((d) => d.day), ["2026-11-18", "2026-11-17"]);
});

test("nameFromDescription strips verb suffixes and falls back to tail", () => {
  assert.equal(nameFromDescription("Pierce One down", "N1"), "Pierce One");
  assert.equal(nameFromDescription("Smokey 3 off the deck", "N1"), "Smokey 3");
  assert.equal(nameFromDescription("Cougar back on the ground", "N1"), "Cougar");
  assert.equal(nameFromDescription(" up", "N1"), "N1");
});

test("placeLabel: airport for takeoff/landing, corridor otherwise, null when unknown", () => {
  const olm = { lat: 46.9694, lon: -122.9028 }; // KOLM
  assert.equal(placeLabel(ev("N1", "takeoff", 0, olm)), "KOLM");
  assert.equal(placeLabel(ev("N1", "landing", 0, olm)), "KOLM");
  const fife = { lat: 47.24, lon: -122.36 };
  const l = placeLabel(ev("N1", "takeoff", 0, fife));
  assert.ok(l && l.startsWith("I-5"), String(l));
  assert.equal(placeLabel(ev("N1", "takeoff", 0, { lat: 40, lon: -100 })), null);
  assert.equal(placeLabel(ev("N1", "takeoff", 0)), null);
  assert.equal(placeLabel(ev("N1", "takeoff", 0, { lat: null, lon: null })), null);
});
