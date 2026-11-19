// Run: npx tsx --test lib/basemap.test.ts
//
// Coloured roads on the shared basemap. Two halves:
//
//  1. The road-layer classifier, against the real MapTiler dataviz-dark
//     layer list (lib/fixtures/maptiler-dataviz-dark-layers.json), plus
//     the paint expressions and the in-place palette repaint.
//  2. Every palette's roadTint, measured the dataviz way (computed, never
//     eyeballed): WCAG contrast on the land, OKLCH lightness, OKLab Delta E
//     (x100) and the Machado 2009 protan / deutan simulation. Results at
//     the time of writing are recorded inline.
//
// Road tint table at writing (contrast on land #232323; OKLCH L; salience
// = Delta E from the land):
//
//   palette        motorway          major             street
//   ember          #4E757D 3.12 .536 #455D62 2.24 .461 #3C494C 1.68 .395
//   magma          #796F45 3.12 .540 #5E5942 2.23 .462 #4A473A 1.69 .397
//   ice            #816A5D 3.11 .543 #64554C 2.20 .462 #4F4641 1.71 .402
//   high-contrast  #5E5E5E 2.42 .482 #525252 2.01 .439 #464646 1.67 .394
//   mono           #525252 2.01 .439 #4B4B4B 1.80 .413 #444444 1.61 .387

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASEMAP,
  CASING_EXTRA,
  ROAD_TIER_CLASSES,
  ROAD_WIDTHS,
  STREET_FADE,
  applyRoadTint,
  classifyRoadLayer,
  classifyRoadLayers,
  firstRoadLayerId,
  motorwayColorOf,
  roadColorExpression,
  roadWidthExpression,
  type StyleLayerLike,
} from "./basemap";
import { LIVE_GLYPH } from "./brand/aircraft-glyphs";
import { composite, contrast, cvdDeltaE, deltaE, oklch, parseColor, toHex } from "./color-math";
import { PALETTES, PALETTE_IDS, heatAt, opaque, type PaletteId } from "./radar-palettes";

const STYLE: { layers: StyleLayerLike[] } = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "maptiler-dataviz-dark-layers.json"), "utf8"),
);
const hex = (c: string) => toHex(parseColor(c));
const L = (c: string) => oklch(hex(c))[0];
const salience = (c: string) => deltaE(hex(c), BASEMAP.land);

// ─── classifier ──────────────────────────────────────────────────────

test("classifier finds exactly the road layers in dataviz-dark", () => {
  const got = classifyRoadLayers(STYLE.layers).map((c) => [c.id, c.role, c.tiers.join("+")]);
  assert.deepStrictEqual(got, [
    ["Tunnel outline", "tunnel-casing", "motorway+major+street"],
    ["Tunnel", "tunnel", "motorway+major+street"],
    ["Road network outline", "casing", "motorway+major+street"],
    ["Road network", "road", "motorway+major+street"],
    ["Road labels", "label", "major+street"],
  ]);
});

test("classifier leaves rail, paths, piers, bridges, aeroways and labels of places alone", () => {
  for (const id of [
    "Railway",
    "Railway dash",
    "Railway tunnel",
    "Path",
    "Path minor",
    "Path outline",
    "Tunnel path",
    "Pier",
    "Pier road",
    "Bridge",
    "Aeroway",
    "Water",
    "City labels",
    "River",
  ]) {
    const l = STYLE.layers.find((x) => x.id === id);
    assert.ok(l, `fixture has ${id}`);
    assert.strictEqual(classifyRoadLayer(l!), null, id);
  }
});

