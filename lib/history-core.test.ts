// Run: npx tsx --test lib/history-core.test.ts
//
// /api/history pure core: strict query validation (range cap, PT dates,
// tails, mission), Douglas–Peucker + the 20k vertex cap, the heat grid,
// sessions stitched across 00:00 UTC, and the cache header split.

import { test } from "node:test";
import assert from "node:assert";
import {
  MAX_RANGE_DAYS,
  buildHistory,
  douglasPeucker,
  douglasPeuckerIndices,
  filterByMission,
  heatGrid,
  historyCacheControl,
  parseHistoryQuery,
  simplifyLines,
  toleranceForDays,
  utcKeysForQuery,
  type HistoryQuery,
} from "./history-core";
import { ptRangeMs, ptDayStartMs, utcDateKeysForRange, isPtDate, daysInclusive } from "./pt-range";
import type { TrackPoint } from "./track-point";
import type { FleetEntry } from "./types";

// 2026-11-18 20:00 UTC = 12:00 PST.
const NOW = Date.UTC(2026, 10, 18, 20, 0);

function q(s: string) {
  return parseHistoryQuery(new URLSearchParams(s), NOW);
}

const ENTRY: FleetEntry = {
  tail: "N305DK",
  operator: "WSP",
  model: "Cessna 182",
  nickname: "Smokey 5",
  roleDescription: "Speed enforcement",
  base: "KOLM",
  role: "police",
  roleConfidence: "confirmed",
  sources: [],
};

// ─── validation ──────────────────────────────────────────────────────

test("parseHistoryQuery accepts a valid range, repeated and comma tails", () => {
  const r = q("from=2026-11-11&to=2026-11-17&tail=n305dk&tail=N2446X,N305DK&mission=Police");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.query.tails, ["N2446X", "N305DK"]);
  assert.equal(r.query.days, 7);
  assert.equal(r.query.mission, "police");
  assert.equal(r.query.includesToday, false);
  const t = q("from=2026-11-18&to=2026-11-18");
  assert.ok(t.ok && t.query.includesToday && t.query.tails === null);
});

test("parseHistoryQuery rejects bad input with a specific error", () => {
  const cases: [string, string][] = [
    ["to=2026-11-17", "missing_range"],
    ["from=2026-11-17", "missing_range"],
    ["from=2026-02-30&to=2026-03-01", "bad_from"],
    ["from=2026-11-01&to=11/17/2026", "bad_to"],
    ["from=2026-11-17&to=2026-11-01", "from_after_to"],
    ["from=2024-12-31&to=2025-01-02", "from_too_early"],
    ["from=2026-11-18&to=2026-11-19", "to_in_future"],
    ["from=2025-11-01&to=2026-11-17", "range_too_long"],
    ["from=2026-11-01&to=2026-11-02&tail=DROP", "bad_tail"],
    ["from=2026-11-01&to=2026-11-02&mission=a%20b", "bad_mission"],
    ["from=2026-11-01&to=2026-11-02&bust=1", "unknown_param"],
    ["from=2026-11-01&from=2026-11-02&to=2026-11-03", "duplicate_param"],
  ];
  for (const [s, err] of cases) {
    const r = q(s);
    assert.equal(r.ok, false, s);
    if (!r.ok) assert.equal(r.error, err, s);
  }
  const many = Array.from({ length: 33 }, (_, i) => `tail=N${100 + i}`).join("&");
  const r = q(`from=2026-11-01&to=2026-11-02&${many}`);
  assert.ok(!r.ok && r.error === "too_many_tails");
});

test("range cap is 366 days inclusive", () => {
  assert.equal(MAX_RANGE_DAYS, 366);
  const ok = q("from=2025-11-17&to=2026-11-17");
  assert.ok(ok.ok && ok.query.days === 366);
  assert.equal(daysInclusive("2024-03-01", "2025-02-28"), 365);
});

test("historyCacheControl: 300s for closed ranges, 30s when today is in range", () => {
  assert.match(historyCacheControl(false), /s-maxage=300/);
  assert.match(historyCacheControl(true), /s-maxage=30\b/);
});

