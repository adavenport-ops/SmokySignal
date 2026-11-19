// Run: npx tsx --test lib/label-declutter.test.ts
//
// Pins the 3D label decluttering: collision (boxes in, visible ids out),
// merging repeated orbits, the multi-path label selection and airport tags.

import { test } from "node:test";
import assert from "node:assert";
import {
  mergeFields,
  nudgeX,
  mergeOrbits,
  placeLabels,
  selectMultiPathLabels,
  selectSinglePathLabels,
  singleLabelText,
  summaryLabelText,
  textBox,
  type LabelBox,
  type OrbitInput,
} from "./label-declutter";

const box = (id: string, x: number, y: number, priority: number, w = 100, h = 30): LabelBox => ({ id, x, y, w, h, priority });
const orbit = (pathId: string, corridor: string | undefined, durationS: number, lat = 47.2, lon = -122.4): OrbitInput => ({
  pathId,
  corridor,
  durationS,
  lat,
  lon,
  altFt: 2500,
  radiusNm: 0.8,
});

test("placeLabels keeps everything that does not overlap", () => {
  const v = placeLabels([box("a", 0, 0, 1), box("b", 200, 0, 1), box("c", 0, 100, 1)]);
  assert.deepStrictEqual([...v].sort(), ["a", "b", "c"]);
});

test("placeLabels hides the lower-priority box of an overlapping pair", () => {
  const v = placeLabels([box("short", 10, 10, 5), box("long", 0, 0, 50)]);
  assert.deepStrictEqual([...v], ["long"]);
});

test("placeLabels is order independent for different priorities", () => {
  const a = placeLabels([box("x", 0, 0, 1), box("y", 20, 5, 9)]);
  const b = placeLabels([box("y", 20, 5, 9), box("x", 0, 0, 1)]);
  assert.deepStrictEqual([...a], ["y"]);
  assert.deepStrictEqual([...b], ["y"]);
});

test("placeLabels: a hidden box does not hide others it would have overlapped", () => {
  // a beats b; b overlaps a (hidden); c overlaps only b, so c stays.
  const v = placeLabels([box("a", 0, 0, 9), box("b", 90, 0, 5), box("c", 180, 0, 1)]);
  assert.deepStrictEqual([...v].sort(), ["a", "c"]);
});

test("placeLabels keeps a gap between neighbours", () => {
  const touching = placeLabels([box("a", 0, 0, 2), box("b", 101, 0, 1)]);
  assert.deepStrictEqual([...touching], ["a"]);
  const clear = placeLabels([box("a", 0, 0, 2), box("b", 110, 0, 1)]);
  assert.deepStrictEqual([...clear].sort(), ["a", "b"]);
});

test("placeLabels breaks priority ties by input order", () => {
  assert.deepStrictEqual([...placeLabels([box("first", 0, 0, 1), box("second", 5, 5, 1)])], ["first"]);
});

test("placeLabels handles an empty list", () => {
  assert.strictEqual(placeLabels([]).size, 0);
});

test("placeLabels hides labels under an obstacle (controls column) whatever their priority", () => {
  const controls = { x: 300, y: 0, w: 50, h: 200 };
  const v = placeLabels([box("under", 280, 40, 99), box("clear", 100, 40, 1)], [controls]);
  assert.deepStrictEqual([...v], ["clear"]);
});

test("placeLabels: an obstacle-hidden label does not hide a neighbour", () => {
  const v = placeLabels([box("under", 280, 40, 99), box("next", 200, 40, 1)], [{ x: 300, y: 0, w: 50, h: 200 }]);
  assert.deepStrictEqual([...v], ["next"]);
});

test("textBox grows with text and lines", () => {
  const one = textBox("abc");
  const two = textBox("abc\nabcdefgh");
  assert.ok(two.w > one.w && two.h > one.h);
});

test("mergeOrbits folds repeats at one corridor + place", () => {
  const g = mergeOrbits([orbit("a", "I-5 · Fife", 600), orbit("a", "I-5 · Fife", 720), orbit("a", "SR-16 · Gig Harbor", 300)]);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0]!.corridor, "I-5 · Fife");
  assert.strictEqual(g[0]!.count, 2);
  assert.strictEqual(g[0]!.totalS, 1320);
  assert.strictEqual(g[0]!.anchor.durationS, 720);
});

test("mergeOrbits without a corridor merges only nearby orbits", () => {
  const near = mergeOrbits([orbit("a", undefined, 100, 47.2, -122.4), orbit("a", undefined, 100, 47.2005, -122.4005)]);
  assert.strictEqual(near.length, 1);
  const far = mergeOrbits([orbit("a", undefined, 100, 47.2, -122.4), orbit("a", undefined, 100, 47.6, -122.0)]);
  assert.strictEqual(far.length, 2);
});

