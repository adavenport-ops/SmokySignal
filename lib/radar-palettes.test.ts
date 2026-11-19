// Run: npx tsx --test lib/radar-palettes.test.ts
//
// Pins the rider-selectable radar palettes. Numbers are computed, never
// eyeballed: WCAG contrast, OKLCH lightness and OKLab Delta E (x100)
// with the Machado 2009 protan / deutan simulation, the same method as
// the dataviz palette validator the values were tuned with. Results at
// the time of writing are recorded inline so a regression shows its
// size.

import { test } from "node:test";
import assert from "node:assert";
import { BASEMAP, BASEMAP_PAINT } from "./basemap";
import { LIVE_GLYPH, isAlertGlyph, liveAircraftSvg } from "./brand/aircraft-glyphs";
import { composite, contrast, cvdDeltaE, deltaE, oklch, parseColor, toHex } from "./color-math";
import {
  DEFAULT_PALETTE,
  HIGH_CONTRAST_PALETTE,
  PALETTES,
  PALETTE_COOKIE,
  PALETTE_IDS,
  assignPaletteTailColors,
  getPalette,
  heatAt,
  heatGradientCss,
  heatSwatch,
  isPaletteId,
  opaque,
  paletteFromCookieHeader,
  parsePaletteCookie,
  resolvePalette,
  serializePaletteCookie,
} from "./radar-palettes";
import { HEAT_OPACITY_STOPS, evalZoomStops, stopsAreValid } from "./radar-zoom";
import { SS_TOKENS } from "./tokens";

const hex = (c: string) => toHex(parseColor(c));
const L = (c: string) => oklch(hex(c))[0];

// ─── shape ───────────────────────────────────────────────────────────

test("five palettes, Ember is the default", () => {
  assert.deepStrictEqual([...PALETTE_IDS], ["ember", "magma", "ice", "high-contrast", "mono"]);
  assert.strictEqual(DEFAULT_PALETTE, "ember");
  assert.strictEqual(HIGH_CONTRAST_PALETTE, "high-contrast");
});

test("every palette is complete", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    assert.strictEqual(p.id, id);
    assert.ok(p.label.length > 0 && p.description.length > 0, id);
    assert.ok(p.heat.length >= 4, `${id} heat stops`);
    assert.strictEqual(p.heat[0]![0], 0, `${id} heat starts at 0`);
    assert.strictEqual(parseColor(p.heat[0]![1])[3], 0, `${id} heat starts transparent`);
    assert.strictEqual(p.heat[p.heat.length - 1]![0], 1, `${id} heat ends at 1`);
    for (const [, c] of p.heat) parseColor(c);
    assert.match(p.route.color, /^#[0-9A-F]{6}$/i, `${id} route`);
    assert.ok(stopsAreValid(p.route.opacity), `${id} route opacity stops`);
    for (const [, o] of p.route.opacity) assert.ok(o > 0 && o <= 1, `${id} route opacity ${o}`);
    assert.strictEqual(p.history.tails.length, 6, `${id} history`);
    assert.strictEqual(new Set(p.history.tails.map((c) => c.toLowerCase())).size, 6, `${id} history distinct`);
    assert.ok(!p.history.tails.map((c) => c.toLowerCase()).includes(p.history.many.toLowerCase()), `${id} many`);
    for (const c of [...p.history.tails, p.history.many]) assert.match(c, /^#[0-9A-F]{6}$/i);
    assert.match(p.live.halo, /^#[0-9A-F]{6}$/i);
    assert.ok(p.live.haloOpacity > 0.5 && p.live.haloOpacity <= 1, `${id} halo opacity`);
  }
});

test("heat ramps rise in lightness with density, in visible steps", () => {
  for (const id of PALETTE_IDS) {
    const Ls = PALETTES[id].heat.slice(1).map(([, c]) => L(opaque(c)));
    for (let i = 1; i < Ls.length; i++) {
      assert.ok(Ls[i]! - Ls[i - 1]! >= 0.05, `${id} step ${i}: ${Ls[i - 1]!.toFixed(3)} -> ${Ls[i]!.toFixed(3)}`);
    }
    // Alpha rises too, so low density recedes into the basemap.
    const As = PALETTES[id].heat.map(([, c]) => parseColor(c)[3]);
    for (let i = 1; i < As.length; i++) assert.ok(As[i]! > As[i - 1]!, `${id} alpha ${i}`);
  }
});

test("getPalette falls back to Ember on junk", () => {
  assert.strictEqual(getPalette("magma").id, "magma");
  assert.strictEqual(getPalette("nope").id, "ember");
  assert.strictEqual(getPalette(null).id, "ember");
  assert.ok(isPaletteId("mono"));
  assert.ok(!isPaletteId("MONO"));
});

// ─── heat vs routes: lightness, not only hue ─────────────────────────

// Heat midpoint (density 0.5) vs route colour, OKLCH L, opaque.
// At writing: ember 0.36, magma 0.37, ice 0.27, high-contrast 0.20
// (route darker than the bright yellow heat), mono 0.30.
test("heat midpoint and route differ in lightness in every palette", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    const dl = Math.abs(L(p.route.color) - L(opaque(heatAt(p, 0.5))));
    assert.ok(dl >= 0.18, `${id}: |dL| ${dl.toFixed(3)}`);
  }
});

