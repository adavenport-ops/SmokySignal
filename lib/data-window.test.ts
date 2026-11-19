// Run: npx tsx --test lib/data-window.test.ts
//
// One data window, one count. The same synthetic tracks go through every
// read path a rider sees for a period, and they must agree:
//   - plane history and /radar history  (lib/history-core.ts, raw tracks)
//   - /stats                            (lib/rollup-core.ts summarizeRollups)
//   - /data and the CSV                 (lib/ledger.ts buildLedgerRows)
//   - the logbook on /plane             (lib/logbook.ts buildLogbook)
//   - the /flight page                  (lib/flights.ts mergeDaySamples)
// The fixture starts on the first day on record (a UTC day that is the
// previous evening in Pacific time) and includes a flight across 00:00
// UTC, the two places the counts used to drift apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistory, type HistoryQuery } from "./history-core";
import { buildRollupDoc, summarizeRollups, utcDateKey, type DailyRollup } from "./rollup-core";
import { buildLedgerRows } from "./ledger";
import { buildLogbook } from "./logbook";
import { findFlightSession, flightIdFromTs, mergeDaySamples, parseFlightId, sessionsFromDay } from "./flights";
import { DATA_SINCE_FALLBACK, dataSinceFrom, earliestTrackDay } from "./data-since-core";
import { circle, leg } from "./geo-fixtures.test-helpers";
import type { FleetEntry } from "./types";
import type { TrackPoint } from "./tracks";

const KOLM = { lat: 46.9694, lon: -122.9025 };
const FIFE = { lat: 47.24, lon: -122.36 };

const ENTRY = {
  tail: "N305DK",
  nickname: "Smokey 4",
  operator: "WSP",
  role: "police",
  model: "Cessna 206H",
  base: "KOLM",
  roleConfidence: "confirmed",
  sources: [],
} as unknown as FleetEntry;

/** KOLM → orbit over Fife → KOLM, `orbitS` long, starting at unix `t0`. */
function sortie(t0: number, orbitS = 1200): TrackPoint[] {
  const out = leg(KOLM, FIFE, 900, { startTs: t0, altFrom: 300, altTo: 2500 });
  const t1 = out[out.length - 1]!.ts;
  const orbit = circle(FIFE.lat, FIFE.lon, orbitS, { startTs: t1 + 30, radiusNm: 1, alt: 2500 });
  out.push(...orbit);
  const t2 = orbit[orbit.length - 1]!.ts;
  out.push(...leg(FIFE, KOLM, 900, { startTs: t2 + 30, altFrom: 2500, altTo: 300 }));
  return out;
}

const sec = (iso: string) => Date.parse(iso) / 1000;

// 2026-10-15T01:00Z is 2026-10-14 18:00 PT: the first point on record.
const FLIGHTS: TrackPoint[][] = [
  sortie(sec("2026-10-15T01:00:00Z")),
  sortie(sec("2026-10-15T03:00:00Z"), 600),
  sortie(sec("2026-10-20T18:00:00Z")),
  // Across 00:00 UTC: 23:20Z to about 00:30Z.
  sortie(sec("2026-10-21T23:20:00Z"), 2400),
  sortie(sec("2026-10-30T17:00:00Z")),
  // November: outside the October window.
  sortie(sec("2026-11-02T18:00:00Z")),
];
const ALL = FLIGHTS.flat().sort((a, b) => a.ts - b.ts);

/** Split points into UTC track days, the way tracks:{tail}:{day} stores them. */
function byUtcDay(points: TrackPoint[]): Map<string, TrackPoint[]> {
  const out = new Map<string, TrackPoint[]>();
  for (const p of points) {
    const k = utcDateKey(p.ts * 1000);
    const list = out.get(k) ?? [];
    list.push(p);
    out.set(k, list);
  }
  return out;
}

const DAYS = byUtcDay(ALL);
const DOCS: DailyRollup[] = [...DAYS.entries()].map(([day, samples]) =>
  buildRollupDoc(day, [{ entry: ENTRY, samples }], 0),
);
const INDEX = [...DAYS.keys()].sort();
const NOW = Date.parse("2026-11-19T20:00:00Z");

test("data since: the earliest track day, in Pacific time", () => {
  const keys = INDEX.map((d) => `tracks:N305DK:${d}`);
  const day = earliestTrackDay(keys);
  assert.equal(day, "20261015");
  assert.equal(dataSinceFrom(day, ALL[0]!.ts), "2026-10-14");
  assert.equal(dataSinceFrom(day, ALL[0]!.ts), DATA_SINCE_FALLBACK);
});