test("label text: single, merged and summary", () => {
  const [one] = mergeOrbits([orbit("a", "I-5 · Fife", 780)]);
  assert.strictEqual(singleLabelText(one!), "Worked a pattern\nI-5 · Fife · 13 min");
  const [two] = mergeOrbits([orbit("a", "I-5 · Fife", 600), orbit("a", "I-5 · Fife", 720)]);
  assert.strictEqual(singleLabelText(two!), "I-5 · Fife\n2 patterns, 22 min");
  const six = mergeOrbits(Array.from({ length: 6 }, (_, i) => orbit(`f${i}`, "I-5 · Fife", 720)));
  assert.strictEqual(summaryLabelText(six[0]!), "I-5 · Fife · 6 patterns · 1h 12m");
  const [none] = mergeOrbits([orbit("a", undefined, 600), orbit("a", undefined, 600)]);
  assert.strictEqual(singleLabelText(none!), "2 patterns, 20 min");
});

test("selectSinglePathLabels labels every merged group", () => {
  const l = selectSinglePathLabels([orbit("a", "I-5 · Fife", 600), orbit("a", "I-5 · Fife", 600), orbit("a", "SR-16 · Gig Harbor", 300)]);
  assert.strictEqual(l.length, 2);
  assert.ok(l.every((x) => !x.selected));
});

test("selectMultiPathLabels: at most 3 overall, deduped by place", () => {
  const orbits = [
    ...Array.from({ length: 6 }, (_, i) => orbit(`f${i}`, "I-5 · Fife", 720)),
    ...Array.from({ length: 3 }, (_, i) => orbit(`g${i}`, "SR-16 · Gig Harbor", 600)),
    orbit("h", "I-90 · Issaquah", 500),
    orbit("h", "SR-18 · Auburn", 400),
    orbit("h", "SR-167 · Kent", 300),
  ];
  const l = selectMultiPathLabels(orbits, null);
  assert.strictEqual(l.length, 3);
  assert.deepStrictEqual(
    l.map((x) => x.group.corridor),
    ["I-5 · Fife", "SR-16 · Gig Harbor", "I-90 · Issaquah"],
  );
  assert.strictEqual(l[0]!.text, "I-5 · Fife · 6 patterns · 1h 12m");
  assert.strictEqual(new Set(l.map((x) => x.group.key)).size, l.length);
});

test("selectMultiPathLabels adds the selected flight's orbits and skips duplicates", () => {
  const orbits = [
    orbit("f1", "I-5 · Fife", 720),
    orbit("f2", "I-5 · Fife", 720),
    orbit("f2", "SR-512 · Puyallup", 120),
    orbit("f3", "I-90 · Issaquah", 900),
  ];
  const l = selectMultiPathLabels(orbits, "f2");
  const sel = l.filter((x) => x.selected);
  assert.deepStrictEqual(sel.map((x) => x.group.corridor).sort(), ["I-5 · Fife", "SR-512 · Puyallup"]);
  // I-5 is labelled once (as the selected flight's), not again as a top label.
  assert.strictEqual(l.filter((x) => x.group.corridor === "I-5 · Fife").length, 1);
  assert.strictEqual(l.filter((x) => !x.selected).length, 1);
  assert.strictEqual(l.length, 3);
});

test("selectMultiPathLabels with nothing to label", () => {
  assert.deepStrictEqual(selectMultiPathLabels([], "x"), []);
});

test("mergeFields: same airport DEP and ARR is one label", () => {
  const f = mergeFields([
    { id: "KOLM", lat: 46.97, lon: -122.9, tag: "DEP" },
    { id: "KOLM", lat: 46.97, lon: -122.9, tag: "ARR" },
  ]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0]!.text, "KOLM · DEP/ARR");
});

test("mergeFields keeps DEP before ARR whatever the input order", () => {
  const f = mergeFields([
    { id: "KOLM", lat: 0, lon: 0, tag: "ARR" },
    { id: "KOLM", lat: 0, lon: 0, tag: "DEP" },
    { id: "KPWT", lat: 1, lon: 1, tag: "ARR" },
  ]);
  assert.deepStrictEqual(f.map((x) => x.text), ["KOLM · DEP/ARR", "KPWT · ARR"]);
});

test("nudgeX leaves a clear label alone", () => {
  assert.strictEqual(nudgeX({ x: 50, y: 50, w: 100, h: 30 }, [{ x: 300, y: 0, w: 50, h: 200 }], { w: 400, h: 400 }), 0);
});

test("nudgeX slides a label left from under the controls column", () => {
  const dx = nudgeX({ x: 230, y: 50, w: 100, h: 30 }, [{ x: 300, y: 0, w: 50, h: 200 }], { w: 400, h: 400 });
  assert.ok(dx < 0);
  assert.ok(230 + dx + 100 <= 300);
});

test("nudgeX pulls a label clipped by the left edge back into the frame", () => {
  assert.strictEqual(nudgeX({ x: -30, y: 50, w: 100, h: 30 }, [], { w: 400, h: 400 }), 34);
});

test("nudgeX ignores obstacles that are above or below the label", () => {
  assert.strictEqual(nudgeX({ x: 230, y: 300, w: 100, h: 30 }, [{ x: 300, y: 0, w: 50, h: 200 }], { w: 400, h: 400 }), 0);
});

test("placeLabels keeps a label nudged clear of an obstacle", () => {
  const ob = { x: 300, y: 0, w: 50, h: 200 };
  const b = box("edge", 230, 50, 5);
  const dx = nudgeX(b, [ob], { w: 400, h: 400 });
  assert.deepStrictEqual([...placeLabels([{ ...b, x: b.x + dx }], [ob])], ["edge"]);
});
