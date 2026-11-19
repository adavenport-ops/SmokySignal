// Run: npx tsx --test lib/airports.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { AIRPORTS, airportById, inferArrival, inferDeparture, nearestAirport } from "./airports";
import { detectOrbits } from "./orbit";
import { FLEET } from "./seed";
import { circle, leg, offsetNm, straight } from "./geo-fixtures.test-helpers";
import type { TrackPoint } from "./tracks";

const KOLM = airportById("KOLM")!;
const I5_FIFE = { lat: 47.24, lon: -122.36 };

test("table: unique ids, coordinates inside Washington (plus Pearson on the river)", () => {
  const ids = AIRPORTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of AIRPORTS) {
    assert.ok(a.lat > 45.5 && a.lat < 49.1 && a.lon > -124.8 && a.lon < -116.9, `${a.id} out of range`);
    assert.ok(a.name.length > 0);
  }
});

test("table: includes the fields the brief and the fleet need", () => {
  for (const id of [
    "KOLM", "KTIW", "KPWT", "KRNT", "KBFI", "KPAE", "KAWO", "KSEA", "KTCM", "KGRF",
    "KSHN", "KBVS", "KPLU", "KSFF", "KGEG", "KYKM", "KELN",
  ]) {
    assert.ok(airportById(id), `missing ${id}`);
  }
});

test("table: every registry base with an ICAO prefix resolves", () => {
  let checked = 0;
  for (const f of FLEET) {
    const code = /^(K[A-Z0-9]{3})\b/.exec(f.base)?.[1];
    if (!code) continue; // e.g. "Taylor's Landing"
    assert.ok(airportById(code), `${f.tail} base ${f.base} not in AIRPORTS`);
    checked++;
  }
  assert.ok(checked >= 15, `only ${checked} bases checked`);
});

test("airportById is case- and whitespace-insensitive", () => {
  assert.equal(airportById(" kolm ")?.id, "KOLM");
  assert.equal(airportById("XXXX"), null);
});

test("nearestAirport: exact, out of range, widened range, nearest of neighbours", () => {
  const exact = nearestAirport(KOLM.lat, KOLM.lon);
  assert.equal(exact?.id, "KOLM");
  assert.ok(exact!.distanceNm < 1e-6);

  const fiveOut = offsetNm(KOLM.lat, KOLM.lon, 0, -5);
  assert.equal(nearestAirport(fiveOut.lat, fiveOut.lon), null);
  assert.equal(nearestAirport(fiveOut.lat, fiveOut.lon, 10)?.id, "KOLM");

  // Just east of Boeing Field, closer to it than to Renton.
  assert.equal(nearestAirport(47.525, -122.29)?.id, "KBFI");
  assert.equal(nearestAirport(47.495, -122.22)?.id, "KRNT");
  assert.equal(nearestAirport(Number.NaN, -122)?.id, undefined);
});

/** KOLM → climb to Fife → work I-5 for 22 min → back to KOLM. */
function patrolFlight(): TrackPoint[] {
  const t0 = 1_763_400_000;
  const depart = leg(KOLM, I5_FIFE, 15 * 60, { startTs: t0, altFrom: 250, altTo: 2500 });
  const d = depart[depart.length - 1]!;
  const work = circle(I5_FIFE.lat, I5_FIFE.lon, 22 * 60, { radiusNm: 0.8, startTs: d.ts + 30 });
  const w = work[work.length - 1]!;
  const home = leg(w, KOLM, 15 * 60, { startTs: w.ts, altFrom: 2500, altTo: 300, includeStart: false });
  return [...depart, ...work, ...home];
}

test("departure + arrival: KOLM round trip with a pattern over I-5 · Fife", () => {
  const pts = patrolFlight();
  assert.equal(inferDeparture(pts)?.id, "KOLM");
  assert.equal(inferArrival(pts)?.id, "KOLM");
  const segs = detectOrbits(pts);
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.corridor, "I-5 · Fife");
  assert.ok(Math.abs(segs[0]!.durationS - 22 * 60) <= 60, `duration ${segs[0]!.durationS}`);
});

