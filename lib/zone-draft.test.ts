// Run: npx tsx --test lib/zone-draft.test.ts
import { test } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_ZONE_RADIUS_MI,
  ZONE_FALLBACK_NAME,
  ZONE_RADII_MI,
  ZONE_UNDO_MS,
  canSaveZone,
  defaultZoneName,
  formatZoneCoords,
  formatZoneRadius,
  initialZoneDraft,
  miToNm,
  nmToMi,
  zoneDraftReducer,
  zoneInputFromDraft,
  zonePlaceName,
  zoneRadiusMi,
  zoneToRemoveOnUndo,
  zoneUndoReducer,
  type ZoneUndo,
} from "./zone-draft";

const FIFE = { lat: 47.2379, lon: -122.354 };
const SEATTLE = { lat: 47.6062, lon: -122.3321 };

test("a zone is named after the nearest place", () => {
  assert.strictEqual(zonePlaceName(FIFE.lat, FIFE.lon), "Fife");
  assert.strictEqual(zonePlaceName(SEATTLE.lat, SEATTLE.lon), "Seattle");
});

test("far from any place, the region names it; nothing at all falls back", () => {
  assert.strictEqual(zonePlaceName(46.0, -119.5), "Central WA");
  assert.strictEqual(zonePlaceName(Number.NaN, 0), null);
  assert.strictEqual(defaultZoneName(Number.NaN, Number.NaN, []), ZONE_FALLBACK_NAME);
});

test("a second zone by the same place gets a number", () => {
  assert.strictEqual(defaultZoneName(FIFE.lat, FIFE.lon, []), "Fife");
  assert.strictEqual(defaultZoneName(FIFE.lat, FIFE.lon, ["fife"]), "Fife 2");
  assert.strictEqual(defaultZoneName(FIFE.lat, FIFE.lon, ["Fife", "Fife 2"]), "Fife 3");
});

test("radius chips are 2, 5 and 10 mi, 5 by default, stored in nm", () => {
  assert.deepStrictEqual([...ZONE_RADII_MI], [2, 5, 10]);
  assert.strictEqual(DEFAULT_ZONE_RADIUS_MI, 5);
  assert.ok(Math.abs(miToNm(5) - 4.345) < 0.001);
  assert.ok(Math.abs(nmToMi(miToNm(10)) - 10) < 1e-9);
  // Old zones only carry nm: 5 nm reads as 6 mi.
  assert.strictEqual(zoneRadiusMi({ radiusNm: 5 }), 6);
  assert.strictEqual(formatZoneRadius({ radiusNm: 4.345, radiusMi: 5 }), "5 mi");
  assert.strictEqual(formatZoneRadius({ radiusNm: 0.2 }), "1 mi");
  assert.strictEqual(formatZoneCoords(47.23791, -122.35402), "47.238, -122.354");
});

test("draft: GPS start, radius pick, save input", () => {
  let d = initialZoneDraft(FIFE);
  assert.strictEqual(d.name, "Fife");
  assert.strictEqual(d.radiusMi, 5);
  assert.ok(canSaveZone(d));
  d = zoneDraftReducer(d, { type: "radius", radiusMi: 10 });
  assert.strictEqual(d.radiusMi, 10);
  // Not a chip value: ignored.
  d = zoneDraftReducer(d, { type: "radius", radiusMi: 7 as never });
  assert.strictEqual(d.radiusMi, 10);
  const input = zoneInputFromDraft(d);
  assert.ok(input);
  assert.strictEqual(input.label, "Fife");
  assert.strictEqual(input.place, "Fife");
  assert.strictEqual(input.radiusMi, 10);
  assert.ok(Math.abs(input.radiusNm - 8.69) < 0.01);
});

test("draft: no location yet means no save until a pin drops", () => {
  let d = initialZoneDraft(null);
  assert.strictEqual(d.point, null);
  assert.strictEqual(d.name, "");
  assert.ok(!canSaveZone(d));
  assert.strictEqual(zoneInputFromDraft(d), null);
  d = zoneDraftReducer(d, { type: "start-pin" });
  assert.ok(d.placing);
  assert.ok(!canSaveZone(d), "can't save while waiting for the tap");
  d = zoneDraftReducer(d, { type: "drop-pin", point: SEATTLE });
  assert.strictEqual(d.source, "pin");
  assert.strictEqual(d.placing, false);
  assert.strictEqual(d.name, "Seattle");
  assert.ok(canSaveZone(d));
});

test("draft: the name follows the point until the rider types one", () => {
  let d = initialZoneDraft(FIFE);
  d = zoneDraftReducer(d, { type: "drop-pin", point: SEATTLE });
  assert.strictEqual(d.name, "Seattle");
  d = zoneDraftReducer(d, { type: "rename", name: "Home" });
  d = zoneDraftReducer(d, { type: "use-location", point: FIFE });
  assert.strictEqual(d.name, "Home");
  assert.strictEqual(zoneInputFromDraft(d)?.label, "Home");
  // Clearing the field hands naming back to the place.
  d = zoneDraftReducer(d, { type: "rename", name: "  " });
  d = zoneDraftReducer(d, { type: "drop-pin", point: SEATTLE });
  assert.strictEqual(d.name, "Seattle");
});

test("undo: inside the window removes the zone, after it does nothing", () => {
  const t0 = 1_000_000;
  let s: ZoneUndo = { kind: "idle" };
  s = zoneUndoReducer(s, { type: "added", zoneId: "z1", name: "Fife", radiusMi: 5, now: t0 });
  assert.strictEqual(s.kind, "added");
  assert.strictEqual(s.kind === "added" && s.text, "Zone added: Fife, 5 mi");
  assert.strictEqual(zoneToRemoveOnUndo(s, t0 + 1000), "z1");
  const undone = zoneUndoReducer(s, { type: "undo", now: t0 + 1000 });
  assert.strictEqual(undone.kind, "undone");
  // A second undo is a no-op.
  assert.strictEqual(zoneToRemoveOnUndo(undone, t0 + 1100), null);
  // Too late.
  assert.strictEqual(zoneToRemoveOnUndo(s, t0 + ZONE_UNDO_MS + 1), null);
  assert.strictEqual(zoneUndoReducer(s, { type: "undo", now: t0 + ZONE_UNDO_MS + 1 }), s);
  // The toast clears itself.
  assert.strictEqual(zoneUndoReducer(s, { type: "tick", now: t0 + 10 }).kind, "added");
  assert.strictEqual(zoneUndoReducer(s, { type: "tick", now: t0 + ZONE_UNDO_MS }).kind, "idle");
});