test("Ember is warm heat with pale routes; Ice keeps the old cool ramp", () => {
  const ember = PALETTES.ember;
  const hue = oklch(hex(opaque(heatAt(ember, 0.5))))[2];
  assert.ok(hue < 45 || hue > 345, `ember mid hue ${hue.toFixed(0)} reads red`);
  assert.ok(L(ember.route.color) > 0.85, "ember routes are pale");
  assert.deepStrictEqual(PALETTES.ice.heat, [
    [0, "rgba(0,0,0,0)"],
    [0.05, "rgba(72,74,170,0.16)"],
    [0.35, "rgba(70,110,215,0.38)"],
    [0.7, "rgba(64,190,210,0.52)"],
    [1.0, "rgba(205,240,255,0.65)"],
  ]);
  const mono = PALETTES.mono;
  for (const [, c] of mono.heat) assert.ok(oklch(hex(opaque(c)))[1] < 0.01, "mono heat carries no hue");
});

// ─── basemap contrast ────────────────────────────────────────────────

// Route colour vs basemap greys. At writing (land / water):
// ember 12.9/15.3, magma 12.7/15.0, ice 11.9/14.1, hc 4.7/5.6, mono 15.7/18.6.
test("route colours clear 3:1 on the basemap land and water", () => {
  for (const id of PALETTE_IDS) {
    const c = PALETTES[id].route.color;
    for (const g of [BASEMAP.land, BASEMAP.water]) {
      assert.ok(contrast(c, g) >= 3, `${id} route on ${g}: ${contrast(c, g).toFixed(2)}`);
    }
  }
});

// The thread as drawn: route colour at its zoom opacity, composited on
// the basemap. Worst case at writing: ember 3.27, magma 3.23, ice 3.10,
// hc 3.19, mono 3.71 (all at z9-12).
test("route threads clear 3:1 on the basemap at every zoom stop, as drawn", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    for (const [z, o] of p.route.opacity) {
      for (const g of [BASEMAP.land, BASEMAP.water]) {
        const r = contrast(composite(p.route.color, g, o), g);
        assert.ok(r >= 3, `${id} z${z} on ${g}: ${r.toFixed(2)}`);
      }
    }
  }
});

test("basemap is neutral: land and water greys carry no hue, water darker", () => {
  for (const c of [BASEMAP.land, BASEMAP.water, BASEMAP.road]) {
    assert.ok(oklch(c)[1] < 0.005, `${c} is grey`);
  }
  assert.ok(L(BASEMAP.water) < L(BASEMAP.land));
  assert.ok(L(BASEMAP.road) > L(BASEMAP.land), "roads lift off the land");
  assert.ok(BASEMAP_PAINT.some(([id]) => id === "Water"));
});