test("departure: first sample a mile out at 900 ft still resolves the field", () => {
  const start = offsetNm(KOLM.lat, KOLM.lon, 0, 1.5);
  const pts = straight(start.lat, start.lon, 20, 10 * 60, { alt: 900 });
  assert.equal(inferDeparture(pts)?.id, "KOLM");
});

test("departure: prefers the lowest point near a field, not just the first", () => {
  const t0 = 1_763_400_000;
  // First sample 2.5 nm east of Boeing Field at 1200 ft (inside KBFI's ring),
  // then 300 ft right over Renton two minutes later.
  const nearBfi = offsetNm(47.53, -122.302, 2.5, 0);
  const pts: TrackPoint[] = [
    { lat: nearBfi.lat, lon: nearBfi.lon, alt: 1200, spd: 90, trk: 150, ts: t0 },
    { lat: 47.4935, lon: -122.2160, alt: 300, spd: 80, trk: 150, ts: t0 + 120 },
    { lat: 47.47, lon: -122.2, alt: 1500, spd: 100, trk: 150, ts: t0 + 240 },
  ];
  assert.equal(inferDeparture(pts)?.id, "KRNT");
});

test("departure: unordered points are handled", () => {
  const pts = patrolFlight();
  assert.equal(inferDeparture([...pts].reverse())?.id, "KOLM");
});

test("departure: reported altitude beats a null altitude; null still counts on its own", () => {
  const t0 = 1_763_400_000;
  const pts: TrackPoint[] = [
    { lat: 47.4931, lon: -122.2158, alt: null, spd: null, trk: null, ts: t0 }, // KRNT, no alt
    { lat: 47.53, lon: -122.302, alt: 200, spd: 80, trk: 330, ts: t0 + 60 }, // KBFI, 200 ft
  ];
  assert.equal(inferDeparture(pts)?.id, "KBFI");
  assert.equal(inferDeparture([pts[0]!])?.id, "KRNT");
});

test("departure: points above maxAltFt or outside the window are ignored", () => {
  const t0 = 1_763_400_000;
  const high: TrackPoint[] = [
    { lat: 47.449, lon: -122.3093, alt: 5000, spd: 160, trk: 0, ts: t0 }, // over KSEA, high
    { lat: 47.6, lon: -122.31, alt: 5000, spd: 160, trk: 0, ts: t0 + 60 },
  ];
  assert.equal(inferDeparture(high), null);
  assert.equal(inferDeparture(high, { maxAltFt: 6000 })?.id, "KSEA");

  // Passes low over KTIW 20 min after a start far from any field.
  const late: TrackPoint[] = [
    { lat: 47.75, lon: -122.55, alt: 2000, spd: 100, trk: 180, ts: t0 },
    { lat: 47.268, lon: -122.5781, alt: 600, spd: 100, trk: 180, ts: t0 + 1200 },
  ];
  assert.equal(inferDeparture(late), null);
  assert.equal(inferDeparture(late, { windowS: 1500 })?.id, "KTIW");
});

test("arrival: session that ends mid-air away from fields is null", () => {
  const pts = straight(KOLM.lat, KOLM.lon, 0, 30 * 60, { alt: 2500 });
  assert.equal(inferDeparture(pts)?.id, "KOLM");
  assert.equal(inferArrival(pts), null);
});

test("arrival: lands somewhere other than where it left", () => {
  const t0 = 1_763_400_000;
  const tiw = airportById("KTIW")!;
  const pts = leg(KOLM, tiw, 20 * 60, { startTs: t0, altFrom: 300, altTo: 400 });
  assert.equal(inferDeparture(pts)?.id, "KOLM");
  assert.equal(inferArrival(pts)?.id, "KTIW");
});

test("empty and invalid input", () => {
  assert.equal(inferDeparture([]), null);
  assert.equal(inferArrival([]), null);
  assert.equal(
    inferArrival([{ lat: Number.NaN, lon: -122, alt: 0, spd: 0, trk: 0, ts: 1 }]),
    null,
  );
});