test("October counts agree across history, stats, ledger and logbook", () => {
  const since = dataSinceFrom(earliestTrackDay(INDEX.map((d) => `tracks:N305DK:${d}`)), ALL[0]!.ts);
  const query: HistoryQuery = {
    tails: ["N305DK"],
    from: since,
    to: "2026-10-31",
    days: 18,
    mission: null,
    includesToday: false,
  };
  const history = buildHistory(query, [{ entry: ENTRY, points: ALL }], { mission_applied: false });
  const historyFlights = history.summary.per_tail[0]!.flights;

  const octDocs = DOCS.filter((d) => d.date >= "20261015" && d.date <= "20261101");
  const stats = summarizeRollups(octDocs, INDEX, NOW);
  // /stats over the October docs; the 20261101 doc holds the tail of
  // nothing here, so per_tail counts October flights only.
  const statsFlights = stats.per_tail[0]!.flights;

  const ledger = buildLedgerRows(DOCS).find((r) => r.month === "2026-10" && r.tail === "N305DK")!;

  const logbook = buildLogbook({
    tail: "N305DK",
    rollupSessions: DOCS.flatMap((d) => d.tails.flatMap((t) => t.sessions)),
    trackFlights: [],
    nowMs: NOW,
    since,
  });
  const logbookOct = logbook.months.find((m) => m.month === "2026-10")!.sorties;

  assert.equal(historyFlights, 5);
  assert.equal(statsFlights, 5);
  assert.equal(ledger.flights, 5);
  assert.equal(logbookOct, 5);
  // The first evening on record counts: its month row exists.
  assert.ok(logbook.months.some((m) => m.month === "2026-10"));
  // Airborne time agrees too.
  assert.equal(history.summary.per_tail[0]!.airborne_s, ledger.airborne_s);
  assert.equal(stats.per_tail[0]!.airborne_s, ledger.airborne_s);
});

test("a flight across 00:00 UTC has one duration on the logbook and the flight page", () => {
  const logbook = buildLogbook({
    tail: "N305DK",
    rollupSessions: DOCS.flatMap((d) => d.tails.flatMap((t) => t.sessions)),
    trackFlights: [],
    nowMs: NOW,
  });
  const cross = FLIGHTS[3]!;
  const startMs = cross[0]!.ts * 1000;
  const listed = logbook.recent.find((f) => f.start_ts === startMs)!;
  assert.ok(listed, "logbook lists the flight under its real takeoff");
  assert.equal(listed.flightId, flightIdFromTs(startMs));

  // The flight page reads the id's UTC day plus its neighbours.
  const parsed = parseFlightId(listed.flightId)!;
  const day = parsed.dateKey;
  const next = utcDateKey(Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T00:00:00Z`) + 86_400_000);
  const merged = mergeDaySamples([DAYS.get(day) ?? [], DAYS.get(next) ?? []]);
  const page = findFlightSession(sessionsFromDay(ENTRY, day, merged), parsed.tsMs)!;
  assert.equal(page.start_ts, listed.start_ts);
  assert.equal(page.duration_s, listed.duration_s);

  // Reading only the one UTC day (the old flight page) cut it short.
  const oneDay = findFlightSession(sessionsFromDay(ENTRY, day, DAYS.get(day)!), parsed.tsMs)!;
  assert.ok(oneDay.duration_s < listed.duration_s);

  // An old link minted from the 00:00 UTC half still finds the flight.
  const half = Date.parse(`${next.slice(0, 4)}-${next.slice(4, 6)}-${next.slice(6)}T00:00:00Z`);
  assert.equal(findFlightSession(sessionsFromDay(ENTRY, day, merged), half)?.start_ts, listed.start_ts);
});

test("mergeDaySamples sorts and drops same-second repeats", () => {
  const a = [{ lat: 1, lon: 1, alt: 1, ts: 10 }, { lat: 1, lon: 1, alt: 1, ts: 20 }] as TrackPoint[];
  const b = [{ lat: 1, lon: 1, alt: 1, ts: 20 }, { lat: 1, lon: 1, alt: 1, ts: 5 }] as TrackPoint[];
  assert.deepEqual(mergeDaySamples([a, b]).map((p) => p.ts), [5, 10, 20]);
});
