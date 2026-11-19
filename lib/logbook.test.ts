// Run: npx tsx --test lib/logbook.test.ts
//
// Pins the aircraft logbook fold: months, averages, longest sortie,
// departures, time on station by corridor, recent flights and the
// stitch across 00:00 UTC.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLogbook, corridorsByRoad, peakWindow, type TrackFlightInput } from "./logbook";
import { flightDetailFromPoints } from "./flight-detail";
import { circle, leg } from "./geo-fixtures.test-helpers";
import { buildRollupDoc, rollupHasDetail, type RollupSession } from "./rollup-core";
import type { TrackPoint } from "./tracks";

const KOLM = { lat: 46.9694, lon: -122.9025 };
const I5_FIFE = { lat: 47.24, lon: -122.36 };

/** KOLM → 20 min orbit over I-5 at Fife → KOLM. Starts at `startTs` (unix s). */
function patrol(startTs: number): TrackPoint[] {
  const out = leg(KOLM, I5_FIFE, 900, { startTs, altFrom: 300, altTo: 2500 });
  const t1 = out[out.length - 1]!.ts;
  const orbit = circle(I5_FIFE.lat, I5_FIFE.lon, 1200, { startTs: t1 + 30, radiusNm: 1 });
  out.push(...orbit);
  const t2 = orbit[orbit.length - 1]!.ts;
  out.push(...leg(I5_FIFE, KOLM, 900, { startTs: t2 + 30, altFrom: 2500, altTo: 300 }));
  return out;
}

function trackFlight(points: TrackPoint[], inProgress = false): TrackFlightInput {
  const start = points[0]!.ts * 1000;
  const end = points[points.length - 1]!.ts * 1000;
  return {
    session: {
      start_ts: start,
      end_ts: end,
      duration_s: Math.round((end - start) / 1000),
      max_alt_ft: Math.max(...points.map((p) => p.alt ?? 0)),
    },
    points,
    inProgress,
  };
}

function sess(startMs: number, minutes: number, extra: Partial<RollupSession> = {}): RollupSession {
  return {
    start_ts: startMs,
    end_ts: startMs + minutes * 60_000,
    duration_s: minutes * 60,
    max_alt_ft: 2000,
    ...extra,
  };
}

const NOW = Date.UTC(2026, 10, 18, 22, 0); // 2026-11-18 14:00 PST

test("flightDetailFromPoints: departure, arrival and the Fife orbit", () => {
  const d = flightDetailFromPoints(patrol(Date.UTC(2026, 10, 17, 18, 0) / 1000));
  assert.equal(d.dep, "KOLM");
  assert.equal(d.arr, "KOLM");
  assert.ok(d.orbit_s >= 15 * 60, `orbit_s ${d.orbit_s}`);
  assert.equal(d.corridors[0]?.label, "I-5 · Fife");
  // In progress: no arrival yet.
  assert.equal(flightDetailFromPoints(patrol(1_800_000_000), true).arr, null);
});

test("buildLogbook: months stop at the log start, totals and averages", () => {
  const lb = buildLogbook({
    tail: "N305DK",
    rollupSessions: [
      sess(Date.UTC(2026, 9, 20, 17, 0), 60), // Oct
      sess(Date.UTC(2026, 9, 22, 17, 0), 120), // Oct
      sess(Date.UTC(2026, 10, 3, 17, 0), 90), // Nov
    ],
    trackFlights: [],
    nowMs: NOW,
  });
  assert.deepEqual(
    lb.months.map((m) => [m.month, m.sorties, m.airborne_s]),
    [
      ["2026-10", 2, 3 * 3600],
      ["2026-11", 1, 90 * 60],
    ],
  );
  assert.deepEqual(lb.totals, { sorties: 3, airborne_s: 270 * 60 });
  assert.equal(lb.avg_sortie_s, 90 * 60);
  assert.equal(lb.longest?.duration_s, 120 * 60);
  assert.equal(lb.longest?.flightId, "20261022T1700");
  // 17:00Z = 10:00 PDT in October, 09:00 PST in November.
  assert.ok(lb.peak_hours);
  assert.equal(lb.station.flights_with_detail, 0, "old rollup docs carry no detail");
});

test("buildLogbook: twelve months at most, once the log is old enough", () => {
  const lb = buildLogbook({
    tail: "N305DK",
    rollupSessions: [],
    trackFlights: [],
    nowMs: Date.UTC(2028, 2, 10, 20, 0),
  });
  assert.equal(lb.months.length, 12);
  assert.equal(lb.months[0]!.month, "2027-04");
  assert.equal(lb.months[11]!.month, "2028-03");
  assert.equal(lb.avg_sortie_s, null);
  assert.equal(lb.longest, null);
  assert.equal(lb.peak_hours, null);
});