// ─── Pacific ranges and UTC keys ─────────────────────────────────────

test("ptDayStartMs handles PST and PDT; range maps to the right UTC keys", () => {
  assert.equal(ptDayStartMs("2026-11-18"), Date.UTC(2026, 10, 18, 8));
  assert.equal(ptDayStartMs("2026-07-04"), Date.UTC(2026, 6, 4, 7));
  // DST starts 2026-03-08: that day is 23 h long.
  const { startMs, endMs } = ptRangeMs("2026-03-08", "2026-03-08");
  assert.equal(endMs - startMs, 23 * 3_600_000);
  assert.deepEqual(utcKeysForQuery({ from: "2026-11-17", to: "2026-11-18" }), [
    "20261117",
    "20261118",
    "20261119",
  ]);
  assert.deepEqual(utcDateKeysForRange(5, 5), []);
  assert.equal(isPtDate("2028-02-29"), true);
  assert.equal(isPtDate("2026-02-29"), false);
});

// ─── Douglas–Peucker ─────────────────────────────────────────────────

test("douglasPeucker drops collinear points and keeps corners", () => {
  const line = [
    { lat: 47, lon: -122 },
    { lat: 47.001, lon: -122 },
    { lat: 47.002, lon: -122 },
    { lat: 47.002, lon: -121.998 },
    { lat: 47.002, lon: -121.996 },
  ];
  assert.deepEqual(douglasPeuckerIndices(line, 0.0001), [0, 2, 4]);
  // Tolerance larger than the corner's offset collapses to the endpoints.
  assert.deepEqual(douglasPeuckerIndices(line, 0.01), [0, 4]);
  assert.equal(douglasPeucker([], 1).length, 0);
  assert.equal(douglasPeucker([{ lat: 1, lon: 1 }], 1).length, 1);
});

test("douglasPeucker keeps a loop that returns to its start", () => {
  const loop = Array.from({ length: 37 }, (_, i) => {
    const a = (i / 36) * 2 * Math.PI;
    return { lat: 47 + 0.01 * Math.sin(a), lon: -122 + 0.01 * Math.cos(a) };
  });
  const kept = douglasPeucker(loop, 0.0005);
  assert.ok(kept.length > 4 && kept.length < loop.length, `kept ${kept.length}`);
});

test("douglasPeucker survives a very long track (iterative, no stack overflow)", () => {
  const long = Array.from({ length: 200_000 }, (_, i) => ({
    lat: 47 + 0.0001 * Math.sin(i / 50),
    lon: -122 + i * 0.00001,
  }));
  const kept = douglasPeucker(long, 0.00005);
  assert.ok(kept.length >= 2 && kept.length < long.length);
});

test("simplifyLines enforces the vertex cap", () => {
  const zig = (n: number, off: number) =>
    Array.from({ length: n }, (_, i) => ({ lat: 47 + (i % 2) * 0.01 + off, lon: -122 + i * 0.001 }));
  const lines = Array.from({ length: 50 }, (_, i) => zig(1000, i * 0.1));
  const r = simplifyLines(lines, toleranceForDays(30), 5_000);
  assert.ok(r.vertices <= 5_000, `vertices ${r.vertices}`);
  assert.equal(r.lines.length, 50);
  for (const l of r.lines) assert.ok(l.length >= 2);
  // Under the cap, nothing is escalated.
  const small = simplifyLines([zig(10, 0)], 0.0001, 5_000);
  assert.equal(small.tolerance, 0.0001);
  assert.equal(small.vertices, 10);
});

test("toleranceForDays grows with the range", () => {
  assert.ok(toleranceForDays(1) < toleranceForDays(31));
  assert.ok(toleranceForDays(31) < toleranceForDays(366));
});

// ─── heat + build ────────────────────────────────────────────────────