// ─── history colours ─────────────────────────────────────────────────

// Categorical checks on adjacent slots (the legend order), as the dataviz
// validator runs them: normal-vision Delta E >= 15 and protan / deutan
// Delta E >= 8, chroma >= 0.10, 3:1 on the land. History colours also
// stay clear of the palette's own heat and of alert / clear / sky.
test("history colours are distinct, CVD-safe and not the heat hues", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    const t = p.history.tails;
    for (let i = 1; i < t.length; i++) {
      assert.ok(deltaE(t[i - 1]!, t[i]!) >= 15, `${id} ${t[i - 1]} / ${t[i]} normal ${deltaE(t[i - 1]!, t[i]!).toFixed(1)}`);
      assert.ok(cvdDeltaE(t[i - 1]!, t[i]!) >= 8, `${id} ${t[i - 1]} / ${t[i]} cvd ${cvdDeltaE(t[i - 1]!, t[i]!).toFixed(1)}`);
    }
    for (const c of t) {
      assert.ok(oklch(c)[1] >= 0.1, `${id} ${c} chroma`);
      assert.ok(contrast(c, BASEMAP.land) >= 3, `${id} ${c} on land`);
      for (const [d, h] of p.heat.slice(1)) {
        assert.ok(deltaE(c, hex(opaque(h))) >= 10, `${id} ${c} too close to heat d${d}`);
      }
      for (const reserved of [SS_TOKENS.alert, SS_TOKENS.clear, SS_TOKENS.sky]) {
        assert.ok(deltaE(c, reserved) >= 10, `${id} ${c} too close to ${reserved}`);
      }
    }
  }
});

test("assignPaletteTailColors: one slot per tail up to six, then the many colour", () => {
  const p = PALETTES.magma;
  const a = assignPaletteTailColors(p, ["N305DK", "n2446x", "N305DK"], 6);
  assert.deepStrictEqual(a, { N2446X: p.history.tails[0], N305DK: p.history.tails[1] });
  const seven = assignPaletteTailColors(p, ["A1", "A2", "A3", "A4", "A5", "A6", "A7"], 6);
  assert.deepStrictEqual(new Set(Object.values(seven)), new Set([p.history.many]));
});

// ─── live aircraft ───────────────────────────────────────────────────

// Heat may be warm; the live marker must still stand out of it. Over
// every heat stop (at the heat layer's peak opacity, on land and water):
// glyph vs its own disc >= 7:1, and the marker (disc or glyph) >= 3:1
// against the heat around it. Worst glyph-on-disc at writing: 14.8
// (magma core); worst marker: ember d0.8, glyph 6.8 vs a 2.6 disc.
test("live halo keeps the glyph legible over every palette's heat", () => {
  const peak = Math.max(...HEAT_OPACITY_STOPS.map(([, v]) => v));
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    for (const z of [4, 8, 12, 16]) {
      const op = Math.max(peak, evalZoomStops(HEAT_OPACITY_STOPS, z));
      for (const [d, c] of p.heat) {
        for (const g of [BASEMAP.land, BASEMAP.water]) {
          const heat = composite(c, g, op);
          const disc = composite(p.live.halo, heat, p.live.haloOpacity);
          for (const fill of [LIVE_GLYPH.fill, LIVE_GLYPH.mutedFill]) {
            assert.ok(contrast(fill, disc) >= 7, `${id} d${d}: ${fill} on disc ${contrast(fill, disc).toFixed(2)}`);
            const marker = Math.max(contrast(disc, heat), contrast(fill, heat));
            assert.ok(marker >= 3, `${id} d${d}: marker ${marker.toFixed(2)}`);
          }
        }
      }
    }
  }
});

