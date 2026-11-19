// Run: npx tsx --test lib/distance-rings.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { RING_MILES, milesToDegLat, ringCoords, ringFeatures, ringLabel } from "./distance-rings";

// Great-circle distance in statute miles.
function miles(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

test("rings are statute miles and labelled in miles", () => {
  assert.deepStrictEqual([...RING_MILES], [5, 10, 15]);
  assert.strictEqual(ringLabel(5), "5 mi");
  // 1 mile is ~0.01447 degrees of latitude.
  assert.ok(Math.abs(milesToDegLat(1) - 0.014483) < 0.0001);
});

test("every ring point sits its radius from the rider", () => {
  const c: [number, number] = [-122.354, 47.2379];
  for (const mi of RING_MILES) {
    const pts = ringCoords(c[1], c[0], mi);
    assert.deepStrictEqual(pts[0], pts[pts.length - 1], "closed ring");
    for (const p of pts) assert.ok(Math.abs(miles(c, p) - mi) / mi < 0.01, `${mi} mi ring off at ${p}`);
  }
});

test("one line and one north-edge label per ring; nothing without a position", () => {
  assert.strictEqual(ringFeatures(null).features.length, 0);
  const fc = ringFeatures({ lat: 47.6, lon: -122.3 });
  const labels = fc.features.filter((f) => f.properties?.label);
  assert.deepStrictEqual(labels.map((f) => f.properties?.label), ["5 mi", "10 mi", "15 mi"]);
  assert.strictEqual(fc.features.filter((f) => f.geometry.type === "LineString").length, 3);
  for (const f of labels) {
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
    assert.strictEqual(lon, -122.3);
    assert.ok((lat ?? 0) > 47.6);
  }
});
