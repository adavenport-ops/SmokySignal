// Run: npx tsx --test lib/flights.test.ts
//
// Pins the share-link contract: every session's flightId must resolve
// back to that session. Regression: a ±30s tolerance around the
// minute-truncated id missed sessions starting in the back half of a
// minute, so /flight share links showed "Flight not available".

import { test } from "node:test";
import assert from "node:assert";
import { flightIdFromTs, parseFlightId, sessionMatchesFlightId } from "./flights";

test("flightId round-trips for a session starting at :45 seconds", () => {
  const start = Date.UTC(2026, 10, 18, 0, 32, 45);
  const id = flightIdFromTs(start);
  assert.equal(id, "20261118T0032");
  const parsed = parseFlightId(id)!;
  assert.ok(sessionMatchesFlightId(start, parsed.tsMs));
});

test("flightId round-trips across every second of a minute", () => {
  for (let s = 0; s < 60; s++) {
    const start = Date.UTC(2026, 4, 1, 6, 29, s, 500);
    const parsed = parseFlightId(flightIdFromTs(start))!;
    assert.ok(sessionMatchesFlightId(start, parsed.tsMs), `second ${s}`);
  }
});

test("adjacent minute does not match", () => {
  const start = Date.UTC(2026, 10, 18, 0, 33, 5);
  const parsed = parseFlightId("20261118T0032")!;
  assert.equal(sessionMatchesFlightId(start, parsed.tsMs), false);
});
