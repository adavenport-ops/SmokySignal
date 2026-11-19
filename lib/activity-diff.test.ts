// Run: npx tsx --test lib/activity-diff.test.ts
//
// Pins the activity-diff contract behind issue #74 (repeated "Pierce One
// down" rows): an upstream outage or a single dropped tick must not invent
// a landing, and a real landing fires exactly once.

import { test } from "node:test";
import assert from "node:assert";
import {
  diffActivity,
  LANDING_DEBOUNCE_MS,
  type PrevState,
} from "./activity-diff";
import type { Aircraft, Snapshot } from "./types";

const T0 = Date.UTC(2026, 10, 18, 18, 0, 0);
const MIN = 60_000;

function plane(airborne: boolean, extra: Partial<Aircraft> = {}): Aircraft {
  return {
    tail: "N2446X",
    nickname: "Pierce One",
    role: "police",
    icao24: "a1b2c3",
    airborne,
    ...(airborne ? { lat: 47.2, lon: -122.4, altitude_ft: 2400 } : {}),
    ...extra,
  } as Aircraft;
}

function snap(
  at: number,
  aircraft: Aircraft[],
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    fetched_at: at,
    source: "adsbfi",
    aircraft,
    live_seen_count: 120,
    ...extra,
  };
}

/** Feed a sequence of snapshots through the diff, carrying state forward. */
function run(seq: Snapshot[], start: PrevState | null = null) {
  let prev = start;
  const events = [];
  for (const s of seq) {
    const r = diffActivity(prev, s);
    events.push(...r.events);
    if (r.next) prev = r.next;
  }
  return { events, prev };
}

test("degraded snapshot: no events and prev is left untouched", () => {
  const prev = snap(T0, [plane(true)]);
  const degraded = snap(T0 + MIN, [plane(false)], {
    source: "none",
    degraded: true,
    live_seen_count: 0,
  });
  const r = diffActivity(prev, degraded);
  assert.deepEqual(r.events, []);
  assert.equal(r.next, null);
});

test("a run of degraded snapshots does not produce a landing", () => {
  const seq = [snap(T0, [plane(true)])];
  for (let i = 1; i <= 10; i++) {
    seq.push(
      snap(T0 + i * MIN, [plane(false)], { source: "none", degraded: true }),
    );
  }
  seq.push(snap(T0 + 11 * MIN, [plane(true)]));
  const { events } = run(seq);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["first_seen"],
    "only the initial first_seen; the outage is invisible",
  );
});

test("single missing tick: no landing and no takeoff", () => {
  const { events } = run([
    snap(T0, [plane(true)]),
    snap(T0 + MIN, [plane(false)]),
    snap(T0 + 2 * MIN, [plane(true)]),
  ]);
  assert.deepEqual(events.map((e) => e.kind), ["first_seen"]);
});

test("missing for under the debounce window: no landing yet", () => {
  const { events, prev } = run([
    snap(T0, [plane(true)]),
    snap(T0 + MIN, [plane(false)]),
    snap(T0 + 2 * MIN, [plane(false)]),
    snap(T0 + 3 * MIN, [plane(false)]),
  ]);
  // Missing since T0+1m; at T0+3m that is only 2 minutes.
  assert.deepEqual(events.map((e) => e.kind), ["first_seen"]);
  assert.ok(prev?.pending_landings?.["N2446X"], "landing is still pending");
});

test("missing for at least 3 minutes: exactly one landing", () => {
  const { events, prev } = run([
    snap(T0, [plane(true)]),
    snap(T0 + MIN, [plane(false)]),
    snap(T0 + 2 * MIN, [plane(false)]),
    snap(T0 + 3 * MIN, [plane(false)]),
    snap(T0 + 4 * MIN, [plane(false)]),
    snap(T0 + 5 * MIN, [plane(false)]),
    snap(T0 + 6 * MIN, [plane(false)]),
  ]);
  const landings = events.filter((e) => e.kind === "landing");
  assert.equal(landings.length, 1);
  const l = landings[0];
  assert.ok(l);
  assert.equal(l.description, "Pierce One down");
  // Recorded at the moment the tail first went missing, with the last
  // airborne position.
  assert.equal(l.ts, T0 + MIN);
  assert.equal(l.lat, 47.2);
  assert.equal(l.lon, -122.4);
  assert.equal(l.alt_ft, 2400);
  assert.equal(prev?.pending_landings, undefined, "pending cleared");
});

test("debounce boundary is inclusive at exactly LANDING_DEBOUNCE_MS", () => {
  const { events } = run([
    snap(T0, [plane(true)]),
    snap(T0 + MIN, [plane(false)]),
    snap(T0 + MIN + LANDING_DEBOUNCE_MS, [plane(false)]),
  ]);
  assert.equal(events.filter((e) => e.kind === "landing").length, 1);
});

test("degraded ticks inside a pending window do not reset or fire it", () => {
  const { events } = run([
    snap(T0, [plane(true)]),
    snap(T0 + MIN, [plane(false)]),
    snap(T0 + 2 * MIN, [plane(false)], { source: "none", degraded: true }),
    snap(T0 + 3 * MIN, [plane(true)]),
  ]);
  assert.deepEqual(events.map((e) => e.kind), ["first_seen"]);
});

test("takeoff fires once on a grounded-to-airborne transition", () => {
  const { events } = run([
    snap(T0, [plane(false)]),
    snap(T0 + MIN, [plane(true)]),
    snap(T0 + 2 * MIN, [plane(true)]),
  ]);
  assert.deepEqual(events.map((e) => e.kind), ["takeoff"]);
  assert.equal(events[0]?.description, "Pierce One up");
});

test("legacy stored prev (plain Snapshot, no pending map) still diffs", () => {
  const legacy: PrevState = snap(T0, [plane(false)]);
  const r = diffActivity(legacy, snap(T0 + MIN, [plane(true)]));
  assert.deepEqual(r.events.map((e) => e.kind), ["takeoff"]);
});

test("emergency squawk transition still fires", () => {
  const { events } = run([
    snap(T0, [plane(true, { squawk: "1200" })]),
    snap(T0 + MIN, [plane(true, { squawk: "7700" })]),
    snap(T0 + 2 * MIN, [plane(true, { squawk: "7700" })]),
  ]);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["first_seen", "squawk_emergency"],
  );
});