test("heatGrid buckets on the hot-zone cells and drops points outside WA", () => {
  const { cells, total_cells } = heatGrid([
    { tail: "A", points: [{ lat: 47.004, lon: -121.995 }, { lat: 47.005, lon: -121.996 }, { lat: 10, lon: 10 }] },
    { tail: "B", points: [{ lat: 47.006, lon: -121.997 }] },
  ]);
  assert.equal(total_cells, 1);
  assert.equal(cells[0]!.count, 3);
  assert.deepEqual(cells[0]!.tails, ["A", "B"]);
});

function pts(startSec: number, n: number, stepSec = 30): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: 47 + i * 0.001,
    lon: -122.5,
    alt: 1000 + i,
    spd: 100,
    trk: 0,
    ts: startSec + i * stepSec,
  }));
}

test("buildHistory stitches a flight across 00:00 UTC and clips to the PT range", () => {
  const query: HistoryQuery = {
    tails: null,
    from: "2026-11-16",
    to: "2026-11-16",
    days: 1,
    mission: null,
    includesToday: false,
  };
  // 23:30 UTC Nov 16 → 00:30 UTC Nov 17 is 15:30–16:30 PST Nov 16: one flight.
  const start = Date.UTC(2026, 10, 16, 23, 30) / 1000;
  const flight = pts(start, 121);
  // Second flight later that PT evening, plus a duplicate tick and an
  // out-of-range point that must be ignored.
  const later = pts(Date.UTC(2026, 10, 17, 3, 0) / 1000, 20);
  const outside = pts(Date.UTC(2026, 10, 18, 3, 0) / 1000, 20);
  const body = buildHistory(
    query,
    [{ entry: ENTRY, points: [...later, ...flight, flight[5]!, ...outside] }],
    { mission_applied: false },
  );
  assert.equal(body.sessions.length, 2);
  const first = body.sessions[0]!;
  assert.equal(first.duration_s, 3600);
  assert.equal(first.sample_count, 121);
  assert.equal(first.date, "20261116");
  assert.equal(first.id, "20261116T2330");
  assert.equal(first.role, "police");
  assert.equal(body.polylines.length, 2);
  assert.equal(body.polylines[0]!.id, first.id);
  // Straight north-bound line simplifies to its endpoints.
  assert.equal(body.polylines[0]!.points.length, 2);
  assert.deepEqual(body.polylines[0]!.points[0], [47, -122.5, 1000, start]);
  assert.equal(body.summary.flights, 2);
  assert.equal(body.summary.tails_flown, 1);
  assert.equal(body.summary.points_read, 121 + 20 + 1 + 20);
  assert.equal(body.summary.days_with_data, 1);
  assert.equal(body.summary.busiest_day!.date, "2026-11-16");
  assert.equal(body.summary.busiest_hour!.dow, 1); // Monday
  assert.ok(body.heat.cells.length > 0);
  assert.equal(body.range.start_ts, Date.UTC(2026, 10, 16, 8));
});

test("buildHistory with no points is a valid empty body", () => {
  const body = buildHistory(
    { tails: ["N1"], from: "2026-11-01", to: "2026-11-07", days: 7, mission: null, includesToday: false },
    [],
    { mission_applied: false },
  );
  assert.deepEqual(body.sessions, []);
  assert.equal(body.summary.busiest_day, null);
  assert.equal(body.summary.vertices, 0);
});

test("filterByMission uses the mission taxonomy, legacy names map, unknown is ignored", () => {
  const fleet: FleetEntry[] = [ENTRY, { ...ENTRY, tail: "N2", role: "sar" }];
  assert.deepEqual(filterByMission(fleet, "police").entries.map((e) => e.tail), ["N305DK"]);
  assert.deepEqual(filterByMission(fleet, "smokey").entries.map((e) => e.tail), ["N305DK"]);
  assert.deepEqual(filterByMission(fleet, "police,sar").entries.length, 2);
  assert.equal(filterByMission(fleet, "sar").applied, true);
  const unknown = filterByMission(fleet, "photography");
  assert.equal(unknown.applied, false);
  assert.equal(unknown.entries.length, 2);
  assert.equal(filterByMission(fleet, "all").applied, false);
});
