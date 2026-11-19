// Run: npx tsx --test lib/feed-select.test.ts
//
// Pins the upstream decision table and what riders get when it degrades:
// a dead feed must never read as a fresh, all-grounded fleet.

import { mock, test } from "node:test";
import assert from "node:assert";
import {
  aircraftCacheControl,
  degradedView,
  selectFeed,
} from "./feed-select";
import type { NormalizedAc, Snapshot } from "./types";

// selectFeed logs every fallback; keep the test output readable.
mock.method(console, "warn", () => {});
mock.method(console, "error", () => {});

const ROW: NormalizedAc = { hex: "a1b2c3", lat: 47.2, lon: -122.4, alt_baro: 2400 };
const boom = async (): Promise<NormalizedAc[]> => {
  throw new Error("upstream down");
};
const rows = (n: number) => async () => Array.from({ length: n }, () => ROW);

test("primary rows: adsbfi, not degraded, fallback never called", async () => {
  let fallbackCalled = false;
  const r = await selectFeed({
    primary: rows(3),
    fallback: async () => {
      fallbackCalled = true;
      return [];
    },
    primaryZeroIsFailure: true,
  });
  assert.equal(r.source, "adsbfi");
  assert.equal(r.degraded, false);
  assert.equal(r.raw.length, 3);
  assert.equal(fallbackCalled, false);
});

test("primary throws, fallback has fleet rows: opensky, not degraded", async () => {
  const r = await selectFeed({
    primary: boom,
    fallback: rows(1),
    primaryZeroIsFailure: true,
  });
  assert.equal(r.source, "opensky");
  assert.equal(r.degraded, false);
});

test("both feeds throw: degraded, source none", async () => {
  const r = await selectFeed({
    primary: boom,
    fallback: boom,
    primaryZeroIsFailure: true,
  });
  assert.deepEqual(r, { raw: [], source: "none", degraded: true });
});

test("both feeds empty: degraded, source none", async () => {
  const r = await selectFeed({
    primary: rows(0),
    fallback: rows(0),
    primaryZeroIsFailure: true,
  });
  assert.deepEqual(r, { raw: [], source: "none", degraded: true });
});

test("primary throws and fallback empty: degraded, source none", async () => {
  const r = await selectFeed({
    primary: boom,
    fallback: rows(0),
    primaryZeroIsFailure: true,
  });
  assert.deepEqual(r, { raw: [], source: "none", degraded: true });
});

test("narrow region: empty primary is accepted as a real answer", async () => {
  const r = await selectFeed({
    primary: rows(0),
    fallback: boom,
    primaryZeroIsFailure: false,
  });
  assert.equal(r.source, "adsbfi");
  assert.equal(r.degraded, false);
});

const T_GOOD = Date.UTC(2026, 10, 18, 22, 2, 0);
const T_NOW = T_GOOD + 7 * 60_000;

function placeholder(): Snapshot {
  return {
    fetched_at: T_NOW,
    source: "none",
    aircraft: [],
    live_seen_count: 0,
    degraded: true,
  };
}

test("both feeds down with a last good snapshot: old fetched_at, degraded, no-store", async () => {
  const feed = await selectFeed({
    primary: boom,
    fallback: boom,
    primaryZeroIsFailure: true,
  });
  assert.equal(feed.degraded, true);
  const lastGood: Snapshot = {
    fetched_at: T_GOOD,
    source: "adsbfi",
    aircraft: [],
    live_seen_count: 140,
  };
  const view = degradedView(placeholder(), lastGood);
  assert.equal(view.degraded, true);
  assert.equal(view.fetched_at, T_GOOD, "keeps the ORIGINAL fetched_at");
  assert.equal(view.source, "adsbfi");
  const cc = aircraftCacheControl(view);
  assert.equal(cc, "no-store");
  assert.ok(!cc.includes("s-maxage"));
});

test("no last good snapshot: placeholder, source none, degraded", () => {
  const view = degradedView(placeholder(), null);
  assert.equal(view.degraded, true);
  assert.equal(view.source, "none");
});

test("healthy snapshot keeps the CDN cache window", () => {
  const cc = aircraftCacheControl({
    fetched_at: T_NOW,
    source: "adsbfi",
    aircraft: [],
    live_seen_count: 140,
  });
  assert.ok(cc.includes("s-maxage=10"));
});