test("classifier reads per-class layers, expression filters and casings", () => {
  const T = { type: "line", "source-layer": "transportation" } as const;
  assert.deepStrictEqual(classifyRoadLayer({ ...T, id: "hw", filter: ["in", "class", "motorway", "trunk"] })?.tiers, ["motorway"]);
  assert.deepStrictEqual(classifyRoadLayer({ ...T, id: "pri", filter: ["==", "class", "primary"] })?.tiers, ["major"]);
  assert.deepStrictEqual(
    classifyRoadLayer({ ...T, id: "minor", filter: ["all", ["in", "class", "minor", "service"], ["!=", "brunnel", "tunnel"]] })?.tiers,
    ["street"],
  );
  assert.deepStrictEqual(
    classifyRoadLayer({ ...T, id: "x", filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary"]]] })?.tiers,
    ["major", "street"],
  );
  assert.deepStrictEqual(
    classifyRoadLayer({ ...T, id: "m", filter: ["match", ["get", "class"], ["motorway"], true, false] })?.tiers,
    ["motorway"],
  );
  assert.strictEqual(classifyRoadLayer({ ...T, id: "Highway casing", filter: ["==", "class", "motorway"] })?.role, "casing");
  assert.strictEqual(classifyRoadLayer({ ...T, id: "rail", filter: ["==", "class", "rail"] }), null);
  assert.strictEqual(classifyRoadLayer({ id: "fill", type: "fill", "source-layer": "transportation" }), null);
  assert.strictEqual(firstRoadLayerId(STYLE.layers), "Tunnel outline");
  for (const t of ["motorway", "major", "street"] as const) assert.ok(ROAD_TIER_CLASSES[t].length > 0);
});

// ─── expressions ─────────────────────────────────────────────────────

test("road colour: one match on class, streets fade in from the land grey around z12", () => {
  const tint = PALETTES.ember.roadTint;
  const e = roadColorExpression(tint, ["motorway", "major", "street"]) as unknown[];
  assert.deepStrictEqual(e.slice(0, 3), ["interpolate", ["linear"], ["zoom"]]);
  assert.strictEqual(e[3], STREET_FADE[0]);
  assert.strictEqual(e[5], STREET_FADE[1]);
  assert.ok(STREET_FADE[0] >= 11 && STREET_FADE[1] <= 13, "streets show from about z12");
  assert.deepStrictEqual(e[4], ["match", ["get", "class"], ["motorway", "trunk"], tint.motorway, ["primary", "secondary"], tint.major, BASEMAP.land]);
  assert.deepStrictEqual(e[6], ["match", ["get", "class"], ["motorway", "trunk"], tint.motorway, ["primary", "secondary"], tint.major, tint.street]);
  // A motorway-only layer is a plain colour.
  assert.strictEqual(roadColorExpression(tint, ["motorway"]), tint.motorway);
  assert.strictEqual(motorwayColorOf(e), tint.motorway);
  assert.strictEqual(motorwayColorOf(tint.motorway), tint.motorway);
  assert.strictEqual(motorwayColorOf(42), null);
});

test("widths: motorways a step wider than major roads at every zoom; streets none before z11", () => {
  for (let i = 0; i < ROAD_WIDTHS.motorway.length; i++) {
    const [z, mw] = ROAD_WIDTHS.motorway[i]!;
    const [z2, mj] = ROAD_WIDTHS.major[i]!;
    const [z3, st] = ROAD_WIDTHS.street[i]!;
    assert.strictEqual(z, z2);
    assert.strictEqual(z, z3);
    assert.strictEqual(z, CASING_EXTRA[i]![0]);
    assert.ok(mw > mj, `z${z}: motorway ${mw} > major ${mj}`);
    assert.ok(mj >= st, `z${z}: major ${mj} >= street ${st}`);
    if (z <= 10) assert.strictEqual(st, 0, `z${z} street`);
    if (i > 0) assert.ok(mw > ROAD_WIDTHS.motorway[i - 1]![1], "widens with zoom");
  }
  const w = roadWidthExpression(["motorway", "major", "street"]) as unknown[];
  assert.deepStrictEqual(w.slice(0, 3), ["interpolate", ["exponential", 1.5], ["zoom"]]);
  // Motorway ramps draw at major width.
  const z12 = w[w.indexOf(12) + 1] as unknown[];
  assert.deepStrictEqual(z12[3], ["match", ["get", "ramp"], 1, 1.9, 2.8]);
  const casing = roadWidthExpression(["motorway", "major", "street"], true) as unknown[];
  const c12 = casing[casing.indexOf(12) + 1] as unknown[];
  assert.strictEqual(c12[c12.length - 1], 0, "no casing under streets");
});

/** Minimal stand-in for a MapLibre map: records paint calls. */
function fakeMap(layers: StyleLayerLike[]) {
  const paint = new Map<string, unknown>();
  const attrs = new Map<string, string>();
  let calls = 0;
  const map = {
    getStyle: () => ({ layers }),
    setPaintProperty: (id: string, prop: string, v: unknown) => {
      calls++;
      paint.set(`${id}|${prop}`, v);
    },
    getPaintProperty: (id: string, prop: string) => paint.get(`${id}|${prop}`),
    getContainer: () => ({ setAttribute: (k: string, v: string) => void attrs.set(k, v) }),
  };
  return { map: map as unknown as Parameters<typeof applyRoadTint>[0], paint, attrs, calls: () => calls };
}

test("applyRoadTint paints the classified layers and repaints in place on a palette switch", () => {
  const f = fakeMap(STYLE.layers);
  applyRoadTint(f.map, PALETTES.ember.roadTint);
  assert.strictEqual(f.attrs.get("data-road-motorway"), PALETTES.ember.roadTint.motorway);
  assert.strictEqual(f.attrs.get("data-road-layer"), "Road network");
  assert.strictEqual(f.paint.get("Road network outline|line-color"), BASEMAP.roadCasing);
  assert.strictEqual(f.paint.get("Road labels|text-color"), BASEMAP.label);
  assert.ok(!f.paint.has("Railway|line-color"), "rail untouched");
  // Switching palette only calls setPaintProperty again: no style reload.
  applyRoadTint(f.map, PALETTES.magma.roadTint);
  assert.strictEqual(f.attrs.get("data-road-motorway"), PALETTES.magma.roadTint.motorway);
  assert.strictEqual(motorwayColorOf(f.paint.get("Tunnel|line-color")), PALETTES.magma.roadTint.motorway);
  // A style with no roads (the keyless 3D fallback) is a no-op.
  const bare = fakeMap([{ id: "ss-bg", type: "background" }]);
  assert.deepStrictEqual(applyRoadTint(bare.map, PALETTES.ember.roadTint), []);
  assert.strictEqual(bare.calls(), 0);
});

// ─── road tints, measured ────────────────────────────────────────────

/** Motorway floor on the land. 3:1 where the palette leaves room. High
 *  contrast's cyan route sits at L .639, so a road 0.15 L under it tops
 *  out near 2.4:1; Mono asks for a very faint grey under its lowest grey
 *  heat stop. Both trade the 3:1 for keeping heat and routes on top. */
const MOTORWAY_FLOOR: Record<PaletteId, number> = {
  ember: 3,
  magma: 3,
  ice: 3,
  "high-contrast": 2.4,
  mono: 2,
};
/** Adjacent-tier lightness step (the dataviz ordinal check is 0.06).
 *  The two neutral palettes are capped above and below, so their tiers
 *  also lean on width. */
const TIER_STEP: Record<PaletteId, number> = {
  ember: 0.06,
  magma: 0.06,
  ice: 0.06,
  "high-contrast": 0.04,
  mono: 0.025,
};

test("every palette has a complete road tint", () => {
  for (const id of PALETTE_IDS) {
    const t = PALETTES[id].roadTint;
    assert.ok(t, id);
    for (const k of ["motorway", "major", "street"] as const) assert.match(t[k], /^#[0-9A-F]{6}$/i, `${id} ${k}`);
    assert.strictEqual(new Set([t.motorway, t.major, t.street].map((c) => c.toLowerCase())).size, 3, `${id} distinct`);
  }
});

// At writing, motorway / street contrast on land: ember 3.12 / 1.68,
// magma 3.12 / 1.69, ice 3.11 / 1.71, hc 2.42 / 1.67, mono 2.01 / 1.61.
test("motorways clearly visible, streets faint but there", () => {
  for (const id of PALETTE_IDS) {
    const t = PALETTES[id].roadTint;
    const mw = contrast(t.motorway, BASEMAP.land);
    const st = contrast(t.street, BASEMAP.land);
    assert.ok(mw >= MOTORWAY_FLOOR[id], `${id} motorway ${mw.toFixed(2)}`);
    assert.ok(st >= 1.6, `${id} street ${st.toFixed(2)}`);
    // Recessive: no tier reaches the route's own contrast.
    assert.ok(mw < contrast(PALETTES[id].route.color, BASEMAP.land), `${id} motorway under route`);
  }
});

test("major is a lighter, duller step of motorway; street fainter still", () => {
  for (const id of PALETTE_IDS) {
    const t = PALETTES[id].roadTint;
    const [Lm, Cm, Hm] = oklch(t.motorway);
    const [Lj, Cj, Hj] = oklch(t.major);
    const [Ls, Cs, Hs] = oklch(t.street);
    assert.ok(Lm - Lj >= TIER_STEP[id] - 1e-3, `${id} motorway/major dL ${(Lm - Lj).toFixed(3)}`);
    assert.ok(Lj - Ls >= TIER_STEP[id] - 1e-3, `${id} major/street dL ${(Lj - Ls).toFixed(3)}`);
    assert.ok(Cm >= Cj && Cj >= Cs, `${id} chroma falls with the tier`);
    assert.ok(Cm <= 0.065, `${id} motorway stays muted (C ${Cm.toFixed(3)})`);
    if (Cm > 0.02) {
      // One hue per palette: the tiers are steps of the same tint.
      const d = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
      assert.ok(d(Hm, Hj) < 8 && d(Hm, Hs) < 8, `${id} hue drift`);
    }
  }
  for (const id of ["high-contrast", "mono"] as const) {
    for (const c of Object.values(PALETTES[id].roadTint)) assert.ok(oklch(c)[1] < 0.005, `${id} ${c} neutral`);
  }
});

// Route L minus motorway L at writing: ember .40, magma .38, ice .36,
// hc .157, mono .56.
test("roads sit at least 0.15 OKLCH L under the route colour", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    for (const c of Object.values(p.roadTint)) {
      const dl = L(p.route.color) - L(c);
      assert.ok(dl >= 0.15, `${id} ${c}: dL ${dl.toFixed(3)}`);
    }
  }
});

test("road hue stays away from the heat (and the route, where the route has hue)", () => {
  const d = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  for (const id of ["ember", "magma", "ice"] as const) {
    const p = PALETTES[id];
    const hRoad = oklch(p.roadTint.motorway)[2];
    const hHeat = oklch(hex(opaque(heatAt(p, 0.5))))[2];
    assert.ok(d(hRoad, hHeat) >= 90, `${id}: road ${hRoad.toFixed(0)} vs heat mid ${hHeat.toFixed(0)}`);
  }
  // Ember's cream route and Magma's ice route: far in hue too.
  for (const id of ["ember", "magma"] as const) {
    const p = PALETTES[id];
    assert.ok(d(oklch(p.roadTint.motorway)[2], oklch(p.route.color)[2]) >= 90, id);
  }
});

// Salience = OKLab Delta E x100 from the land. At writing, heat midpoint /
// route / motorway: ember 38.0 / 67.8 / 28.4, magma 34.7 / 66.9 / 29.1,
// ice 40.1 / 65.1 / 28.9, hc 61.2 / 40.7 / 22.6, mono 44.6 / 74.4 / 18.2.
test("heat midpoint, route and live aircraft stay clearly louder than any road", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    const road = salience(p.roadTint.motorway);
    const heat = salience(opaque(heatAt(p, 0.5)));
    const route = salience(p.route.color);
    assert.ok(heat >= 1.15 * road, `${id}: heat ${heat.toFixed(1)} vs road ${road.toFixed(1)}`);
    assert.ok(route >= 1.75 * road, `${id}: route ${route.toFixed(1)} vs road ${road.toFixed(1)}`);
    assert.ok(
      contrast(p.route.color, BASEMAP.land) >= 1.5 * contrast(p.roadTint.motorway, BASEMAP.land),
      `${id}: route luminance contrast`,
    );
    // Live marker: the near-white glyph out-shouts every road, and the
    // marker (dark halo or glyph) still stands 3:1 off a motorway it
    // crosses, with the glyph 7:1 on its own disc.
    assert.ok(salience(LIVE_GLYPH.fill) >= 2.5 * road, `${id}: glyph`);
    const mw = p.roadTint.motorway;
    const disc = composite(p.live.halo, mw, p.live.haloOpacity);
    const marker = Math.max(contrast(disc, mw), contrast(LIVE_GLYPH.fill, mw));
    assert.ok(marker >= 3, `${id}: marker over motorway ${marker.toFixed(2)}`);
    assert.ok(contrast(LIVE_GLYPH.fill, disc) >= 7, `${id}: glyph on halo`);
  }
});

