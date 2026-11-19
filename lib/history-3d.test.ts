// Run: npx tsx --test lib/history-3d.test.ts
//
// Pins the 3D adapters: history polylines → Flight3D paths (TrackPoint
// shape, keys), the colour rules (cool and never warm, except the one
// selected flight and live police), replay gating, the view URL param,
// and live markers + trails.

import { test } from "node:test";
import assert from "node:assert";
import {
  FLIGHT_PALETTE_3D,
  HISTORY_VIEW_PARAM,
  LIVE_NEUTRAL_COLOR,
  LIVE_POLICE_COLOR,
  LIVE_VIEW_PARAM,
  SELECTED_FLIGHT_COLOR,
  historyColors3D,
  historyPathKey,
  historyPaths3D,
  liveColor,
  liveMarkers,
  liveTrailPaths,
  parseHistoryPathKey,
  parseMapView,
  replayAllowed,
  tailColors3D,
  withMapView,
} from "./history-3d";
import { PER_TAIL_COLOR_MAX, isWarmHex } from "./history-view";
import { PALETTES, PALETTE_IDS } from "./radar-palettes";
import { resolveTrack } from "./flight3d";
import type { HistoryPolyline } from "./history-core";
import type { TrackPoint } from "./tracks";

const poly = (tail: string, id: string, n = 3): HistoryPolyline => ({
  id,
  tail,
  points: Array.from({ length: n }, (_, i) => [47 + i * 0.01, -122.3 - i * 0.01, 1000 + i * 100, 1_800_000_000 + i * 10]),
});

// ─── view param ──────────────────────────────────────────────────────

test("view param: only '3d' turns 3D on; 2D removes the key and keeps the rest", () => {
  assert.strictEqual(parseMapView("3d"), "3d");
  for (const v of [null, undefined, "", "2d", "3D", "flat"]) assert.strictEqual(parseMapView(v), "2d");
  const on = withMapView("h=1&from=2026-11-01&to=2026-11-17&mock=up", HISTORY_VIEW_PARAM, "3d");
  assert.strictEqual(on.get("hview"), "3d");
  assert.strictEqual(on.get("mock"), "up");
  assert.strictEqual(on.get("from"), "2026-11-01");
  const off = withMapView(on, HISTORY_VIEW_PARAM, "2d");
  assert.strictEqual(off.has("hview"), false);
  assert.strictEqual(off.get("h"), "1");
  assert.strictEqual(HISTORY_VIEW_PARAM, "hview");
  assert.strictEqual(LIVE_VIEW_PARAM, "view");
});

// ─── adapters ────────────────────────────────────────────────────────

test("path keys round-trip and keep two tails' same-minute flights apart", () => {
  const a = historyPathKey({ tail: "N305DK", id: "20261111T0419" });
  const b = historyPathKey({ tail: "N2446X", id: "20261111T0419" });
  assert.notStrictEqual(a, b);
  assert.deepStrictEqual(parseHistoryPathKey(a), { tail: "N305DK", id: "20261111T0419" });
  assert.strictEqual(parseHistoryPathKey("nokey"), null);
  assert.strictEqual(parseHistoryPathKey("/x"), null);
  assert.strictEqual(parseHistoryPathKey("x/"), null);
});

test("historyPaths3D: TrackPoint shape Flight3D can resolve, single-vertex lines dropped", () => {
  const paths = historyPaths3D([
    { id: "f1", tail: "N305DK", points: [[47.1, -122.3, 1200, 1_800_000_000], [47.2, -122.4, null, 1_800_000_010]] },
    { id: "f2", tail: "N305DK", points: [[47.1, -122.3, 1200, 1_800_000_000]] },
  ]);
  assert.strictEqual(paths.length, 1);
  const p = paths[0]!;
  assert.strictEqual(p.id, "N305DK/f1");
  assert.deepStrictEqual(p.points[0], { lat: 47.1, lon: -122.3, alt: 1200, spd: null, trk: null, ts: 1_800_000_000 });
  // Assignable to TrackPoint and resolvable by Flight3D's own pipeline:
  // the null altitude fills from its neighbour.
  const pts: TrackPoint[] = p.points;
  const r = resolveTrack(pts);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[1]!.altFt, 1200);
  assert.strictEqual(r[0]!.lon, -122.3);
});

// ─── colours ─────────────────────────────────────────────────────────

test("one flight: orange (it is the flight on screen), replay on", () => {
  const polys = [poly("N305DK", "20261101T1000")];
  const c = historyColors3D(polys);
  assert.deepStrictEqual(Object.values(c), [SELECTED_FLIGHT_COLOR]);
  assert.ok(replayAllowed(historyPaths3D(polys)));
});