test("live glyphs are near-white; police and other missions stay distinguishable", () => {
  assert.ok(L(LIVE_GLYPH.fill) >= 0.98);
  assert.ok(L(LIVE_GLYPH.mutedFill) >= 0.8);
  assert.strictEqual(LIVE_GLYPH.alertRing, SS_TOKENS.alert, "police ring is alert orange");
  assert.ok(oklch(LIVE_GLYPH.neutralRing)[1] < 0.03, "other missions get a neutral ring");
  assert.ok(deltaE(LIVE_GLYPH.alertRing, LIVE_GLYPH.neutralRing) >= 15);
  assert.ok(cvdDeltaE(LIVE_GLYPH.alertRing, LIVE_GLYPH.neutralRing) >= 8);
  // Rings read against the halo disc they sit on.
  for (const id of PALETTE_IDS) {
    const disc = composite(PALETTES[id].live.halo, BASEMAP.land, PALETTES[id].live.haloOpacity);
    assert.ok(contrast(LIVE_GLYPH.alertRing, disc) >= 3, id);
    assert.ok(contrast(LIVE_GLYPH.neutralRing, disc) >= 3, id);
  }
  assert.ok(isAlertGlyph("smokey") && isAlertGlyph("patrol"));
  assert.ok(!isAlertGlyph("sar") && !isAlertGlyph("transport"));
  const police = liveAircraftSvg("smokey", { halo: "#0B0D10", haloOpacity: 0.8 });
  const other = liveAircraftSvg("transport", { halo: "#0B0D10", haloOpacity: 0.8 });
  assert.match(police, new RegExp(`stroke="${SS_TOKENS.alert}"`));
  assert.ok(!other.includes(SS_TOKENS.alert), "no alert orange on a non-police marker");
  assert.match(other, new RegExp(`stroke="${LIVE_GLYPH.neutralRing}"`));
});

// ─── UI helpers ──────────────────────────────────────────────────────

test("swatch and gradient come from the heat ramp", () => {
  for (const id of PALETTE_IDS) {
    const p = PALETTES[id];
    assert.match(heatSwatch(p), /^rgb\(\d+,\d+,\d+\)$/);
    // The HOT ZONES pill swatch must not read as alert orange.
    assert.ok(deltaE(hex(heatSwatch(p)), SS_TOKENS.alert) >= 10, `${id} swatch vs alert`);
    const g = heatGradientCss(p);
    assert.ok(g.startsWith("linear-gradient(90deg, "), id);
    assert.ok(g.endsWith("100%)"), id);
  }
});

// ─── cookie ──────────────────────────────────────────────────────────

test("cookie parse / serialize round-trips every palette", () => {
  for (const id of PALETTE_IDS) {
    const s = serializePaletteCookie(id);
    assert.ok(s.startsWith(`${PALETTE_COOKIE}=${id};`), s);
    assert.match(s, /Path=\//);
    assert.match(s, /Max-Age=31536000/);
    assert.match(s, /SameSite=Lax/);
    const value = s.split(";")[0]!.split("=")[1]!;
    assert.strictEqual(parsePaletteCookie(value), id);
    assert.strictEqual(paletteFromCookieHeader(`ss_contrast=high; ${s.split(";")[0]}; other=1`), id);
  }
});

test("cookie parse rejects junk and tolerates case and encoding", () => {
  assert.strictEqual(parsePaletteCookie(undefined), null);
  assert.strictEqual(parsePaletteCookie(""), null);
  assert.strictEqual(parsePaletteCookie("rainbow"), null);
  assert.strictEqual(parsePaletteCookie(" Magma "), "magma");
  assert.strictEqual(parsePaletteCookie("high%2Dcontrast"), "high-contrast");
  assert.strictEqual(paletteFromCookieHeader("a=1; b=2"), null);
  assert.strictEqual(paletteFromCookieHeader(null), null);
  assert.strictEqual(paletteFromCookieHeader("ss_palette_x=mono"), null);
});

test("high-contrast pref defaults to the High contrast palette until the rider picks", () => {
  assert.strictEqual(resolvePalette(null, "normal"), "ember");
  assert.strictEqual(resolvePalette(null, null), "ember");
  assert.strictEqual(resolvePalette(null, "high"), "high-contrast");
  assert.strictEqual(resolvePalette("magma", "high"), "magma");
  assert.strictEqual(resolvePalette("ice", "normal"), "ice");
});