// Protan / deutan Delta E, road tint vs every opaque heat stop. Target 8,
// floor 6: legal here because roads and heat never share a mark (thin
// lines under a filled glow), the dataviz rule for the floor band.
// Worst at writing: ember 9.8, magma 6.4 (motorway vs the pink 0.55
// stop at the same lightness), ice 16.9, hc 14.4, mono 10.0. Normal
// vision floor 9.5 (Mono has no hue, so lightness alone: worst 10.0).
test("colour-blind check: road tints stay apart from every heat stop", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    for (const tier of ["motorway", "major"] as const) {
      const c = p.roadTint[tier];
      for (const [d, s] of p.heat.slice(1)) {
        const stop = hex(opaque(s));
        const cvd = cvdDeltaE(c, stop);
        assert.ok(cvd >= 6, `${id} ${tier} vs heat d${d}: cvd ${cvd.toFixed(1)}`);
        assert.ok(deltaE(c, stop) >= 9.5, `${id} ${tier} vs heat d${d}: normal ${deltaE(c, stop).toFixed(1)}`);
      }
    }
  }
});

test("road labels: legible on the land, quieter than the routes", () => {
  const cr = contrast(BASEMAP.label, BASEMAP.land);
  assert.ok(cr >= 3.5, `label ${cr.toFixed(2)}`);
  for (const id of PALETTE_IDS) {
    assert.ok(salience(BASEMAP.label) < salience(PALETTES[id].route.color) || id === "high-contrast", id);
  }
  assert.ok(oklch(BASEMAP.label)[1] < 0.005, "labels are neutral text, never the tint");
  assert.ok(L(BASEMAP.roadCasing) < L(BASEMAP.land), "casing a step darker than the land");
  assert.ok(contrast(BASEMAP.labelHalo, BASEMAP.label) >= 3.5);
});