test("many flights, one tail: a colour per flight, cool, none warm, no replay", () => {
  const polys = Array.from({ length: 20 }, (_, i) => poly("N305DK", `202611${String(i + 1).padStart(2, "0")}T1000`));
  const c = historyColors3D(polys);
  const vals = Object.values(c);
  assert.strictEqual(vals.length, 20);
  for (const v of vals) assert.ok(!isWarmHex(v), `${v} reads warm`);
  // Neighbouring flights differ; the palette cycles.
  const ordered = polys.map((p) => c[historyPathKey(p)]!);
  for (let i = 1; i < ordered.length; i++) assert.notStrictEqual(ordered[i], ordered[i - 1]);
  assert.strictEqual(ordered[0], ordered[FLIGHT_PALETTE_3D.length]);
  assert.ok(!replayAllowed(historyPaths3D(polys)));
  // Order-independent: shuffled input, same mapping.
  const shuffled = [...polys].reverse();
  assert.deepStrictEqual(historyColors3D(shuffled), c);
});

test("many flights: only the selected one turns orange", () => {
  const polys = Array.from({ length: 5 }, (_, i) => poly("N305DK", `2026110${i + 1}T1000`));
  const sel = historyPathKey(polys[2]!);
  const c = historyColors3D(polys, sel);
  assert.strictEqual(c[sel], SELECTED_FLIGHT_COLOR);
  const warm = Object.entries(c).filter(([, v]) => isWarmHex(v));
  assert.deepStrictEqual(warm.map(([k]) => k), [sel]);
  // An unknown selection changes nothing.
  assert.deepStrictEqual(historyColors3D(polys, "N1/nope"), historyColors3D(polys));
  // The selected flight draws last (on top of the stack), in orange.
  const paths = historyPaths3D(polys, sel);
  assert.strictEqual(paths.length, 5);
  assert.strictEqual(paths[4]!.id, sel);
  assert.strictEqual(paths[4]!.color, SELECTED_FLIGHT_COLOR);
  assert.deepStrictEqual(historyPaths3D(polys).map((p) => p.id), polys.map(historyPathKey));
});

test("two to six tails: a 3D colour per tail, matching the legend", () => {
  const polys = [poly("N305DK", "a"), poly("N305DK", "b"), poly("N2446X", "c"), poly("N422CT", "d")];
  const c = historyColors3D(polys);
  const legend: Record<string, string> = tailColors3D(polys.map((p) => p.tail));
  // Sorted tails → palette slots; the chip legend reads the same map.
  assert.deepStrictEqual({ ...legend }, {
    N2446X: FLIGHT_PALETTE_3D[0],
    N305DK: FLIGHT_PALETTE_3D[1],
    N422CT: FLIGHT_PALETTE_3D[2],
  });
  for (const p of polys) assert.strictEqual(c[historyPathKey(p)], legend[p.tail]);
  for (const v of Object.values(c)) assert.ok(!isWarmHex(v));
  const sel = historyColors3D(polys, "N2446X/c");
  assert.strictEqual(sel["N2446X/c"], SELECTED_FLIGHT_COLOR);
  assert.strictEqual(sel["N305DK/a"], FLIGHT_PALETTE_3D[1]);
  // Past the limit there is no per-tail legend.
  assert.deepStrictEqual(tailColors3D(["A1", "A2", "A3", "A4", "A5", "A6", "A7"]), {});
});

test("3D colours do not follow the rider's 2D palette (some 2D palettes run warm)", () => {
  // Every 2D palette is allowed warm history hues; 3D never is.
  const anyWarm2D = PALETTE_IDS.some((id) => PALETTES[id].history.tails.some((h) => isWarmHex(h)));
  assert.ok(anyWarm2D, "fixture: expected at least one warm 2D palette");
  for (const hex of FLIGHT_PALETTE_3D) assert.ok(!isWarmHex(hex));
});

test("more tails than the legend holds: a colour per flight again, still cool", () => {
  const tails = Array.from({ length: PER_TAIL_COLOR_MAX + 3 }, (_, i) => `N${100 + i}SP`);
  const polys = tails.flatMap((t, i) => [poly(t, `2026110${(i % 9) + 1}T0800`), poly(t, `2026110${(i % 9) + 1}T1400`)]);
  const c = historyColors3D(polys);
  const vals = Object.values(c);
  assert.strictEqual(vals.length, polys.length);
  assert.ok(new Set(vals).size >= FLIGHT_PALETTE_3D.length, "flights share one colour");
  for (const v of vals) assert.ok(!isWarmHex(v), `${v} reads warm`);
  const sel = historyPathKey(polys[3]!);
  const withSel = historyColors3D(polys, sel);
  assert.deepStrictEqual(
    Object.entries(withSel)
      .filter(([, v]) => isWarmHex(v))
      .map(([k]) => k),
    [sel],
  );
});

