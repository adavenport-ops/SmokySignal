// Run: npx tsx --test lib/radar-zoom.test.ts
//
// Pins the zoom-adaptive heat + route paint. MapLibre throws at render
// time on non-ascending interpolate stops, so validity is checked here
// rather than discovered in the browser console.

import { test } from "node:test";
import assert from "node:assert";
import {
  HEAT_COLOR_STOPS,
  HEAT_SWATCH,
  ROUTE_COLOR,
  heatColorExpression,
  isWarmRgba,
  HEAT_INTENSITY_STOPS,
  HEAT_OPACITY_STOPS,
  HEAT_RADIUS_STOPS,
  ROUTE_OPACITY_STOPS,
  ROUTE_WIDTH_STOPS,
  evalZoomStops,
  stopsAreValid,
  zoomInterpolate,
  type ZoomStops,
} from "./radar-zoom";

const ALL: Record<string, ZoomStops> = {
  HEAT_RADIUS_STOPS,
  HEAT_INTENSITY_STOPS,
  HEAT_OPACITY_STOPS,
  ROUTE_WIDTH_STOPS,
  ROUTE_OPACITY_STOPS,
};

test("every stop list is strictly ascending and finite", () => {
  for (const [name, stops] of Object.entries(ALL)) {
    assert.ok(stopsAreValid(stops), name);
  }
});

test("stopsAreValid catches the render-time failure modes", () => {
  assert.ok(!stopsAreValid([[6, 1]]));
  assert.ok(
    !stopsAreValid([
      [6, 1],
      [6, 2],
    ]),
  );
  assert.ok(
    !stopsAreValid([
      [8, 1],
      [6, 2],
    ]),
  );
  assert.ok(
    !stopsAreValid([
      [6, 1],
      [8, NaN],
    ]),
  );
});

test("zoomInterpolate builds a linear zoom interpolate expression", () => {
  assert.deepStrictEqual(
    zoomInterpolate([
      [5, 1],
      [10, 2],
    ]),
    ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 2],
  );
});

test("evalZoomStops clamps and interpolates linearly", () => {
  const s: ZoomStops = [
    [6, 10],
    [8, 20],
  ];
  assert.strictEqual(evalZoomStops(s, 2), 10);
  assert.strictEqual(evalZoomStops(s, 7), 15);
  assert.strictEqual(evalZoomStops(s, 12), 20);
  assert.ok(Number.isNaN(evalZoomStops([], 7)));
});

test("heat radius only grows with zoom, so cells never re-separate", () => {
  for (let z = 4; z < 18; z += 0.5) {
    assert.ok(
      evalZoomStops(HEAT_RADIUS_STOPS, z + 0.5) >=
        evalZoomStops(HEAT_RADIUS_STOPS, z),
      `z${z}`,
    );
  }
});

test("heat stays visible at state zoom (z5-7)", () => {
  for (const z of [5, 6, 7]) {
    assert.ok(evalZoomStops(HEAT_RADIUS_STOPS, z) >= 5, `radius z${z}`);
    assert.ok(evalZoomStops(HEAT_OPACITY_STOPS, z) >= 0.7, `opacity z${z}`);
    assert.ok(evalZoomStops(HEAT_INTENSITY_STOPS, z) > 0, `intensity z${z}`);
  }
});

test("heat intensity is lower zoomed out than up close (no state-wide red)", () => {
  assert.ok(
    evalZoomStops(HEAT_INTENSITY_STOPS, 6) <
      evalZoomStops(HEAT_INTENSITY_STOPS, 12) / 2,
  );
});

test("corridor detail from z12 up is unchanged from the pre-statewide tuning", () => {
  assert.strictEqual(evalZoomStops(HEAT_RADIUS_STOPS, 12), 70);
  assert.strictEqual(evalZoomStops(HEAT_RADIUS_STOPS, 14), 140);
  assert.strictEqual(evalZoomStops(HEAT_RADIUS_STOPS, 18), 400);
  assert.strictEqual(evalZoomStops(HEAT_INTENSITY_STOPS, 12), 1.0);
  assert.strictEqual(evalZoomStops(ROUTE_WIDTH_STOPS, 12), 1.2);
  assert.strictEqual(evalZoomStops(ROUTE_OPACITY_STOPS, 12), 0.14);
});

test("routes are thin, low-opacity threads at state zoom", () => {
  for (const z of [5, 6, 7]) {
    const w = evalZoomStops(ROUTE_WIDTH_STOPS, z);
    const o = evalZoomStops(ROUTE_OPACITY_STOPS, z);
    assert.ok(w > 0 && w <= 1, `width z${z}=${w}`);
    assert.ok(o >= 0.2 && o <= 0.4, `opacity z${z}=${o}`);
  }
  // Brighter zoomed out than at corridor zoom, where the heat leads.
  assert.ok(
    evalZoomStops(ROUTE_OPACITY_STOPS, 6) > evalZoomStops(ROUTE_OPACITY_STOPS, 12),
  );
});

// Orange is reserved for live aircraft. The heat ramp and route threads
// are 30 days of history and must stay cool.
test("heat colour stops start at 0, end at 1, strictly ascending", () => {
  assert.equal(HEAT_COLOR_STOPS[0]![0], 0);
  assert.equal(HEAT_COLOR_STOPS[HEAT_COLOR_STOPS.length - 1]![0], 1);
  for (let i = 1; i < HEAT_COLOR_STOPS.length; i++) {
    assert.ok(HEAT_COLOR_STOPS[i]![0] > HEAT_COLOR_STOPS[i - 1]![0]);
  }
});

test("heat ramp, swatch and route colour carry no warm (alert) hue", () => {
  for (const [d, c] of HEAT_COLOR_STOPS) {
    assert.ok(!isWarmRgba(c), `stop ${d} ${c} is warm`);
  }
  assert.ok(!isWarmRgba(HEAT_SWATCH));
  const hex = ROUTE_COLOR.replace("#", "");
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)})`;
  assert.ok(!isWarmRgba(rgb), `route ${ROUTE_COLOR} is warm`);
});

test("isWarmRgba flags the alert orange and the old amber ramp", () => {
  assert.ok(isWarmRgba("rgb(255,122,26)"));
  assert.ok(isWarmRgba("rgba(245,184,64,0.45)"));
  assert.ok(isWarmRgba("rgba(220,38,38,0.65)"));
  assert.ok(!isWarmRgba("rgba(0,0,0,0)"));
});

test("heatColorExpression interleaves density/colour pairs", () => {
  const e = heatColorExpression() as unknown[];
  assert.deepEqual(e.slice(0, 3), ["interpolate", ["linear"], ["heatmap-density"]]);
  assert.equal(e.length, 3 + HEAT_COLOR_STOPS.length * 2);
});
