// Run: npx tsx --test lib/wrap.test.ts
//
// Pins the season wrap: the limited first season, busiest and quietest
// months (whole months preferred), busiest day and hour, longest sortie,
// most-worked corridor and the per-mission breakdown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isWrapYear, summarizeWrap } from "./wrap";
import type { DailyRollup, RollupSession, RollupTail } from "./rollup-core";

function s(startMs: number, minutes: number, extra: Partial<RollupSession> = {}): RollupSession {
  return { start_ts: startMs, end_ts: startMs + minutes * 60_000, duration_s: minutes * 60, max_alt_ft: 2000, ...extra };
}

function t(tail: string, role: string, sessions: RollupSession[]): RollupTail {
  return {
    tail,
    nickname: tail === "N305DK" ? "Smokey 5" : null,
    operator: "X",
    role: role as RollupTail["role"],
    flights: sessions.length,
    airborne_s: 0,
    max_alt_ft: 0,
    first_takeoff_ts: null,
    last_takeoff_ts: null,
    sessions,
  };
}

function doc(date: string, tails: RollupTail[]): DailyRollup {
  return {
    v: 1,
    date,
    built_at: 0,
    registry_size: 3,
    sample_count: 1,
    tails,
    totals: { flights: 0, airborne_s: 0, max_alt_ft: 0, tails_flown: 0 },
    pt_hour_minutes: new Array(24).fill(0),
  };
}

const FIFE = [{ label: "I-5 · Fife", s: 1200 }];
const PARKLAND = [{ label: "SR-512 · Parkland", s: 900 }];

const DOCS: DailyRollup[] = [
  // Oct 20, 10:00 PDT: two sorties the same day.
  doc("20261020", [
    t("N305DK", "police", [s(Date.UTC(2026, 9, 20, 17), 120, { orbit_s: 1200, corridors: FIFE })]),
    t("N1977G", "federal_le", [s(Date.UTC(2026, 9, 20, 18), 60)]),
  ]),
  // Nov 3, 09:00 PST: the longest sortie.
  doc("20261103", [t("N305DK", "police", [s(Date.UTC(2026, 10, 3, 17), 200, { orbit_s: 900, corridors: PARKLAND })])]),
  // Nov 4: Fife again.
  doc("20261104", [t("N2446X", "patrol", [s(Date.UTC(2026, 10, 4, 18), 50, { orbit_s: 600, corridors: [{ label: "I-5 · Fife", s: 600 }] })])]),
  // Next year: never counted in 2026.
  doc("20270105", [t("N305DK", "police", [s(Date.UTC(2027, 0, 5, 18), 500)])]),
];

const NOW = Date.UTC(2026, 10, 18, 22, 0); // 2026-11-18 14:00 PST

test("isWrapYear: from the log's first year through the current one", () => {
  assert.equal(isWrapYear(2026, NOW), true);
  assert.equal(isWrapYear(2025, NOW), false);
  assert.equal(isWrapYear(2027, NOW), false);
  assert.equal(isWrapYear(2027, Date.UTC(2027, 5, 1)), true);
  assert.equal(isWrapYear(2026.5, NOW), false);
});

test("summarizeWrap 2026: limited and in progress, totals, months, extremes", () => {
  const w = summarizeWrap(DOCS, 2026, NOW);
  assert.equal(w.from, "2026-10-16");
  assert.equal(w.to, "2026-11-17", "through the last closed day");
  assert.equal(w.limited, true);
  assert.equal(w.in_progress, true);
  assert.deepEqual(w.totals, { sorties: 4, airborne_s: (120 + 60 + 200 + 50) * 60, tails: 3 });
  assert.deepEqual(
    w.months.map((m) => [m.month, m.sorties, m.airborne_s, m.partial]),
    [
      ["2026-10", 2, 180 * 60, true],
      ["2026-11", 2, 250 * 60, true],
    ],
  );
  assert.equal(w.busiest_month?.month, "2026-11");
  // No whole month yet, so quietest compares the partial ones.
  assert.equal(w.quietest_month?.month, "2026-10");
  assert.deepEqual(w.busiest_day, { date: "2026-11-03", airborne_s: 200 * 60, sorties: 1 });
  // 11:00 PT: Oct 20 (two tails) plus the Nov 3 sortie = 180 min.
  assert.deepEqual(w.busiest_hour, { hour: 11, minutes: 180 });
  assert.equal(w.longest?.tail, "N305DK");
  assert.equal(w.longest?.duration_s, 200 * 60);
  assert.deepEqual(w.corridor, { road: "I-5", s: 1800, place: "Fife" });
  assert.equal(w.sorties_with_detail, 3);
  assert.deepEqual(
    w.by_mission.map((m) => [m.mission, m.sorties, m.tails]),
    [
      ["police", 3, 2],
      ["federal_le", 1, 1],
    ],
  );
});

test("summarizeWrap: a whole year prefers whole months for quietest", () => {
  const w = summarizeWrap(DOCS, 2026, Date.UTC(2027, 1, 1, 20));
  assert.equal(w.to, "2026-12-31");
  assert.equal(w.in_progress, false);
  assert.deepEqual(w.months.map((m) => [m.month, m.partial]), [
    ["2026-10", true],
    ["2026-11", false],
    ["2026-12", false],
  ]);
  assert.equal(w.quietest_month?.month, "2026-12");
  assert.equal(w.quietest_month?.sorties, 0);
});

test("summarizeWrap: a year with no flights is empty, not broken", () => {
  const w = summarizeWrap([], 2026, NOW);
  assert.equal(w.totals.sorties, 0);
  assert.equal(w.busiest_month, null);
  assert.equal(w.busiest_day, null);
  assert.equal(w.busiest_hour, null);
  assert.equal(w.longest, null);
  assert.equal(w.corridor, null);
  assert.deepEqual(w.by_mission, []);
  assert.equal(w.months.length, 2);
});
