// Run: npx tsx --test lib/aircraft-list.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aircraftActivity } from "./aircraft-activity";
import { filterAircraft, matchesQuery, type AircraftRow } from "./aircraft-list";
import type { DailyRollup, RollupSession } from "./rollup-core";

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);
const DAY = 86_400_000;

function sess(startMs: number, minutes: number): RollupSession {
  return {
    start_ts: startMs,
    end_ts: startMs + minutes * 60_000,
    duration_s: minutes * 60,
    max_alt_ft: 1500,
  };
}

function doc(date: string, tails: Record<string, RollupSession[]>): DailyRollup {
  return {
    v: 1,
    date,
    built_at: 0,
    registry_size: 2,
    sample_count: 100,
    tails: Object.entries(tails).map(([tail, sessions]) => ({
      tail,
      nickname: null,
      operator: "WSP",
      role: "police",
      flights: sessions.length,
      airborne_s: 0,
      max_alt_ft: 0,
      first_takeoff_ts: null,
      last_takeoff_ts: null,
      sessions,
    })),
    totals: { flights: 0, airborne_s: 0, max_alt_ft: 0, tails_flown: 0 },
    pt_hour_minutes: new Array(24).fill(0),
  };
}

test("aircraftActivity counts stitched flights in the last 30 days and the latest landing", () => {
  const old = NOW - 40 * DAY;
  const recent = NOW - 2 * DAY;
  // A flight cut at 00:00 UTC: two halves 60 s apart stitch into one.
  const cutA = sess(recent, 30);
  const cutB = sess(recent + 31 * 60_000, 20);
  const docs = [
    doc("20261010", { N305DK: [sess(old, 60)] }),
    doc("20261117", { N305DK: [cutA, cutB] }),
  ];
  const today = { tail: "N305DK", session: sess(NOW - 3_600_000, 45) };
  const act = aircraftActivity(docs, [today, { tail: "N2446X", session: sess(NOW - DAY, 10) }], NOW);
  const a = act.get("N305DK")!;
  assert.equal(a.flights_30d, 2);
  assert.equal(a.last_flew_ts, NOW - 3_600_000 + 45 * 60_000);
  assert.equal(act.get("N2446X")!.flights_30d, 1);
  assert.equal(act.has("N999ZZ"), false);
});

test("aircraftActivity does not double count a session in both a rollup and today's tracks", () => {
  const s = sess(NOW - 5 * 3_600_000, 50);
  const act = aircraftActivity([doc("20261119", { N305DK: [s] })], [{ tail: "N305DK", session: s }], NOW);
  assert.equal(act.get("N305DK")!.flights_30d, 1);
});

function row(p: Partial<AircraftRow> & { tail: string }): AircraftRow {
  return {
    nickname: null,
    operator: "WSP",
    agency: "Washington State Patrol",
    model: "Cessna 206",
    mission: "police",
    last_flew_ts: null,
    flights_30d: 0,
    up: false,
    ...p,
  };
}

test("search matches tail, nickname and agency, ignoring case and punctuation", () => {
  const r = row({ tail: "N305DK", nickname: "Smokey 4", operator: "WSP" });
  assert.ok(matchesQuery(r, "n305"));
  assert.ok(matchesQuery(r, "smokey4"));
  assert.ok(matchesQuery(r, "state patrol"));
  assert.ok(!matchesQuery(r, "guardian"));
  assert.ok(matchesQuery(r, "  "));
});

test("filterAircraft: mission filter and sort by last flew (up now first, never flown last)", () => {
  const rows = [
    row({ tail: "A", last_flew_ts: 100 }),
    row({ tail: "B", last_flew_ts: null }),
    row({ tail: "C", last_flew_ts: 300 }),
    row({ tail: "D", last_flew_ts: 50, up: true }),
    row({ tail: "E", mission: "federal_le", last_flew_ts: 999 }),
  ];
  assert.deepEqual(
    filterAircraft(rows, { q: "", mission: "police", sort: "last_flew" }).map((r) => r.tail),
    ["D", "C", "A", "B"],
  );
  assert.deepEqual(
    filterAircraft(rows, { q: "", mission: "all", sort: "tail" }).map((r) => r.tail),
    ["A", "B", "C", "D", "E"],
  );
});

test("filterAircraft: sort by 30-day flights, ties by tail", () => {
  const rows = [row({ tail: "B", flights_30d: 3 }), row({ tail: "A", flights_30d: 3 }), row({ tail: "C", flights_30d: 9 })];
  assert.deepEqual(
    filterAircraft(rows, { q: "", mission: "all", sort: "flights" }).map((r) => r.tail),
    ["C", "A", "B"],
  );
});