test("buildLogbook: track flights add today, carry detail and win over rollup copies", () => {
  const yesterday = patrol(Date.UTC(2026, 10, 17, 18, 0) / 1000);
  const today = patrol(Date.UTC(2026, 10, 18, 21, 0) / 1000).slice(0, 60); // still up
  const yf = trackFlight(yesterday);
  const tf = trackFlight(today, true);
  const lb = buildLogbook({
    tail: "N305DK",
    // The rolled-up copy of yesterday's flight has no detail fields.
    rollupSessions: [sess(yf.session.start_ts, yf.session.duration_s / 60)],
    trackFlights: [yf, { ...tf, session: { ...tf.session, end_ts: NOW - 60_000 } }],
    nowMs: NOW,
  });
  assert.equal(lb.totals.sorties, 2, "deduped by start");
  assert.equal(lb.recent.length, 2);
  assert.equal(lb.recent[0]!.inProgress, true, "newest first, still airborne");
  assert.equal(lb.recent[0]!.arr, null);
  assert.equal(lb.recent[1]!.dep, "KOLM");
  assert.equal(lb.recent[1]!.arr, "KOLM");
  assert.equal(lb.recent[1]!.corridor, "I-5 · Fife");
  assert.equal(lb.recent[1]!.flightId, "20261117T1800");
  assert.deepEqual(lb.departures, [{ id: "KOLM", count: 2 }]);
  assert.equal(lb.departures_known, 2);
  assert.equal(lb.station.flights_with_detail, 2);
  assert.ok(lb.station.orbit_s >= 15 * 60);
  assert.equal(lb.station.corridors[0]?.road, "I-5");
  assert.equal(lb.station.corridors[0]?.place, "Fife");
});

test("buildLogbook: a flight cut at 00:00 UTC counts once, detail merged", () => {
  const cut = Date.UTC(2026, 10, 18, 0, 0);
  const a = sess(cut - 40 * 60_000, 40, { dep: "KOLM", arr: null, orbit_s: 600, corridors: [{ label: "I-5 · Fife", s: 600 }] });
  const b = sess(cut, 30, { dep: null, arr: "KTIW", orbit_s: 300, corridors: [{ label: "I-5 · Fife", s: 300 }] });
  const lb = buildLogbook({ tail: "N305DK", rollupSessions: [a, b], trackFlights: [], nowMs: NOW });
  assert.equal(lb.totals.sorties, 1);
  assert.equal(lb.recent[0]!.duration_s, 70 * 60);
  assert.equal(lb.recent[0]!.dep, "KOLM");
  assert.equal(lb.recent[0]!.arr, "KTIW");
  assert.equal(lb.recent[0]!.orbit_s, 900);
  assert.equal(lb.station.corridors[0]?.s, 900);
});

test("peakWindow wraps past midnight and ignores an empty histogram", () => {
  const h = new Array(24).fill(0);
  h[23] = 30;
  h[0] = 30;
  h[1] = 30;
  h[12] = 50;
  assert.deepEqual(peakWindow(h), { start: 23, end: 2, minutes: 90 });
  assert.equal(peakWindow(new Array(24).fill(0)), null);
});

test("corridorsByRoad groups places under their road", () => {
  assert.deepEqual(
    corridorsByRoad([
      { label: "I-5 · Fife", s: 300 },
      { label: "SR-512 · Parkland", s: 500 },
      { label: "I-5 · Tacoma", s: 400 },
      { label: "I-5", s: 100 },
    ]),
    [
      { road: "I-5", s: 800, place: "Tacoma" },
      { road: "SR-512", s: 500, place: "Parkland" },
    ],
  );
});

test("buildRollupDoc stores per-session detail; rollupHasDetail spots old docs", () => {
  const pts = patrol(Date.UTC(2026, 10, 17, 18, 0) / 1000);
  const entry = {
    tail: "N305DK",
    operator: "WSP",
    model: "Cessna 206H",
    nickname: "Smokey 4",
    roleDescription: "Speed enforcement",
    base: "KOLM",
    role: "police" as const,
    roleConfidence: "confirmed" as const,
    sources: [],
  };
  const doc = buildRollupDoc("20261117", [{ entry, samples: pts }], 1);
  const s = doc.tails[0]!.sessions[0]!;
  assert.equal(s.dep, "KOLM");
  assert.equal(s.arr, "KOLM");
  assert.ok((s.orbit_s ?? 0) >= 15 * 60);
  assert.equal(s.corridors?.[0]?.label, "I-5 · Fife");
  assert.equal(rollupHasDetail(doc), true);
  const old = { ...doc, tails: [{ ...doc.tails[0]!, sessions: [sess(s.start_ts, 60)] }] };
  assert.equal(rollupHasDetail(old), false);
});
