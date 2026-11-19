// Run: npx tsx --test lib/radar-zoom.test.ts
//
// Pins the zoom-adaptive heat + route paint. MapLibre throws at render
// time on non-ascending interpolate stops, so validity is checked here
// rather than discovered in the browser console.

import { test } from "node:test";
import assert from "node:assert";
import { BASEMAP } from "./basemap";
import { LIVE_GLYPH } from "./brand/aircraft-glyphs";
import { composite, contrast } from "./color-math";
import { PALETTES, PALETTE_IDS, heatColorExpressionFor } from "./radar-palettes";
import {
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

// Colour rule, revised with the palette picker: heat MAY be warm (Ember,
// the default, runs deep red to amber). What must hold is that a live
// aircraft is never lost in any palette's heat. The marker is a
// near-white glyph on a dark halo disc with an identity ring; at every
// heat stop either the disc or the glyph clears 3:1 against the heat,
// and the glyph always clears 7:1 against its own disc. Full palette
// coverage lives in lib/radar-palettes.test.ts; this pins the rule next
// to the zoom curves it depends on (heat opacity tops out at z4).
test("heat may be warm; live aircraft stay distinguishable from every palette's heat", () => {
  const heatOpacity = Math.max(...HEAT_OPACITY_STOPS.map(([, v]) => v));
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    for (const [d, c] of p.heat) {
      for (const ground of [BASEMAP.land, BASEMAP.water]) {
        const heat = composite(c, ground, heatOpacity);
        const disc = composite(p.live.halo, heat, p.live.haloOpacity);
        const glyphOnDisc = contrast(LIVE_GLYPH.fill, disc);
        const marker = Math.max(contrast(disc, heat), contrast(LIVE_GLYPH.fill, heat));
        assert.ok(glyphOnDisc >= 7, `${id} d${d}: glyph on disc ${glyphOnDisc.toFixed(2)}`);
        assert.ok(marker >= 3, `${id} d${d}: marker vs heat ${marker.toFixed(2)}`);
      }
    }
  }
});

test("every palette heat ramp is a valid heatmap-color interpolate", () => {
  for (const id of PALETTE_IDS) {
    const stops = PALETTES[id].heat;
    assert.equal(stops[0]![0], 0, id);
    assert.equal(stops[stops.length - 1]![0], 1, id);
    for (let i = 1; i < stops.length; i++) assert.ok(stops[i]![0] > stops[i - 1]![0], id);
    const e = heatColorExpressionFor(PALETTES[id]) as unknown[];
    assert.deepEqual(e.slice(0, 3), ["interpolate", ["linear"], ["heatmap-density"]]);
    assert.equal(e.length, 3 + stops.length * 2);
  }
});
