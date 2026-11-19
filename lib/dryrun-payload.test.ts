// Run: npx tsx --test lib/dryrun-payload.test.ts
//
// Privacy contract for /api/dryrun-warnings: only coarse buckets are
// accepted and stored. Rider speed / lat / lon never survive parsing.

import { test } from "node:test";
import assert from "node:assert";
import {
  bucketDistanceNm,
  bucketOverLimit,
  parseDryRunBody,
  toViewRow,
} from "./dryrun-payload";
import { zoneIdForPoint } from "./zone-id";

const NOW = Date.UTC(2026, 10, 18, 17, 30, 42, 123);

function valid(overrides: Record<string, unknown> = {}) {
  return {
    ts: NOW,
    overLimitBy: "5-10",
    nearestZoneId: zoneIdForPoint(47.6062, -122.3321),
    nearestTail: "n305dk",
    nearestBirdNm: 1.34,
    reason: "speeding_in_zone_bird_nearby",
    ...overrides,
  };
}

test("bucketOverLimit: 2-5 / 5-10 / 10+", () => {
  assert.equal(bucketOverLimit(2.1), "2-5");
  assert.equal(bucketOverLimit(4.99), "2-5");
  assert.equal(bucketOverLimit(5), "5-10");
  assert.equal(bucketOverLimit(9.9), "5-10");
  assert.equal(bucketOverLimit(10), "10+");
  assert.equal(bucketOverLimit(42), "10+");
});

test("bucketDistanceNm rounds to 0.5 nm", () => {
  assert.equal(bucketDistanceNm(1.34), 1.5);
  assert.equal(bucketDistanceNm(1.2), 1);
  assert.equal(bucketDistanceNm(0.1), 0);
  assert.equal(bucketDistanceNm(4.76), 5);
});

test("parseDryRunBody: valid body → v2 record, tail uppercased, distance re-bucketed, ts floored to minute", () => {
  const r = parseDryRunBody(valid(), NOW);
  assert.ok(r);
  assert.deepEqual(r, {
    v: 2,
    ts: Date.UTC(2026, 10, 18, 17, 30, 0, 0),
    overLimitBy: "5-10",
    nearestZoneId: zoneIdForPoint(47.6062, -122.3321),
    nearestTail: "N305DK",
    nearestBirdNm: 1.5,
    reason: "speeding_in_zone_bird_nearby",
  });
});

test("parseDryRunBody: precise rider fields are stripped, never stored", () => {
  const r = parseDryRunBody(
    valid({
      riderLat: 47.60621,
      riderLon: -122.33207,
      riderSpeedMph: 73.4,
      riderOverLimitBy: 13.4,
      postedLimitMph: 60,
    }),
    NOW,
  );
  assert.ok(r);
  const json = JSON.stringify(r);
  for (const k of [
    "riderLat",
    "riderLon",
    "riderSpeedMph",
    "riderOverLimitBy",
    "postedLimitMph",
  ]) {
    assert.ok(!json.includes(k), `${k} leaked into stored record`);
  }
});

test("parseDryRunBody: legacy (pre-v2) client shape is rejected", () => {
  assert.equal(
    parseDryRunBody(
      {
        ts: NOW,
        riderLat: 47.6,
        riderLon: -122.3,
        riderSpeedMph: 70,
        postedLimitMph: 60,
        riderOverLimitBy: 10,
        nearestZoneMi: 0.2,
        nearestBirdMi: 1.3,
        nearestTail: "N305DK",
        reason: "Over by 10 mph in a hot zone, bird 1.3 nm out",
      },
      NOW,
    ),
    null,
  );
});

test("parseDryRunBody: rejects non-enum overLimitBy and free-text reason", () => {
  assert.equal(parseDryRunBody(valid({ overLimitBy: "13.4" }), NOW), null);
  assert.equal(parseDryRunBody(valid({ overLimitBy: 13 }), NOW), null);
  assert.equal(
    parseDryRunBody(valid({ reason: "Over by 13 mph in a hot zone" }), NOW),
    null,
  );
});

test("parseDryRunBody: rejects bad tail, bad zone id, bad distance, stale ts", () => {
  assert.equal(parseDryRunBody(valid({ nearestTail: "X".repeat(5000) }), NOW), null);
  assert.equal(parseDryRunBody(valid({ nearestTail: "<script>" }), NOW), null);
  assert.equal(parseDryRunBody(valid({ nearestTail: 42 }), NOW), null);
  assert.equal(parseDryRunBody(valid({ nearestZoneId: "47.60621,-122.33207" }), NOW), null);
  assert.equal(parseDryRunBody(valid({ nearestZoneId: "__proto__" }), NOW), null);
  assert.equal(parseDryRunBody(valid({ nearestBirdNm: -1 }), NOW), null);
  assert.equal(parseDryRunBody(valid({ nearestBirdNm: 500 }), NOW), null);
  assert.equal(parseDryRunBody(valid({ nearestBirdNm: "1" }), NOW), null);
  assert.equal(parseDryRunBody(valid({ ts: NOW - 6 * 60_000 }), NOW), null);
  assert.equal(parseDryRunBody([], NOW), null);
  assert.equal(parseDryRunBody(null, NOW), null);
});

test("parseDryRunBody: null optionals allowed", () => {
  const r = parseDryRunBody(
    valid({ nearestZoneId: null, nearestTail: null, nearestBirdNm: null }),
    NOW,
  );
  assert.ok(r);
  assert.equal(r.nearestZoneId, null);
  assert.equal(r.nearestTail, null);
  assert.equal(r.nearestBirdNm, null);
});

test("toViewRow: v2 row passes through", () => {
  const rec = parseDryRunBody(valid(), NOW)!;
  const row = toViewRow(JSON.parse(JSON.stringify(rec)));
  assert.ok(row);
  assert.equal(row.legacy, false);
  assert.equal(row.overLimitBy, "5-10");
  assert.equal(row.nearestTail, "N305DK");
});

test("toViewRow: legacy row is shown bucketed, precise values not exposed", () => {
  const row = toViewRow({
    ts: NOW,
    riderLat: 47.60621,
    riderLon: -122.33207,
    riderSpeedMph: 73.4,
    postedLimitMph: 60,
    riderOverLimitBy: 13.4,
    nearestZoneMi: 0.21,
    nearestBirdMi: 1.34,
    nearestTail: "N305DK",
    reason: "Over by 13 mph in a hot zone, bird 1.3 nm out",
  });
  assert.ok(row);
  assert.deepEqual(row, {
    ts: NOW,
    overLimitBy: "10+",
    nearestZoneId: null,
    nearestTail: "N305DK",
    nearestBirdNm: 1.5,
    legacy: true,
  });
});
