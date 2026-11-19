// Run: npx tsx --test lib/activity-dedupe.test.ts
//
// Write-time dedupe for the activity feed. It must drop a racing duplicate
// of the same transition, but never a genuine re-takeoff inside the 10 min
// window (which used to leave the feed ending on "down" while airborne).

import { test } from "node:test";
import assert from "node:assert";
import { claimEvents, releaseClaims, type DedupeStore } from "./activity";
import type { ActivityEntry, ActivityKind } from "./activity-diff";

/** In-memory stand-in for the two Redis calls the dedupe uses. */
function fakeStore(): DedupeStore & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    async set(key, _value, opts) {
      if (opts.nx && keys.has(key)) return null;
      keys.add(key);
      return "OK";
    },
    async del(...ks) {
      let n = 0;
      for (const k of ks) if (keys.delete(k)) n++;
      return n;
    },
  };
}

const T0 = Date.UTC(2026, 10, 18, 18, 0, 0);

function ev(kind: ActivityKind, minute: number): ActivityEntry {
  return {
    ts: T0 + minute * 60_000,
    tail: "N2446X",
    kind,
    description: `Pierce One ${kind}`,
  };
}

test("racing duplicate of the same takeoff is dropped", async () => {
  const store = fakeStore();
  const a = await claimEvents(store, [ev("takeoff", 0)]);
  const b = await claimEvents(store, [ev("takeoff", 0)]);
  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
});

test("down then up within 10 min writes both rows", async () => {
  const store = fakeStore();
  const written: ActivityKind[] = [];
  for (const [kind, minute] of [
    ["takeoff", 0],
    ["landing", 3],
    ["takeoff", 6],
    ["landing", 9],
  ] as const) {
    const won = await claimEvents(store, [ev(kind, minute)]);
    written.push(...won.map((e) => e.kind));
  }
  assert.deepEqual(written, ["takeoff", "landing", "takeoff", "landing"]);
});

test("first_seen then landing then takeoff within 10 min writes all three", async () => {
  const store = fakeStore();
  const written: ActivityKind[] = [];
  for (const [kind, minute] of [
    ["first_seen", 0],
    ["landing", 4],
    ["takeoff", 7],
  ] as const) {
    const won = await claimEvents(store, [ev(kind, minute)]);
    written.push(...won.map((e) => e.kind));
  }
  assert.deepEqual(written, ["first_seen", "landing", "takeoff"]);
});

test("released claims (failed feed write) can be claimed again", async () => {
  const store = fakeStore();
  const first = await claimEvents(store, [ev("takeoff", 0)]);
  await releaseClaims(store, first);
  const retry = await claimEvents(store, [ev("takeoff", 1)]);
  assert.equal(retry.length, 1);
});

test("KV error on claim fails open", async () => {
  const store: DedupeStore = {
    async set() {
      throw new Error("kv down");
    },
    async del() {
      return 0;
    },
  };
  const won = await claimEvents(store, [ev("takeoff", 0)]);
  assert.equal(won.length, 1);
});
