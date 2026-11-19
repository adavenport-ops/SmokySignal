// Run: npx tsx --test lib/ledger.test.ts
//
// Pins the open ledger: tail-month rows, the mission roll-up, month
// params, and the CSV contract (column order, escaping, no positions).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSV_COLUMNS,
  buildLedgerRows,
  buildMissionRows,
  csvField,
  hoursString,
  ledgerCsv,
  parseMonthParam,
  type LedgerRow,
} from "./ledger";
import type { DailyRollup, RollupSession, RollupTail } from "./rollup-core";

function tail(t: string, sessions: RollupSession[], extra: Partial<RollupTail> = {}): RollupTail {
  return {
    tail: t,
    nickname: null,
    operator: "WSP",
    role: "police",
    flights: sessions.length,
    airborne_s: sessions.reduce((n, s) => n + s.duration_s, 0),
    max_alt_ft: Math.max(0, ...sessions.map((s) => s.max_alt_ft)),
    first_takeoff_ts: sessions[0]?.start_ts ?? null,
    last_takeoff_ts: sessions[sessions.length - 1]?.start_ts ?? null,
    sessions,
    ...extra,
  };
}

function s(startMs: number, minutes: number, alt = 2000): RollupSession {
  return { start_ts: startMs, end_ts: startMs + minutes * 60_000, duration_s: minutes * 60, max_alt_ft: alt };
}

function doc(date: string, tails: RollupTail[]): DailyRollup {
  return {
    v: 1,
    date,
    built_at: 0,
    registry_size: 10,
    sample_count: 100,
    tails,
    totals: { flights: 0, airborne_s: 0, max_alt_ft: 0, tails_flown: tails.length },
    pt_hour_minutes: new Array(24).fill(0),
  };
}

const DOCS: DailyRollup[] = [
  doc("20261020", [
    // Stored pre-taxonomy role value; read paths normalize it.
    tail("N305DK", [s(Date.UTC(2026, 9, 20, 17), 60, 2500)], { nickname: "Smokey 5", role: "smokey" as RollupTail["role"] }),
    tail("N1977G", [s(Date.UTC(2026, 9, 20, 18), 30, 9000)], { operator: "CBP", role: "federal_le" }),
  ]),
  doc("20261021", [tail("N305DK", [s(Date.UTC(2026, 9, 21, 17), 90, 3000)], { nickname: "Smokey 5" })]),
  // 2026-11-01 06:30Z is still Oct 31 in Pacific time.
  doc("20261101", [tail("N305DK", [s(Date.UTC(2026, 10, 1, 6, 30), 45)], { nickname: "Smokey 5" })]),
  doc("20261105", [tail("N305DK", [s(Date.UTC(2026, 10, 5, 17), 120)], { nickname: "Smokey 5" })]),
];

test("buildLedgerRows: one row per tail-month, Pacific months, legacy roles normalized", () => {
  const rows = buildLedgerRows(DOCS);
  assert.deepEqual(
    rows.map((r) => [r.month, r.tail, r.mission, r.flights, r.airborne_s, r.max_alt_ft]),
    [
      ["2026-10", "N1977G", "federal_le", 1, 1800, 9000],
      ["2026-10", "N305DK", "police", 3, (60 + 90 + 45) * 60, 3000],
      ["2026-11", "N305DK", "police", 1, 7200, 2000],
    ],
  );
  assert.equal(rows[1]!.nickname, "Smokey 5");
});

test("buildLedgerRows: month range is inclusive; registry overrides stored metadata", () => {
  const rows = buildLedgerRows(DOCS, {
    range: { from: "2026-11", to: "2026-11" },
    registry: new Map([["N305DK", { nickname: "Smokey 5 (renamed)" }]]),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.month, "2026-11");
  assert.equal(rows[0]!.nickname, "Smokey 5 (renamed)");
  assert.equal(buildLedgerRows(DOCS, { range: { to: "2026-09" } }).length, 0);
});

test("buildMissionRows: sums by month and mission in canonical mission order", () => {
  const m = buildMissionRows(buildLedgerRows(DOCS));
  assert.deepEqual(
    m.map((r) => [r.month, r.mission, r.flights, r.airborne_s, r.tails]),
    [
      ["2026-10", "police", 3, 195 * 60, 1],
      ["2026-10", "federal_le", 1, 1800, 1],
      ["2026-11", "police", 1, 7200, 1],
    ],
  );
});

test("parseMonthParam accepts YYYY-MM only", () => {
  assert.equal(parseMonthParam("2026-10"), "2026-10");
  assert.equal(parseMonthParam(" 2026-01 "), "2026-01");
  for (const bad of ["2026-13", "2026-00", "2026-1", "202610", "", null, undefined, "2026-10-01"]) {
    assert.equal(parseMonthParam(bad), null, String(bad));
  }
});

test("csvField: RFC 4180 quoting and formula guard", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
  assert.equal(csvField("cr\rhere"), '"cr\rhere"');
  assert.equal(csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvField("+1"), "'+1");
  assert.equal(csvField("@x,y"), "\"'@x,y\"");
  assert.equal(csvField(null), "");
  assert.equal(csvField(undefined), "");
  assert.equal(csvField(-5), "-5", "numbers are never guarded");
  assert.equal(csvField(NaN), "");
});

test("ledgerCsv: header first, fixed column order, CRLF, hours to two places", () => {
  const rows: LedgerRow[] = [
    {
      month: "2026-10",
      tail: "N305DK",
      nickname: 'Smokey "5", south',
      operator: "WSP",
      mission: "police",
      flights: 3,
      airborne_s: 11_700,
      max_alt_ft: 3000,
    },
    { month: "2026-11", tail: "N1977G", nickname: null, operator: "CBP", mission: "federal_le", flights: 1, airborne_s: 1800, max_alt_ft: 9000 },
  ];
  const csv = ledgerCsv(rows);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "month,tail,nickname,operator,mission,flights,hours,max_alt_ft");
  assert.deepEqual(lines[0]!.split(","), [...CSV_COLUMNS]);
  assert.equal(lines[1], '2026-10,N305DK,"Smokey ""5"", south",WSP,police,3,3.25,3000');
  assert.equal(lines[2], "2026-11,N1977G,,CBP,federal_le,1,0.50,9000");
  assert.equal(lines[3], "", "ends with CRLF");
  assert.equal(lines.length, 4);
  assert.ok(!/lat|lon/i.test(csv), "no positions");
  assert.equal(ledgerCsv([]), "month,tail,nickname,operator,mission,flights,hours,max_alt_ft\r\n");
  assert.equal(hoursString(-1), "0.00");
});