test("the 3D flight palette is cool and low-saturation, and the warm check catches orange", () => {
  // HSV saturation: pastels sit low, the alert orange sits near 0.9.
  const sat = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  };
  for (const hex of FLIGHT_PALETTE_3D) {
    assert.ok(!isWarmHex(hex), `${hex} reads warm`);
    assert.ok(sat(hex) <= 0.45, `${hex} saturation ${sat(hex).toFixed(2)}`);
  }
  assert.ok(sat(SELECTED_FLIGHT_COLOR) > 0.8);
  assert.strictEqual(new Set(FLIGHT_PALETTE_3D).size, FLIGHT_PALETTE_3D.length);
  assert.ok(isWarmHex(SELECTED_FLIGHT_COLOR));
  assert.ok(isWarmHex(LIVE_POLICE_COLOR));
});

// ─── live ────────────────────────────────────────────────────────────

const NOW = 1_800_000_600;
const ac = (tail: string, role: string, extra: Record<string, unknown> = {}) => ({
  tail,
  role,
  airborne: true,
  lat: 47.5,
  lon: -122.3,
  altitude_ft: 2500,
  ...extra,
});

test("live colours: police orange, every other mission the neutral glyph grey", () => {
  assert.strictEqual(LIVE_POLICE_COLOR, "#FF7A1A");
  assert.strictEqual(liveColor({ role: "police" }), "#FF7A1A");
  for (const role of ["sar", "medevac", "wildfire", "survey", "transport", "federal_le", "unknown", undefined]) {
    const c = liveColor({ role });
    assert.strictEqual(c, LIVE_NEUTRAL_COLOR);
    assert.ok(!isWarmHex(c), `${role} → ${c} reads warm`);
  }
  // Legacy role names map through the mission taxonomy.
  assert.strictEqual(liveColor({ role: "smokey" }), "#FF7A1A");
});

test("liveMarkers: airborne with a position only, at reported altitude", () => {
  const m = liveMarkers([
    ac("N305DK", "police"),
    ac("N2446X", "sar", { altitude_ft: undefined }),
    ac("N1GND", "police", { airborne: false }),
    ac("N0POS", "police", { lat: undefined }),
  ]);
  assert.deepStrictEqual(
    m.map((x) => [x.id, x.altFt, x.color]),
    [
      ["N305DK", 2500, "#FF7A1A"],
      ["N2446X", null, LIVE_NEUTRAL_COLOR],
    ],
  );
  assert.strictEqual(m[0]!.label, "N305DK");
});

test("liveTrailPaths: last 10 minutes, ends at the live fix, altitude carried", () => {
  const trails = {
    N305DK: [
      { lat: 47.40, lon: -122.2, ts: NOW - 900, alt: 1800 }, // 15 min ago: dropped
      { lat: 47.45, lon: -122.25, ts: NOW - 540, alt: 2000 },
      { lat: 47.48, lon: -122.28, ts: NOW - 300, alt: null },
      { lat: 47.49, lon: -122.29, ts: NOW - 30 }, // older server: no alt
    ],
    N2446X: [{ lat: 47.1, lon: -122.1, ts: NOW - 60 }],
  };
  const paths = liveTrailPaths(trails, [ac("N305DK", "police"), ac("N2446X", "sar"), ac("N9NONE", "police")], NOW);
  const dk = paths.find((p) => p.id === "live/N305DK")!;
  assert.ok(dk);
  assert.strictEqual(dk.color, "#FF7A1A");
  assert.deepStrictEqual(
    dk.points.map((p) => p.ts),
    [NOW - 540, NOW - 300, NOW - 30, NOW],
  );
  assert.deepStrictEqual(
    dk.points.map((p) => p.alt),
    [2000, null, null, 2500],
  );
  const last = dk.points[dk.points.length - 1]!;
  assert.deepStrictEqual([last.lat, last.lon], [47.5, -122.3]);
  // One trail point + the live fix is still a line; no trail at all is not.
  const x = paths.find((p) => p.id === "live/N2446X")!;
  assert.strictEqual(x.points.length, 2);
  assert.strictEqual(x.color, LIVE_NEUTRAL_COLOR);
  assert.ok(!paths.some((p) => p.id === "live/N9NONE"));
  // Flight3D fills the gaps from the nearest known altitude.
  const r = resolveTrack(dk.points);
  assert.ok(r.every((p) => p.altFt >= 2000 && p.altFt <= 2500));
});

test("liveTrailPaths: grounded aircraft and future-stamped junk are skipped", () => {
  const paths = liveTrailPaths(
    { N1: [{ lat: 47, lon: -122, ts: NOW + 3600 }, { lat: 47.01, lon: -122, ts: NOW - 10 }] },
    [ac("N1", "police"), ac("N2", "police", { airborne: false })],
    NOW,
  );
  assert.strictEqual(paths.length, 1);
  assert.deepStrictEqual(paths[0]!.points.map((p) => p.ts), [NOW - 10, NOW]);
});
