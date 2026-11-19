// Run: npx tsx --test lib/bots/spoken.test.ts
//
// The read-aloud formatter: short sentences, spoken numbers, no symbols
// beyond basic punctuation.

import { test } from "node:test";
import assert from "node:assert";
import {
  formatSpokenAlert,
  formatSpokenStatus,
  sanitizeSpoken,
  spokenAltitude,
  spokenName,
  spokenPlace,
} from "./spoken";
import { computeStatus, makeFleetMap } from "../status";
import { FLEET } from "../seed";
import type { Aircraft, Snapshot } from "../types";

// 14:22 PT on 2026-11-18 (PST, UTC-8).
const T = Date.parse("2026-11-18T22:22:00Z");
const SAFE = /^[A-Za-z0-9 .,:'\-]+$/;

test("formatSpokenAlert: the canonical example", () => {
  const s = formatSpokenAlert({
    tail: "N305DK",
    nickname: "Smokey 4",
    mission: "police",
    lat: 47.2402,
    lon: -122.3605,
    alt_ft: 2580,
    tsMs: T,
  });
  assert.equal(s, "Smokey 4 up. I-5 near Fife. 2,600 feet. 14:22.");
  assert.match(s, SAFE);
});

test("formatSpokenAlert: no nickname spells the tail; no fix drops the place", () => {
  const s = formatSpokenAlert({
    tail: "N305DK",
    nickname: null,
    mission: "police",
    lat: null,
    lon: null,
    alt_ft: null,
    tsMs: T,
  });
  assert.equal(s, "N 3 0 5 D K up. 14:22.");
});

test("formatSpokenAlert: non-Smokey missions say what they are", () => {
  const s = formatSpokenAlert({
    tail: "N338WN",
    nickname: "Fire 1",
    mission: "wildfire",
    lat: 46.7,
    lon: -120.6,
    alt_ft: 5049,
    tsMs: T,
  });
  assert.equal(s, "Fire 1 up. Fire run. Over Central WA. 5,000 feet. 14:22.");
  assert.match(s, SAFE);
});

test("sanitizeSpoken strips symbols and emoji, keeps basic punctuation", () => {
  assert.equal(sanitizeSpoken("Smokey 4 · I-5 / Fife"), "Smokey 4, I-5, Fife");
  assert.equal(sanitizeSpoken("Bird \u{1F985} #1 (WSP)"), "Bird 1 WSP");
  assert.equal(spokenName("Hawk’s *Eye*", "N1"), "Hawk s Eye");
  assert.equal(spokenAltitude(40), "100 feet");
  assert.equal(spokenAltitude(12_345), "12,300 feet");
  assert.equal(spokenAltitude(null), null);
  assert.equal(spokenPlace(47.6, -117.4)?.phrase, "over East WA");
});

function snap(up: Array<{ tail: string; lat?: number; lon?: number; alt?: number }>, fetched = T): Snapshot {
  const byTail = new Map(up.map((u) => [u.tail, u]));
  return {
    fetched_at: fetched,
    source: "adsbfi",
    live_seen_count: 10,
    aircraft: FLEET.map((f): Aircraft => {
      const u = byTail.get(f.tail);
      return {
        ...f,
        icao24: "a00000",
        airborne: Boolean(u),
        ...(u?.lat != null ? { lat: u.lat, lon: u.lon, altitude_ft: u.alt } : {}),
      };
    }),
  } as Snapshot;
}

test("formatSpokenStatus: up, multiple up, down, stale; one sentence each", () => {
  const nick = FLEET.find((f) => f.tail === "N305DK")!.nickname ?? "N 3 0 5 D K";
  const one = snap([{ tail: "N305DK", lat: 47.2402, lon: -122.3605 }]);
  const s1 = formatSpokenStatus({ state: "up", status: computeStatus(one, makeFleetMap(one.aircraft)), fetchedAt: T });
  assert.equal(s1, `Smokey's up, ${nick} on I-5 near Fife, as of 14:22.`);

  const two = snap([{ tail: "N305DK", lat: 47.2402, lon: -122.3605 }, { tail: "N815SC", lat: 47.9, lon: -122.2 }]);
  const s2 = formatSpokenStatus({ state: "up", status: computeStatus(two, makeFleetMap(two.aircraft)), fetchedAt: T });
  assert.match(s2, /^Smokey's up, 2 birds, lead is .+, as of 14:22\.$/);

  const none = snap([]);
  const s3 = formatSpokenStatus({ state: "down", status: computeStatus(none, makeFleetMap(none.aircraft)), fetchedAt: T });
  assert.equal(s3, "Smokey's down, no bird up over Washington, as of 14:22.");

  assert.equal(formatSpokenStatus({ state: "stale", status: null, fetchedAt: T }), "Feed's quiet, last good read 14:22.");
  assert.equal(formatSpokenStatus({ state: "stale", status: null, fetchedAt: null }), "Feed's quiet, no good read yet.");

  for (const s of [s1, s2, s3]) {
    assert.match(s, SAFE);
    assert.equal(s.split(". ").length, 1, `one sentence: ${s}`);
    assert.ok(!/send it/i.test(s));
  }
});
