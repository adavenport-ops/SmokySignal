// Run: npx tsx --test lib/flight-card.test.ts
//
// Pins the flight card geometry: the track fits its box with aspect
// kept and north up, degenerate tracks land centred, the sparkline runs
// baseline to peak, and vertex counts stay capped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CARD_POINTS, altitudeSparkline, cardRoute, decimate, projectTrack, subPath } from "./flight-card";
import type { TrackPoint } from "./tracks";

function p(lat: number, lon: number, ts: number, alt: number | null = 1000): TrackPoint {
  return { lat, lon, alt, spd: 100, trk: null, ts };
}

/** Parse "M x y L x y ..." into numbers. */
function coords(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const BOX = { width: 1000, height: 600, pad: 20 };

test("projectTrack: fits inside the padded box, north up, east right", () => {
  const g = projectTrack([p(47.0, -122.5, 1), p(47.2, -122.5, 2), p(47.2, -122.2, 3)], BOX);
  const xy = coords(g.d);
  assert.equal(xy.length, 3);
  for (const [x, y] of xy) {
    assert.ok(x >= 20 - 1e-6 && x <= 980 + 1e-6, `x ${x}`);
    assert.ok(y >= 20 - 1e-6 && y <= 580 + 1e-6, `y ${y}`);
  }
  // Second point is due north of the first: same x, smaller y.
  assert.equal(xy[0]![0], xy[1]![0]);
  assert.ok(xy[1]![1] < xy[0]![1]);
  // Third is east of the second: larger x, same y.
  assert.ok(xy[2]![0] > xy[1]![0]);
  assert.equal(xy[2]![1], xy[1]![1]);
  assert.deepEqual(g.start, { x: g.xy[0]!.x, y: g.xy[0]!.y });
  assert.deepEqual(g.end, { x: g.xy[2]!.x, y: g.xy[2]!.y });
});

test("projectTrack: keeps aspect, scaling longitude by cos(latitude)", () => {
  // 0.1° lat x 0.1° lon at 47°N: the east span is ~0.68 of the north span.
  const g = projectTrack([p(47.0, -122.5, 1), p(47.1, -122.4, 2)], BOX);
  const [[x0, y0], [x1, y1]] = coords(g.d) as [[number, number], [number, number]];
  const ratio = Math.abs(x1 - x0) / Math.abs(y1 - y0);
  assert.ok(Math.abs(ratio - Math.cos((47.05 * Math.PI) / 180)) < 0.01, `ratio ${ratio}`);
  // Height-bound: the north span fills the padded height and is centred across.
  assert.ok(Math.abs(Math.abs(y1 - y0) - 560) < 0.2);
  assert.ok(Math.abs((x0 + x1) / 2 - 500) < 0.2);
});

test("projectTrack: a single fix or zero extent lands in the centre; empty draws nothing", () => {
  const one = projectTrack([p(47, -122, 1)], BOX);
  assert.deepEqual(one.start, { x: 500, y: 300 });
  const parked = projectTrack([p(47, -122, 1), p(47, -122, 2)], BOX);
  assert.deepEqual(coords(parked.d), [
    [500, 300],
    [500, 300],
  ]);
  const none = projectTrack([], BOX);
  assert.equal(none.d, "");
  assert.equal(none.start, null);
  // Non-finite fixes are dropped, unsorted input is sorted by time.
  const messy = projectTrack([p(47.1, -122, 2), p(NaN, -122, 3), p(47, -122, 1)], BOX);
  assert.equal(messy.xy.length, 2);
  assert.deepEqual(messy.xy.map((q) => q.ts), [1, 2]);
});

test("projectTrack + subPath: vertex cap and time slices", () => {
  const many = Array.from({ length: 5000 }, (_, i) => p(47 + i * 1e-4, -122 + Math.sin(i / 50) * 0.01, i));
  const g = projectTrack(many, BOX);
  assert.ok(g.xy.length <= MAX_CARD_POINTS + 1);
  assert.equal(g.xy[g.xy.length - 1]!.ts, 4999, "last fix kept");
  const part = coords(subPath(g, 1000, 2000));
  assert.ok(part.length >= 2 && part.length < g.xy.length);
  assert.equal(subPath(g, 10_000, 20_000), "");
});

test("decimate keeps the ends and respects the cap", () => {
  const list = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(decimate(list, 20), list);
  const d = decimate(list, 4);
  assert.equal(d[0], 0);
  assert.equal(d[d.length - 1], 9);
  assert.ok(d.length <= 5);
});

test("altitudeSparkline: time on x, 0 ft at the baseline, nulls skipped", () => {
  const sp = altitudeSparkline(
    [p(47, -122, 0, 0), p(47, -122, 50, null), p(47, -122, 100, 2000), p(47, -122, 200, 1000)],
    { width: 400, height: 100 },
  );
  const xy = coords(sp.d);
  assert.equal(xy.length, 3);
  assert.deepEqual(xy[0], [0, 100]);
  assert.equal(xy[1]![0], 200);
  assert.equal(xy[2]![0], 400);
  // Peak sits below the top edge (10% headroom), half-peak at ~55% height.
  assert.ok(Math.abs(xy[1]![1] - (100 - 100 / 1.1)) < 0.1);
  assert.ok(xy[2]![1] > xy[1]![1]);
  assert.equal(sp.max_alt_ft, 2000);
  assert.equal(sp.min_alt_ft, 0);
  assert.match(sp.area, /Z$/);
  assert.equal(altitudeSparkline([p(47, -122, 0, 500)], { width: 10, height: 10 }).d, "");
});

test("cardRoute: unknown arrival reads in rider terms, never a dash", () => {
  const nameOf = (id: string) => ({ S50: "Auburn Municipal", KOLM: "Olympia Regional" })[id] ?? null;
  assert.deepEqual(cardRoute({ dep: "S50", arr: null, inProgress: false, nameOf }), {
    codes: "S50",
    names: "Auburn Municipal (S50) → landed off-field or out of range",
  });
  assert.deepEqual(cardRoute({ dep: "S50", arr: "KOLM", inProgress: false, nameOf }), {
    codes: "S50 → KOLM",
    names: "Auburn Municipal (S50) → Olympia Regional (KOLM)",
  });
  assert.deepEqual(cardRoute({ dep: "S50", arr: null, inProgress: true, nameOf }), {
    codes: "S50 → UP",
    names: "Auburn Municipal (S50) → still up",
  });
  const none = cardRoute({ dep: null, arr: null, inProgress: false, nameOf });
  assert.equal(none.names, "Took off off-field or out of range → landed off-field or out of range");
  assert.ok(!/—|not resolved/.test(none.codes + none.names));
});
