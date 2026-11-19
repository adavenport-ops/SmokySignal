// Run: npx tsx --test lib/share-text.test.ts
//
// Share lines for /seen answers, town pages and finished flight replays.
// The rule that matters: no coordinate ever rides in the text, and the
// /seen URL beside it carries the rider's point rounded to 2 decimals.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COORD_LIKE_RE, flightShareText, seenShareText, townShareText } from "./share-text";
import { parseSeenPageParams, seenPageHref, type SeenBody, type SeenItem } from "./seen-view";

const T = Date.parse("2026-11-18T22:32:00Z"); // 14:32 PST

function item(over: Partial<SeenItem> = {}): SeenItem {
  return {
    tail: "N2446X",
    name: "Smokey 3",
    nickname: "Smokey 3",
    operator: "WSP",
    airframe: "Cessna 206H",
    mission: "police",
    mission_label: "Smokey",
    mission_badge: "SMOKEY",
    smokey: true,
    closest: {
      ts: T,
      lat: 47.241234,
      lon: -122.361234,
      alt_ft: 1500,
      distance_nm: 0.4,
      distance_mi: 0.46,
      bearing_deg: 10,
      direction: "north",
    },
    pattern: { working: false, over: null },
    corridor: null,
    near: "Fife",
    departure: null,
    flight: null,
    track: [],
    ...over,
  };
}

function body(aircraft: SeenItem[], area: string | null = "Fife"): Pick<SeenBody, "query" | "aircraft" | "area"> {
  return {
    query: {
      lat: 47.24,
      lon: -122.36,
      t: "2026-11-18T22:30:00Z",
      window_min: 30,
      radius_nm: 4.34,
      radius_mi: 5,
      from_ts: Date.parse("2026-11-18T22:00:00Z"),
      to_ts: Date.parse("2026-11-18T23:00:00Z"),
    },
    area,
    aircraft,
  };
}

test("seen: 'That was Smokey 3 over Fife at 14:32.'", () => {
  assert.equal(seenShareText(body([item()]), "Fife"), "That was Smokey 3 over Fife at 14:32.");
  assert.equal(
    seenShareText(body([item(), item({ tail: "N1", name: "N1" })]), "Fife"),
    "That was Smokey 3 over Fife at 14:32. 1 more passed nearby.",
  );
  assert.equal(seenShareText(body([item()]), "Fife", { hour12: true }), "That was Smokey 3 over Fife at 2:32 PM.");
});

test("seen with the rider's own spot: a town name, never the point", () => {
  // No picked place: the API's area name, then the aircraft's nearest place.
  assert.equal(seenShareText(body([item()], "Puyallup"), null), "That was Smokey 3 over Puyallup at 14:32.");
  assert.equal(seenShareText(body([item()], null), null), "That was Smokey 3 over Fife at 14:32.");
  assert.equal(seenShareText(body([item({ near: null })], null), null), "That was Smokey 3 overhead at 14:32.");
  // A coordinate-looking "place" is dropped, not printed.
  assert.equal(seenShareText(body([item({ near: null })], null), "47.24, -122.36"), "That was Smokey 3 overhead at 14:32.");
  for (const t of [
    seenShareText(body([item()]), null),
    seenShareText(body([item({ near: "47.2412" })], null), null),
    seenShareText(body([]), null),
  ]) {
    assert.ok(!COORD_LIKE_RE.test(t), t);
    assert.ok(!/47\.|122\./.test(t), t);
  }
});

test("seen: an empty answer says what we checked, never 'clear'", () => {
  const t = seenShareText(body([]), "Fife");
  assert.equal(t, "Nothing we tracked passed within 5 mi of Fife between 14:00 and 15:00.");
  assert.ok(!/clear|safe/i.test(t));
});

test("the /seen URL that rides along rounds the point to 2 decimals", () => {
  const s = parseSeenPageParams({ lat: "47.241234", lon: "-122.361234", date: "2026-11-18", time: "14:32" }, T);
  const href = seenPageHref(s);
  assert.match(href, /lat=47\.24&lon=-122\.36/);
  assert.ok(!/\d\.\d{3,}/.test(href), href);
});

test("town and flight share lines", () => {
  assert.equal(townShareText("Puyallup", 12), "Over Puyallup this month: 12 flights. Live check and the 30-day log:");
  assert.equal(
    flightShareText({ tail: "N305DK", nickname: "Smokey 4", startMs: T, durationS: 4320 }),
    "Smokey 4 (N305DK) flew 1h 12m on 2026-11-18. Replay it:",
  );
  assert.equal(flightShareText({ tail: "N1", nickname: null, startMs: T, durationS: 600 }), "N1 flew 10m on 2026-11-18. Replay it:");
  for (const s of [townShareText("Fife", 1), flightShareText({ tail: "N1", nickname: " ", startMs: T, durationS: 60 })]) {
    assert.ok(!/[A-Za-z]!/.test(s));
  }
});
