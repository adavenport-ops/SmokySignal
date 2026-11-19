// Run: npx tsx --test lib/embed.test.ts
//
// Pins the /embed param parser, the iframe snippet and the regional
// snapshot filter behind /api/status.json?region=.

import { test } from "node:test";
import assert from "node:assert";
import {
  EMBED_HEIGHT,
  embedDisplay,
  embedQuery,
  embedRegionOptions,
  embedSnippet,
  parseEmbedParams,
  parseEmbedRegion,
  parseEmbedTheme,
  restrictSnapshotToRegion,
} from "./embed";
import type { Aircraft, Snapshot } from "./types";

test("parseEmbedTheme: compact is the default, card is opt-in", () => {
  assert.strictEqual(parseEmbedTheme(undefined), "compact");
  assert.strictEqual(parseEmbedTheme(""), "compact");
  assert.strictEqual(parseEmbedTheme("compact"), "compact");
  assert.strictEqual(parseEmbedTheme("card"), "card");
  assert.strictEqual(parseEmbedTheme("CARD"), "card");
  assert.strictEqual(parseEmbedTheme(" card "), "card");
  assert.strictEqual(parseEmbedTheme("giant"), "compact");
  assert.strictEqual(parseEmbedTheme(["card", "compact"]), "card");
});

test("parseEmbedRegion: known ids pass, all_wa and junk mean whole state", () => {
  assert.strictEqual(parseEmbedRegion("puget_sound"), "puget_sound");
  assert.strictEqual(parseEmbedRegion("east_wa"), "east_wa");
  assert.strictEqual(parseEmbedRegion("all_wa"), null);
  assert.strictEqual(parseEmbedRegion("narnia"), null);
  assert.strictEqual(parseEmbedRegion(undefined), null);
  assert.strictEqual(parseEmbedRegion(null), null);
  assert.strictEqual(parseEmbedRegion(""), null);
});

test("parseEmbedRegion: prototype keys are not regions", () => {
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.strictEqual(parseEmbedRegion(k), null, k);
  }
});

test("parseEmbedParams: reads both knobs", () => {
  assert.deepStrictEqual(parseEmbedParams({}), { region: null, theme: "compact" });
  assert.deepStrictEqual(
    parseEmbedParams({ region: "olympic", theme: "card" }),
    { region: "olympic", theme: "card" },
  );
});

test("embedQuery: omits defaults, round-trips through the parser", () => {
  assert.strictEqual(embedQuery({ region: null, theme: "compact" }), "");
  assert.strictEqual(embedQuery({ region: "olympic", theme: "compact" }), "?region=olympic");
  assert.strictEqual(
    embedQuery({ region: "puget_sound", theme: "card" }),
    "?region=puget_sound&theme=card",
  );
  const q = new URLSearchParams(embedQuery({ region: "sw_wa", theme: "card" }));
  assert.deepStrictEqual(
    parseEmbedParams({ region: q.get("region"), theme: q.get("theme") }),
    { region: "sw_wa", theme: "card" },
  );
});

test("embedSnippet: iframe with src, title, theme height, no trailing slash", () => {
  const s = embedSnippet("https://smokysignal.app/", { region: "puget_sound", theme: "card" });
  assert.match(s, /^<iframe/);
  assert.match(s, /src="https:\/\/smokysignal\.app\/embed\?region=puget_sound&theme=card"/);
  assert.match(s, /title="SmokySignal status"/);
  assert.match(s, new RegExp(`height="${EMBED_HEIGHT.card}"`));
  assert.match(s, /><\/iframe>$/);
  assert.doesNotMatch(s, /!/);
});

test("embedRegionOptions: every region but all_wa", () => {
  const ids = embedRegionOptions().map((r) => r.id);
  assert.ok(ids.includes("puget_sound"));
  assert.ok(!ids.includes("all_wa" as never));
});

function ac(tail: string, airborne: boolean, lat?: number, lon?: number): Aircraft {
  return {
    tail,
    icao24: "a00000",
    operator: "WSP",
    model: "Cessna 206H",
    nickname: null,
    roleDescription: "",
    base: "KOLM Olympia",
    role: "police",
    roleConfidence: "confirmed",
    sources: [],
    airborne,
    lat,
    lon,
  } as Aircraft;
}

test("restrictSnapshotToRegion: keeps birds inside, grounds those outside", () => {
  const snap = {
    fetched_at: 1,
    source: "adsbfi",
    live_seen_count: 3,
    aircraft: [
      ac("INSIDE", true, 47.6, -122.3), // Seattle, in puget_sound
      ac("OUTSIDE", true, 47.65, -117.4), // Spokane
      ac("NOPOS", true),
      ac("DOWN", false, 47.6, -122.3),
    ],
  } as Snapshot;
  const out = restrictSnapshotToRegion(snap, "puget_sound");
  const by = Object.fromEntries(out.aircraft.map((a) => [a.tail, a.airborne]));
  assert.deepStrictEqual(by, { INSIDE: true, OUTSIDE: false, NOPOS: false, DOWN: false });
  // input is not mutated
  assert.strictEqual(snap.aircraft[1]!.airborne, true);
});

const T = Date.parse("2026-11-18T15:12:00Z");

test("embedDisplay: no read is stale, never down", () => {
  assert.deepStrictEqual(embedDisplay(null, T), { kind: "stale", count: 0, readAt: null });
});

test("embedDisplay: fresh up and down pass through", () => {
  const up = embedDisplay({ state: "up", count: 2, ageS: 5, receivedAt: T }, T + 1000);
  assert.strictEqual(up.kind, "up");
  assert.strictEqual(up.count, 2);
  assert.strictEqual(up.readAt, T + 1000 - 6000);
  assert.strictEqual(
    embedDisplay({ state: "down", count: 0, ageS: 30, receivedAt: T }, T).kind,
    "down",
  );
});

test("embedDisplay: server stale stays stale", () => {
  assert.strictEqual(
    embedDisplay({ state: "stale", count: 1, ageS: 400, receivedAt: T }, T).kind,
    "stale",
  );
});

test("embedDisplay: a down read that ages past two minutes in the tab goes stale", () => {
  const read = { state: "down" as const, count: 0, ageS: 60, receivedAt: T };
  assert.strictEqual(embedDisplay(read, T + 30_000).kind, "down");
  assert.strictEqual(embedDisplay(read, T + 90_000).kind, "stale");
});

test("embedDisplay: unknown age is stale", () => {
  assert.strictEqual(
    embedDisplay({ state: "down", count: 0, ageS: null, receivedAt: T }, T).kind,
    "stale",
  );
});

test("restrictSnapshotToRegion: null region passes the snapshot through", () => {
  const snap = {
    fetched_at: 1,
    source: "adsbfi",
    live_seen_count: 1,
    aircraft: [ac("A", true, 47.65, -117.4)],
  } as Snapshot;
  assert.strictEqual(restrictSnapshotToRegion(snap, null), snap);
});
