// Run: npx tsx --test lib/feed-merge.test.ts
//
// Merge precedence: freshest fix supplies the position as one unit,
// missing fields fill from the other feeds, `sources` lists every feed.

import { test } from "node:test";
import assert from "node:assert";
import { mergeByHex } from "./feed-merge";
import { describeSource, parseSources, summarizeSources } from "./feed-sources";
import { normalizeAdsbFi } from "./feeds/adsbfi";
import { normalizeAdsbLol } from "./feeds/adsblol";
import fiFixture from "./feeds/fixtures/adsbfi-point.json";
import lolFixture from "./feeds/fixtures/adsblol-point.json";
import type { NormalizedAc } from "./types";

const T = 1_795_059_348_000;

test("real fixtures: union by hex, fresher adsb.fi fix wins the shared hex", () => {
  const fi = normalizeAdsbFi(fiFixture, 0);
  const lol = normalizeAdsbLol(lolFixture, 0);
  const merged = mergeByHex([fi, lol]);
  // fi has 4 rows, lol 2, both shared: union is 4.
  assert.equal(merged.length, 4);
  const shared = merged.find((a) => a.hex === "71bc36")!;
  // fi answered at ...348.002 s, lol at ...346.001 s: fi's fix is ~2 s newer.
  assert.equal(shared.src, "fi");
  assert.equal(shared.lat, 49.411104);
  assert.deepEqual(shared.sources, ["fi", "lol"]);
  const grounded = merged.find((a) => a.hex === "a76d90")!;
  assert.deepEqual(grounded.sources, ["fi"]);
  assert.equal(grounded.alt_baro, "ground");
});

test("newer pos_ts wins even from a lower-priority feed", () => {
  const [m] = mergeByHex([
    [{ hex: "abc123", src: "fi", lat: 1, lon: 1, pos_ts: T - 5000, seen_pos: 5 }],
    [{ hex: "abc123", src: "lol", lat: 2, lon: 2, pos_ts: T - 1000, seen_pos: 1 }],
  ]);
  assert.equal(m!.src, "lol");
  assert.equal(m!.lat, 2);
  assert.equal(m!.lon, 2);
  assert.deepEqual(m!.sources, ["fi", "lol"]);
});

test("without pos_ts, smaller seen_pos wins; full tie goes to feed order", () => {
  const [bySeen] = mergeByHex([
    [{ hex: "abc123", src: "fi", lat: 1, lon: 1, seen_pos: 9 }],
    [{ hex: "abc123", src: "lol", lat: 2, lon: 2, seen_pos: 0.5 }],
  ]);
  assert.equal(bySeen!.src, "lol");

  const [tie] = mergeByHex([
    [{ hex: "abc123", src: "lol", lat: 2, lon: 2, pos_ts: T }],
    [{ hex: "abc123", src: "fi", lat: 1, lon: 1, pos_ts: T }],
  ]);
  assert.equal(tie!.src, "fi");
});

test("a row with a position beats a fresher row without one", () => {
  const [m] = mergeByHex([
    [{ hex: "abc123", src: "fi", alt_baro: 3000, squawk: "1200" }],
    [{ hex: "abc123", src: "lol", lat: 2, lon: 2, pos_ts: T - 60_000 }],
  ]);
  assert.equal(m!.src, "lol");
  assert.equal(m!.lat, 2);
  // Missing fields fill from the other feed.
  assert.equal(m!.alt_baro, 3000);
  assert.equal(m!.squawk, "1200");
});

test("missing fields fill from the other feeds, freshest first; position never mixes", () => {
  const rows: NormalizedAc[][] = [
    [{ hex: "abc123", src: "fi", lat: 1, lon: 1, pos_ts: T - 3000, gs: 100, r: "N123" }],
    [{ hex: "abc123", src: "lol", lat: 2, lon: 2, pos_ts: T, track: 90 }],
    [{ hex: "abc123", src: "apl", lat: 3, lon: 3, pos_ts: T - 1000, gs: 120, squawk: "4672" }],
  ];
  const [m] = mergeByHex(rows);
  assert.equal(m!.src, "lol");
  assert.equal(m!.lat, 2);
  assert.equal(m!.lon, 2);
  assert.equal(m!.pos_ts, T);
  assert.equal(m!.track, 90);
  assert.equal(m!.gs, 120, "apl's fix is fresher than fi's, so its gs fills first");
  assert.equal(m!.squawk, "4672");
  assert.equal(m!.r, "N123");
  assert.deepEqual(m!.sources, ["fi", "lol", "apl"]);
});

test("hex match is case-insensitive and output keeps first-appearance order", () => {
  const out = mergeByHex([
    [{ hex: "AAAAAA", src: "fi" }, { hex: "bbbbbb", src: "fi" }],
    [{ hex: "cccccc", src: "lol" }, { hex: "aaaaaa", src: "lol" }],
  ]);
  assert.deepEqual(
    out.map((a) => a.hex),
    ["aaaaaa", "bbbbbb", "cccccc"],
  );
  assert.deepEqual(out[0]!.sources, ["fi", "lol"]);
});

test("source summary: canonical order, readable label, legacy values", () => {
  assert.equal(summarizeSources(["lol", "fi"]), "fi+lol");
  assert.equal(summarizeSources([]), "none");
  assert.deepEqual(parseSources("fi+lol+apl"), ["fi", "lol", "apl"]);
  assert.deepEqual(parseSources("adsbfi"), ["fi"]);
  const d = describeSource("fi+lol");
  assert.equal(d.label, "FI+LOL");
  assert.match(d.detail, /FI = adsb\.fi\. LOL = adsb\.lol\./);
  assert.equal(describeSource("adsbfi").label, "ADSBFI");
  assert.equal(describeSource("mock").label, "MOCK");
  assert.equal(describeSource("os").label, "OS", "legacy tag degrades to a plain label");
  for (const s of ["fi+lol", "adsbfi", "mock", "none", "os"]) {
    const { label, detail } = describeSource(s);
    assert.ok(!/!/.test(label + detail), "no exclamation marks");
  }
});
