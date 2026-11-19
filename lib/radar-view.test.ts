// Run: npx tsx --test lib/radar-view.test.ts
//
// Pins the /radar camera presets: the region picker fits the map to a
// box and never filters data, so the boxes and fit math are the whole
// contract.

import { test } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_RADAR_VIEW,
  RADAR_VIEW_LABEL,
  RADAR_VIEW_ORDER,
  boundsForView,
  extentOfPoints,
  fitPadding,
  isRadarViewId,
  toLngLatBounds,
  unionBounds,
} from "./radar-view";
import {
  REGIONS,
  TRACKING_ENVELOPE,
  WA_STATE_BBOX,
  inTrackingEnvelope,
} from "./regions";

test("Puget Sound is the default camera for a new visitor", () => {
  assert.strictEqual(DEFAULT_RADAR_VIEW, "puget_sound");
});

test("picker leads with the three asked-for presets and ends with Everything", () => {
  assert.deepStrictEqual(RADAR_VIEW_ORDER.slice(0, 3), [
    "puget_sound",
    "all_wa",
    "east_wa",
  ]);
  assert.strictEqual(RADAR_VIEW_ORDER[RADAR_VIEW_ORDER.length - 1], "everything");
  assert.strictEqual(RADAR_VIEW_LABEL.all_wa, "All of Washington");
  assert.strictEqual(RADAR_VIEW_LABEL.east_wa, "Eastern Washington");
  assert.strictEqual(RADAR_VIEW_LABEL.everything, "Everything");
  // Every region (so saved prefs keep working) plus everything.
  for (const id of Object.keys(REGIONS)) {
    assert.ok(RADAR_VIEW_ORDER.includes(id as never), `missing ${id}`);
  }
  assert.strictEqual(new Set(RADAR_VIEW_ORDER).size, RADAR_VIEW_ORDER.length);
});

test("labels carry no exclamation marks", () => {
  for (const l of Object.values(RADAR_VIEW_LABEL)) assert.ok(!l.includes("!"));
});

test("isRadarViewId accepts regions + everything, rejects junk", () => {
  assert.ok(isRadarViewId("puget_sound"));
  assert.ok(isRadarViewId("everything"));
  assert.ok(!isRadarViewId("custom"));
  assert.ok(!isRadarViewId("pierce"));
  assert.ok(!isRadarViewId("__proto__"));
  assert.ok(!isRadarViewId(42));
});

test("region views fit their bbox", () => {
  const ew = REGIONS.east_wa.bbox!;
  assert.deepStrictEqual(boundsForView("east_wa"), {
    west: ew.lonMin,
    south: ew.latMin,
    east: ew.lonMax,
    north: ew.latMax,
  });
});

test("Puget Sound camera box is the Olympia-Everett core, inside the data bbox", () => {
  const ps = REGIONS.puget_sound.bbox!;
  const cam = boundsForView("puget_sound");
  assert.ok(cam.north < ps.latMax && cam.south >= ps.latMin - 0.05);
  // Olympia, Tacoma, Seattle, Everett all in frame.
  for (const [lat, lon] of [
    [47.04, -122.9],
    [47.25, -122.44],
    [47.61, -122.33],
    [47.98, -122.2],
  ] as const) {
    assert.ok(
      lat >= cam.south && lat <= cam.north && lon >= cam.west && lon <= cam.east,
      `${lat},${lon}`,
    );
  }
});

test("every view yields a well-formed box", () => {
  for (const id of RADAR_VIEW_ORDER) {
    const b = boundsForView(id);
    assert.ok(b.west < b.east && b.south < b.north, id);
  }
});

test("All of Washington fits the state outline, not a null box", () => {
  const b = boundsForView("all_wa");
  assert.strictEqual(b.west, WA_STATE_BBOX.lonMin);
  assert.strictEqual(b.north, WA_STATE_BBOX.latMax);
});

test("Everything is the data extent, never smaller than the state", () => {
  const noData = boundsForView("everything", null);
  assert.deepStrictEqual(noData, boundsForView("all_wa"));
  // Oregon + Idaho mutual-aid data widens it.
  const withData = boundsForView("everything", {
    west: -123.0,
    south: 44.2,
    east: -115.5,
    north: 48.0,
  });
  assert.strictEqual(withData.south, 44.2);
  assert.strictEqual(withData.east, -115.5);
  assert.strictEqual(withData.north, WA_STATE_BBOX.latMax);
  assert.strictEqual(withData.west, WA_STATE_BBOX.lonMin);
});

test("unionBounds handles nulls and widens", () => {
  const a = { west: -122, south: 47, east: -121, north: 48 };
  const b = { west: -120, south: 46, east: -119, north: 47.5 };
  assert.strictEqual(unionBounds(null, null), null);
  assert.deepStrictEqual(unionBounds(a, null), a);
  assert.deepStrictEqual(unionBounds(null, b), b);
  assert.deepStrictEqual(unionBounds(a, b), {
    west: -122,
    south: 46,
    east: -119,
    north: 48,
  });
});

test("extentOfPoints skips non-finite and returns null when empty", () => {
  assert.strictEqual(extentOfPoints([]), null);
  assert.strictEqual(extentOfPoints([[NaN, 47]]), null);
  assert.deepStrictEqual(
    extentOfPoints([
      [-122.3, 47.6],
      [-117.4, 47.7],
      [Infinity, 10],
      [-120.5, 46.6],
    ]),
    { west: -122.3, south: 46.6, east: -117.4, north: 47.7 },
  );
});

test("toLngLatBounds is [[west, south], [east, north]]", () => {
  assert.deepStrictEqual(
    toLngLatBounds({ west: -1, south: 2, east: 3, north: 4 }),
    [
      [-1, 2],
      [3, 4],
    ],
  );
});

test("fitPadding passes insets through on a roomy viewport", () => {
  const insets = { top: 76, bottom: 138, left: 16, right: 16 };
  assert.deepStrictEqual(fitPadding(1440, 900, insets), insets);
});

test("fitPadding scales down so the box keeps 40% of a short viewport", () => {
  const p = fitPadding(390, 300, { top: 76, bottom: 268, left: 16, right: 16 });
  assert.ok(p.top + p.bottom <= 300 * 0.6 + 1, JSON.stringify(p));
  // Proportions survive the scale.
  assert.ok(p.bottom > p.top);
  assert.strictEqual(p.left, 16);
});

test("fitPadding never goes negative on a zero-size container", () => {
  const p = fitPadding(0, 0, { top: 76, bottom: 138, left: 16, right: 16 });
  for (const v of Object.values(p)) assert.ok(v >= 0);
});

test("tracking envelope keeps WA, OR and ID border points, drops noise", () => {
  assert.ok(inTrackingEnvelope(47.6, -122.3)); // Seattle
  assert.ok(inTrackingEnvelope(45.52, -122.68)); // Portland
  assert.ok(inTrackingEnvelope(44.06, -121.31)); // Bend
  assert.ok(inTrackingEnvelope(47.68, -116.78)); // Coeur d'Alene
  assert.ok(inTrackingEnvelope(43.62, -116.2)); // Boise
  assert.ok(!inTrackingEnvelope(34.05, -118.24)); // Los Angeles
  assert.ok(!inTrackingEnvelope(40.71, -74.0)); // New York
  assert.ok(!inTrackingEnvelope(NaN, -122));
  // Envelope contains the whole state box.
  assert.ok(TRACKING_ENVELOPE.latMin < WA_STATE_BBOX.latMin);
  assert.ok(TRACKING_ENVELOPE.lonMax > WA_STATE_BBOX.lonMax);
});
