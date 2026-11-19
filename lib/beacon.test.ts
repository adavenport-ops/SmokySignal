// Run: npx tsx --test lib/beacon.test.ts
//
// Pins the Beacon contract that ESP32 sketches and Home Assistant
// sensors parse (docs/beacon.md): first line is the state alone, then
// count / fetched_at / age_s, and stale beats up/down whenever the read
// is missing, degraded, or older than two minutes.

import { test } from "node:test";
import assert from "node:assert";
import {
  FEED_STALE_MS,
  beaconCacheControl,
  beaconEtag,
  beaconFromSnapshot,
  etagMatches,
  formatBeaconJson,
  formatBeaconText,
  isFeedStale,
} from "./beacon";
import type { Aircraft, FleetEntry, FleetRole, Snapshot } from "./types";

const NOW = Date.parse("2026-11-18T15:12:00Z");

function entry(tail: string, role: FleetRole, nickname: string | null = null): FleetEntry {
  return {
    tail,
    operator: "WSP",
    model: "Cessna 206H",
    nickname,
    roleDescription: "",
    base: "KOLM Olympia",
    role,
    roleConfidence: "confirmed",
  };
}

function snap(
  aircraft: Array<[FleetEntry, boolean]>,
  fetched_at = NOW - 10_000,
  extra: Record<string, unknown> = {},
): Snapshot {
  return {
    fetched_at,
    source: "adsbfi",
    live_seen_count: 12,
    aircraft: aircraft.map(
      ([e, airborne]): Aircraft => ({ ...e, icao24: "a00000", airborne }),
    ),
    ...extra,
  } as Snapshot;
}

const smokey = entry("N305DK", "smokey", "Smokey 4");
const patrol = entry("N422CT", "patrol", "Guardian One");
const sar = entry("N815SC", "sar", "SnoHawk 10");
const fleet = new Map([smokey, patrol, sar].map((e) => [e.tail, e]));

test("up: smokey airborne, fresh read", () => {
  const b = beaconFromSnapshot(snap([[smokey, true], [sar, false]]), fleet, NOW);
  assert.deepEqual(b, { state: "up", count: 1, fetched_at: NOW - 10_000, age_s: 10 });
  assert.equal(
    formatBeaconText(b),
    "up\ncount=1\nfetched_at=2026-11-18T15:11:50.000Z\nage_s=10\n",
  );
});

test("up: count is alert-class only (SAR does not count)", () => {
  const b = beaconFromSnapshot(
    snap([[smokey, true], [patrol, true], [sar, true]]),
    fleet,
    NOW,
  );
  assert.equal(b.state, "up");
  assert.equal(b.count, 2);
});

test("down: nothing up", () => {
  const b = beaconFromSnapshot(snap([[smokey, false]]), fleet, NOW);
  assert.equal(b.state, "down");
  assert.equal(formatBeaconText(b).split("\n")[0], "down");
});

test("down: only SAR up still reads down", () => {
  const b = beaconFromSnapshot(snap([[sar, true]]), fleet, NOW);
  assert.equal(b.state, "down");
  assert.equal(b.count, 0);
});

test("stale: read older than two minutes beats up", () => {
  const old = NOW - FEED_STALE_MS - 1000;
  const b = beaconFromSnapshot(snap([[smokey, true]], old), fleet, NOW);
  assert.equal(b.state, "stale");
  // Last known count is kept, labelled by the stale state.
  assert.equal(b.count, 1);
  assert.equal(b.age_s, 121);
});

test("stale: exactly two minutes is still fresh", () => {
  const b = beaconFromSnapshot(snap([[smokey, false]], NOW - FEED_STALE_MS), fleet, NOW);
  assert.equal(b.state, "down");
});

test("stale: degraded snapshot (every feed failed) is never down", () => {
  const b = beaconFromSnapshot(
    snap([[smokey, false]], NOW - 5_000, { degraded: true }),
    fleet,
    NOW,
  );
  assert.equal(b.state, "stale");
  assert.equal(isFeedStale({ fetched_at: NOW, degraded: true }, NOW), true);
});

test("stale: no snapshot leaves unknown values empty", () => {
  const b = beaconFromSnapshot(null, fleet, NOW);
  assert.deepEqual(b, { state: "stale", count: 0, fetched_at: null, age_s: null });
  assert.equal(formatBeaconText(b), "stale\ncount=0\nfetched_at=\nage_s=\n");
  assert.deepEqual(formatBeaconJson(b), {
    state: "stale",
    count: 0,
    fetched_at: null,
    age_s: null,
  });
});

test("json mirrors text fields", () => {
  const b = beaconFromSnapshot(snap([[smokey, true]]), fleet, NOW);
  assert.deepEqual(formatBeaconJson(b), {
    state: "up",
    count: 1,
    fetched_at: "2026-11-18T15:11:50.000Z",
    age_s: 10,
  });
});

test("cache: edge-cached when healthy, no-store when stale", () => {
  const fresh = beaconFromSnapshot(snap([[smokey, true]]), fleet, NOW);
  const stale = beaconFromSnapshot(null, fleet, NOW);
  assert.equal(beaconCacheControl(fresh), "public, s-maxage=15, stale-while-revalidate=15");
  assert.equal(beaconCacheControl(stale), "no-store");
});

test("etag: stable across age_s, changes with state and read", () => {
  const s = snap([[smokey, true]]);
  const a = beaconFromSnapshot(s, fleet, NOW);
  const later = beaconFromSnapshot(s, fleet, NOW + 7_000);
  assert.notEqual(a.age_s, later.age_s);
  assert.equal(beaconEtag(a, "txt"), beaconEtag(later, "txt"));
  assert.notEqual(beaconEtag(a, "txt"), beaconEtag(a, "json"));
  const down = beaconFromSnapshot(snap([[smokey, false]]), fleet, NOW);
  assert.notEqual(beaconEtag(a, "txt"), beaconEtag(down, "txt"));
  assert.match(beaconEtag(a, "txt"), /^W\/"txt-[0-9a-f]{8}"$/);
});

test("etagMatches: weak compare, lists, wildcard", () => {
  const tag = 'W/"txt-0badf00d"';
  assert.equal(etagMatches(null, tag), false);
  assert.equal(etagMatches(tag, tag), true);
  assert.equal(etagMatches('"txt-0badf00d"', tag), true);
  assert.equal(etagMatches('W/"other", W/"txt-0badf00d"', tag), true);
  assert.equal(etagMatches("*", tag), true);
  assert.equal(etagMatches('W/"other"', tag), false);
});
